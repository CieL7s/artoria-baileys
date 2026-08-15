use futures_util::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};
use tracing::{error, info, warn};

use crate::auth::AuthenticationCreds;
use crate::events::BotEvent;
use crate::message::MessageParser;
use crate::noise::crypto::{aes_gcm_decrypt, aes_gcm_encrypt, curve25519_shared_key, generate_iv, hkdf_sha256, sha256, CryptoError};
use crate::noise::framing::{encode_frame, FrameBuffer};
use crate::noise::TransportState;
use crate::proto::{
    AppVersion, ClientFinish, ClientHello, ClientPayload, DevicePairingData, DeviceProps,
    HandshakeMessage, HistorySyncConfig, UserAgent, WebInfo,
};
use crate::protocol::{decode_binary_node, encode_binary_node, BinaryNode, BinaryNodeContent};
use base64::Engine;

pub const DEFAULT_WA_WEBSOCKET_URL: &str = "wss://web.whatsapp.com/ws/chat";
pub const NOISE_HEADER: &[u8] = b"WA\x06\x03";
pub const NOISE_MODE: &[u8] = b"Noise_XX_25519_AESGCM_SHA256\0\0\0\0";

pub struct NoiseHandler {
    hash: [u8; 32],
    salt: [u8; 32],
    enc_key: [u8; 32],
    dec_key: [u8; 32],
    counter: u32,
    ephemeral_priv: [u8; 32],
    ephemeral_pub: [u8; 32],
    noise_priv: [u8; 32],
    noise_pub: [u8; 32],
    pub transport: Option<TransportState>,
}

impl NoiseHandler {
    pub fn new(noise_priv: [u8; 32], noise_pub: [u8; 32]) -> Self {
        let (ephemeral_pub, ephemeral_priv) = {
            let mut rng = rand::thread_rng();
            let mut priv_b = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rng, &mut priv_b);
            let sec = x25519_dalek::StaticSecret::from(priv_b);
            let pub_k = x25519_dalek::PublicKey::from(&sec);
            (pub_k.to_bytes(), priv_b)
        };

        let mut mode_raw = [0u8; 32];
        mode_raw.copy_from_slice(NOISE_MODE);
        let mut handler = Self {
            hash: mode_raw,
            salt: mode_raw,
            enc_key: mode_raw,
            dec_key: mode_raw,
            counter: 0,
            ephemeral_priv,
            ephemeral_pub,
            noise_priv,
            noise_pub,
            transport: None,
        };

