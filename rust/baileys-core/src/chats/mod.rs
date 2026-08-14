use crate::message::generate_message_id;
use crate::protocol::BinaryNode;

pub struct ChatBuilder;

impl ChatBuilder {
    pub fn build_mute_chat(jid: &str, duration_secs: Option<u64>) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let mut chat_node = BinaryNode::new("chat").with_attr("jid", jid);

        if let Some(secs) = duration_secs {
            chat_node = chat_node.with_attr("mute", secs.to_string());
        } else {
            chat_node = chat_node.with_attr("mute", "0");
        }

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:chat")
            .with_attr("to", "s.whatsapp.net")
            .with_children(vec![chat_node]);

        (msg_id, iq_node)
    }

    pub fn build_pin_chat(jid: &str, pin: bool) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let pin_val = if pin { "1" } else { "0" };
        let chat_node = BinaryNode::new("chat")
            .with_attr("jid", jid)
            .with_attr("pin", pin_val);

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:chat")
            .with_attr("to", "s.whatsapp.net")
            .with_children(vec![chat_node]);

        (msg_id, iq_node)
    }

    pub fn build_archive_chat(jid: &str, archive: bool) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let archive_val = if archive { "1" } else { "0" };
        let chat_node = BinaryNode::new("chat")
            .with_attr("jid", jid)
            .with_attr("archive", archive_val);

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:chat")
            .with_attr("to", "s.whatsapp.net")
            .with_children(vec![chat_node]);

        (msg_id, iq_node)
    }

    pub fn build_presence_subscribe(jid: &str) -> BinaryNode {
        BinaryNode::new("presence")
            .with_attr("type", "subscribe")
            .with_attr("to", jid)
    }
}
