use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::protocol::{BinaryNode, BinaryNodeContent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct USyncUserDTO {
    pub id: Option<String>,
    pub lid: Option<String>,
    pub phone: Option<String>,
    pub username: Option<String>,
    pub username_key: Option<String>,
    pub r#type: Option<String>,
    pub persona_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceItem {
    pub id: u32,
    pub key_index: u32,
    pub is_hosted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyIndexData {
    pub timestamp: u64,
    pub signed_key_index: Option<Vec<u8>>,
    pub expected_timestamp: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct USyncDevicesResult {
    pub device_list: Vec<DeviceItem>,
    pub key_index: Option<KeyIndexData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct USyncStatusResult {
    pub status: Option<String>,
    pub set_at: Option<String>, // ISO Date string
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct USyncDisappearingModeResult {
    pub duration: u64,
    pub set_at: Option<String>, // ISO Date string
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotCommand {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct USyncBotProfileResult {
    pub is_default: bool,
    pub jid: Option<String>,
    pub name: Option<String>,
    pub attributes: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub persona_id: Option<String>,
    pub commands_description: Option<String>,
    pub commands: Vec<BotCommand>,
    pub prompts: Vec<String>,
}

// -------------------------------------------------------------
// PROTOCOL PARSERS & GENERATORS
// -------------------------------------------------------------

pub struct USyncProtocols;

impl USyncProtocols {
    // 1. CONTACT PROTOCOL
    pub fn contact_query_element() -> BinaryNode {
        BinaryNode {
            tag: "contact".to_string(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn contact_user_element(user: &USyncUserDTO) -> BinaryNode {
        if let Some(ref phone) = user.phone {
            return BinaryNode {
                tag: "contact".to_string(),
                attrs: HashMap::new(),
                content: Some(BinaryNodeContent::Bytes(phone.as_bytes().to_vec())),
            };
        }
        if let Some(ref username) = user.username {
            let mut attrs = HashMap::new();
            attrs.insert("username".to_string(), username.clone());
            if let Some(ref pin) = user.username_key {
                attrs.insert("pin".to_string(), pin.clone());
            }
            if let Some(ref lid) = user.lid {
                attrs.insert("lid".to_string(), lid.clone());
            }
            return BinaryNode {
                tag: "contact".to_string(),
                attrs,
                content: None,
            };
        }
        if let Some(ref r#type) = user.r#type {
            let mut attrs = HashMap::new();
            attrs.insert("type".to_string(), r#type.clone());
            return BinaryNode {
                tag: "contact".to_string(),
                attrs,
                content: None,
            };
        }
        BinaryNode {
            tag: "contact".to_string(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn parse_contact(node: &BinaryNode) -> Option<bool> {
        if node.tag == "contact" {
            let is_in = node.attrs.get("type").map(|t| t == "in").unwrap_or(false);
            Some(is_in)
        } else {
            None
        }
    }

    // 2. DEVICES PROTOCOL
    pub fn devices_query_element() -> BinaryNode {
        let mut attrs = HashMap::new();
        attrs.insert("version".to_string(), "2".to_string());
        BinaryNode {
            tag: "devices".to_string(),
            attrs,
            content: None,
        }
    }

    pub fn parse_devices(node: &BinaryNode) -> Option<USyncDevicesResult> {
        if node.tag != "devices" {
            return None;
        }
        let mut device_list = Vec::new();
        let mut key_index = None;

        if let Some(BinaryNodeContent::List(ref children)) = node.content {
            for child in children {
                if child.tag == "device-list" {
                    if let Some(BinaryNodeContent::List(ref dev_nodes)) = child.content {
                        for dev in dev_nodes {
                            if dev.tag == "device" {
                                let id = dev.attrs.get("id").and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                                let k_idx = dev.attrs.get("key-index").and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                                let is_hosted = dev.attrs.get("is_hosted").map(|s| s == "true").unwrap_or(false);
                                device_list.push(DeviceItem {
                                    id,
                                    key_index: k_idx,
                                    is_hosted,
                                });
                            }
                        }
                    }
                } else if child.tag == "key-index-list" {
                    let ts = child.attrs.get("ts").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                    let exp_ts = child.attrs.get("expected_ts").and_then(|s| s.parse::<u64>().ok());
                    let signed_bytes = match child.content {
                        Some(BinaryNodeContent::Bytes(ref b)) => Some(b.clone()),
                        Some(BinaryNodeContent::NodeBuffer(ref nb)) => Some(nb.data.clone()),
                        _ => None,
                    };
                    key_index = Some(KeyIndexData {
                        timestamp: ts,
                        signed_key_index: signed_bytes,
                        expected_timestamp: exp_ts,
                    });
                }
            }
        }

        Some(USyncDevicesResult {
            device_list,
            key_index,
        })
    }

    // 3. STATUS PROTOCOL
    pub fn status_query_element() -> BinaryNode {
        BinaryNode {
            tag: "status".to_string(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn parse_status(node: &BinaryNode) -> Option<USyncStatusResult> {
        if node.tag != "status" {
            return None;
        }
        let ts_sec = node.attrs.get("t").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let set_at = if ts_sec > 0 {
            Some(format_iso_timestamp(ts_sec * 1000))
        } else {
            Some(format_iso_timestamp(0))
        };

        let mut status_str = match node.content {
            Some(BinaryNodeContent::Bytes(ref b)) => String::from_utf8(b.clone()).ok(),
            Some(BinaryNodeContent::NodeBuffer(ref nb)) => String::from_utf8(nb.data.clone()).ok(),
            Some(BinaryNodeContent::String(ref s)) => Some(s.clone()),
            _ => None,
        };

        if status_str.as_ref().map(|s| s.is_empty()).unwrap_or(false) {
            status_str = None;
        }

        if status_str.is_none() {
            if let Some(code_str) = node.attrs.get("code") {
                if code_str == "401" {
                    status_str = Some("".to_string());
                }
            }
        }

        Some(USyncStatusResult {
            status: status_str,
            set_at,
        })
    }

    // 4. DISAPPEARING MODE PROTOCOL
    pub fn disappearing_mode_query_element() -> BinaryNode {
        BinaryNode {
            tag: "disappearing_mode".to_string(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn parse_disappearing_mode(node: &BinaryNode) -> Option<USyncDisappearingModeResult> {
        if node.tag != "disappearing_mode" {
            return None;
        }
        let duration = node.attrs.get("duration").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        let ts_sec = node.attrs.get("t").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let set_at = Some(format_iso_timestamp(ts_sec * 1000));

        Some(USyncDisappearingModeResult {
            duration,
            set_at,
        })
    }

    // 5. LID PROTOCOL
    pub fn lid_query_element() -> BinaryNode {
        BinaryNode {
            tag: "lid".to_string(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn lid_user_element(user: &USyncUserDTO) -> Option<BinaryNode> {
        user.lid.as_ref().map(|lid| {
            let mut attrs = HashMap::new();
            attrs.insert("jid".to_string(), lid.clone());
            BinaryNode {
                tag: "lid".to_string(),
                attrs,
                content: None,
            }
        })
    }

    pub fn parse_lid(node: &BinaryNode) -> Option<String> {
        if node.tag == "lid" {
            node.attrs.get("val").cloned()
        } else {
            None
        }
    }

    // 6. USERNAME PROTOCOL
    pub fn username_query_element() -> BinaryNode {
        BinaryNode {
            tag: "username".to_string(),
            attrs: HashMap::new(),
            content: None,
        }
    }

    pub fn parse_username(node: &BinaryNode) -> Option<String> {
        if node.tag == "username" {
            match node.content {
                Some(BinaryNodeContent::Bytes(ref b)) => String::from_utf8(b.clone()).ok(),
                Some(BinaryNodeContent::String(ref s)) => Some(s.clone()),
                _ => None,
            }
        } else {
            None
        }
    }

    // 7. BOT PROFILE PROTOCOL
    pub fn bot_query_element() -> BinaryNode {
        let mut p_attrs = HashMap::new();
        p_attrs.insert("v".to_string(), "1".to_string());
        let profile_node = BinaryNode {
            tag: "profile".to_string(),
            attrs: p_attrs,
            content: None,
        };
        BinaryNode {
            tag: "bot".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(vec![profile_node])),
        }
    }

    pub fn bot_user_element(user: &USyncUserDTO) -> BinaryNode {
        let mut p_attrs = HashMap::new();
        if let Some(ref persona) = user.persona_id {
            p_attrs.insert("persona_id".to_string(), persona.clone());
        }
        let profile_node = BinaryNode {
            tag: "profile".to_string(),
            attrs: p_attrs,
            content: None,
        };
        BinaryNode {
            tag: "bot".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(vec![profile_node])),
        }
    }

    pub fn parse_bot(node: &BinaryNode) -> Option<USyncBotProfileResult> {
        let bot_node = find_child(node, "bot").unwrap_or(node);
        let profile = find_child(bot_node, "profile")?;
        let commands_node = find_child(profile, "commands");
        let prompts_node = find_child(profile, "prompts");

        let is_default = find_child(profile, "default").is_some();
        let jid = node.attrs.get("jid").cloned();
        let name = find_child_string(profile, "name");
        let attributes = find_child_string(profile, "attributes");
        let description = find_child_string(profile, "description");
        let category = find_child_string(profile, "category");
        let persona_id = profile.attrs.get("persona_id").cloned();
        let commands_description = commands_node.and_then(|c| find_child_string(c, "description"));

        let mut commands = Vec::new();
        if let Some(c_node) = commands_node {
            for cmd in find_children(c_node, "command") {
                commands.push(BotCommand {
                    name: find_child_string(cmd, "name"),
                    description: find_child_string(cmd, "description"),
                });
            }
        }

        let mut prompts = Vec::new();
        if let Some(p_node) = prompts_node {
            for prompt in find_children(p_node, "prompt") {
                let emoji = find_child_string(prompt, "emoji").unwrap_or_default();
                let text = find_child_string(prompt, "text").unwrap_or_default();
                prompts.push(format!("{} {}", emoji, text).trim().to_string());
            }
        }

        Some(USyncBotProfileResult {
            is_default,
            jid,
            name,
            attributes,
            description,
            category,
            persona_id,
            commands_description,
            commands,
            prompts,
        })
    }
}

// -------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------

fn find_child<'a>(node: &'a BinaryNode, tag: &str) -> Option<&'a BinaryNode> {
    if let Some(BinaryNodeContent::List(ref children)) = node.content {
        children.iter().find(|c| c.tag == tag)
    } else {
        None
    }
}

fn find_children<'a>(node: &'a BinaryNode, tag: &str) -> Vec<&'a BinaryNode> {
    if let Some(BinaryNodeContent::List(ref children)) = node.content {
        children.iter().filter(|c| c.tag == tag).collect()
    } else {
        Vec::new()
    }
}

fn find_child_string(node: &BinaryNode, tag: &str) -> Option<String> {
    let child = find_child(node, tag)?;
    match child.content {
        Some(BinaryNodeContent::Bytes(ref b)) => String::from_utf8(b.clone()).ok(),
        Some(BinaryNodeContent::String(ref s)) => Some(s.clone()),
        _ => None,
    }
}

fn format_iso_timestamp(epoch_ms: i64) -> String {
    // Construct ISO-8601 string: YYYY-MM-DDTHH:MM:SS.000Z
    let secs = epoch_ms / 1000;
    let days = secs / 86400;
    let rem_secs = secs % 86400;
    let hours = rem_secs / 3600;
    let mins = (rem_secs % 3600) / 60;
    let s = rem_secs % 60;

    // Simple Gregorian date from epoch days
    let (year, month, day) = days_to_date(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", year, month, day, hours, mins, s)
}

fn days_to_date(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as i64;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as i64;
    let final_y = if m <= 2 { y + 1 } else { y };
    (final_y, m, d)
}
