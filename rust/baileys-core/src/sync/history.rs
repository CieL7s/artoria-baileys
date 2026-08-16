use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::protocol::jid::{is_hosted_lid_user, is_hosted_pn_user, is_lid_user, is_pn_user};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryContactItem {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lid: Option<String>,
    #[serde(rename = "phoneNumber", skip_serializing_if = "Option::is_none")]
    pub phone_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify: Option<String>,
    #[serde(rename = "verifiedName", skip_serializing_if = "Option::is_none")]
    pub verified_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryLidPnPnPair {
    pub lid: String,
    pub pn: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessedHistoryResult {
    pub chats: Vec<Value>,
    pub contacts: Vec<HistoryContactItem>,
    pub messages: Vec<Value>,
    #[serde(rename = "lidPnMappings")]
    pub lid_pn_mappings: Vec<HistoryLidPnPnPair>,
    #[serde(rename = "pastParticipants", skip_serializing_if = "Option::is_none")]
    pub past_participants: Option<Value>,
    #[serde(rename = "syncType", skip_serializing_if = "Option::is_none")]
    pub sync_type: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Value>,
}

pub struct HistoryProcessor;

impl HistoryProcessor {
    /// Extracts PN from outgoing 1:1 chat messages (fromMe: true) with userReceipt.
    pub fn extract_pn_from_messages(messages: &[Value]) -> Option<String> {
        for msg_item in messages {
            let message = msg_item.get("message").unwrap_or(msg_item);
            let from_me = message
                .get("key")
                .and_then(|k| k.get("fromMe"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if !from_me {
                continue;
            }

            if let Some(user_receipt) = message.get("userReceipt").and_then(|r| r.as_array()) {
                if let Some(first) = user_receipt.first() {
                    if let Some(user_jid) = first.get("userJid").and_then(|j| j.as_str()) {
                        if is_pn_user(user_jid) || is_hosted_pn_user(user_jid) {
                            return Some(user_jid.to_string());
                        }
                    }
                }
            }
        }
        None
    }

    /// Pure Rust processing of decoded HistorySync protobuf payload.
    pub fn process_history_message(mut item: Value) -> ProcessedHistoryResult {
        let mut messages = Vec::new();
        let mut contacts = Vec::new();
        let mut chats = Vec::new();
        let mut lid_pn_mappings = Vec::new();

        // 1. Extract direct phoneNumberToLidMappings
        if let Some(mappings) = item.get("phoneNumberToLidMappings").and_then(|m| m.as_array()) {
            for m in mappings {
                let lid = m.get("lidJid").and_then(|v| v.as_str());
                let pn = m.get("pnJid").and_then(|v| v.as_str());
                if let (Some(l), Some(p)) = (lid, pn) {
                    lid_pn_mappings.push(HistoryLidPnPnPair {
                        lid: l.to_string(),
                        pn: p.to_string(),
                    });
                }
            }
        }

        let sync_type_num = item.get("syncType").and_then(|v| v.as_i64()).unwrap_or(-1);

        // 2. Process conversations for INITIAL_BOOTSTRAP(0), RECENT(1), FULL(2), ON_DEMAND(3)
        if (0..=3).contains(&sync_type_num) {
            if let Some(conversations) = item.get_mut("conversations").and_then(|c| c.as_array_mut()) {
                for chat in conversations {
                    let chat_id = chat.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let name = chat.get("displayName")
                        .or_else(|| chat.get("name"))
                        .or_else(|| chat.get("username"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    let username = chat.get("username").and_then(|v| v.as_str()).map(str::to_string);
                    let lid = chat.get("lidJid")
                        .or_else(|| chat.get("accountLid"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    let phone_number = chat.get("pnJid").and_then(|v| v.as_str()).map(str::to_string);

                    contacts.push(HistoryContactItem {
                        id: chat_id.clone(),
                        name,
                        username,
                        lid: lid.clone(),
                        phone_number: phone_number.clone(),
                        notify: None,
                        verified_name: None,
                    });

                    let is_lid = is_lid_user(&chat_id) || is_hosted_lid_user(&chat_id);
                    let is_pn = is_pn_user(&chat_id) || is_hosted_pn_user(&chat_id);

                    // Extract chat.messages array
                    let raw_msgs = if let Value::Object(ref mut c_map) = chat {
                        c_map.remove("messages").and_then(|m| match m {
                            Value::Array(a) => Some(a),
                            _ => None,
                        }).unwrap_or_default()
                    } else {
                        Vec::new()
                    };

                    if is_lid {
                        if let Some(ref pn) = phone_number {
                            lid_pn_mappings.push(HistoryLidPnPnPair {
                                lid: chat_id.clone(),
                                pn: pn.clone(),
                            });
                        } else {
                            // Fallback: extract from messages
                            if let Some(pn_from_rcpt) = Self::extract_pn_from_messages(&raw_msgs) {
                                lid_pn_mappings.push(HistoryLidPnPnPair {
                                    lid: chat_id.clone(),
                                    pn: pn_from_rcpt,
                                });
                            }
                        }
                    } else if is_pn {
                        if let Some(ref l) = lid {
                            lid_pn_mappings.push(HistoryLidPnPnPair {
                                lid: l.clone(),
                                pn: chat_id.clone(),
                            });
                        }
                    }

                    // Process messages inside chat
                    let mut chat_messages_retained = Vec::new();
                    let mut last_recv_ts: Option<Value> = chat.get("lastMessageRecvTimestamp").cloned();

                    for item_msg in raw_msgs {
                        let msg_content = item_msg.get("message").cloned().unwrap_or(item_msg);
                        messages.push(msg_content.clone());

                        if chat_messages_retained.is_empty() {
                            chat_messages_retained.push(serde_json::json!({ "message": msg_content }));
                        }

                        let from_me = msg_content
                            .get("key")
                            .and_then(|k| k.get("fromMe"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        if !from_me && last_recv_ts.is_none() {
                            if let Some(ts) = msg_content.get("messageTimestamp") {
                                last_recv_ts = Some(ts.clone());
                            }
                        }

                        // Check verifiedName stub types (BIZ_PRIVACY_MODE_TO_BSP = 142, BIZ_PRIVACY_MODE_TO_FB = 143)
                        let stub_type = msg_content.get("messageStubType").and_then(|v| v.as_i64()).unwrap_or(0);
                        if stub_type == 142 || stub_type == 143 {
                            if let Some(params) = msg_content.get("messageStubParameters").and_then(|p| p.as_array()) {
                                if let Some(first_param) = params.first().and_then(|v| v.as_str()) {
                                    let target_id = msg_content
                                        .get("key")
                                        .and_then(|k| k.get("participant").or_else(|| k.get("remoteJid")))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(&chat_id);

                                    contacts.push(HistoryContactItem {
                                        id: target_id.to_string(),
                                        name: None,
                                        username: None,
                                        lid: None,
                                        phone_number: None,
                                        notify: None,
                                        verified_name: Some(first_param.to_string()),
                                    });
                                }
                            }
                        }
                    }

                    if let Value::Object(ref mut c_map) = chat {
                        if !chat_messages_retained.is_empty() {
                            c_map.insert("messages".to_string(), Value::Array(chat_messages_retained));
                        }
                        if let Some(ts) = last_recv_ts {
                            c_map.insert("lastMessageRecvTimestamp".to_string(), ts);
                        }
                    }

                    chats.push(chat.clone());
                }
            }
        } else if sync_type_num == 4 {
            // PUSH_NAME (4)
            if let Some(pushnames) = item.get("pushnames").and_then(|p| p.as_array()) {
                for c in pushnames {
                    if let Some(c_id) = c.get("id").and_then(|v| v.as_str()) {
                        let pushname = c.get("pushname").and_then(|v| v.as_str()).map(str::to_string);
                        contacts.push(HistoryContactItem {
                            id: c_id.to_string(),
                            name: None,
                            username: None,
                            lid: None,
                            phone_number: None,
                            notify: pushname,
                            verified_name: None,
                        });
                    }
                }
            }
        }

        let past_participants = item.get("pastParticipants").cloned();
        let sync_type = item.get("syncType").cloned();
        let progress = item.get("progress").cloned();

        ProcessedHistoryResult {
            chats,
            contacts,
            messages,
            lid_pn_mappings,
            past_participants,
            sync_type,
            progress,
        }
    }
}
