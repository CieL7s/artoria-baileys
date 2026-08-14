use crate::protocol::{BinaryNode, BinaryNodeContent};
use std::collections::HashMap;

pub struct BusinessBuilder;

impl BusinessBuilder {
    pub fn build_catalog_query(jid: &str, limit: u32) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "get".to_string());
        attrs.insert("xmlns".to_string(), "w:biz:catalog".to_string());
        attrs.insert("to".to_string(), "s.whatsapp.net".to_string());

        let mut cat_attrs = HashMap::new();
        cat_attrs.insert("jid".to_string(), jid.to_string());
        cat_attrs.insert("limit".to_string(), limit.to_string());

        let node = BinaryNode {
            tag: "catalog".to_string(),
            attrs: cat_attrs,
            content: None,
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![node])),
        };

        (msg_id, root)
    }

    pub fn build_product_query(jid: &str, product_id: &str) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "get".to_string());
        attrs.insert("xmlns".to_string(), "w:biz:catalog".to_string());
        attrs.insert("to".to_string(), "s.whatsapp.net".to_string());

        let mut prod_attrs = HashMap::new();
        prod_attrs.insert("jid".to_string(), jid.to_string());

        let mut id_attrs = HashMap::new();
        id_attrs.insert("id".to_string(), product_id.to_string());

        let prod_node = BinaryNode {
            tag: "product".to_string(),
            attrs: prod_attrs,
            content: Some(BinaryNodeContent::List(vec![BinaryNode {
                tag: "id".to_string(),
                attrs: id_attrs,
                content: None,
            }])),
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![prod_node])),
        };

        (msg_id, root)
    }

    pub fn build_collections_query(jid: &str) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "get".to_string());
        attrs.insert("xmlns".to_string(), "w:biz:catalog".to_string());
        attrs.insert("to".to_string(), "s.whatsapp.net".to_string());

        let mut coll_attrs = HashMap::new();
        coll_attrs.insert("jid".to_string(), jid.to_string());

        let node = BinaryNode {
            tag: "collections".to_string(),
            attrs: coll_attrs,
            content: None,
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![node])),
        };

        (msg_id, root)
    }

    pub fn build_order_details(order_id: &str, token: &str) -> (String, BinaryNode) {
        let msg_id = format!("3EB0{}", uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..12].to_string());
        let mut attrs = HashMap::new();
        attrs.insert("id".to_string(), msg_id.clone());
        attrs.insert("type".to_string(), "get".to_string());
        attrs.insert("xmlns".to_string(), "fb:thrift_iq".to_string());
        attrs.insert("to".to_string(), "s.whatsapp.net".to_string());

        let mut order_attrs = HashMap::new();
        order_attrs.insert("id".to_string(), order_id.to_string());
        order_attrs.insert("token".to_string(), token.to_string());

        let node = BinaryNode {
            tag: "order".to_string(),
            attrs: order_attrs,
            content: None,
        };

        let root = BinaryNode {
            tag: "iq".to_string(),
            attrs,
            content: Some(BinaryNodeContent::List(vec![node])),
        };

        (msg_id, root)
    }
}
