use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::proto::WebMessageInfo;
use crate::auth::AuthenticationCreds;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum BotEvent {
    #[serde(rename = "connection.update")]
    ConnectionUpdate {
        connection: Option<String>,
        status: String,
        qr: Option<String>,
        is_logged_in: bool,
        is_new_login: Option<bool>,
        last_disconnect: Option<serde_json::Value>,
    },
    #[serde(rename = "creds.update")]
    CredsUpdate(AuthenticationCreds),
    #[serde(rename = "messages.upsert")]
    MessageUpsert {
        messages: Vec<WebMessageInfo>,
        r#type: String,
    },
    #[serde(rename = "messages.update")]
    MessagesUpdate(Vec<serde_json::Value>),
    #[serde(rename = "messages.delete")]
    MessagesDelete(serde_json::Value),
    #[serde(rename = "messages.reaction")]
    MessagesReaction(Vec<serde_json::Value>),
    #[serde(rename = "presence.update")]
    PresenceUpdate {
        id: String,
        presences: HashMap<String, serde_json::Value>,
    },
    #[serde(rename = "chats.upsert")]
    ChatsUpsert(Vec<serde_json::Value>),
    #[serde(rename = "chats.update")]
    ChatsUpdate(Vec<serde_json::Value>),
    #[serde(rename = "contacts.upsert")]
    ContactsUpsert(Vec<serde_json::Value>),
    #[serde(rename = "contacts.update")]
    ContactsUpdate(Vec<serde_json::Value>),
    #[serde(rename = "groups.upsert")]
    GroupsUpsert(Vec<serde_json::Value>),
    #[serde(rename = "groups.update")]
    GroupsUpdate(Vec<serde_json::Value>),
    #[serde(rename = "group-participants.update")]
    GroupParticipantsUpdate {
        id: String,
        author: Option<String>,
        participants: Vec<String>,
        action: String,
    },
    #[serde(rename = "raw.node")]
    RawNode(crate::protocol::node::BinaryNode),
}

