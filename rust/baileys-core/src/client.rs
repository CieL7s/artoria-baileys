use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::auth::{AuthError, FileAuthState};
use crate::connection::WsConnection;
use crate::events::BotEvent;
use crate::message::MessageBuilder;
use crate::protocol::{BinaryNode, ProtocolError};

pub struct WhatsAppClientCore {
    pub auth: Arc<Mutex<FileAuthState>>,
    pub outgoing_tx: mpsc::UnboundedSender<BinaryNode>,
    pub event_tx: mpsc::UnboundedSender<BotEvent>,
    pub event_rx: Arc<Mutex<mpsc::UnboundedReceiver<BotEvent>>>,
}

impl WhatsAppClientCore {
    pub fn new(auth_folder: &str) -> Result<Self, AuthError> {
        let auth = Arc::new(Mutex::new(FileAuthState::load_or_create(auth_folder)?));
        let (outgoing_tx, _) = mpsc::unbounded_channel::<BinaryNode>();
        let (event_tx, event_rx) = mpsc::unbounded_channel::<BotEvent>();

        Ok(Self {
            auth,
            outgoing_tx,
            event_tx,
            event_rx: Arc::new(Mutex::new(event_rx)),
        })
    }

    pub async fn start_connection_async(&self) {
        let auth_clone = self.auth.clone();
        let event_tx_clone = self.event_tx.clone();
        let (_out_tx, out_rx) = mpsc::unbounded_channel::<BinaryNode>();

        let creds = {
            let lock = auth_clone.lock().await;
            Arc::new(Mutex::new(lock.creds.clone()))
        };

        let conn = WsConnection::new(creds, event_tx_clone);
        conn.start(out_rx).await;
    }

    pub fn start_connection(&self) {
        let auth_clone = self.auth.clone();
        let event_tx_clone = self.event_tx.clone();
        let (_out_tx, out_rx) = mpsc::unbounded_channel::<BinaryNode>();

        tokio::spawn(async move {
            let creds = {
                let lock = auth_clone.lock().await;
                Arc::new(Mutex::new(lock.creds.clone()))
            };

            let conn = WsConnection::new(creds, event_tx_clone);
            conn.start(out_rx).await;
        });
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
