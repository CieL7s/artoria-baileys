use crate::protocol::{BinaryNode, BinaryNodeContent};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;

type HmacSha256 = Hmac<Sha256>;

pub struct AppStateSync;

impl AppStateSync {
    pub fn compute_patch_mac(patch_data: &[u8], mac_key: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(mac_key).expect("hmac key");
        mac.update(patch_data);
        mac.finalize().into_bytes().to_vec()
    }

    pub fn build_syncd_node(name: &str, patches: &[Vec<u8>]) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "set".to_string());
        attrs.insert("xmlns".to_string(), "w:sync:app:state".to_string());
        attrs.insert("to".to_string(), "s.whatsapp.net".to_string());

        let patch_nodes: Vec<BinaryNode> = patches
            .iter()
            .map(|p| BinaryNode {
                tag: "patch".to_string(),
                attrs: HashMap::new(),
                content: Some(BinaryNodeContent::Bytes(p.clone())),
            })
            .collect();

        let collection_node = BinaryNode {
            tag: "collection".to_string(),
            attrs: {
                let mut c_attrs = HashMap::new();
                c_attrs.insert("name".to_string(), name.to_string());
                c_attrs
            },
            content: Some(BinaryNodeContent::List(patch_nodes)),
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![BinaryNode {
                tag: "sync".to_string(),
                attrs: HashMap::new(),
                content: Some(BinaryNodeContent::List(vec![collection_node])),
            }])),
        };

        (msg_id, root)
    }
}
