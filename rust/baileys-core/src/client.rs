use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::auth::{AuthError, FileAuthState};
use crate::connection::WsConnection;
use crate::events::BotEvent;
use crate::message::MessageBuilder;
use crate::noise::crypto::aes_ctr_encrypt;
use crate::protocol::{BinaryNode, ProtocolError};
use rand::RngCore;

pub struct WhatsAppClientCore {
    pub auth: Arc<Mutex<FileAuthState>>,
    pub outgoing_tx: mpsc::UnboundedSender<BinaryNode>,
    pub outgoing_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<BinaryNode>>>>,
    pub event_tx: mpsc::UnboundedSender<BotEvent>,
    pub event_rx: Arc<Mutex<mpsc::UnboundedReceiver<BotEvent>>>,
    pub is_open: Arc<AtomicBool>,
    pub print_qr_terminal: bool,
}

impl WhatsAppClientCore {
    pub fn new(auth_folder: &str) -> Result<Self, AuthError> {
        let auth = Arc::new(Mutex::new(FileAuthState::load_or_create(auth_folder)?));
        let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel::<BinaryNode>();
        let (event_tx, event_rx) = mpsc::unbounded_channel::<BotEvent>();

        Ok(Self {
            auth,
            outgoing_tx,
            outgoing_rx: Arc::new(Mutex::new(Some(outgoing_rx))),
            event_tx,
            event_rx: Arc::new(Mutex::new(event_rx)),
            is_open: Arc::new(AtomicBool::new(false)),
            print_qr_terminal: true,
        })
    }

    pub fn with_print_qr(mut self, print_qr: bool) -> Self {
        self.print_qr_terminal = print_qr;
        self
    }

    pub fn is_open(&self) -> bool {
        self.is_open.load(Ordering::SeqCst)
    }

    pub async fn get_user_id(&self) -> Option<String> {
        let lock = self.auth.lock().await;
        lock.creds.me.as_ref().map(|m| m.id.clone())
    }

    pub async fn get_auth_snapshot(&self) -> crate::auth::AuthenticationCreds {
        let lock = self.auth.lock().await;
        lock.creds.clone()
    }

    pub async fn start_connection_async(&self) {
        let auth_clone = self.auth.clone();
        let event_tx_clone = self.event_tx.clone();
        let is_open_clone = self.is_open.clone();
        let print_qr = self.print_qr_terminal;

        let mut rx_guard = self.outgoing_rx.lock().await;
        let rx = match rx_guard.take() {
            Some(r) => r,
            None => {
                let (_, new_rx) = mpsc::unbounded_channel::<BinaryNode>();
                new_rx
            }
        };

        let creds = {
            let lock = auth_clone.lock().await;
            Arc::new(Mutex::new(lock.creds.clone()))
        };

        let conn = WsConnection::new(creds, event_tx_clone, is_open_clone, print_qr);
        conn.start(rx).await;
    }

    pub fn start_connection(&self) {
        let auth_clone = self.auth.clone();
        let event_tx_clone = self.event_tx.clone();
        let is_open_clone = self.is_open.clone();
        let print_qr = self.print_qr_terminal;
        let rx_arc = self.outgoing_rx.clone();

        tokio::spawn(async move {
            let mut rx_guard = rx_arc.lock().await;
            let rx = match rx_guard.take() {
                Some(r) => r,
                None => {
                    let (_, new_rx) = mpsc::unbounded_channel::<BinaryNode>();
                    new_rx
                }
            };

            let creds = {
                let lock = auth_clone.lock().await;
                Arc::new(Mutex::new(lock.creds.clone()))
            };

            let conn = WsConnection::new(creds, event_tx_clone, is_open_clone, print_qr);
            conn.start(rx).await;
        });
    }

    pub async fn request_pairing_code(&self, phone_number: &str) -> Result<String, AuthError> {
        let mut rng = rand::thread_rng();
        let mut rand_5 = [0u8; 5];
        rng.fill_bytes(&mut rand_5);
        let raw_code = crate::noise::crypto::bytes_to_crockford(&rand_5);

        let mut salt = [0u8; 32];
        let mut random_iv = [0u8; 16];
        rng.fill_bytes(&mut salt);
        rng.fill_bytes(&mut random_iv);

        let key = crate::noise::crypto::derive_pairing_code_key(&raw_code, &salt);

        let mut auth_guard = self.auth.lock().await;
        let encrypted_ephemeral = aes_ctr_encrypt(
            &key,
            &random_iv,
            &auth_guard.creds.pairing_ephemeral_key_pair.public,
        )
        .map_err(|_| AuthError::KeyNotFound)?;

        let mut wrapped_ephemeral = Vec::with_capacity(80);
        wrapped_ephemeral.extend_from_slice(&salt);
        wrapped_ephemeral.extend_from_slice(&random_iv);
        wrapped_ephemeral.extend_from_slice(&encrypted_ephemeral);

        let noise_pub = auth_guard.creds.noise_key.public.clone();
        auth_guard.creds.pairing_code = Some(raw_code.clone());
        auth_guard.creds.me = Some(crate::auth::ContactInfo {
            id: format!("{}@s.whatsapp.net", phone_number),
            name: Some("~".to_string()),
            notify: None,
            verified_name: None,
        });
        let _ = auth_guard.save_creds();
        drop(auth_guard);

        let wrapped_node = BinaryNode::new("link_code_pairing_wrapped_companion_ephemeral_pub")
            .with_bytes_content(wrapped_ephemeral);
        let companion_auth = BinaryNode::new("companion_server_auth_key_pub")
            .with_bytes_content(noise_pub);
        let platform_id = BinaryNode::new("companion_platform_id")
            .with_string_content("1");
        let platform_display = BinaryNode::new("companion_platform_display")
            .with_string_content("Chrome (Ubuntu)");
        let nonce = BinaryNode::new("link_code_pairing_nonce")
            .with_string_content("0");

        let comp_reg = BinaryNode::new("link_code_companion_reg")
            .with_attr("jid", format!("{}@s.whatsapp.net", phone_number))
            .with_attr("stage", "companion_hello")
            .with_attr("should_show_push_notification", "true")
            .with_children(vec![wrapped_node, companion_auth, platform_id, platform_display, nonce]);

        let msg_id = format!("3EB0{}", hex::encode(rand::random::<[u8; 8]>()));
        let iq_node = BinaryNode::new("iq")
            .with_attr("to", "@s.whatsapp.net")
            .with_attr("type", "set")
            .with_attr("id", &msg_id)
            .with_attr("xmlns", "md")
            .with_children(vec![comp_reg]);

        let _ = self.outgoing_tx.send(iq_node);

        Ok(raw_code)
    }

    pub async fn send_message(&self, to_jid: &str, text: &str) -> Result<String, ProtocolError> {
        let msg = MessageBuilder::create_text_message(text, None, None, vec![]);
        let (msg_id, node) = MessageBuilder::build_send_message_node(to_jid, &msg, None)?;
        let _ = self.outgoing_tx.send(node);
        Ok(msg_id)
    }

    pub async fn send_raw_node(&self, node: BinaryNode) {
        let _ = self.outgoing_tx.send(node);
    }
}
