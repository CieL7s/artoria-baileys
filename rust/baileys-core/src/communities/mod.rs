use crate::protocol::{BinaryNode, BinaryNodeContent};
use std::collections::HashMap;

pub struct CommunityBuilder;

impl CommunityBuilder {
    pub fn build_create(subject: &str, description: &str) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "set".to_string());
        attrs.insert("xmlns".to_string(), "w:g2".to_string());
        attrs.insert("to".to_string(), "g.us".to_string());

        let mut create_attrs = HashMap::new();
        create_attrs.insert("subject".to_string(), subject.to_string());

        let sub_nodes = vec![
            BinaryNode {
                tag: "description".to_string(),
                attrs: HashMap::new(),
                content: Some(BinaryNodeContent::Bytes(description.as_bytes().to_vec())),
            },
            BinaryNode {
                tag: "parent".to_string(),
                attrs: HashMap::new(),
                content: None,
            },
            BinaryNode {
                tag: "allow_non_admin_sub_group_creation".to_string(),
                attrs: HashMap::new(),
                content: None,
            },
        ];

        let create_node = BinaryNode {
            tag: "create".to_string(),
            attrs: create_attrs,
            content: Some(BinaryNodeContent::List(sub_nodes)),
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![create_node])),
        };

        (msg_id, root)
    }

    pub fn build_deactivate(community_jid: &str) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "set".to_string());
        attrs.insert("xmlns".to_string(), "w:g2".to_string());
        attrs.insert("to".to_string(), community_jid.to_string());

        let node = BinaryNode {
            tag: "delete_parent".to_string(),
            attrs: HashMap::new(),
            content: None,
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![node])),
        };

        (msg_id, root)
    }

    pub fn build_link_groups(community_jid: &str, group_jids: &[String]) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "set".to_string());
        attrs.insert("xmlns".to_string(), "w:g2".to_string());
        attrs.insert("to".to_string(), community_jid.to_string());

        let group_nodes: Vec<BinaryNode> = group_jids
            .iter()
            .map(|jid| {
                let mut g_attrs = HashMap::new();
                g_attrs.insert("jid".to_string(), jid.clone());
                BinaryNode {
                    tag: "group".to_string(),
                    attrs: g_attrs,
                    content: None,
                }
            })
            .collect();

        let links_node = BinaryNode {
            tag: "links".to_string(),
            attrs: HashMap::new(),
            content: Some(BinaryNodeContent::List(vec![
                BinaryNode {
                    tag: "link".to_string(),
                    attrs: {
                        let mut l_attrs = HashMap::new();
                        l_attrs.insert("link_type".to_string(), "sub_group".to_string());
                        l_attrs
                    },
                    content: Some(BinaryNodeContent::List(group_nodes)),
                }
            ])),
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![links_node])),
        };

        (msg_id, root)
    }

    pub fn build_unlink_groups(community_jid: &str, group_jids: &[String]) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "set".to_string());
        attrs.insert("xmlns".to_string(), "w:g2".to_string());
        attrs.insert("to".to_string(), community_jid.to_string());

        let group_nodes: Vec<BinaryNode> = group_jids
            .iter()
            .map(|jid| {
                let mut g_attrs = HashMap::new();
                g_attrs.insert("jid".to_string(), jid.clone());
                BinaryNode {
                    tag: "group".to_string(),
                    attrs: g_attrs,
                    content: None,
                }
            })
            .collect();

        let unlinks_node = BinaryNode {
            tag: "unlink".to_string(),
            attrs: {
                let mut u_attrs = HashMap::new();
                u_attrs.insert("unlink_type".to_string(), "sub_group".to_string());
                u_attrs
            },
            content: Some(BinaryNodeContent::List(group_nodes)),
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![unlinks_node])),
        };

        (msg_id, root)
    }
}
