pub mod auth;
pub mod business;
pub mod chats;
pub mod client;
pub mod communities;
pub mod connection;
pub mod events;
pub mod groups;
pub mod media;
pub mod message;
pub mod newsletter;
pub mod noise;
pub mod proto;
pub mod protocol;
pub mod signal;
pub mod sync;
pub mod usync;
pub mod wam;

pub use auth::{AuthenticationCreds, FileAuthState, KeyPair, MemorySignalStore, SignalKeyStore};
pub use business::BusinessBuilder;
pub use chats::ChatBuilder;
pub use client::WhatsAppClientCore;
pub use communities::CommunityBuilder;
pub use events::BotEvent;
pub use groups::GroupBuilder;
pub use media::{decrypt_media, encrypt_media, MediaType};
pub use message::{MessageBuilder, MessageParser};
pub use newsletter::NewsletterBuilder;
pub use noise::TransportState;
pub use protocol::{
    decode_binary_node, encode_binary_node, jid_decode, jid_encode, jid_normalized_user,
    BinaryNode, BinaryNodeContent, FullJid, ProtocolError, Tags,
};
pub use signal::*;
pub use sync::AppStateSync;
pub use usync::*;
pub use wam::WamEncoder;

pub fn version() -> &'static str {
    "auriel-baileys-core v0.2.0"
}