        handler.authenticate(NOISE_HEADER);
        handler.authenticate(&ephemeral_pub);
        handler
    }

    pub fn get_ephemeral_pub(&self) -> [u8; 32] {
        self.ephemeral_pub
    }

    pub fn authenticate(&mut self, data: &[u8]) {
        if self.transport.is_none() {
            let mut combined = Vec::with_capacity(32 + data.len());
            combined.extend_from_slice(&self.hash);
            combined.extend_from_slice(data);
            self.hash = sha256(&combined);
        }
    }

    pub fn local_hkdf(&self, data: &[u8]) -> ([u8; 32], [u8; 32]) {
        let out = hkdf_sha256(&self.salt, data, b"", 64).unwrap_or_else(|_| vec![0u8; 64]);
        let mut write = [0u8; 32];
        let mut read = [0u8; 32];
        write.copy_from_slice(&out[0..32]);
        read.copy_from_slice(&out[32..64]);
        (write, read)
    }

    pub fn mix_into_key(&mut self, data: &[u8]) {
        let (write, read) = self.local_hkdf(data);
        self.salt = write;
        self.enc_key = read;
        self.dec_key = read;
        self.counter = 0;
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if let Some(t) = &mut self.transport {
            return t.encrypt(plaintext);
        }
        let iv = generate_iv(self.counter);
        self.counter += 1;
        let res = aes_gcm_encrypt(&self.enc_key, &iv, &self.hash, plaintext)?;
        self.authenticate(&res);
        Ok(res)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if let Some(t) = &mut self.transport {
            return t.decrypt(ciphertext);
        }
        let iv = generate_iv(self.counter);
        self.counter += 1;
        let res = aes_gcm_decrypt(&self.dec_key, &iv, &self.hash, ciphertext)?;
        self.authenticate(ciphertext);
        Ok(res)
    }

    pub fn process_server_hello(
        &mut self,
        hs_msg: &HandshakeMessage,
        creds: &AuthenticationCreds,
    ) -> Result<HandshakeMessage, CryptoError> {
        let srv_hello = hs_msg.server_hello.as_ref().ok_or(CryptoError::HkdfError)?;
        let srv_eph = srv_hello.ephemeral.as_ref().ok_or(CryptoError::HkdfError)?;
        self.authenticate(srv_eph);

        let mut srv_eph_32 = [0u8; 32];
        srv_eph_32.copy_from_slice(&srv_eph[..32]);
        let shared1 = curve25519_shared_key(&self.ephemeral_priv, &srv_eph_32);
        self.mix_into_key(&shared1);

        let srv_static = srv_hello.r#static.as_ref().ok_or(CryptoError::HkdfError)?;
        let dec_static = self.decrypt(srv_static)?;
        let mut dec_static_32 = [0u8; 32];
        dec_static_32.copy_from_slice(&dec_static[..32]);
        let shared2 = curve25519_shared_key(&self.ephemeral_priv, &dec_static_32);
        self.mix_into_key(&shared2);

        let srv_payload = srv_hello.payload.as_ref().ok_or(CryptoError::HkdfError)?;
        let _dec_cert = self.decrypt(srv_payload)?;

        let noise_pub = self.noise_pub;
        let noise_priv = self.noise_priv;
        let enc_noise_key = self.encrypt(&noise_pub)?;
        let shared3 = curve25519_shared_key(&noise_priv, &srv_eph_32);
        self.mix_into_key(&shared3);

        // Build Client Payload
        let client_payload = if creds.registered && creds.me.is_some() {
            let me_jid = &creds.me.as_ref().unwrap().id;
            let decoded = crate::protocol::jid::jid_decode(me_jid);
            let user_num: u64 = decoded.as_ref().and_then(|d| d.user.parse::<u64>().ok()).unwrap_or(0);
            let device_num: Option<u32> = decoded.as_ref().and_then(|d| d.device.map(|dev| dev as u32));

            println!("[WS Login] Connecting with username={}, device={:?}, jid={}", user_num, device_num, me_jid);

            ClientPayload {
                username: Some(user_num),
                device: device_num,
                passive: Some(true),
                pull: Some(true),
                lid_db_migrated: Some(false),
                user_agent: Some(UserAgent {
                    platform: Some(14), // WEB = 14
                    app_version: Some(AppVersion {
                        primary: Some(2),
                        secondary: Some(3000),
                        tertiary: Some(1043857760),
                        quaternary: None,
                    }),
                    os_version: Some("0.1".to_string()),
                    device: Some("Desktop".to_string()),
                    os_build_number: Some("0.1".to_string()),
                    release_channel: Some(0),
                    locale_language_iso_639_1: Some("en".to_string()),
                    locale_country_iso_3166_1_alpha_2: Some("US".to_string()),
                    ..Default::default()
                }),
                web_info: Some(WebInfo {
                    web_sub_platform: Some(0),
                    ..Default::default()
                }),
                connect_type: Some(1),
                connect_reason: Some(1),
                ..Default::default()
            }
        } else {
            let mut device_props_bytes = Vec::new();
            let device_props = DeviceProps {
                os: Some("Ubuntu".to_string()),
                version: Some(AppVersion {
                    primary: Some(10),
                    secondary: Some(15),
                    tertiary: Some(7),
                    quaternary: None,
                }),
                platform_type: Some(1), // Chrome
                require_full_sync: Some(false),
                history_sync_config: Some(HistorySyncConfig {
                    storage_quota_mb: Some(10240),
                    inline_initial_payload_in_e2_ee_msg: Some(true),
                    recent_sync_days_limit: None,
                    support_call_log_history: Some(false),
                    support_bot_user_agent_chat_history: Some(true),
                    support_cag_reactions_and_polls: Some(true),
                    support_biz_hosted_msg: Some(true),
                    support_recent_sync_chunk_message_count_tuning: Some(true),
                    support_hosted_group_msg: Some(true),
                    support_fbid_bot_chat_history: Some(true),
                    support_add_on_history_sync_migration: None,
                    support_message_association: Some(true),
                    support_group_history: Some(false),
                    on_demand_ready: None,
                    support_guest_chat: None,
                    ..Default::default()
                }),
            };
            let _ = device_props.encode(&mut device_props_bytes);

            let mut reg_id_bytes = vec![0u8; 4];
            reg_id_bytes[0] = ((creds.registration_id >> 24) & 0xff) as u8;
            reg_id_bytes[1] = ((creds.registration_id >> 16) & 0xff) as u8;
            reg_id_bytes[2] = ((creds.registration_id >> 8) & 0xff) as u8;
            reg_id_bytes[3] = (creds.registration_id & 0xff) as u8;

            let mut skey_id_bytes = vec![0u8; 3];
            skey_id_bytes[0] = ((creds.signed_pre_key.key_id >> 16) & 0xff) as u8;
            skey_id_bytes[1] = ((creds.signed_pre_key.key_id >> 8) & 0xff) as u8;
            skey_id_bytes[2] = (creds.signed_pre_key.key_id & 0xff) as u8;

            ClientPayload {
                passive: Some(false),
                pull: Some(false),
                user_agent: Some(UserAgent {
                    platform: Some(14), // WEB = 14
                    app_version: Some(AppVersion {
                        primary: Some(2),
                        secondary: Some(3000),
                        tertiary: Some(1043857760),
                        quaternary: None,
                    }),
                    os_version: Some("0.1".to_string()),
                    device: Some("Desktop".to_string()),
                    os_build_number: Some("0.1".to_string()),
                    release_channel: Some(0),
                    locale_language_iso_639_1: Some("en".to_string()),
                    locale_country_iso_3166_1_alpha_2: Some("US".to_string()),
                    ..Default::default()
                }),
                web_info: Some(WebInfo {
                    web_sub_platform: Some(0),
                    ..Default::default()
                }),
                connect_type: Some(1),
                connect_reason: Some(1),
                device_pairing_data: Some(DevicePairingData {
                    build_hash: {
                        use md5::{Digest, Md5};
                        let mut h = Md5::new();
                        h.update(b"2.3000.1043857760");
                        Some(h.finalize().to_vec())
                    },
                    device_props: Some(device_props_bytes),
                    e_regid: Some(reg_id_bytes),
                    e_keytype: Some(vec![0x05]),
                    e_ident: Some(creds.signed_identity_key.public.clone()),
                    e_skey_id: Some(skey_id_bytes),
                    e_skey_val: Some(creds.signed_pre_key.key_pair.public.clone()),
                    e_skey_sig: Some(creds.signed_pre_key.signature.clone()),
                }),
                ..Default::default()
            }
        };

        let mut payload_buf = Vec::new();
        client_payload.encode(&mut payload_buf).map_err(|_| CryptoError::HkdfError)?;
        let enc_payload = self.encrypt(&payload_buf)?;

        // Transition to transport state!
        let (write_key, read_key) = self.local_hkdf(&[]);
        self.transport = Some(TransportState::new(write_key, read_key));

        Ok(HandshakeMessage {
            client_hello: None,
            server_hello: None,
            client_finish: Some(ClientFinish {
                r#static: Some(enc_noise_key),
                payload: Some(enc_payload),
            }),
        })
    }
}

