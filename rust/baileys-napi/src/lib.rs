use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::JsFunction;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::runtime::Runtime;

use baileys_core::chats::ChatBuilder;
use baileys_core::client::WhatsAppClientCore;
use baileys_core::groups::GroupBuilder;
use baileys_core::media::{
    decrypt_media as core_decrypt_media, encrypt_media as core_encrypt_media, MediaType,
};
use baileys_core::message::MessageBuilder;
use baileys_core::newsletter::NewsletterBuilder;
use baileys_core::noise::TransportState;
use baileys_core::protocol::{
    decode_binary_node as core_decode_node, encode_binary_node as core_encode_node,
    jid_decode as core_jid_decode, jid_encode as core_jid_encode,
    jid_normalized_user as core_jid_normalized_user, BinaryNode as CoreNode,
};

#[derive(Serialize, Deserialize, Debug)]
#[napi(object)]
pub struct JsFullJid {
    pub user: String,
    pub server: String,
    pub device: Option<u8>,
    pub agent: Option<u32>,
    pub domain_type: Option<u8>,
}

#[derive(Serialize, Deserialize, Debug)]
#[napi(object)]
pub struct JsBinaryNode {
    pub tag: String,
    pub attrs: HashMap<String, String>,
    pub content: Option<String>,
}

#[napi(object)]
pub struct JsEncryptedMedia {
    pub encrypted_buffer: Buffer,
    pub media_key: Buffer,
    pub file_sha256: Buffer,
    pub file_enc_sha256: Buffer,
}

#[derive(Serialize, Deserialize, Debug)]
#[napi(object)]
pub struct JsNodePayload {
    pub id: String,
    pub node_json: String,
}

#[napi]
pub fn jid_encode(
    user: String,
    server: String,
    device: Option<u8>,
    agent: Option<u32>,
) -> String {
    core_jid_encode(&user, &server, device, agent)
}

#[napi]
pub fn jid_decode(jid: String) -> Option<JsFullJid> {
    core_jid_decode(&jid).map(|j| JsFullJid {
        user: j.user,
        server: j.server,
        device: j.device,
        agent: j.agent,
        domain_type: j.domain_type,
    })
}

#[napi]
pub fn jid_normalized_user(jid: String) -> String {
    core_jid_normalized_user(&jid)
}

