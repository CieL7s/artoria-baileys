use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use crate::protocol::{BinaryNode, BinaryNodeContent};
use super::protocols::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct USyncQueryResult {
    pub list: Vec<HashMap<String, Value>>,
    pub side_list: Vec<HashMap<String, Value>>,
}

pub struct USyncQueryEngine;

impl USyncQueryEngine {
    /// Builds the standard WhatsApp USync query IQ node
    pub fn build_query(
        context: &str,
        mode: &str,
        users: &[USyncUserDTO],
        protocols: &[String],
        message_id: &str,
    ) -> BinaryNode {
        let mut query_children = Vec::new();
        for proto in protocols {
            match proto.as_str() {
                "contact" => query_children.push(USyncProtocols::contact_query_element()),
                "devices" => query_children.push(USyncProtocols::devices_query_element()),
                "status" => query_children.push(USyncProtocols::status_query_element()),
                "disappearing_mode" => query_children.push(USyncProtocols::disappearing_mode_query_element()),
                "bot" => query_children.push(USyncProtocols::bot_query_element()),
                "lid" => query_children.push(USyncProtocols::lid_query_element()),
                "username" => query_children.push(USyncProtocols::username_query_element()),
                _ => {}
            }
        }

        let query_node = BinaryNode {
            tag: "query".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(query_children)),
        };

        let mut user_nodes = Vec::new();
        for user in users {
            let mut user_content = Vec::new();
            for proto in protocols {
                match proto.as_str() {
                    "contact" => user_content.push(USyncProtocols::contact_user_element(user)),
                    "lid" => {
                        if let Some(lid_node) = USyncProtocols::lid_user_element(user) {
                            user_content.push(lid_node);
                        }
                    }
                    "bot" => user_content.push(USyncProtocols::bot_user_element(user)),
                    _ => {}
                }
            }

            let mut u_attrs = HashMap::new();
            if user.phone.is_none() {
                if let Some(ref id) = user.id {
                    u_attrs.insert("jid".to_string(), id.clone());
                }
            }

            user_nodes.push(BinaryNode {
                tag: "user".to_string(),
                attrs: u_attrs,
                content: if user_content.is_empty() {
                    None
                } else {
                    Some(BinaryNodeContent::List(user_content))
                },
            });
        }

        let list_node = BinaryNode {
            tag: "list".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(user_nodes)),
        };

        let mut usync_attrs = HashMap::new();
        usync_attrs.insert("context".to_string(), context.to_string());
        usync_attrs.insert("mode".to_string(), mode.to_string());
        usync_attrs.insert("sid".to_string(), message_id.to_string());
        usync_attrs.insert("last".to_string(), "true".to_string());
        usync_attrs.insert("index".to_string(), "0".to_string());

        let usync_node = BinaryNode {
            tag: "usync".to_string(),
            attrs: usync_attrs,
            content: Some(BinaryNodeContent::List(vec![query_node, list_node])),
        };

        let mut iq_attrs = HashMap::new();
        iq_attrs.insert("to".to_string(), "s.whatsapp.net".to_string());
        iq_attrs.insert("type".to_string(), "get".to_string());
        iq_attrs.insert("xmlns".to_string(), "usync".to_string());
        iq_attrs.insert("id".to_string(), message_id.to_string());

        BinaryNode {
            tag: "iq".to_string(),
            attrs: iq_attrs,
            content: Some(BinaryNodeContent::List(vec![usync_node])),
        }
    }

    /// Parses the IQ result binary node into structured protocol maps
    pub fn parse_query_result(
        result_node: &BinaryNode,
        protocols: &[String],
    ) -> Option<USyncQueryResult> {
        let node_type = result_node.attrs.get("type").map(|s| s.as_str());
        if node_type != Some("result") {
            return None;
        }

        let usync_node = find_child(result_node, "usync")?;
        let list_node = find_child(usync_node, "list");

        let mut list_results = Vec::new();
        if let Some(ln) = list_node {
            if let Some(BinaryNodeContent::List(ref user_nodes)) = ln.content {
                for u_node in user_nodes {
                    if u_node.tag == "user" {
                        if let Some(jid) = u_node.attrs.get("jid") {
                            let mut user_map = HashMap::new();
                            user_map.insert("id".to_string(), Value::String(jid.clone()));

                            if let Some(BinaryNodeContent::List(ref content_nodes)) = u_node.content {
                                for c_node in content_nodes {
                                    let tag = c_node.tag.as_str();
                                    if !protocols.iter().any(|p| p == tag) {
                                        continue;
                                    }
                                    match tag {
                                        "contact" => {
                                            if let Some(b) = USyncProtocols::parse_contact(c_node) {
                                                user_map.insert("contact".to_string(), Value::Bool(b));
                                            }
                                        }
                                        "devices" => {
                                            if let Some(dev) = USyncProtocols::parse_devices(c_node) {
                                                if let Ok(v) = serde_json::to_value(dev) {
                                                    user_map.insert("devices".to_string(), v);
                                                }
                                            }
                                        }
                                        "status" => {
                                            if let Some(st) = USyncProtocols::parse_status(c_node) {
                                                if let Ok(v) = serde_json::to_value(st) {
                                                    user_map.insert("status".to_string(), v);
                                                }
                                            }
                                        }
                                        "disappearing_mode" => {
                                            if let Some(dm) = USyncProtocols::parse_disappearing_mode(c_node) {
                                                if let Ok(v) = serde_json::to_value(dm) {
                                                    user_map.insert("disappearing_mode".to_string(), v);
                                                }
                                            }
                                        }
                                        "bot" => {
                                            if let Some(bot) = USyncProtocols::parse_bot(c_node) {
                                                if let Ok(v) = serde_json::to_value(bot) {
                                                    user_map.insert("bot".to_string(), v);
                                                }
                                            }
                                        }
                                        "lid" => {
                                            if let Some(lid_val) = USyncProtocols::parse_lid(c_node) {
                                                user_map.insert("lid".to_string(), Value::String(lid_val));
                                            }
                                        }
                                        "username" => {
                                            if let Some(u_val) = USyncProtocols::parse_username(c_node) {
                                                user_map.insert("username".to_string(), Value::String(u_val));
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            list_results.push(user_map);
                        }
                    }
                }
            }
        }

        Some(USyncQueryResult {
            list: list_results,
            side_list: Vec::new(),
        })
    }
}

fn find_child<'a>(node: &'a BinaryNode, tag: &str) -> Option<&'a BinaryNode> {
    if let Some(BinaryNodeContent::List(ref children)) = node.content {
        children.iter().find(|c| c.tag == tag)
    } else {
        None
    }
}
