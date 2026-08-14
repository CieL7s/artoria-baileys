use prost::Message as ProstMessage;
use serde::{Deserialize, Serialize};

// --- Handshake Protobufs ---

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct HandshakeMessage {
    #[prost(message, optional, tag = "2")]
    pub client_hello: Option<ClientHello>,
    #[prost(message, optional, tag = "3")]
    pub server_hello: Option<ServerHello>,
    #[prost(message, optional, tag = "4")]
    pub client_finish: Option<ClientFinish>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ClientHello {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub ephemeral: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub r#static: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub payload: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ServerHello {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub ephemeral: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub r#static: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub payload: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ClientFinish {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub r#static: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub payload: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct CertChain {
    #[prost(message, optional, tag = "1")]
    pub leaf: Option<NoiseCertificate>,
    #[prost(message, optional, tag = "2")]
    pub intermediate: Option<NoiseCertificate>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct NoiseCertificate {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub details: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub signature: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct CertDetails {
    #[prost(uint32, optional, tag = "1")]
    pub serial: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub issuer_serial: Option<u32>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub key: Option<Vec<u8>>,
    #[prost(uint64, optional, tag = "4")]
    pub not_before: Option<u64>,
    #[prost(uint64, optional, tag = "5")]
    pub not_after: Option<u64>,
}

// --- Client Payload & Device Registration Protobufs ---

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct AppVersion {
    #[prost(uint32, optional, tag = "1")]
    pub primary: Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub secondary: Option<u32>,
    #[prost(uint32, optional, tag = "3")]
    pub tertiary: Option<u32>,
    #[prost(uint32, optional, tag = "4")]
    pub quaternary: Option<u32>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct UserAgent {
    #[prost(int32, optional, tag = "1")]
    pub platform: Option<i32>,
    #[prost(message, optional, tag = "2")]
    pub app_version: Option<AppVersion>,
    #[prost(string, optional, tag = "3")]
    pub mcc: Option<String>,
    #[prost(string, optional, tag = "4")]
    pub mnc: Option<String>,
    #[prost(string, optional, tag = "5")]
    pub os_version: Option<String>,
    #[prost(string, optional, tag = "6")]
    pub manufacturer: Option<String>,
    #[prost(string, optional, tag = "7")]
    pub device: Option<String>,
    #[prost(string, optional, tag = "8")]
    pub os_build_number: Option<String>,
    #[prost(string, optional, tag = "9")]
    pub phone_id: Option<String>,
    #[prost(int32, optional, tag = "10")]
    pub release_channel: Option<i32>,
    #[prost(string, optional, tag = "11")]
    pub locale_language_iso_639_1: Option<String>,
    #[prost(string, optional, tag = "12")]
    pub locale_country_iso_3166_1_alpha_2: Option<String>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct WebInfo {
    #[prost(string, optional, tag = "1")]
    pub ref_token: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub version: Option<String>,
    #[prost(int32, optional, tag = "4")]
    pub web_sub_platform: Option<i32>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct DevicePairingData {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub e_regid: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub e_keytype: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub e_ident: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "4")]
    pub e_skey_id: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "5")]
    pub e_skey_val: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "6")]
    pub e_skey_sig: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "7")]
    pub build_hash: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "8")]
    pub device_props: Option<Vec<u8>>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ClientPayload {
    #[prost(uint64, optional, tag = "1")]
    pub username: Option<u64>,
    #[prost(bool, optional, tag = "3")]
    pub passive: Option<bool>,
    #[prost(message, optional, tag = "5")]
    pub user_agent: Option<UserAgent>,
    #[prost(message, optional, tag = "6")]
    pub web_info: Option<WebInfo>,
    #[prost(string, optional, tag = "7")]
    pub push_name: Option<String>,
    #[prost(sfixed32, optional, tag = "9")]
    pub session_id: Option<i32>,
    #[prost(bool, optional, tag = "10")]
    pub short_connect: Option<bool>,
    #[prost(int32, optional, tag = "12")]
    pub connect_type: Option<i32>,
    #[prost(int32, optional, tag = "13")]
    pub connect_reason: Option<i32>,
    #[prost(int32, repeated, tag = "14")]
    pub shards: Vec<i32>,
    #[prost(uint32, optional, tag = "18")]
    pub device: Option<u32>,
    #[prost(message, optional, tag = "19")]
    pub device_pairing_data: Option<DevicePairingData>,
    #[prost(bool, optional, tag = "33")]
    pub pull: Option<bool>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct DeviceProps {
    #[prost(string, optional, tag = "1")]
    pub os: Option<String>,
    #[prost(message, optional, tag = "2")]
    pub version: Option<AppVersion>,
    #[prost(int32, optional, tag = "3")]
    pub platform_type: Option<i32>,
    #[prost(bool, optional, tag = "4")]
    pub require_full_sync: Option<bool>,
}

// --- Message Protobufs ---

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct MessageKey {
    #[prost(string, optional, tag = "1")]
    pub remote_jid: Option<String>,
    #[prost(bool, optional, tag = "2")]
    pub from_me: Option<bool>,
    #[prost(string, optional, tag = "3")]
    pub id: Option<String>,
    #[prost(string, optional, tag = "4")]
    pub participant: Option<String>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ContextInfo {
    #[prost(string, optional, tag = "1")]
    pub stanza_id: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub participant: Option<String>,
    #[prost(message, optional, boxed, tag = "3")]
    pub quoted_message: Option<Box<Message>>,
    #[prost(string, repeated, tag = "15")]
    pub mentioned_jid: Vec<String>,
    #[prost(bool, optional, tag = "18")]
    pub is_forwarded: Option<bool>,
    #[prost(uint32, optional, tag = "19")]
    pub forwarding_score: Option<u32>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ExtendedTextMessage {
    #[prost(string, optional, tag = "1")]
    pub text: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub matched_text: Option<String>,
    #[prost(string, optional, tag = "4")]
    pub description: Option<String>,
    #[prost(string, optional, tag = "5")]
    pub title: Option<String>,
    #[prost(string, optional, tag = "6")]
    pub canonical_url: Option<String>,
    #[prost(message, optional, tag = "17")]
    pub context_info: Option<ContextInfo>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ImageMessage {
    #[prost(string, optional, tag = "1")]
    pub url: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub mimetype: Option<String>,
    #[prost(string, optional, tag = "3")]
    pub caption: Option<String>,
    #[prost(bytes = "vec", optional, tag = "4")]
    pub file_sha256: Option<Vec<u8>>,
    #[prost(uint64, optional, tag = "5")]
    pub file_length: Option<u64>,
    #[prost(bytes = "vec", optional, tag = "6")]
    pub media_key: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "7")]
    pub file_enc_sha256: Option<Vec<u8>>,
    #[prost(string, optional, tag = "8")]
    pub direct_path: Option<String>,
    #[prost(bytes = "vec", optional, tag = "16")]
    pub jpeg_thumbnail: Option<Vec<u8>>,
    #[prost(message, optional, tag = "17")]
    pub context_info: Option<ContextInfo>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct VideoMessage {
    #[prost(string, optional, tag = "1")]
    pub url: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub mimetype: Option<String>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub file_sha256: Option<Vec<u8>>,
    #[prost(uint64, optional, tag = "4")]
    pub file_length: Option<u64>,
    #[prost(uint32, optional, tag = "5")]
    pub seconds: Option<u32>,
    #[prost(bytes = "vec", optional, tag = "6")]
    pub media_key: Option<Vec<u8>>,
    #[prost(string, optional, tag = "7")]
    pub caption: Option<String>,
    #[prost(bool, optional, tag = "8")]
    pub gif_playback: Option<bool>,
    #[prost(bytes = "vec", optional, tag = "9")]
    pub file_enc_sha256: Option<Vec<u8>>,
    #[prost(string, optional, tag = "10")]
    pub direct_path: Option<String>,
    #[prost(bytes = "vec", optional, tag = "16")]
    pub jpeg_thumbnail: Option<Vec<u8>>,
    #[prost(message, optional, tag = "17")]
    pub context_info: Option<ContextInfo>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct AudioMessage {
    #[prost(string, optional, tag = "1")]
    pub url: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub mimetype: Option<String>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub file_sha256: Option<Vec<u8>>,
    #[prost(uint64, optional, tag = "4")]
    pub file_length: Option<u64>,
    #[prost(uint32, optional, tag = "5")]
    pub seconds: Option<u32>,
    #[prost(bool, optional, tag = "6")]
    pub ptt: Option<bool>,
    #[prost(bytes = "vec", optional, tag = "7")]
    pub media_key: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "8")]
    pub file_enc_sha256: Option<Vec<u8>>,
    #[prost(string, optional, tag = "9")]
    pub direct_path: Option<String>,
    #[prost(bytes = "vec", optional, tag = "10")]
    pub waveform: Option<Vec<u8>>,
    #[prost(message, optional, tag = "17")]
    pub context_info: Option<ContextInfo>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct DocumentMessage {
    #[prost(string, optional, tag = "1")]
    pub url: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub mimetype: Option<String>,
    #[prost(string, optional, tag = "3")]
    pub title: Option<String>,
    #[prost(bytes = "vec", optional, tag = "4")]
    pub file_sha256: Option<Vec<u8>>,
    #[prost(uint64, optional, tag = "5")]
    pub file_length: Option<u64>,
    #[prost(string, optional, tag = "6")]
    pub file_name: Option<String>,
    #[prost(bytes = "vec", optional, tag = "7")]
    pub media_key: Option<Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "8")]
    pub file_enc_sha256: Option<Vec<u8>>,
    #[prost(string, optional, tag = "9")]
    pub direct_path: Option<String>,
    #[prost(string, optional, tag = "10")]
    pub caption: Option<String>,
    #[prost(bytes = "vec", optional, tag = "16")]
    pub jpeg_thumbnail: Option<Vec<u8>>,
    #[prost(message, optional, tag = "17")]
    pub context_info: Option<ContextInfo>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ReactionMessage {
    #[prost(message, optional, tag = "1")]
    pub key: Option<MessageKey>,
    #[prost(string, optional, tag = "2")]
    pub text: Option<String>,
    #[prost(string, optional, tag = "3")]
    pub grouping_key: Option<String>,
    #[prost(int64, optional, tag = "4")]
    pub sender_timestamp_ms: Option<i64>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct PollOption {
    #[prost(string, optional, tag = "1")]
    pub option_name: Option<String>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct PollCreationMessage {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub enc_key: Option<Vec<u8>>,
    #[prost(string, optional, tag = "2")]
    pub name: Option<String>,
    #[prost(message, repeated, tag = "3")]
    pub options: Vec<PollOption>,
    #[prost(uint32, optional, tag = "4")]
    pub selectable_options_count: Option<u32>,
    #[prost(message, optional, tag = "5")]
    pub context_info: Option<ContextInfo>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct ProtocolMessage {
    #[prost(message, optional, tag = "1")]
    pub key: Option<MessageKey>,
    #[prost(int32, optional, tag = "2")]
    pub r#type: Option<i32>,
    #[prost(uint32, optional, tag = "3")]
    pub ephemeral_expiration: Option<u32>,
    #[prost(int64, optional, tag = "4")]
    pub ephemeral_setting_timestamp: Option<i64>,
    #[prost(message, optional, tag = "14")]
    pub edited_message: Option<Box<Message>>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct Message {
    #[prost(string, optional, tag = "1")]
    pub conversation: Option<String>,
    #[prost(message, optional, tag = "2")]
    pub image_message: Option<ImageMessage>,
    #[prost(message, optional, tag = "4")]
    pub document_message: Option<DocumentMessage>,
    #[prost(message, optional, tag = "5")]
    pub audio_message: Option<AudioMessage>,
    #[prost(message, optional, tag = "6")]
    pub video_message: Option<VideoMessage>,
    #[prost(message, optional, tag = "7")]
    pub extended_text_message: Option<ExtendedTextMessage>,
    #[prost(message, optional, tag = "8")]
    pub protocol_message: Option<ProtocolMessage>,
    #[prost(message, optional, tag = "37")]
    pub reaction_message: Option<ReactionMessage>,
    #[prost(message, optional, tag = "49")]
    pub poll_creation_message: Option<PollCreationMessage>,
}

#[derive(Clone, PartialEq, ProstMessage, Serialize, Deserialize)]
pub struct WebMessageInfo {
    #[prost(message, required, tag = "1")]
    pub key: MessageKey,
    #[prost(message, optional, tag = "2")]
    pub message: Option<Message>,
    #[prost(uint64, optional, tag = "3")]
    pub message_timestamp: Option<u64>,
    #[prost(int32, optional, tag = "4")]
    pub status: Option<i32>,
    #[prost(string, optional, tag = "5")]
    pub participant: Option<String>,
    #[prost(string, optional, tag = "16")]
    pub push_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_decode_text_message() {
        let msg = Message {
            conversation: Some("Hello WhatsApp from Rust!".to_string()),
            ..Default::default()
        };

        let mut buf = Vec::new();
        msg.encode(&mut buf).expect("encode message");

        let decoded = Message::decode(&buf[..]).expect("decode message");
        assert_eq!(decoded.conversation, Some("Hello WhatsApp from Rust!".to_string()));
    }

    #[test]
    fn test_encode_decode_handshake_message() {
        let hs = HandshakeMessage {
            client_hello: Some(ClientHello {
                ephemeral: Some(vec![1; 32]),
                r#static: Some(vec![2; 48]),
                payload: Some(vec![3; 64]),
            }),
            server_hello: None,
            client_finish: None,
        };

        let mut buf = Vec::new();
        hs.encode(&mut buf).expect("encode handshake");

        let decoded = HandshakeMessage::decode(&buf[..]).expect("decode handshake");
        assert!(decoded.client_hello.is_some());
        assert_eq!(decoded.client_hello.unwrap().ephemeral, Some(vec![1; 32]));
    }
}
