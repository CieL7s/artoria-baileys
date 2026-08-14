use crate::protocol::{BinaryNode, BinaryNodeContent};
use std::collections::HashMap;

pub struct USyncBuilder;

impl USyncBuilder {
    pub fn build_query(users: &[String], protocols: &[String], mode: &str, context: &str) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "get".to_string());
        attrs.insert("xmlns".to_string(), "usync".to_string());
        attrs.insert("to".to_string(), "s.whatsapp.net".to_string());

        let mut usync_attrs = HashMap::new();
        usync_attrs.insert("sid".to_string(), msg_id.clone());
        usync_attrs.insert("mode".to_string(), mode.to_string());
        usync_attrs.insert("last".to_string(), "true".to_string());
        usync_attrs.insert("index".to_string(), "0".to_string());
        usync_attrs.insert("context".to_string(), context.to_string());

        let protocol_nodes: Vec<BinaryNode> = protocols
            .iter()
            .map(|p| BinaryNode {
                tag: p.clone(),
                attrs: HashMap::new(),
                content: None,
            })
            .collect();

        let protocols_node = BinaryNode {
            tag: "protocols".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(protocol_nodes)),
        };

        let user_nodes: Vec<BinaryNode> = users
            .iter()
            .map(|u| {
                let mut u_attrs = HashMap::new();
                u_attrs.insert("jid".to_string(), u.clone());
                BinaryNode {
                    tag: "user".to_string(),
                    attrs: u_attrs,
                    content: None,
                }
            })
            .collect();

        let list_node = BinaryNode {
            tag: "list".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(user_nodes)),
        };

        let usync_node = BinaryNode {
            tag: "usync".to_string(),
            attrs: usync_attrs,
            content: Some(BinaryNodeContent::List(vec![protocols_node, list_node])),
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![usync_node])),
        };

        (msg_id, root)
    }
}