#[napi]
pub fn decode_binary_node(buffer: Buffer) -> Result<String> {
    let node = core_decode_node(buffer.as_ref())
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn encode_binary_node(node_json: String) -> Result<Buffer> {
    let node: CoreNode = serde_json::from_str(&node_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid node JSON: {}", e)))?;
    let bytes = core_encode_node(&node)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(bytes))
}

// --- Group Builders ---

#[napi]
pub fn build_group_create_node(subject: String, participants: Vec<String>) -> Result<JsNodePayload> {
    let (id, node) = GroupBuilder::build_create_group(&subject, &participants);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_group_participants_update_node(
    group_jid: String,
    participants: Vec<String>,
    action: String,
) -> Result<JsNodePayload> {
    let (id, node) = GroupBuilder::build_participants_update(&group_jid, &participants, &action);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_group_invite_code_node(group_jid: String) -> Result<JsNodePayload> {
    let (id, node) = GroupBuilder::build_invite_code_query(&group_jid);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_group_update_subject_node(group_jid: String, subject: String) -> Result<JsNodePayload> {
    let (id, node) = GroupBuilder::build_update_subject(&group_jid, &subject);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_group_update_description_node(
    group_jid: String,
    description: String,
    prev_id: Option<String>,
) -> Result<JsNodePayload> {
    let (id, node) = GroupBuilder::build_update_description(&group_jid, &description, prev_id.as_deref());
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_group_setting_update_node(group_jid: String, setting: String) -> Result<JsNodePayload> {
    let (id, node) = GroupBuilder::build_setting_update(&group_jid, &setting);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- Chat Builders ---

#[napi]
pub fn build_mute_chat_node(jid: String, duration_secs: Option<u32>) -> Result<JsNodePayload> {
    let (id, node) = ChatBuilder::build_mute_chat(&jid, duration_secs.map(|s| s as u64));
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_pin_chat_node(jid: String, pin: bool) -> Result<JsNodePayload> {
    let (id, node) = ChatBuilder::build_pin_chat(&jid, pin);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_archive_chat_node(jid: String, archive: bool) -> Result<JsNodePayload> {
    let (id, node) = ChatBuilder::build_archive_chat(&jid, archive);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- Newsletter Builders ---

#[napi]
pub fn build_newsletter_create_node(name: String, description: String) -> Result<JsNodePayload> {
    let (id, node) = NewsletterBuilder::build_create(&name, &description);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_newsletter_follow_node(jid: String) -> Result<JsNodePayload> {
    let (id, node) = NewsletterBuilder::build_follow(&jid);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_newsletter_mute_node(jid: String, mute: bool) -> Result<JsNodePayload> {
    let (id, node) = NewsletterBuilder::build_mute(&jid, mute);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- Receipt & Presence ---

#[napi]
pub fn build_receipt_node(
    msg_id: String,
    to_jid: String,
    participant: Option<String>,
    receipt_type: Option<String>,
) -> Result<String> {
    let node = MessageBuilder::build_receipt_node(&msg_id, &to_jid, participant.as_deref(), receipt_type.as_deref());
    serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn build_presence_node(presence_type: String, to_jid: Option<String>) -> Result<String> {
    let node = MessageBuilder::build_presence_node(&presence_type, to_jid.as_deref());
    serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn build_ping_node() -> Result<String> {
    let node = MessageBuilder::build_ping_node();
    serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))
}

// --- Communities Builders ---

#[napi]
pub fn build_community_create_node(subject: String, description: String) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::communities::CommunityBuilder::build_create(&subject, &description);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_community_deactivate_node(community_jid: String) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::communities::CommunityBuilder::build_deactivate(&community_jid);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_community_link_groups_node(community_jid: String, group_jids: Vec<String>) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::communities::CommunityBuilder::build_link_groups(&community_jid, &group_jids);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_community_unlink_groups_node(community_jid: String, group_jids: Vec<String>) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::communities::CommunityBuilder::build_unlink_groups(&community_jid, &group_jids);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- Business Builders ---

#[napi]
pub fn build_catalog_query_node(jid: String, limit: Option<u32>) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::business::BusinessBuilder::build_catalog_query(&jid, limit.unwrap_or(10));
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_product_query_node(jid: String, product_id: String) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::business::BusinessBuilder::build_product_query(&jid, &product_id);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_collections_query_node(jid: String) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::business::BusinessBuilder::build_collections_query(&jid);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

#[napi]
pub fn build_order_details_node(order_id: String, token: String) -> Result<JsNodePayload> {
    let (id, node) = baileys_core::business::BusinessBuilder::build_order_details(&order_id, &token);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- USync Builders ---

#[napi]
pub fn build_usync_query_node(
    users: Vec<String>,
    protocols: Vec<String>,
    mode: Option<String>,
    context: Option<String>,
) -> Result<JsNodePayload> {
    let id = baileys_core::message::generate_message_id();
    let user_dtos: Vec<baileys_core::usync::USyncUserDTO> = users.into_iter().map(|u| baileys_core::usync::USyncUserDTO {
        id: Some(u),
        lid: None,
        phone: None,
        username: None,
        username_key: None,
        r#type: None,
        persona_id: None,
    }).collect();

    let node = baileys_core::usync::USyncQueryEngine::build_query(
        &context.unwrap_or_else(|| "interactive".to_string()),
        &mode.unwrap_or_else(|| "query".to_string()),
        &user_dtos,
        &protocols,
        &id,
    );
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- App State Sync ---

#[napi]
pub fn compute_patch_mac(patch_data: Buffer, mac_key: Buffer) -> Result<Buffer> {
    let mac = baileys_core::sync::AppStateSync::compute_patch_mac(patch_data.as_ref(), mac_key.as_ref());
    Ok(Buffer::from(mac))
}

#[napi]
pub fn build_syncd_node(name: String, patches: Vec<Buffer>) -> Result<JsNodePayload> {
    let patch_vecs: Vec<Vec<u8>> = patches.into_iter().map(|b| b.as_ref().to_vec()).collect();
    let (id, node) = baileys_core::sync::AppStateSync::build_syncd_node(&name, &patch_vecs);
    let node_json = serde_json::to_string(&node).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(JsNodePayload { id, node_json })
}

// --- WAM Encoder ---

#[napi]
pub fn encode_wam_event(event_id: u32, weight: Option<f64>) -> Result<Buffer> {
    let buf = baileys_core::wam::WamEncoder::encode_event(event_id, weight.unwrap_or(1.0) as f32);
    Ok(Buffer::from(buf))
}

// --- Media Cryptography ---

fn parse_media_type(media_type: &str) -> Result<MediaType> {
    match media_type.to_lowercase().as_str() {
        "image" => Ok(MediaType::Image),
        "video" => Ok(MediaType::Video),
        "audio" => Ok(MediaType::Audio),
        "document" => Ok(MediaType::Document),
        "sticker" => Ok(MediaType::Sticker),
        _ => Err(napi::Error::from_reason(format!(
            "Unsupported media type: {}",
            media_type
        ))),
    }
}

#[napi]
pub fn encrypt_media(plaintext: Buffer, media_type: String) -> Result<JsEncryptedMedia> {
    let m_type = parse_media_type(&media_type)?;
    let res = core_encrypt_media(plaintext.as_ref(), m_type)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    Ok(JsEncryptedMedia {
        encrypted_buffer: Buffer::from(res.encrypted_buffer),
        media_key: Buffer::from(res.media_key.to_vec()),
        file_sha256: Buffer::from(res.file_sha256.to_vec()),
        file_enc_sha256: Buffer::from(res.file_enc_sha256.to_vec()),
    })
}

#[napi]
pub fn decrypt_media(
    encrypted_buffer: Buffer,
    media_key: Buffer,
    media_type: String,
) -> Result<Buffer> {
    let m_type = parse_media_type(&media_type)?;
    if media_key.len() != 32 {
        return Err(napi::Error::from_reason(
            "media_key must be exactly 32 bytes",
        ));
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(media_key.as_ref());

    let decrypted = core_decrypt_media(encrypted_buffer.as_ref(), &key_arr, m_type)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(decrypted))
}

#[napi]
pub fn curve25519_sign(private_key: Buffer, message: Buffer) -> Result<Buffer> {
    if private_key.len() < 32 {
        return Err(napi::Error::from_reason("private_key must be at least 32 bytes"));
    }
    let mut priv_arr = [0u8; 32];
    priv_arr.copy_from_slice(&private_key[..32]);
    let sig = baileys_core::noise::crypto::curve25519_sign(&priv_arr, message.as_ref());
    Ok(Buffer::from(sig.to_vec()))
}

#[napi]
pub fn curve25519_verify(public_key: Buffer, message: Buffer, signature: Buffer) -> Result<bool> {
    if signature.len() != 64 {
        return Ok(false);
    }
    let pk_slice = public_key.as_ref();
    let pk_32 = if pk_slice.len() == 33 && pk_slice[0] == 0x05 {
        &pk_slice[1..]
    } else if pk_slice.len() == 32 {
        pk_slice
    } else {
        return Ok(false);
    };
    let mut pub_arr = [0u8; 32];
    pub_arr.copy_from_slice(pk_32);
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(signature.as_ref());
    Ok(baileys_core::noise::crypto::curve25519_verify(&pub_arr, message.as_ref(), &sig_arr))
}

#[napi]
pub fn aes_gcm_encrypt(key: Buffer, iv: Buffer, aad: Buffer, plaintext: Buffer) -> Result<Buffer> {
    if iv.len() != 12 {
        return Err(napi::Error::from_reason("IV must be 12 bytes"));
    }
    let mut iv_arr = [0u8; 12];
    iv_arr.copy_from_slice(iv.as_ref());
    let ciphertext = baileys_core::noise::crypto::aes_gcm_encrypt(key.as_ref(), &iv_arr, aad.as_ref(), plaintext.as_ref())
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(ciphertext))
}

#[napi]
pub fn aes_gcm_decrypt(key: Buffer, iv: Buffer, aad: Buffer, ciphertext: Buffer) -> Result<Buffer> {
    if iv.len() != 12 {
        return Err(napi::Error::from_reason("IV must be 12 bytes"));
    }
    let mut iv_arr = [0u8; 12];
    iv_arr.copy_from_slice(iv.as_ref());
    let plaintext = baileys_core::noise::crypto::aes_gcm_decrypt(key.as_ref(), &iv_arr, aad.as_ref(), ciphertext.as_ref())
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(plaintext))
}

#[napi]
pub struct NoiseTransport {
    state: TransportState,
}

#[napi]
impl NoiseTransport {
    #[napi(constructor)]
    pub fn new(enc_key: Buffer, dec_key: Buffer) -> Result<Self> {
        let enc_slice = enc_key.as_ref();
        let dec_slice = dec_key.as_ref();

        if enc_slice.len() != 32 || dec_slice.len() != 32 {
            return Err(napi::Error::from_reason(
                "Encryption and decryption keys must be 32 bytes each",
            ));
        }

        let mut enc_arr = [0u8; 32];
        let mut dec_arr = [0u8; 32];
        enc_arr.copy_from_slice(enc_slice);
        dec_arr.copy_from_slice(dec_slice);

        Ok(Self {
            state: TransportState::new(enc_arr, dec_arr),
        })
    }

    #[napi]
    pub fn encrypt(&mut self, plaintext: Buffer) -> Result<Buffer> {
        let encrypted = self
            .state
            .encrypt(plaintext.as_ref())
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(Buffer::from(encrypted))
    }

    #[napi]
    pub fn decrypt(&mut self, ciphertext: Buffer) -> Result<Buffer> {
        let decrypted = self
            .state
            .decrypt(ciphertext.as_ref())
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(Buffer::from(decrypted))
    }

    #[napi]
    pub fn get_read_counter(&self) -> u32 {
        self.state.get_read_counter()
    }

    #[napi]
    pub fn get_write_counter(&self) -> u32 {
        self.state.get_write_counter()
    }
}

#[napi]
pub struct WhatsAppClient {
    client: Arc<WhatsAppClientCore>,
    rt: Arc<Runtime>,
}

#[napi]
impl WhatsAppClient {
    #[napi(constructor)]
    pub fn new(auth_folder: Option<String>, print_qr: Option<bool>) -> Result<Self> {
        let folder = auth_folder.unwrap_or_else(|| "./auth_info_baileys".to_string());
        let mut core = WhatsAppClientCore::new(&folder)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        if let Some(pq) = print_qr {
            core = core.with_print_qr(pq);
        }
        let rt = Runtime::new().map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(Self {
            client: Arc::new(core),
            rt: Arc::new(rt),
        })
    }

    #[napi]
    pub fn on_event(&self, #[napi(ts_arg_type = "(event: string) => void")] callback: JsFunction) -> Result<()> {
        let tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
                ctx.env.create_string(&ctx.value).map(|v| vec![v])
            })?;

        let event_rx_arc = self.client.event_rx.clone();

        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[Artoria-Baileys] Event runtime build error: {}", e);
                    return;
                }
            };

            rt.block_on(async move {
                let mut lock = event_rx_arc.lock().await;
                while let Some(event) = lock.recv().await {
                    if let Ok(json_str) = serde_json::to_string(&event) {
                        let _ = tsfn.call(json_str, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                }
            });
        });

        Ok(())
    }

    #[napi]
    pub fn connect(&self) {
        let client = self.client.clone();
        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[Artoria-Baileys] Connection runtime build error: {}", e);
                    return;
                }
            };

            rt.block_on(async move {
                client.start_connection_async().await;
            });
        });
    }

    #[napi]
    pub fn is_open(&self) -> bool {
        self.client.is_open()
    }

    #[napi]
    pub fn request_pairing_code(&self, phone_number: String) -> Result<String> {
        let client = self.client.clone();
        self.rt
            .block_on(async move { client.request_pairing_code(&phone_number).await })
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    #[napi]
    pub fn get_auth_state_snapshot(&self) -> Result<String> {
        let client = self.client.clone();
        let creds = self.rt.block_on(async move { client.get_auth_snapshot().await });
        serde_json::to_string(&creds).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    #[napi]
    pub fn get_user_id(&self) -> Result<Option<String>> {
        let client = self.client.clone();
        Ok(self.rt.block_on(async move { client.get_user_id().await }))
    }

    #[napi]
    pub fn get_user_lid(&self) -> Result<Option<String>> {
        let client = self.client.clone();
        Ok(self.rt.block_on(async move { client.get_user_lid().await }))
    }

    #[napi]
    pub fn send_message(&self, to_jid: String, text: String) -> Result<String> {
        let client = self.client.clone();
        self.rt
            .block_on(async move { client.send_message(&to_jid, &text).await })
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    #[napi]
    pub fn send_raw_node(&self, node_json: String) -> Result<()> {
        let node: CoreNode = serde_json::from_str(&node_json)
            .map_err(|e| napi::Error::from_reason(format!("Invalid node JSON: {}", e)))?;
        let client = self.client.clone();
        self.rt.block_on(async move {
            client.send_raw_node(node).await;
        });
        Ok(())
    }
}

#[napi(object)]
pub struct NapiSenderMessageKey {
    pub iteration: u32,
    pub iv: Buffer,
    pub cipher_key: Buffer,
    pub seed: Buffer,
}

#[napi(object)]
pub struct NapiSenderChainKey {
    pub iteration: u32,
    pub seed: Buffer,
}

#[napi(object)]
pub struct NapiSenderKeyName {
    pub group_id: String,
    pub sender: String,
    pub device_id: u32,
}

#[napi(object)]
pub struct NapiSenderKeyMessage {
    pub message_version: u32,
    pub key_id: u32,
    pub iteration: u32,
    pub ciphertext: Buffer,
    pub signature: Buffer,
    pub serialized: Buffer,
}

#[napi(object)]
pub struct NapiSenderKeyDistributionMessage {
    pub id: u32,
    pub iteration: u32,
    pub chain_key: Buffer,
    pub signature_key: Buffer,
    pub serialized: Buffer,
}

#[napi]
pub fn signal_group_derive_message_key(iteration: u32, seed: Buffer) -> Result<NapiSenderMessageKey> {
    let msg_key = baileys_core::signal::SenderMessageKey::new(iteration, seed.as_ref());
    Ok(NapiSenderMessageKey {
        iteration: msg_key.iteration(),
        iv: Buffer::from(msg_key.iv()),
        cipher_key: Buffer::from(msg_key.cipher_key()),
        seed: Buffer::from(msg_key.seed()),
    })
}

#[napi]
pub fn signal_group_chain_key_next(iteration: u32, seed: Buffer) -> Result<NapiSenderChainKey> {
    let chain_key = baileys_core::signal::SenderChainKey::new(iteration, seed.as_ref());
    let next_key = chain_key.get_next();
    Ok(NapiSenderChainKey {
        iteration: next_key.iteration(),
        seed: Buffer::from(next_key.seed()),
    })
}

#[napi]
pub fn signal_group_chain_key_get_message_key(iteration: u32, seed: Buffer) -> Result<NapiSenderMessageKey> {
    let chain_key = baileys_core::signal::SenderChainKey::new(iteration, seed.as_ref());
    let msg_key = chain_key.get_sender_message_key();
    Ok(NapiSenderMessageKey {
        iteration: msg_key.iteration(),
        iv: Buffer::from(msg_key.iv()),
        cipher_key: Buffer::from(msg_key.cipher_key()),
        seed: Buffer::from(msg_key.seed()),
    })
}

#[napi]
pub fn signal_group_parse_sender_key_name(name: String) -> Result<Option<NapiSenderKeyName>> {
    let parsed = baileys_core::signal::SenderKeyName::parse(&name);
    Ok(parsed.map(|n| NapiSenderKeyName {
        group_id: n.group_id().to_string(),
        sender: n.sender().to_string(),
        device_id: n.device_id(),
    }))
}

#[napi]
pub fn signal_group_format_sender_key_name(group_id: String, sender: String, device_id: u32) -> Result<String> {
    let name = baileys_core::signal::SenderKeyName::new(group_id, sender, device_id);
    Ok(name.serialize())
}

#[napi]
pub fn signal_group_create_sender_key_message(
    key_id: u32,
    iteration: u32,
    ciphertext: Buffer,
    signature_private_key: Buffer,
) -> Result<Buffer> {
    let msg = baileys_core::signal::SenderKeyMessage::new(
        key_id,
        iteration,
        ciphertext.as_ref(),
        signature_private_key.as_ref(),
    ).map_err(|e| napi::Error::from_reason(e))?;
    Ok(Buffer::from(msg.serialized()))
}

#[napi]
pub fn signal_group_parse_sender_key_message(serialized: Buffer) -> Result<NapiSenderKeyMessage> {
    let msg = baileys_core::signal::SenderKeyMessage::from_serialized(serialized.as_ref())
        .map_err(|e| napi::Error::from_reason(e))?;
    Ok(NapiSenderKeyMessage {
        message_version: msg.message_version as u32,
        key_id: msg.key_id(),
        iteration: msg.iteration(),
        ciphertext: Buffer::from(msg.ciphertext()),
        signature: Buffer::from(msg.signature()),
        serialized: Buffer::from(msg.serialized()),
    })
}

#[napi]
pub fn signal_group_verify_sender_key_message(serialized: Buffer, public_key: Buffer) -> Result<bool> {
    let msg = match baileys_core::signal::SenderKeyMessage::from_serialized(serialized.as_ref()) {
        Ok(m) => m,
        Err(_) => return Ok(false),
    };
    Ok(msg.verify_signature(public_key.as_ref()).is_ok())
}

#[napi]
pub fn signal_group_create_skdm(
    id: u32,
    iteration: u32,
    chain_key: Buffer,
    signature_key: Buffer,
) -> Result<Buffer> {
    let skdm = baileys_core::signal::SenderKeyDistributionMessage::new(
        id,
        iteration,
        chain_key.as_ref(),
        signature_key.as_ref(),
    ).map_err(|e| napi::Error::from_reason(e))?;
    Ok(Buffer::from(skdm.serialized()))
}

#[napi]
pub fn signal_group_parse_skdm(serialized: Buffer) -> Result<NapiSenderKeyDistributionMessage> {
    let skdm = baileys_core::signal::SenderKeyDistributionMessage::from_serialized(serialized.as_ref())
        .map_err(|e| napi::Error::from_reason(e))?;
    Ok(NapiSenderKeyDistributionMessage {
        id: skdm.id(),
        iteration: skdm.iteration(),
        chain_key: Buffer::from(skdm.chain_key()),
        signature_key: Buffer::from(skdm.signature_key()),
        serialized: Buffer::from(skdm.serialized()),
    })
}

#[napi]
pub fn signal_group_record_deserialize(json_str: String) -> Result<String> {
    let record = baileys_core::signal::SenderKeyRecord::deserialize_from_json(&json_str)
        .map_err(|e| napi::Error::from_reason(e))?;
    let serialized_states = record.serialize();
    serde_json::to_string(&serialized_states)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn signal_group_record_serialize(states_json: String) -> Result<String> {
    let states: Vec<baileys_core::signal::SenderKeyState> = serde_json::from_str(&states_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid SenderKeyState JSON: {}", e)))?;
    let record = baileys_core::signal::SenderKeyRecord::from_states(states);
    let serialized_states = record.serialize();
    serde_json::to_string(&serialized_states)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn signal_lid_validate_pairs(pairs_json: String) -> Result<String> {
    let pairs: Vec<baileys_core::signal::LidPnPair> = serde_json::from_str(&pairs_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid LidPnPair JSON: {}", e)))?;
    let validated = baileys_core::signal::validate_lid_pn_pairs(&pairs);
    serde_json::to_string(&validated)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn signal_lid_resolve_pn_to_lid(pn_jid: String, lid_user: String) -> Option<String> {
    baileys_core::signal::resolve_pn_to_lid(&pn_jid, &lid_user)
}

#[napi]
pub fn signal_lid_resolve_lid_to_pn(lid_jid: String, pn_user: String) -> Option<String> {
    baileys_core::signal::resolve_lid_to_pn(&lid_jid, &pn_user)
}

#[napi]
pub fn signal_lid_build_db_batch(pairs_json: String) -> Result<String> {
    let pairs: Vec<baileys_core::signal::ValidatedUserPair> = serde_json::from_str(&pairs_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid ValidatedUserPair JSON: {}", e)))?;
    let batch = baileys_core::signal::build_lid_db_batch(&pairs);
    serde_json::to_string(&batch)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(object)]
pub struct NapiGroupEncryptResult {
    pub ciphertext: Buffer,
    pub record_json: String,
}

#[napi(object)]
pub struct NapiGroupDecryptResult {
    pub plaintext: Buffer,
    pub record_json: String,
}

#[napi(object)]
pub struct NapiGroupCreateResult {
    pub skdm_bytes: Buffer,
    pub record_json: String,
}

#[napi]
pub fn signal_group_cipher_encrypt(
    record_json: String,
    padded_plaintext: Buffer,
) -> Result<NapiGroupEncryptResult> {
    let mut record = baileys_core::signal::SenderKeyRecord::deserialize_from_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let ct = baileys_core::signal::GroupCipher::encrypt(&mut record, &padded_plaintext)
        .map_err(|e| napi::Error::from_reason(e))?;

    let serialized = serde_json::to_string(&record.serialize())
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    Ok(NapiGroupEncryptResult {
        ciphertext: Buffer::from(ct),
        record_json: serialized,
    })
}

#[napi]
pub fn signal_group_cipher_decrypt(
    record_json: String,
    sender_key_message_bytes: Buffer,
) -> Result<NapiGroupDecryptResult> {
    let mut record = baileys_core::signal::SenderKeyRecord::deserialize_from_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let pt = baileys_core::signal::GroupCipher::decrypt(&mut record, &sender_key_message_bytes)
        .map_err(|e| napi::Error::from_reason(e))?;

    let serialized = serde_json::to_string(&record.serialize())
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    Ok(NapiGroupDecryptResult {
        plaintext: Buffer::from(pt),
        record_json: serialized,
    })
}

#[napi]
pub fn signal_group_session_builder_process(
    record_json: String,
    skdm_bytes: Buffer,
) -> Result<String> {
    let mut record = baileys_core::signal::SenderKeyRecord::deserialize_from_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let skdm = baileys_core::signal::SenderKeyDistributionMessage::from_serialized(&skdm_bytes)
        .map_err(|e| napi::Error::from_reason(e))?;

    baileys_core::signal::GroupSessionBuilder::process(&mut record, &skdm);

    serde_json::to_string(&record.serialize())
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn signal_group_session_builder_create(
    record_json: String,
) -> Result<NapiGroupCreateResult> {
    let mut record = baileys_core::signal::SenderKeyRecord::deserialize_from_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let skdm = baileys_core::signal::GroupSessionBuilder::create(&mut record)
        .map_err(|e| napi::Error::from_reason(e))?;

    let serialized = serde_json::to_string(&record.serialize())
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    Ok(NapiGroupCreateResult {
        skdm_bytes: Buffer::from(skdm.serialized()),
        record_json: serialized,
    })
}

#[napi]
pub fn signal_session_record_roundtrip(json_str: String) -> Result<String> {
    let record = baileys_core::signal::SessionRecord::deserialize_json(&json_str)
        .map_err(|e| napi::Error::from_reason(e))?;
    record.serialize_json().map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn signal_session_record_have_open_session(json_str: String) -> Result<bool> {
    let record = baileys_core::signal::SessionRecord::deserialize_json(&json_str)
        .map_err(|e| napi::Error::from_reason(e))?;
    Ok(record.have_open_session())
}

#[napi]
pub fn signal_session_record_get_registration_id(json_str: String) -> Result<Option<u32>> {
    let record = baileys_core::signal::SessionRecord::deserialize_json(&json_str)
        .map_err(|e| napi::Error::from_reason(e))?;
    Ok(record.get_open_session().map(|s| s.registration_id))
}

#[napi(object)]
pub struct NapiSessionEncryptResult {
    pub ciphertext: Buffer,
    pub record_json: String,
}

#[napi(object)]
pub struct NapiSessionDecryptResult {
    pub plaintext: Buffer,
    pub record_json: String,
}

#[napi]
pub fn signal_session_cipher_encrypt(
    record_json: String,
    our_identity_pub: Buffer,
    plaintext: Buffer,
) -> Result<NapiSessionEncryptResult> {
    let mut record = baileys_core::signal::SessionRecord::deserialize_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let ciphertext = baileys_core::signal::SessionCipher::encrypt(
        &mut record,
        our_identity_pub.as_ref(),
        plaintext.as_ref(),
    ).map_err(|e| napi::Error::from_reason(e))?;

    let updated_json = record.serialize_json().map_err(|e| napi::Error::from_reason(e))?;

    Ok(NapiSessionEncryptResult {
        ciphertext: Buffer::from(ciphertext),
        record_json: updated_json,
    })
}

#[napi]
pub fn signal_session_cipher_decrypt_whisper_message(
    record_json: String,
    our_identity_pub: Buffer,
    data: Buffer,
) -> Result<NapiSessionDecryptResult> {
    let mut record = baileys_core::signal::SessionRecord::deserialize_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let plaintext = baileys_core::signal::SessionCipher::decrypt_whisper_message(
        &mut record,
        our_identity_pub.as_ref(),
        data.as_ref(),
    ).map_err(|e| napi::Error::from_reason(e))?;

    let updated_json = record.serialize_json().map_err(|e| napi::Error::from_reason(e))?;

    Ok(NapiSessionDecryptResult {
        plaintext: Buffer::from(plaintext),
        record_json: updated_json,
    })
}

#[napi(object)]
pub struct NapiProcessPkmsgResult {
    pub plaintext: Buffer,
    pub record_json: String,
    pub pre_key_id: Option<u32>,
}

#[napi(object)]
pub struct NapiInitOutgoingResult {
    pub base_key: Buffer,
    pub record_json: String,
}

#[napi]
pub fn signal_session_builder_process_incoming_pkmsg(
    record_json: String,
    our_identity_priv: Buffer,
    our_identity_pub: Buffer,
    our_signed_pre_key_priv: Buffer,
    our_signed_pre_key_pub: Buffer,
    our_pre_key_priv: Option<Buffer>,
    pkmsg_data: Buffer,
) -> Result<NapiProcessPkmsgResult> {
    let mut record = baileys_core::signal::SessionRecord::deserialize_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let pre_key_slice = our_pre_key_priv.as_ref().map(|b| b.as_ref());

    let res = baileys_core::signal::SessionBuilder::process_incoming_pkmsg(
        &mut record,
        our_identity_priv.as_ref(),
        our_identity_pub.as_ref(),
        our_signed_pre_key_priv.as_ref(),
        our_signed_pre_key_pub.as_ref(),
        pre_key_slice,
        pkmsg_data.as_ref(),
    ).map_err(|e| napi::Error::from_reason(e))?;

    let updated_json = record.serialize_json().map_err(|e| napi::Error::from_reason(e))?;

    Ok(NapiProcessPkmsgResult {
        plaintext: Buffer::from(res.plaintext),
        record_json: updated_json,
        pre_key_id: res.pre_key_id,
    })
}

#[napi]
pub fn signal_session_builder_init_outgoing(
    record_json: String,
    our_identity_priv: Buffer,
    registration_id: u32,
    identity_key: Buffer,
    signed_pre_key_id: u32,
    signed_pre_key_public: Buffer,
    signed_pre_key_signature: Buffer,
    pre_key_id: Option<u32>,
    pre_key_public: Option<Buffer>,
) -> Result<NapiInitOutgoingResult> {
    let mut record = baileys_core::signal::SessionRecord::deserialize_json(&record_json)
        .map_err(|e| napi::Error::from_reason(e))?;

    let bundle = baileys_core::signal::PreKeyBundle {
        registration_id,
        identity_key: identity_key.as_ref().to_vec(),
        signed_pre_key_id,
        signed_pre_key_public: signed_pre_key_public.as_ref().to_vec(),
        signed_pre_key_signature: signed_pre_key_signature.as_ref().to_vec(),
        pre_key_id,
        pre_key_public: pre_key_public.map(|b| b.as_ref().to_vec()),
    };

    let base_key = baileys_core::signal::SessionBuilder::init_outgoing_session(
        &mut record,
        our_identity_priv.as_ref(),
        &bundle,
    ).map_err(|e| napi::Error::from_reason(e))?;

    let updated_json = record.serialize_json().map_err(|e| napi::Error::from_reason(e))?;

    Ok(NapiInitOutgoingResult {
        base_key: Buffer::from(base_key),
        record_json: updated_json,
    })
}

#[napi]
pub fn signal_session_builder_build_pkmsg_envelope(
    our_identity_pub: Buffer,
    our_registration_id: u32,
    base_key: Buffer,
    signed_pre_key_id: u32,
    pre_key_id: Option<u32>,
    inner_whisper_message: Buffer,
) -> Result<Buffer> {
    let pkmsg = baileys_core::signal::SessionBuilder::build_pkmsg_envelope(
        our_identity_pub.as_ref(),
        our_registration_id,
        base_key.as_ref(),
        signed_pre_key_id,
        pre_key_id,
        inner_whisper_message.as_ref(),
    ).map_err(|e| napi::Error::from_reason(e))?;

    Ok(Buffer::from(pkmsg))
}

#[napi]
pub fn usync_build_query(
    context: String,
    mode: String,
    users_json: String,
    protocols_json: String,
    message_id: String,
) -> Result<String> {
    let users: Vec<baileys_core::usync::USyncUserDTO> = serde_json::from_str(&users_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid users JSON: {}", e)))?;
    let protocols: Vec<String> = serde_json::from_str(&protocols_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid protocols JSON: {}", e)))?;

    let root = baileys_core::usync::USyncQueryEngine::build_query(
        &context,
        &mode,
        &users,
        &protocols,
        &message_id,
    );

    serde_json::to_string(&root)
        .map_err(|e| napi::Error::from_reason(format!("Failed to serialize query node: {}", e)))
}

#[napi]
pub fn usync_parse_query_result(
    iq_result_json: String,
    protocols_json: String,
) -> Result<String> {
    let result_node: baileys_core::protocol::BinaryNode = serde_json::from_str(&iq_result_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid result node JSON: {}", e)))?;
    let protocols: Vec<String> = serde_json::from_str(&protocols_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid protocols JSON: {}", e)))?;

    let res = baileys_core::usync::USyncQueryEngine::parse_query_result(&result_node, &protocols)
        .ok_or_else(|| napi::Error::from_reason("Failed to parse USync query result: invalid or missing usync node"))?;

    serde_json::to_string(&res)
        .map_err(|e| napi::Error::from_reason(format!("Failed to serialize query result: {}", e)))
}

#[napi]
pub fn normalize_message_content(content_json: String) -> Result<Option<String>> {
    let val: serde_json::Value = serde_json::from_str(&content_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid message JSON: {}", e)))?;
    let normalized = baileys_core::message::MessageNormalizer::normalize_message_content(val);
    match normalized {
        Some(v) => {
            let s = serde_json::to_string(&v)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize normalized JSON: {}", e)))?;
            Ok(Some(s))
        }
        None => Ok(None),
    }
}

#[napi]
pub fn extract_message_content(content_json: String) -> Result<Option<String>> {
    let val: serde_json::Value = serde_json::from_str(&content_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid message JSON: {}", e)))?;
    let extracted = baileys_core::message::MessageNormalizer::extract_message_content(val);
    match extracted {
        Some(v) => {
            let s = serde_json::to_string(&v)
                .map_err(|e| napi::Error::from_reason(format!("Failed to serialize extracted JSON: {}", e)))?;
            Ok(Some(s))
        }
        None => Ok(None),
    }
}

#[napi]
pub fn get_content_type(content_json: String) -> Result<Option<String>> {
    let val: serde_json::Value = serde_json::from_str(&content_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid message JSON: {}", e)))?;
    Ok(baileys_core::message::MessageNormalizer::get_content_type(&val))
}

#[napi]
pub fn get_device(id: String) -> Result<String> {
    Ok(baileys_core::message::MessageNormalizer::get_device(&id).to_string())
}

#[napi]
pub fn extract_addressing_context(stanza_json: String) -> Result<String> {
    let stanza: baileys_core::protocol::BinaryNode = serde_json::from_str(&stanza_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid stanza JSON: {}", e)))?;
    let ctx = baileys_core::message::MessageDecoder::extract_addressing_context(&stanza);
    serde_json::to_string(&ctx)
        .map_err(|e| napi::Error::from_reason(format!("Failed to serialize AddressingContext: {}", e)))
}

#[napi]
pub fn decode_message_node(
    stanza_json: String,
    me_id: Option<String>,
    me_lid: Option<String>,
) -> Result<String> {
    let stanza: baileys_core::protocol::BinaryNode = serde_json::from_str(&stanza_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid stanza JSON: {}", e)))?;
    let decoded = baileys_core::message::MessageDecoder::decode_message_node(
        &stanza,
        me_id.as_deref(),
        me_lid.as_deref(),
    ).map_err(|e| napi::Error::from_reason(format!("Decode message error: {}", e)))?;

    serde_json::to_string(&decoded)
        .map_err(|e| napi::Error::from_reason(format!("Failed to serialize DecodedMessageNode: {}", e)))
}

#[napi]
pub fn sync_process_contact_action(action_json: String, id: Option<String>) -> Result<String> {
    let action: serde_json::Value = serde_json::from_str(&action_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid action JSON: {}", e)))?;
    let results = baileys_core::sync::SyncActionProcessor::process_contact_action(&action, id.as_deref());
    serde_json::to_string(&results)
        .map_err(|e| napi::Error::from_reason(format!("Failed to serialize SyncActionResult: {}", e)))
}

#[napi]
pub fn history_extract_pn_from_messages(messages_json: String) -> Result<Option<String>> {
    let msgs: Vec<serde_json::Value> = serde_json::from_str(&messages_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid messages JSON: {}", e)))?;
    Ok(baileys_core::sync::HistoryProcessor::extract_pn_from_messages(&msgs))
}

#[napi]
pub fn history_process_message(history_json: String) -> Result<String> {
    let history: serde_json::Value = serde_json::from_str(&history_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid history JSON: {}", e)))?;
    let res = baileys_core::sync::HistoryProcessor::process_history_message(history);
    serde_json::to_string(&res)
        .map_err(|e| napi::Error::from_reason(format!("Failed to serialize ProcessedHistoryResult: {}", e)))
}

#[napi]
pub fn compute_app_state_patch_mac(patch_data: Buffer, mac_key: Buffer) -> Buffer {
    let mac = baileys_core::sync::AppStateSync::compute_patch_mac(&patch_data, &mac_key);
    Buffer::from(mac)
}

#[napi]
pub fn version() -> String {
    format!("auriel-baileys-core v{}", baileys_core::version())
}


