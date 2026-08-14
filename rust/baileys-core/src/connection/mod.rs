use futures_util::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};
use tracing::{error, info, warn};

use crate::auth::AuthenticationCreds;
use crate::events::BotEvent;
use crate::message::MessageParser;
use crate::noise::crypto::{curve25519_shared_key, hkdf_sha256};
use crate::noise::framing::{encode_frame, FrameBuffer};
use crate::noise::TransportState;
use crate::proto::{ClientHello, HandshakeMessage};
use crate::protocol::{decode_binary_node, encode_binary_node, BinaryNode};

pub const DEFAULT_WA_WEBSOCKET_URL: &str = "wss://web.whatsapp.net/ws/chat";
pub const NOISE_HEADER: &[u8] = b"WA\x06\x02";
pub const NOISE_MODE: &[u8] = b"Noise_XX_25519_AESGCM_SHA256\0\0\0\0";

pub struct WsConnection {
    url: String,
    creds: Arc<Mutex<AuthenticationCreds>>,
    event_tx: mpsc::UnboundedSender<BotEvent>,
    send_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
}

impl WsConnection {
    pub fn new(
        creds: Arc<Mutex<AuthenticationCreds>>,
        event_tx: mpsc::UnboundedSender<BotEvent>,
    ) -> Self {
        Self {
            url: DEFAULT_WA_WEBSOCKET_URL.to_string(),
            creds,
            event_tx,
            send_tx: None,
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

        let ws_stream = match connect_async(&self.url).await {
            Ok((stream, _response)) => {
                info!("WebSocket TCP/TLS connection established!");
                stream
            }
            Err(e) => {
                error!("WebSocket connection error: {}", e);
                let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                    status: format!("error: {}", e),
                    qr: None,
                    is_logged_in: false,
                });
                return;
            }
        };

        let (mut ws_write, mut ws_read) = ws_stream.split();
        let (send_raw_tx, mut send_raw_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.send_tx = Some(send_raw_tx.clone());

        // Perform Noise XX Handshake
        let (ephemeral_pub, ephemeral_priv) = {
            let mut rng = rand::thread_rng();
            let mut priv_b = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rng, &mut priv_b);
            let sec = x25519_dalek::StaticSecret::from(priv_b);
            let pub_k = x25519_dalek::PublicKey::from(&sec);
            (pub_k.to_bytes(), priv_b)
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
            status: "connecting".to_string(),
            qr: None,
            is_logged_in: false,
        });

        let transport = Arc::new(Mutex::new(None::<TransportState>));
        let transport_writer = transport.clone();
        let transport_reader = transport.clone();

        // Spawn Outgoing Node Worker
        let send_raw_worker = send_raw_tx.clone();
        tokio::spawn(async move {
            while let Some(node) = outgoing_rx.recv().await {
                if let Ok(encoded_node) = encode_binary_node(&node) {
                    let mut lock = transport_writer.lock().await;
                    if let Some(trans) = lock.as_mut() {
                        if let Ok(encrypted) = trans.encrypt(&encoded_node) {
                            let frame = encode_frame(&encrypted, None);
                            let _ = send_raw_worker.send(frame);
                        }
                    } else {
                        // Send unencrypted if pre-handshake
                        let frame = encode_frame(&encoded_node, None);
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

        // Frame Receiver Loop
        let mut frame_buffer = FrameBuffer::new();

        while let Some(msg_res) = ws_read.next().await {
            match msg_res {
                Ok(WsMessage::Binary(data)) => {
                    frame_buffer.push_data(&data);

                    while let Some(raw_frame) = frame_buffer.pop_frame() {
                        let mut lock = transport_reader.lock().await;

                        if let Some(trans) = lock.as_mut() {
                            // Decrypt transport frame
                            if let Ok(decrypted) = trans.decrypt(&raw_frame) {
                                if let Ok(node) = decode_binary_node(&decrypted) {
                                    Self::handle_incoming_node(&node, &self.event_tx).await;
                                }
                            }
                        } else {
                            // Process Handshake Response
                            if let Ok(hs) = HandshakeMessage::decode(&raw_frame[..]) {
                                if let Some(server_hello) = hs.server_hello {
                                    info!("Received ServerHello! Completing Noise handshake...");

                                    // Extract server ephemeral key
                                    if let Some(srv_ephemeral) = server_hello.ephemeral {
                                        if srv_ephemeral.len() == 32 {
                                            let mut srv_eph_arr = [0u8; 32];
                                            srv_eph_arr.copy_from_slice(&srv_ephemeral);

                                            // Derive shared keys
                                            let shared_secret = curve25519_shared_key(&ephemeral_priv, &srv_eph_arr);
                                            let hkdf_out = hkdf_sha256(&[], &shared_secret, b"Noise_XX_25519_AESGCM_SHA256", 64)
                                                .unwrap_or_default();

                                            if hkdf_out.len() == 64 {
                                                let mut enc_key = [0u8; 32];
                                                let mut dec_key = [0u8; 32];
                                                enc_key.copy_from_slice(&hkdf_out[0..32]);
                                                dec_key.copy_from_slice(&hkdf_out[32..64]);

                                                *lock = Some(TransportState::new(enc_key, dec_key));
                                                info!("Noise Handshake completed: Transitioned to TransportState!");

                                                let creds_guard = self.creds.lock().await;
                                                let is_reg = creds_guard.registered;
                                                drop(creds_guard);

                                                if !is_reg {
                                                    // Emit QR code for pairing
                                                    let qr_data = format!("RIEL_BAILEYS_QR_{}", uuid::Uuid::new_v4());
                                                    let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                                                        status: "qr".to_string(),
                                                        qr: Some(qr_data),
                                                        is_logged_in: false,
                                                    });
                                                } else {
                                                    let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                                                        status: "open".to_string(),
                                                        qr: None,
                                                        is_logged_in: true,
                                                    });
                                                }
                                            }
                                        }
                                    }
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
                    let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                        status: "close".to_string(),
                        qr: None,
                        is_logged_in: false,
                    });
                    break;
                }
                Err(e) => {
                    error!("WebSocket read error: {}", e);
                    let _ = self.event_tx.send(BotEvent::ConnectionUpdate {
                        status: format!("error: {}", e),
                        qr: None,
                        is_logged_in: false,
                    });
                    break;
                }
                _ => {}
            }
        }
    }

    async fn handle_incoming_node(
        node: &BinaryNode,
        event_tx: &mpsc::UnboundedSender<BotEvent>,
    ) {
        if node.tag == "message" {
            if let Some(msg_info) = MessageParser::parse_incoming_message(node) {
                let _ = event_tx.send(BotEvent::MessageUpsert {
                    messages: vec![msg_info],
                    r#type: "notify".to_string(),
                });
            }
        } else if node.tag == "iq" {
            if node.get_attr("type") == Some("result") {
                info!("Received IQ result from WhatsApp server");
            }
        } else if node.tag == "receipt" {
            info!("Received message receipt from server");
        }
    }
}
