use crate::message::generate_message_id;
use crate::protocol::BinaryNode;

pub struct NewsletterBuilder;

impl NewsletterBuilder {
    pub fn build_create(name: &str, description: &str) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let name_node = BinaryNode::new("name").with_string_content(name);
        let desc_node = BinaryNode::new("description").with_string_content(description);

        let mut nl_node = BinaryNode::new("newsletter");
        nl_node = nl_node.with_children(vec![name_node, desc_node]);

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "newsletter")
            .with_attr("to", "s.whatsapp.net")
            .with_children(vec![nl_node]);

        (msg_id, iq_node)
    }

    pub fn build_follow(jid: &str) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let live_node = BinaryNode::new("live");

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "newsletter")
            .with_attr("to", jid)
            .with_children(vec![live_node]);

        (msg_id, iq_node)
    }

    pub fn build_unfollow(jid: &str) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let live_node = BinaryNode::new("live");

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "newsletter")
            .with_attr("to", jid)
            .with_children(vec![live_node]);

        (msg_id, iq_node)
    }

    pub fn build_mute(jid: &str, mute: bool) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let mute_node = BinaryNode::new(if mute { "mute" } else { "unmute" });

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "newsletter")
            .with_attr("to", jid)
            .with_children(vec![mute_node]);

        (msg_id, iq_node)
    }
}
