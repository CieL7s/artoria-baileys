use crate::message::generate_message_id;
use crate::protocol::BinaryNode;

pub struct GroupBuilder;

impl GroupBuilder {
    pub fn build_create_group(
        subject: &str,
        participants: &[String],
    ) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let participant_nodes: Vec<BinaryNode> = participants
            .iter()
            .map(|p| {
                let p_node = BinaryNode::new("participant").with_attr("jid", p);
                p_node
            })
            .collect();

        let mut group_node = BinaryNode::new("group").with_attr("subject", subject);
        if !participant_nodes.is_empty() {
            group_node = group_node.with_children(participant_nodes);
        }

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", "@g.us")
            .with_children(vec![group_node]);

        (msg_id, iq_node)
    }

    pub fn build_participants_update(
        group_jid: &str,
        participants: &[String],
        action: &str, // "add" | "remove" | "promote" | "demote"
    ) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let participant_nodes: Vec<BinaryNode> = participants
            .iter()
            .map(|p| BinaryNode::new("participant").with_attr("jid", p))
            .collect();

        let action_node = BinaryNode::new(action).with_children(participant_nodes);

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", group_jid)
            .with_children(vec![action_node]);

        (msg_id, iq_node)
    }

    pub fn build_invite_code_query(group_jid: &str) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let invite_node = BinaryNode::new("invite");

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "get")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", group_jid)
            .with_children(vec![invite_node]);

        (msg_id, iq_node)
    }

    pub fn build_revoke_invite_code(group_jid: &str) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let invite_node = BinaryNode::new("invite");

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", group_jid)
            .with_children(vec![invite_node]);

        (msg_id, iq_node)
    }

    pub fn build_update_subject(group_jid: &str, subject: &str) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let subject_node = BinaryNode::new("subject").with_string_content(subject);

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", group_jid)
            .with_children(vec![subject_node]);

        (msg_id, iq_node)
    }

    pub fn build_update_description(
        group_jid: &str,
        description: &str,
        prev_id: Option<&str>,
    ) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let desc_id = generate_message_id();
        let body_node = BinaryNode::new("body").with_string_content(description);

        let mut desc_node = BinaryNode::new("description")
            .with_attr("id", desc_id)
            .with_children(vec![body_node]);

        if let Some(pid) = prev_id {
            desc_node = desc_node.with_attr("prev", pid);
        }

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", group_jid)
            .with_children(vec![desc_node]);

        (msg_id, iq_node)
    }

    pub fn build_setting_update(
        group_jid: &str,
        setting: &str, // "announcement" | "not_announcement" | "locked" | "unlocked"
    ) -> (String, BinaryNode) {
        let msg_id = generate_message_id();
        let setting_node = BinaryNode::new(setting);

        let iq_node = BinaryNode::new("iq")
            .with_attr("id", &msg_id)
            .with_attr("type", "set")
            .with_attr("xmlns", "w:g2")
            .with_attr("to", group_jid)
            .with_children(vec![setting_node]);

        (msg_id, iq_node)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_group_create_builder() {
        let participants = vec![
            "6281111111@s.whatsapp.net".to_string(),
            "6282222222@s.whatsapp.net".to_string(),
        ];
        let (id, node) = GroupBuilder::build_create_group("Test Group", &participants);
        assert_eq!(node.tag, "iq");
        assert_eq!(node.get_attr("xmlns"), Some("w:g2"));
        assert_eq!(node.get_attr("type"), Some("set"));
        assert_eq!(node.get_attr("id"), Some(id.as_str()));

        let group_child = node.get_child("group").expect("group child");
        assert_eq!(group_child.get_attr("subject"), Some("Test Group"));
        assert_eq!(group_child.get_children("participant").len(), 2);
    }
}
