use prost::Message as ProstMessage;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::proto::{ContextInfo, ExtendedTextMessage, Message, MessageKey, ReactionMessage, WebMessageInfo};
use crate::protocol::{BinaryNode, BinaryNodeContent, ProtocolError};

pub mod normalizer;
pub use normalizer::MessageNormalizer;
pub mod decoder;
pub use decoder::{AddressingContext, DecodedFullMessage, DecodedMessageKey, DecodedMessageNode, MessageDecoder};
pub mod processor;
pub use processor::MessageProcessor;

pub fn generate_message_id() -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("3EB0{}", &hex[..12].to_uppercase())
}

pub fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct MessageBuilder;

impl MessageBuilder {
    pub fn create_text_message(
        text: &str,
        quoted_key: Option<MessageKey>,
        quoted_text: Option<String>,
        mentions: Vec<String>,
    ) -> Message {
        if quoted_key.is_some() || !mentions.is_empty() {
            let context_info = ContextInfo {
                stanza_id: quoted_key.as_ref().and_then(|k| k.id.clone()),
                participant: quoted_key.as_ref().and_then(|k| k.participant.clone().or_else(|| k.remote_jid.clone())),
                quoted_message: quoted_text.map(|q| {
                    Box::new(Message {
                        conversation: Some(q),
                        ..Default::default()
                    })
                }),
                mentioned_jid: mentions,
                ..Default::default()
            };

            Message {
                extended_text_message: Some(ExtendedTextMessage {
                    text: Some(text.to_string()),
                    context_info: Some(context_info),
                    ..Default::default()
                }),
                ..Default::default()
            }
        } else {
            Message {
                conversation: Some(text.to_string()),
                ..Default::default()
            }
        }
    }

    pub fn create_reaction_message(
        target_key: MessageKey,
        emoji: &str,
    ) -> Message {
        Message {
            reaction_message: Some(ReactionMessage {
                key: Some(target_key),
                text: Some(emoji.to_string()),
                sender_timestamp_ms: Some(current_timestamp_millis()),
                grouping_key: None,
            }),
            ..Default::default()
        }
    }

    pub fn build_send_message_node(
        to_jid: &str,
        message: &Message,
        custom_id: Option<&str>,
    ) -> Result<(String, BinaryNode), ProtocolError> {
        let msg_id = custom_id
            .map(|s| s.to_string())
            .unwrap_or_else(generate_message_id);

        let mut encoded_proto = Vec::new();
        message
            .encode(&mut encoded_proto)
            .map_err(|e| ProtocolError::InvalidNode(e.to_string()))?;

        // Encrypted node or direct message node payload
        let enc_node = BinaryNode::new("enc")
            .with_attr("v", "2")
            .with_attr("type", "msg")
            .with_bytes_content(encoded_proto);

        let message_node = BinaryNode::new("message")
            .with_attr("id", &msg_id)
            .with_attr("to", to_jid)
            .with_attr("type", "text")
            .with_children(vec![enc_node]);

        Ok((msg_id, message_node))
    }

    pub fn build_receipt_node(
        msg_id: &str,
        to_jid: &str,
        participant: Option<&str>,
        receipt_type: Option<&str>,
    ) -> BinaryNode {
        let mut node = BinaryNode::new("receipt")
            .with_attr("id", msg_id)
            .with_attr("to", to_jid)
            .with_attr("t", current_timestamp_secs().to_string());

        if let Some(part) = participant {
            node = node.with_attr("participant", part);
        }
        if let Some(r_type) = receipt_type {
            node = node.with_attr("type", r_type);
        }
        node
    }

    pub fn build_presence_node(presence_type: &str, to_jid: Option<&str>) -> BinaryNode {
        let mut node = BinaryNode::new("presence").with_attr("type", presence_type);
        if let Some(to) = to_jid {
            node = node.with_attr("to", to);
        }
        node
    }

    pub fn build_ping_node() -> BinaryNode {
        let ping_child = BinaryNode::new("ping");
        BinaryNode::new("iq")
            .with_attr("id", generate_message_id())
            .with_attr("type", "get")
            .with_attr("to", "s.whatsapp.net")
            .with_attr("xmlns", "w:p")
            .with_children(vec![ping_child])
    }
}

pub struct MessageParser;

impl MessageParser {
    pub fn parse_incoming_message(node: &BinaryNode) -> Option<WebMessageInfo> {
        if node.tag != "message" {
            return None;
        }

        let id = node.get_attr("id")?.to_string();
        let from = node.get_attr("from")?.to_string();
        let participant = node.get_attr("participant").map(|s| s.to_string());
        let push_name = node.get_attr("notify").map(|s| s.to_string());
        let timestamp = node
            .get_attr("t")
            .and_then(|t| t.parse::<u64>().ok())
            .unwrap_or_else(current_timestamp_secs);

        let key = MessageKey {
            remote_jid: Some(from),
            from_me: Some(false),
            id: Some(id),
            participant,
        };

        // Try extracting raw proto bytes or text from child
        let mut parsed_message = None;
        if let Some(enc_child) = node.get_child("enc") {
            if let Some(BinaryNodeContent::Bytes(bytes)) = &enc_child.content {
                if let Ok(msg) = Message::decode(&bytes[..]) {
                    parsed_message = Some(msg);
                }
            }
        } else if let Some(body_child) = node.get_child("body") {
            if let Some(text) = body_child.get_content_string() {
                parsed_message = Some(Message {
                    conversation: Some(text),
                    ..Default::default()
                });
            }
        }

        Some(WebMessageInfo {
            key,
            message: parsed_message,
            message_timestamp: Some(timestamp),
            status: Some(0),
            participant: node.get_attr("participant").map(|s| s.to_string()),
            push_name,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_and_parse_message() {
        let text_msg = MessageBuilder::create_text_message(
            "Hello from Riel-Baileys Rust!",
            None,
            None,
            vec![],
        );

        let (msg_id, node) = MessageBuilder::build_send_message_node(
            "628123456789@s.whatsapp.net",
            &text_msg,
            None,
        )
        .expect("build message node");

        assert_eq!(node.tag, "message");
        assert_eq!(node.get_attr("to"), Some("628123456789@s.whatsapp.net"));
        assert_eq!(node.get_attr("id"), Some(msg_id.as_str()));

        // Simulate incoming message parsing
        let mut incoming_node = node.clone();
        incoming_node.attrs.insert("from".to_string(), "628123456789@s.whatsapp.net".to_string());
        incoming_node.attrs.insert("notify".to_string(), "Alice".to_string());
        incoming_node.attrs.insert("t".to_string(), "1600000000".to_string());

        let parsed = MessageParser::parse_incoming_message(&incoming_node).expect("parse message");
        assert_eq!(parsed.key.id, Some(msg_id));
        assert_eq!(parsed.push_name, Some("Alice".to_string()));
        assert_eq!(
            parsed.message.and_then(|m| m.conversation),
            Some("Hello from Riel-Baileys Rust!".to_string())
        );
    }
}
