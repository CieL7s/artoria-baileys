use serde::{Deserialize, Serialize};

pub const S_WHATSAPP_NET: &str = "@s.whatsapp.net";
pub const OFFICIAL_BIZ_JID: &str = "16505361212@c.us";
pub const SERVER_JID: &str = "server@c.us";
pub const PSA_WID: &str = "0@c.us";
pub const STORIES_JID: &str = "status@broadcast";
pub const META_AI_JID: &str = "13135550002@c.us";

pub mod domains {
    pub const WHATSAPP: u8 = 0;
    pub const LID: u8 = 1;
    pub const HOSTED: u8 = 128;
    pub const HOSTED_LID: u8 = 129;
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FullJid {
    pub user: String,
    pub server: String,
    pub device: Option<u8>,
    pub agent: Option<u32>,
    pub domain_type: Option<u8>,
}

pub fn get_server_from_domain_type(initial_server: &str, domain_type: Option<u8>) -> String {
    match domain_type {
        Some(domains::LID) => "lid".to_string(),
        Some(domains::HOSTED) => "hosted".to_string(),
        Some(domains::HOSTED_LID) => "hosted.lid".to_string(),
        _ => initial_server.to_string(),
    }
}

pub fn jid_encode(
    user: &str,
    server: &str,
    device: Option<u8>,
    agent: Option<u32>,
) -> String {
    let mut result = String::new();
    result.push_str(user);
    if let Some(ag) = agent {
        if ag > 0 {
            result.push('_');
            result.push_str(&ag.to_string());
        }
    }
    if let Some(dev) = device {
        if dev > 0 {
            result.push(':');
            result.push_str(&dev.to_string());
        }
    }
    result.push('@');
    result.push_str(server);
    result
}

pub fn jid_decode(jid: &str) -> Option<FullJid> {
    let sep_idx = jid.find('@')?;
    let user_combined = &jid[..sep_idx];
    let server = &jid[sep_idx + 1..];

    let (user_agent, device) = if let Some(colon_idx) = user_combined.find(':') {
        let dev = user_combined[colon_idx + 1..].parse::<u8>().ok();
        (&user_combined[..colon_idx], dev)
    } else {
        (user_combined, None)
    };

    let (user, agent) = if let Some(underscore_idx) = user_agent.find('_') {
        let ag = user_agent[underscore_idx + 1..].parse::<u32>().ok();
        (&user_agent[..underscore_idx], ag)
    } else {
        (user_agent, None)
    };

    let mut domain_type = Some(domains::WHATSAPP);
    if server == "lid" {
        domain_type = Some(domains::LID);
    } else if server == "hosted" {
        domain_type = Some(domains::HOSTED);
    } else if server == "hosted.lid" {
        domain_type = Some(domains::HOSTED_LID);
    } else if let Some(ag) = agent {
        domain_type = Some(ag as u8);
    }

    Some(FullJid {
        user: user.to_string(),
        server: server.to_string(),
        device,
        agent,
        domain_type,
    })
}

pub fn are_jids_same_user(jid1: Option<&str>, jid2: Option<&str>) -> bool {
    match (jid1.and_then(jid_decode), jid2.and_then(jid_decode)) {
        (Some(j1), Some(j2)) => j1.user == j2.user,
        _ => false,
    }
}

pub fn is_jid_group(jid: &str) -> bool {
    jid.ends_with("@g.us")
}

pub fn is_jid_user(jid: &str) -> bool {
    jid.ends_with("@s.whatsapp.net") || jid.ends_with("@c.us")
}

pub fn is_lid_user(jid: &str) -> bool {
    jid.ends_with("@lid")
}

pub fn is_jid_broadcast(jid: &str) -> bool {
    jid.ends_with("@broadcast")
}

pub fn is_jid_newsletter(jid: &str) -> bool {
    jid.ends_with("@newsletter")
}

pub fn jid_normalized_user(jid: &str) -> String {
    if let Some(decoded) = jid_decode(jid) {
        let target_server = if decoded.server == "c.us" {
            "s.whatsapp.net"
        } else {
            &decoded.server
        };
        jid_encode(&decoded.user, target_server, None, None)
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jid_encode_decode() {
        let encoded = jid_encode("628123456789", "s.whatsapp.net", Some(1), None);
        assert_eq!(encoded, "628123456789:1@s.whatsapp.net");

        let decoded = jid_decode(&encoded).unwrap();
        assert_eq!(decoded.user, "628123456789");
        assert_eq!(decoded.server, "s.whatsapp.net");
        assert_eq!(decoded.device, Some(1));
        assert_eq!(decoded.domain_type, Some(domains::WHATSAPP));
    }

    #[test]
    fn test_jid_normalized_user() {
        let normal = jid_normalized_user("628123456789:2@c.us");
        assert_eq!(normal, "628123456789@s.whatsapp.net");
    }

    #[test]
    fn test_group_jid() {
        assert!(is_jid_group("120363024823904@g.us"));
        assert!(!is_jid_group("628123456789@s.whatsapp.net"));
    }
}
