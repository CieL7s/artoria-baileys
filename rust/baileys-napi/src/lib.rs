use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, JsFunction};
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
    let (id, node) = baileys_core::usync::USyncBuilder::build_query(
        &users,
        &protocols,
        &mode.unwrap_or_else(|| "interactive".to_string()),
        &context.unwrap_or_else(|| "interactive".to_string()),
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
    pub fn new(auth_folder: Option<String>) -> Result<Self> {
        let folder = auth_folder.unwrap_or_else(|| "./auth_info_baileys".to_string());
        let core = WhatsAppClientCore::new(&folder)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let rt = Runtime::new().map_err(|e| napi::Error::from_reason(e.to_string()))?;

        Ok(Self {
            client: Arc::new(core),
            rt: Arc::new(rt),
        })
    }

    #[napi]
    pub fn on_event(&self, env: Env, callback: JsFunction) -> Result<()> {
        let tsfn: ThreadsafeFunction<String> =
            env.create_threadsafe_function(&callback, 0, |ctx: ThreadSafeCallContext<String>| {
                let js_str = ctx.env.create_string(&ctx.value)?;
                Ok(vec![js_str])
            })?;

        let event_rx_arc = self.client.event_rx.clone();

        self.rt.spawn(async move {
            let mut lock = event_rx_arc.lock().await;
            while let Some(event) = lock.recv().await {
                if let Ok(json_str) = serde_json::to_string(&event) {
                    let _ = tsfn.call(Ok(json_str), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        });

        Ok(())
    }

    #[napi]
    pub fn connect(&self) {
        let client = self.client.clone();
        self.rt.spawn(async move {
            client.start_connection_async().await;
        });
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

#[napi]
pub fn version() -> String {
    format!("auriel-baileys-core v{}", baileys_core::version())
}