pub struct WsConnection {
    url: String,
    creds: Arc<Mutex<AuthenticationCreds>>,
    event_tx: mpsc::UnboundedSender<BotEvent>,
    send_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    is_open: Arc<AtomicBool>,
    print_qr_terminal: bool,
    auth_folder: Option<std::path::PathBuf>,
}

impl WsConnection {
    pub fn new(
        creds: Arc<Mutex<AuthenticationCreds>>,
        event_tx: mpsc::UnboundedSender<BotEvent>,
        is_open: Arc<AtomicBool>,
        print_qr_terminal: bool,
        auth_folder: Option<std::path::PathBuf>,
    ) -> Self {
        Self {
            url: DEFAULT_WA_WEBSOCKET_URL.to_string(),
            creds,
            event_tx,
            send_tx: None,
            is_open,
            print_qr_terminal,
            auth_folder,
        }
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = url.into();
        self
    }

    pub async fn start(
        mut self,
        mut outgoing_rx: mpsc::UnboundedReceiver<BinaryNode>,
    ) {
        info!("Connecting to WhatsApp WebSocket at {}...", self.url);

        let ws_stream = {
            let req_res = tokio_tungstenite::tungstenite::handshake::client::Request::builder()
                .uri(&self.url)
                .header("Host", "web.whatsapp.com")
                .header("Origin", "https://web.whatsapp.com")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .header("Upgrade", "websocket")
                .header("Connection", "Upgrade")
                .header("Sec-WebSocket-Key", tokio_tungstenite::tungstenite::handshake::client::generate_key())
                .header("Sec-WebSocket-Version", "13")
                .body(());

            match req_res {
                Ok(req) => match connect_async(req).await {
                    Ok((stream, _)) => {
                        info!("WebSocket connection established with WhatsApp Origin!");
                        stream
                    }
                    Err(e) => {
                        warn!("Custom header WebSocket failed ({}), falling back to direct connect...", e);
                        match connect_async(&self.url).await {
                            Ok((stream, _)) => stream,
                            Err(e2) => {
                                error!("WebSocket connection error: {}", e2);
                                let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                                    connection: Some("close".to_string()),
                                    status: format!("error: {}", e2),
                                    qr: None,
                                    is_logged_in: false,
                                    is_new_login: None,
                                    last_disconnect: Some(serde_json::json!({
                                        "error": { "message": e2.to_string(), "output": { "statusCode": 500 } }
                                    })),
                                });
                                return;
                            }
                        }
                    }
                },
                Err(_) => match connect_async(&self.url).await {
                    Ok((stream, _)) => stream,
                    Err(e) => {
                        error!("WebSocket connection error: {}", e);
                        let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                            connection: Some("close".to_string()),
                            status: format!("error: {}", e),
                            qr: None,
                            is_logged_in: false,
                            is_new_login: None,
                            last_disconnect: Some(serde_json::json!({
                                "error": { "message": e.to_string(), "output": { "statusCode": 500 } }
                            })),
                        });
                        return;
                    }
                }
            }
        };

        let (mut ws_write, mut ws_read) = ws_stream.split();
        let (send_raw_tx, mut send_raw_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.send_tx = Some(send_raw_tx.clone());

        // Prepare Noise Handler
        let (noise_priv, noise_pub) = {
            let lock = self.creds.lock().await;
            let mut priv_b = [0u8; 32];
            let mut pub_b = [0u8; 32];
            priv_b.copy_from_slice(&lock.noise_key.private[..32]);
            pub_b.copy_from_slice(&lock.noise_key.public[..32]);
            (priv_b, pub_b)
        };

        let noise_handler = Arc::new(Mutex::new(NoiseHandler::new(noise_priv, noise_pub)));
        let ephemeral_pub = {
            let lock = noise_handler.lock().await;
            lock.get_ephemeral_pub()
        };

        // Prepare initial Noise ClientHello
        let client_hello = ClientHello {
            ephemeral: Some(ephemeral_pub.to_vec()),
            r#static: None,
            payload: None,
        };

        let hs_msg = HandshakeMessage {
            client_hello: Some(client_hello),
            server_hello: None,
            client_finish: None,
        };

        let mut hs_bytes = Vec::new();
        let _ = hs_msg.encode(&mut hs_bytes);

        // Frame 0 contains NOISE_HEADER prefix
        let first_frame = encode_frame(&hs_bytes, Some(NOISE_HEADER));
        if let Err(e) = ws_write.send(WsMessage::Binary(first_frame)).await {
            error!("Failed to send ClientHello handshake frame: {}", e);
            return;
        }

        let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
            connection: Some("connecting".to_string()),
            status: "connecting".to_string(),
            qr: None,
            is_logged_in: false,
            is_new_login: None,
            last_disconnect: None,
        });

        // Spawn Outgoing Node Worker
        let noise_writer = noise_handler.clone();
        let send_raw_worker = send_raw_tx.clone();
        tokio::spawn(async move {
            while let Some(node) = outgoing_rx.recv().await {
                if let Ok(encoded_node) = encode_binary_node(&node) {
                    let mut lock = noise_writer.lock().await;
                    if let Ok(encrypted) = lock.encrypt(&encoded_node) {
                        let frame = encode_frame(&encrypted, None);
                        let _ = send_raw_worker.send(frame);
                    }
                }
            }
        });

        // Spawn WebSocket Writer Task
        tokio::spawn(async move {
            while let Some(frame) = send_raw_rx.recv().await {
                if let Err(e) = ws_write.send(WsMessage::Binary(frame)).await {
                    error!("WebSocket write error: {}", e);
                    break;
                }
            }
        });

        // Periodic Keep-Alive Ping Task
        let send_ping_worker = send_raw_tx.clone();
        let ping_noise = noise_handler.clone();
        let ping_is_open = self.is_open.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(25));
            loop {
                interval.tick().await;
                if ping_is_open.load(Ordering::SeqCst) {
                    let tag = format!("ping_{}", rand::random::<u32>());
                    let ping_node = BinaryNode::new("iq")
                        .with_attr("id", &tag)
                        .with_attr("to", "@s.whatsapp.net")
                        .with_attr("type", "get")
                        .with_attr("xmlns", "w:p")
                        .with_children(vec![BinaryNode::new("ping")]);

                    if let Ok(encoded) = encode_binary_node(&ping_node) {
                        let mut lock = ping_noise.lock().await;
                        if let Ok(encrypted) = lock.encrypt(&encoded) {
                            let frame = encode_frame(&encrypted, None);
                            let _ = send_ping_worker.send(frame);
                        }
                    }
                }
            }
        });

        // Frame Receiver Loop
        let mut frame_buffer = FrameBuffer::new();

        while let Some(msg_res) = ws_read.next().await {
            match msg_res {
                Ok(WsMessage::Binary(data)) => {
                    println!("[WS] Received {} bytes from WhatsApp WebSocket", data.len());
                    frame_buffer.push_data(&data);

                    while let Some(raw_frame) = frame_buffer.pop_frame() {
                        println!("[WS] Popped frame: {} bytes (transport={})", raw_frame.len(), noise_handler.lock().await.transport.is_some());
                        let mut lock = noise_handler.lock().await;

                        if lock.transport.is_some() {
                            // Decrypt transport frame
                            let dec_res = lock.decrypt(&raw_frame);
                            drop(lock); // CRITICAL: Release lock before calling handle_incoming_node to avoid deadlock!

                            match dec_res {
                                Ok(decrypted) => {
                                    println!("[WS] Successfully decrypted transport frame: {} bytes", decrypted.len());
                                    match decode_binary_node(&decrypted) {
                                        Ok(node) => {
                                            println!("[WS] Decoded BinaryNode: {:?}", node);
                                            Self::handle_incoming_node(
                                                &node,
                                                &self.event_tx,
                                                &self.creds,
                                                &noise_handler,
                                                &send_raw_tx,
                                                &self.is_open,
                                                self.print_qr_terminal,
                                                self.auth_folder.as_ref(),
                                            )
                                            .await;
                                        }
                                        Err(e) => {
                                            println!("[WS] Failed to decode BinaryNode: {:?}", e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    println!("[WS] Failed to decrypt transport frame: {:?}", e);
                                }
                            }
                        } else {
                            // Process Handshake Response (ServerHello)
                            match HandshakeMessage::decode(&raw_frame[..]) {
                                Ok(hs) => {
                                    println!("[WS] Decoded HandshakeMessage (has server_hello={})", hs.server_hello.is_some());
                                    let creds_lock = self.creds.lock().await;
                                    match lock.process_server_hello(&hs, &creds_lock) {
                                        Ok(client_finish) => {
                                            println!("[WS] ServerHello verified! Sending ClientFinish...");
                                            let mut finish_bytes = Vec::new();
                                            let _ = client_finish.encode(&mut finish_bytes);
                                            let finish_frame = encode_frame(&finish_bytes, None);
                                            let _ = send_raw_tx.send(finish_frame);
                                        }
                                        Err(e) => {
                                            println!("[WS] process_server_hello error: {:?}", e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    println!("[WS] Failed to decode HandshakeMessage protobuf: {:?}", e);
                                }
                            }
                        }
                    }
                }
                Ok(WsMessage::Ping(p)) => {
                    let _ = send_raw_tx.send(p);
                }
                Ok(WsMessage::Close(_)) => {
                    warn!("WebSocket closed by remote host");
                    self.is_open.store(false, Ordering::SeqCst);
                    let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                        connection: Some("close".to_string()),
                        status: "close".to_string(),
                        qr: None,
                        is_logged_in: false,
                        is_new_login: None,
                        last_disconnect: Some(serde_json::json!({
                            "error": { "message": "Connection Closed", "output": { "statusCode": 428 } }
                        })),
                    });
                    break;
                }
                Err(e) => {
                    error!("WebSocket read error: {}", e);
                    self.is_open.store(false, Ordering::SeqCst);
                    let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                        connection: Some("close".to_string()),
                        status: format!("error: {}", e),
                        qr: None,
                        is_logged_in: false,
                        is_new_login: None,
                        last_disconnect: Some(serde_json::json!({
                            "error": { "message": e.to_string(), "output": { "statusCode": 500 } }
                        })),
                    });
                    break;
                }
                _ => {}
            }
        }
    }

    async fn send_encrypted_node(
        node: &BinaryNode,
        noise_handler: &Arc<Mutex<NoiseHandler>>,
        send_raw_tx: &mpsc::UnboundedSender<Vec<u8>>,
    ) {
        if let Ok(encoded) = encode_binary_node(node) {
            let mut lock = noise_handler.lock().await;
            if let Ok(encrypted) = lock.encrypt(&encoded) {
                let frame = encode_frame(&encrypted, None);
                let _ = send_raw_tx.send(frame);
            }
        }
    }

    async fn handle_incoming_node(
        node: &BinaryNode,
        event_tx: &mpsc::UnboundedSender<BotEvent>,
        creds: &Arc<Mutex<AuthenticationCreds>>,
        noise_handler: &Arc<Mutex<NoiseHandler>>,
        send_tx: &mpsc::UnboundedSender<Vec<u8>>,
        is_open: &Arc<AtomicBool>,
        print_qr_terminal: bool,
        auth_folder: Option<&std::path::PathBuf>,
    ) {
        if node.tag == "message" {
            // Auto send Ack
            if let Some(msg_id) = node.get_attr("id") {
                let from_jid = node.get_attr("from").unwrap_or("@s.whatsapp.net");
                let ack_node = BinaryNode::new("ack")
                    .with_attr("id", msg_id)
                    .with_attr("class", "message")
                    .with_attr("to", from_jid);
                Self::send_encrypted_node(&ack_node, noise_handler, send_tx).await;
            }

            if let Some(msg_info) = MessageParser::parse_incoming_message(node) {
                let _ = event_tx.send(BotEvent::MessageUpsert {
                    messages: vec![msg_info],
                    r#type: "notify".to_string(),
                });
            }
        } else if node.tag == "notification" {
            // Auto-acknowledge notifications
            if let Some(msg_id) = node.get_attr("id") {
                let from_jid = node.get_attr("from").unwrap_or("@s.whatsapp.net");
                let notif_type = node.get_attr("type").unwrap_or("");
                let ack_node = BinaryNode::new("ack")
                    .with_attr("id", msg_id)
                    .with_attr("class", "notification")
                    .with_attr("type", notif_type)
                    .with_attr("to", from_jid);
                Self::send_encrypted_node(&ack_node, noise_handler, send_tx).await;
            }

            // Handle Phone Pairing Code Submission (primary_hello notification)
            if let Some(link_code) = node.get_child("link_code_companion_reg") {
                if let (Some(ref_bytes), Some(primary_ident_bytes), Some(wrapped_bytes)) = (
                    link_code.get_child_bytes("link_code_pairing_ref"),
                    link_code.get_child_bytes("primary_identity_pub"),
                    link_code.get_child_bytes("link_code_pairing_wrapped_primary_ephemeral_pub"),
                ) {
                    if wrapped_bytes.len() >= 80 && primary_ident_bytes.len() == 32 {
                        let salt = &wrapped_bytes[0..32];
                        let iv = &wrapped_bytes[32..48];
                        let ciphered_eph = &wrapped_bytes[48..80];

                        let creds_guard = creds.lock().await;
                        let pairing_code_str = creds_guard.pairing_code.clone().unwrap_or_default();
                        let pairing_ephemeral_priv = creds_guard.pairing_ephemeral_key_pair.private.clone();
                        let noise_pub = creds_guard.noise_key.public.clone();
                        let signed_ident_pub = creds_guard.signed_identity_key.public.clone();
                        let signed_prekey_pub = creds_guard.signed_pre_key.key_pair.public.clone();
                        let signed_prekey_sig = creds_guard.signed_pre_key.signature.clone();
                        let signed_prekey_id = creds_guard.signed_pre_key.key_id;
                        let adv_secret_b64 = creds_guard.adv_secret_key.clone();
                        let my_jid = creds_guard.me.as_ref().map(|m| m.id.clone()).unwrap_or_else(|| "0@s.whatsapp.net".to_string());
                        drop(creds_guard);

                        let code_clean: String = pairing_code_str.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
                        println!("[WS] Phone pairing exchange: pairing_code='{}', ref_len={}, primary_ident_len={}", code_clean, ref_bytes.len(), primary_ident_bytes.len());

                        let link_code_key = crate::noise::crypto::derive_pairing_code_key(&code_clean, salt);
                        if let Ok(primary_eph_pub) = crate::noise::crypto::aes_ctr_decrypt(&link_code_key, iv, ciphered_eph) {
                            if primary_eph_pub.len() == 32 {
                                let mut eph_priv_32 = [0u8; 32];
                                eph_priv_32.copy_from_slice(&pairing_ephemeral_priv[..32]);

                                let mut primary_eph_32 = [0u8; 32];
                                primary_eph_32.copy_from_slice(&primary_eph_pub[..32]);

                                let shared_eph = crate::noise::crypto::curve25519_shared_key(&eph_priv_32, &primary_eph_32);

                                let mut primary_ident_32 = [0u8; 32];
                                primary_ident_32.copy_from_slice(&primary_ident_bytes[..32]);

                                let shared_ident = crate::noise::crypto::curve25519_shared_key(&eph_priv_32, &primary_ident_32);

                                let mut ikm = Vec::with_capacity(64);
                                ikm.extend_from_slice(&shared_eph);
                                ikm.extend_from_slice(&shared_ident);

                                let link_code_salt = [
                                    link_code_key.as_slice(),
                                    salt,
                                ].concat();

                                if let Ok(master_key) = crate::noise::crypto::hkdf_sha256(&link_code_salt, &ikm, b"link_code_pairing_key_bundle_encryption_key", 32) {
                                    let enc_iv = {
                                        let mut iv_buf = [0u8; 12];
                                        let mut rng = rand::thread_rng();
                                        rand::RngCore::fill_bytes(&mut rng, &mut iv_buf);
                                        iv_buf
                                    };

                                    let mut adv_secret_bytes = vec![0u8; 32];
                                    if let Ok(decoded) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &adv_secret_b64) {
                                        adv_secret_bytes = decoded;
                                    }

                                    let mut key_bundle_bytes = Vec::new();
                                    key_bundle_bytes.push(0x05); // Curve25519 type
                                    key_bundle_bytes.extend_from_slice(&signed_ident_pub);
                                    key_bundle_bytes.push(((signed_prekey_id >> 16) & 0xff) as u8);
                                    key_bundle_bytes.push(((signed_prekey_id >> 8) & 0xff) as u8);
                                    key_bundle_bytes.push((signed_prekey_id & 0xff) as u8);
                                    key_bundle_bytes.extend_from_slice(&signed_prekey_pub);
                                    key_bundle_bytes.extend_from_slice(&signed_prekey_sig);
                                    key_bundle_bytes.extend_from_slice(&noise_pub);
                                    key_bundle_bytes.extend_from_slice(&adv_secret_bytes);

                                    if let Ok(ciphertext) = crate::noise::crypto::aes_gcm_encrypt(&master_key, &enc_iv, &[], &key_bundle_bytes) {
                                        let mut encrypted_payload = Vec::with_capacity(12 + ciphertext.len());
                                        encrypted_payload.extend_from_slice(&enc_iv);
                                        encrypted_payload.extend_from_slice(&ciphertext);

                                        let mut creds_guard = creds.lock().await;
                                        creds_guard.registered = true;
                                        let creds_clone = creds_guard.clone();
                                        drop(creds_guard);

                                        if let Some(folder) = auth_folder {
                                            let creds_path = folder.join("creds.json");
                                            if let Ok(serialized) = serde_json::to_string_pretty(&creds_clone) {
                                                let _ = std::fs::write(&creds_path, serialized);
                                            }
                                        }

                                        let rand_8 = {
                                            let mut rng = rand::thread_rng();
                                            let mut b = [0u8; 8];
                                            rand::RngCore::fill_bytes(&mut rng, &mut b);
                                            b
                                        };

                                        // Send companion_finish IQ
                                        let resp_comp_reg = BinaryNode::new("link_code_companion_reg")
                                            .with_attr("jid", &my_jid)
                                            .with_attr("stage", "companion_finish")
                                            .with_children(vec![
                                                BinaryNode::new("link_code_pairing_wrapped_key_bundle")
                                                    .with_bytes_content(encrypted_payload),
                                                BinaryNode::new("companion_identity_public")
                                                    .with_bytes_content(signed_ident_pub),
                                                BinaryNode::new("link_code_pairing_ref")
                                                    .with_bytes_content(ref_bytes.to_vec()),
                                            ]);

                                        let resp_msg_id = format!("3EB0{}", hex::encode(rand_8));
                                        let resp_iq = BinaryNode::new("iq")
                                            .with_attr("to", "@s.whatsapp.net")
                                            .with_attr("type", "set")
                                            .with_attr("id", &resp_msg_id)
                                            .with_attr("xmlns", "md")
                                            .with_children(vec![resp_comp_reg]);

                                        Self::send_encrypted_node(&resp_iq, noise_handler, send_tx).await;

                                        let _ = event_tx.send(BotEvent::CredsUpdate(creds_clone));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if node.tag == "iq" {
            println!("[WS IQ Detail] tag={} attrs={:?}", node.tag, node.attrs);
            if let Some(BinaryNodeContent::List(children)) = &node.content {
                for (i, c) in children.iter().enumerate() {
                    println!("  [Child {}] tag={} attrs={:?} content={:?}", i, c.tag, c.attrs, c.content);
                }
            }

            if let Some(iq_type) = node.get_attr("type") {
                if iq_type == "error" {
                    if let Some(err_node) = node.get_child("error") {
                        let text = err_node.get_attr("text").unwrap_or("unknown");
                        let code = err_node.get_attr("code").unwrap_or("unknown");
                        println!("\n[WhatsApp IQ Error] code={}, text={}", code, text);
                        if code == "429" || text == "rate-overlimit" {
                            println!("[⚠️ Pairing Rate Limit] Nomor ini sedang terkena rate-overlimit (429) dari server WhatsApp karena terlalu sering request kode. Silakan tunggu 5-10 menit atau gunakan opsi [1] Scan QR Code!\n");
                        }
                    }
                } else if iq_type == "get" && node.get_child("ping").is_some() {
                    let from_jid = node.get_attr("from").unwrap_or("@s.whatsapp.net");
                    let mut ack_iq = BinaryNode::new("iq")
                        .with_attr("to", from_jid)
                        .with_attr("type", "result");
                    if let Some(msg_id) = node.get_attr("id") {
                        ack_iq = ack_iq.with_attr("id", msg_id);
                    }
                    Self::send_encrypted_node(&ack_iq, noise_handler, send_tx).await;
                }
            }

            // Handle QR Pair-Device Node
            if let Some(pair_device) = node.get_child("pair-device") {
                // Acknowledge pair-device IQ
                if let Some(msg_id) = node.get_attr("id") {
                    let from_jid = node.get_attr("from").unwrap_or("@s.whatsapp.net");
                    let ack_iq = BinaryNode::new("iq")
                        .with_attr("to", from_jid)
                        .with_attr("type", "result")
                        .with_attr("id", msg_id);
                    Self::send_encrypted_node(&ack_iq, noise_handler, send_tx).await;
                }

                if let Some(ref_data) = pair_device.get_child_string("ref") {
                    let creds_guard = creds.lock().await;
                    let noise_pub_b64 = base64::engine::general_purpose::STANDARD.encode(&creds_guard.noise_key.public);
                    let ident_pub_b64 = base64::engine::general_purpose::STANDARD.encode(&creds_guard.signed_identity_key.public);
                    let adv_secret_b64 = creds_guard.adv_secret_key.clone();
                    drop(creds_guard);

                    let qr_url = format!(
                        "https://wa.me/settings/linked_devices#{},{},{},{},1",
                        ref_data.trim(), noise_pub_b64, ident_pub_b64, adv_secret_b64
                    );

                    if print_qr_terminal {
                        match qrcode::QrCode::new(qr_url.as_bytes()) {
                            Ok(code) => {
                                let string = code.render::<char>().quiet_zone(true).module_dimensions(2, 1).build();
                                println!("\n{}\n", string);
                            }
                            Err(e) => {
                                println!("\n[WhatsApp Linked Devices QR Data]: {}\n(Error: {:?})\n", qr_url, e);
                            }
                        }
                    }

                    let _ = event_tx.send(BotEvent::ConnectionUpdate {
                        connection: Some("connecting".to_string()),
                        status: "qr".to_string(),
                        qr: Some(qr_url),
                        is_logged_in: false,
                        is_new_login: None,
                        last_disconnect: None,
                    });
                }
            } else if let Some(pair_success) = node.get_child("pair-success") {
                // Device successfully paired!
                let msg_id = node.get_attr("id").unwrap_or("pair-sign");
                let mut signed_device_identity_enc: Option<Vec<u8>> = None;
                let mut key_index: Option<u32> = None;

                let creds_guard = creds.lock().await;
                let signed_ident_pub = creds_guard.signed_identity_key.public.clone();
                let signed_ident_priv = creds_guard.signed_identity_key.private.clone();
                drop(creds_guard);

                if let Some(device_ident_node) = pair_success.get_child("device-identity") {
                    if let Some(ident_bytes) = device_ident_node.get_bytes_content() {
                        if let Ok(hmac_msg) = crate::proto::ADVSignedDeviceIdentityHMAC::decode(ident_bytes) {
                            if let Some(details) = hmac_msg.details {
                                if let Ok(mut account) = crate::proto::ADVSignedDeviceIdentity::decode(&details[..]) {
                                    if let Some(dev_details) = &account.details {
                                        if let Ok(dev_ident) = crate::proto::ADVDeviceIdentity::decode(&dev_details[..]) {
                                            key_index = dev_ident.key_index;
                                            let account_sig_key = account.account_signature_key.clone().unwrap_or_default();
                                            
                                            // WA_ADV_DEVICE_SIG_PREFIX = [6, 1]
                                            let mut device_msg = vec![6u8, 1u8];
                                            device_msg.extend_from_slice(dev_details);
                                            device_msg.extend_from_slice(&signed_ident_pub);
                                            device_msg.extend_from_slice(&account_sig_key);

                                            let mut priv_32 = [0u8; 32];
                                            priv_32.copy_from_slice(&signed_ident_priv[..32]);
                                            let sig_64 = crate::noise::crypto::curve25519_sign(&priv_32, &device_msg);

                                            account.device_signature = Some(sig_64.to_vec());
                                            account.account_signature_key = None; // clear as per Baileys encodeSignedDeviceIdentity

                                            let mut enc = Vec::new();
                                            let _ = account.encode(&mut enc);
                                            signed_device_identity_enc = Some(enc);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Send pair-device-sign reply IQ if device identity was processed
                if let (Some(account_enc), Some(k_idx)) = (signed_device_identity_enc, key_index) {
                    let sign_node = BinaryNode::new("pair-device-sign")
                        .with_children(vec![
                            BinaryNode::new("device-identity")
                                .with_attr("key-index", k_idx.to_string())
                                .with_bytes_content(account_enc)
                        ]);
                    let reply_iq = BinaryNode::new("iq")
                        .with_attr("to", "@s.whatsapp.net")
                        .with_attr("type", "result")
                        .with_attr("id", msg_id)
                        .with_children(vec![sign_node]);
                    Self::send_encrypted_node(&reply_iq, noise_handler, send_tx).await;
                    Self::send_unified_session(noise_handler, send_tx).await;
                }

                if let Some(device_node) = pair_success.get_child("device") {
                    if let Some(jid) = device_node.get_attr("jid") {
                        let lid = device_node.get_attr("lid");
                        let mut creds_guard = creds.lock().await;
                        creds_guard.me = Some(crate::auth::ContactInfo {
                            id: jid.to_string(),
                            lid: lid.map(|l| l.to_string()),
                            name: Some("~".to_string()),
                            notify: None,
                            verified_name: None,
                        });
                        creds_guard.registered = true;
                        let creds_clone = creds_guard.clone();
                        drop(creds_guard);

                        if let Some(folder) = auth_folder {
                            let creds_path = folder.join("creds.json");
                            if let Ok(serialized) = serde_json::to_string_pretty(&creds_clone) {
                                let _ = std::fs::write(&creds_path, serialized);
                            }
                        }

                        let _ = event_tx.send(BotEvent::CredsUpdate(creds_clone));
                        let _ = event_tx.send(BotEvent::ConnectionUpdate {
                            connection: None,
                            status: "pairing-success".to_string(),
                            qr: None,
                            is_logged_in: false,
                            is_new_login: Some(true),
                            last_disconnect: None,
                        });
                    }
                }
            }
        } else if node.tag == "success" {
            let mut creds_guard = creds.lock().await;
            creds_guard.registered = true;
            if let Some(lid) = node.get_attr("lid") {
                if let Some(ref mut me) = creds_guard.me {
                    me.lid = Some(lid.to_string());
                }
            }
            let creds_clone = creds_guard.clone();
            drop(creds_guard);

            if let Some(folder) = auth_folder {
                let creds_path = folder.join("creds.json");
                if let Ok(serialized) = serde_json::to_string_pretty(&creds_clone) {
                    let _ = std::fs::write(&creds_path, serialized);
                }
            }

            // 1. Upload 30 PreKeys to WhatsApp server
            Self::upload_prekeys(auth_folder, creds, noise_handler, send_tx).await;

            // 2. Send passive active IQ matching Baileys socket.ts
            let active_node = BinaryNode::new("iq")
                .with_attr("to", "@s.whatsapp.net")
                .with_attr("xmlns", "passive")
                .with_attr("type", "set")
                .with_attr("id", format!("active_{}", rand::random::<u32>()))
                .with_children(vec![BinaryNode::new("active")]);
            Self::send_encrypted_node(&active_node, noise_handler, send_tx).await;

            // 3. Send unified session telemetry
            Self::send_unified_session(noise_handler, send_tx).await;

            is_open.store(true, Ordering::SeqCst);
            let _ = event_tx.send(BotEvent::CredsUpdate(creds_clone));
            let _ = event_tx.send(BotEvent::ConnectionUpdate {
                connection: Some("open".to_string()),
                status: "open".to_string(),
                qr: None,
                is_logged_in: true,
                is_new_login: Some(false),
                last_disconnect: None,
            });
        } else if node.tag == "ib" {
            if let Some(dirty_node) = node.get_child("dirty") {
                let dirty_type = dirty_node.get_attr("type").unwrap_or("account_sync");
                let timestamp = dirty_node.get_attr("timestamp");

                let mut clean_child = BinaryNode::new("clean").with_attr("type", dirty_type);
                if let Some(ts) = timestamp {
                    clean_child = clean_child.with_attr("timestamp", ts);
                }

                let clean_iq = BinaryNode::new("iq")
                    .with_attr("to", "@s.whatsapp.net")
                    .with_attr("type", "set")
                    .with_attr("xmlns", "urn:xmpp:whatsapp:dirty")
                    .with_attr("id", format!("clean_{}", rand::random::<u32>()))
                    .with_children(vec![clean_child]);

                println!("[WS Dirty] Responding clean dirty bits for type={}", dirty_type);
                Self::send_encrypted_node(&clean_iq, noise_handler, send_tx).await;
            }
        }
    }

    async fn upload_prekeys(
        auth_folder: Option<&std::path::PathBuf>,
        creds: &Arc<Mutex<AuthenticationCreds>>,
        noise_handler: &Arc<Mutex<NoiseHandler>>,
        send_tx: &mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let mut creds_guard = creds.lock().await;
        let folder_opt = auth_folder.cloned();

        let reg_id = creds_guard.registration_id;
        let signed_ident_pub = creds_guard.signed_identity_key.public.clone();
        let signed_skey = creds_guard.signed_pre_key.clone();

        let mut prekeys_to_upload = Vec::new();

        // Generate 30 prekeys
        for id in 1..=30u32 {
            let keypair = crate::auth::KeyPair::generate();

            if let Some(ref folder) = folder_opt {
                let prekey_path = folder.join(format!("pre-key-{}.json", id));
                let priv_b64 = base64::engine::general_purpose::STANDARD.encode(&keypair.private);
                let pub_b64 = base64::engine::general_purpose::STANDARD.encode(&keypair.public);

                let json_content = serde_json::json!({
                    "private": {
                        "type": "Buffer",
                        "data": priv_b64
                    },
                    "public": {
                        "type": "Buffer",
                        "data": pub_b64
                    }
                });
                let _ = std::fs::write(&prekey_path, serde_json::to_string_pretty(&json_content).unwrap_or_default());
            }

            prekeys_to_upload.push((id, keypair.public));
        }

        creds_guard.next_pre_key_id = 31;
        creds_guard.first_unuploaded_pre_key_id = 31;

        let creds_clone = creds_guard.clone();
        drop(creds_guard);

        if let Some(ref folder) = folder_opt {
            let creds_path = folder.join("creds.json");
            if let Ok(serialized) = serde_json::to_string_pretty(&creds_clone) {
                let _ = std::fs::write(&creds_path, serialized);
            }
        }

        // Build encrypt IQ
        let mut reg_bytes = vec![0u8; 4];
        reg_bytes[0] = ((reg_id >> 24) & 0xff) as u8;
        reg_bytes[1] = ((reg_id >> 16) & 0xff) as u8;
        reg_bytes[2] = ((reg_id >> 8) & 0xff) as u8;
        reg_bytes[3] = (reg_id & 0xff) as u8;

        let mut key_nodes = Vec::new();
        for (id, pub_bytes) in prekeys_to_upload {
            let id_bytes = vec![((id >> 16) & 0xff) as u8, ((id >> 8) & 0xff) as u8, (id & 0xff) as u8];
            key_nodes.push(
                BinaryNode::new("key")
                    .with_children(vec![
                        BinaryNode::new("id").with_bytes_content(id_bytes),
                        BinaryNode::new("value").with_bytes_content(pub_bytes),
                    ])
            );
        }

        let skey_id = signed_skey.key_id;
        let skey_id_bytes = vec![((skey_id >> 16) & 0xff) as u8, ((skey_id >> 8) & 0xff) as u8, (skey_id & 0xff) as u8];
        let skey_node = BinaryNode::new("skey")
            .with_children(vec![
                BinaryNode::new("id").with_bytes_content(skey_id_bytes),
                BinaryNode::new("value").with_bytes_content(signed_skey.key_pair.public.clone()),
                BinaryNode::new("signature").with_bytes_content(signed_skey.signature.clone()),
            ]);

        let encrypt_iq = BinaryNode::new("iq")
            .with_attr("to", "@s.whatsapp.net")
            .with_attr("type", "set")
            .with_attr("xmlns", "encrypt")
            .with_attr("id", format!("encrypt_upload_{}", rand::random::<u32>()))
            .with_children(vec![
                BinaryNode::new("registration").with_bytes_content(reg_bytes),
                BinaryNode::new("type").with_bytes_content(vec![5u8]),
                BinaryNode::new("identity").with_bytes_content(signed_ident_pub),
                BinaryNode::new("list").with_children(key_nodes),
                skey_node,
            ]);

        println!("[WS PreKeys] Uploading 30 PreKeys to WhatsApp Server...");
        Self::send_encrypted_node(&encrypt_iq, noise_handler, send_tx).await;
    }

    async fn send_unified_session(
        noise_handler: &Arc<Mutex<NoiseHandler>>,
        send_tx: &mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let session_id = (now % (7 * 24 * 60 * 60 * 1000)).to_string();

        let unified_node = BinaryNode::new("ib")
            .with_children(vec![
                BinaryNode::new("unified_session")
                    .with_attr("id", session_id)
            ]);
        Self::send_encrypted_node(&unified_node, noise_handler, send_tx).await;
    }
}
