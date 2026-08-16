use serde::{Deserialize, Serialize};
use crate::protocol::jid::{
    are_jids_same_user, is_hosted_lid_user, is_hosted_pn_user, is_jid_broadcast, is_jid_group,
    is_jid_meta_ai, is_jid_newsletter, is_jid_status_broadcast, is_lid_user, is_pn_user,
};
use crate::protocol::{BinaryNode, ProtocolError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddressingContext {
    #[serde(rename = "addressingMode")]
    pub addressing_mode: String,
    #[serde(rename = "senderAlt", skip_serializing_if = "Option::is_none")]
    pub sender_alt: Option<String>,
    #[serde(rename = "recipientAlt", skip_serializing_if = "Option::is_none")]
    pub recipient_alt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecodedMessageKey {
    #[serde(rename = "remoteJid")]
    pub remote_jid: String,
    #[serde(rename = "remoteJidAlt", skip_serializing_if = "Option::is_none")]
    pub remote_jid_alt: Option<String>,
    #[serde(rename = "remoteJidUsername", skip_serializing_if = "Option::is_none")]
    pub remote_jid_username: Option<String>,
    #[serde(rename = "fromMe")]
    pub from_me: bool,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participant: Option<String>,
    #[serde(rename = "participantAlt", skip_serializing_if = "Option::is_none")]
    pub participant_alt: Option<String>,
    #[serde(rename = "participantUsername", skip_serializing_if = "Option::is_none")]
    pub participant_username: Option<String>,
    #[serde(rename = "addressingMode")]
    pub addressing_mode: String,
    #[serde(rename = "server_id", skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecodedFullMessage {
    pub key: DecodedMessageKey,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(rename = "messageTimestamp")]
    pub message_timestamp: u64,
    #[serde(rename = "pushName", skip_serializing_if = "Option::is_none")]
    pub push_name: Option<String>,
    pub broadcast: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecodedMessageNode {
    #[serde(rename = "fullMessage")]
    pub full_message: DecodedFullMessage,
    pub author: String,
    pub sender: String,
}

pub struct MessageDecoder;

impl MessageDecoder {
    pub fn extract_addressing_context(stanza: &BinaryNode) -> AddressingContext {
        let from = stanza.get_attr("from").unwrap_or("");
        let participant = stanza.get_attr("participant");
        let sender = participant.unwrap_or(from);

        let addressing_mode = stanza
            .get_attr("addressing_mode")
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if sender.ends_with("lid") {
                    "lid".to_string()
                } else {
                    "pn".to_string()
                }
            });

        let (sender_alt, recipient_alt) = if addressing_mode == "lid" {
            let s_alt = stanza
                .get_attr("participant_pn")
                .or_else(|| stanza.get_attr("sender_pn"))
                .or_else(|| stanza.get_attr("peer_recipient_pn"))
                .map(|s| s.to_string());
            let r_alt = stanza.get_attr("recipient_pn").map(|s| s.to_string());
            (s_alt, r_alt)
        } else {
            let s_alt = stanza
                .get_attr("participant_lid")
                .or_else(|| stanza.get_attr("sender_lid"))
                .or_else(|| stanza.get_attr("peer_recipient_lid"))
                .map(|s| s.to_string());
            let r_alt = stanza.get_attr("recipient_lid").map(|s| s.to_string());
            (s_alt, r_alt)
        };

        AddressingContext {
            addressing_mode,
            sender_alt,
            recipient_alt,
        }
    }

    pub fn decode_message_node(
        stanza: &BinaryNode,
        me_id: Option<&str>,
        me_lid: Option<&str>,
    ) -> Result<DecodedMessageNode, ProtocolError> {
        let msg_id = stanza
            .get_attr("id")
            .ok_or_else(|| ProtocolError::InvalidNode("Invalid message stanza: missing id attribute".to_string()))?;
        let from = stanza
            .get_attr("from")
            .ok_or_else(|| ProtocolError::InvalidNode("Invalid message stanza: missing from attribute".to_string()))?;

        let participant = stanza.get_attr("participant");
        let recipient = stanza.get_attr("recipient");
        let addressing_context = Self::extract_addressing_context(stanza);

        let is_me = |jid: &str| are_jids_same_user(Some(jid), me_id);
        let is_me_lid = |jid: &str| are_jids_same_user(Some(jid), me_lid);

        let msg_type: &str;
        let chat_id: String;
        let author: String;
        let mut from_me = false;

        if is_pn_user(from) || is_lid_user(from) || is_hosted_lid_user(from) || is_hosted_pn_user(from) {
            if let Some(rec) = recipient {
                if !is_jid_meta_ai(rec) {
                    if !is_me(from) && !is_me_lid(from) {
                        if are_jids_same_user(Some(from), Some(rec)) {
                            from_me = true;
                        } else {
                            return Err(ProtocolError::InvalidNode("receipient present, but msg not from me".to_string()));
                        }
                    } else {
                        from_me = true;
                    }
                    chat_id = rec.to_string();
                } else {
                    if is_me(from) || is_me_lid(from) {
                        from_me = true;
                    }
                    chat_id = from.to_string();
                }
            } else {
                if is_me(from) || is_me_lid(from) {
                    from_me = true;
                }
                chat_id = from.to_string();
            }
            msg_type = "chat";
            author = from.to_string();
        } else if is_jid_group(from) {
            let part = participant.ok_or_else(|| ProtocolError::InvalidNode("No participant in group message".to_string()))?;
            if is_me(part) || is_me_lid(part) {
                from_me = true;
            }
            msg_type = "group";
            author = part.to_string();
            chat_id = from.to_string();
        } else if is_jid_broadcast(from) {
            let part = participant.ok_or_else(|| ProtocolError::InvalidNode("No participant in group message".to_string()))?;
            let is_participant_me = is_me(part);
            if is_jid_status_broadcast(from) {
                msg_type = if is_participant_me { "direct_peer_status" } else { "other_status" };
            } else {
                msg_type = if is_participant_me { "peer_broadcast" } else { "other_broadcast" };
            }
            from_me = is_participant_me;
            chat_id = from.to_string();
            author = part.to_string();
        } else if is_jid_newsletter(from) {
            msg_type = "newsletter";
            chat_id = from.to_string();
            author = from.to_string();
            if is_me(from) || is_me_lid(from) {
                from_me = true;
            }
        } else {
            return Err(ProtocolError::InvalidNode("Unknown message type".to_string()));
        }

        let is_group = is_jid_group(&chat_id);
        let push_name = stanza.get_attr("notify").map(|s| s.to_string());
        let server_id = if msg_type == "newsletter" {
            stanza.get_attr("server_id").map(|s| s.to_string())
        } else {
            None
        };

        let key = DecodedMessageKey {
            remote_jid: chat_id.clone(),
            remote_jid_alt: if !is_group { addressing_context.sender_alt.clone() } else { None },
            remote_jid_username: if !is_group {
                stanza.get_attr("peer_recipient_username")
                    .or_else(|| stanza.get_attr("recipient_username"))
                    .map(|s| s.to_string())
            } else {
                None
            },
            from_me,
            id: msg_id.to_string(),
            participant: participant.map(|s| s.to_string()),
            participant_alt: if is_group { addressing_context.sender_alt.clone() } else { None },
            participant_username: if participant.is_some() {
                stanza.get_attr("participant_username").map(|s| s.to_string())
            } else {
                None
            },
            addressing_mode: addressing_context.addressing_mode,
            server_id,
        };

        let message_timestamp = stanza
            .get_attr("t")
            .and_then(|t| t.parse::<u64>().ok())
            .unwrap_or(0);

        let status = if from_me { Some(1) } else { None };

        let full_message = DecodedFullMessage {
            key,
            category: stanza.get_attr("category").map(|s| s.to_string()),
            message_timestamp,
            push_name,
            broadcast: is_jid_broadcast(from),
            status,
        };

        let sender = if msg_type == "chat" { author.clone() } else { chat_id };

        Ok(DecodedMessageNode {
            full_message,
            author,
            sender,
        })
    }
}
