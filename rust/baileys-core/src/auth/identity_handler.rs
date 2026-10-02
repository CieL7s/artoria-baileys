use serde::{Deserialize, Serialize};
use crate::protocol::{are_jids_same_user, jid_decode};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IdentityEvaluation {
    pub action: String,
    pub device: Option<u8>,
    pub should_refresh: bool,
    pub is_self_primary: bool,
}

pub struct IdentityHandlerCore;

impl IdentityHandlerCore {
    pub fn evaluate(
        from: Option<&str>,
        has_identity_node: bool,
        me_id: Option<&str>,
        me_lid: Option<&str>,
        is_debounced: bool,
        is_offline: bool,
        has_existing_session: bool,
    ) -> IdentityEvaluation {
        let from_str = match from {
            Some(s) if !s.trim().is_empty() => s.trim(),
            _ => {
                return IdentityEvaluation {
                    action: "invalid_notification".to_string(),
                    device: None,
                    should_refresh: false,
                    is_self_primary: false,
                };
            }
        };

        if !has_identity_node {
            return IdentityEvaluation {
                action: "no_identity_node".to_string(),
                device: None,
                should_refresh: false,
                is_self_primary: false,
            };
        }

        let decoded = jid_decode(from_str);
        if let Some(ref d) = decoded {
            if let Some(dev) = d.device {
                if dev != 0 {
                    return IdentityEvaluation {
                        action: "skipped_companion_device".to_string(),
                        device: Some(dev),
                        should_refresh: false,
                        is_self_primary: false,
                    };
                }
            }
        }

        let is_self_primary = are_jids_same_user(Some(from_str), me_id)
            || are_jids_same_user(Some(from_str), me_lid);

        if is_self_primary {
            return IdentityEvaluation {
                action: "skipped_self_primary".to_string(),
                device: decoded.and_then(|d| d.device),
                should_refresh: false,
                is_self_primary: true,
            };
        }

        if is_debounced {
            return IdentityEvaluation {
                action: "debounced".to_string(),
                device: decoded.and_then(|d| d.device),
                should_refresh: false,
                is_self_primary: false,
            };
        }

        if !has_existing_session {
            return IdentityEvaluation {
                action: "skipped_no_session".to_string(),
                device: decoded.and_then(|d| d.device),
                should_refresh: false,
                is_self_primary: false,
            };
        }

        if is_offline {
            return IdentityEvaluation {
                action: "skipped_offline".to_string(),
                device: decoded.and_then(|d| d.device),
                should_refresh: false,
                is_self_primary: false,
            };
        }

        IdentityEvaluation {
            action: "proceed_refresh".to_string(),
            device: decoded.and_then(|d| d.device),
            should_refresh: true,
            is_self_primary: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_handler_all_branches() {
        let e1 = IdentityHandlerCore::evaluate(None, true, None, None, false, false, true);
        assert_eq!(e1.action, "invalid_notification");

        let e2 = IdentityHandlerCore::evaluate(Some("u@s.whatsapp.net"), false, None, None, false, false, true);
        assert_eq!(e2.action, "no_identity_node");

        let e3 = IdentityHandlerCore::evaluate(Some("u:1@s.whatsapp.net"), true, None, None, false, false, true);
        assert_eq!(e3.action, "skipped_companion_device");
        assert_eq!(e3.device, Some(1));

        let e4 = IdentityHandlerCore::evaluate(Some("u@s.whatsapp.net"), true, Some("u@s.whatsapp.net"), None, false, false, true);
        assert_eq!(e4.action, "skipped_self_primary");
        assert!(e4.is_self_primary);

        let e5 = IdentityHandlerCore::evaluate(Some("u@s.whatsapp.net"), true, None, None, true, false, true);
        assert_eq!(e5.action, "debounced");

        let e6 = IdentityHandlerCore::evaluate(Some("u@s.whatsapp.net"), true, None, None, false, false, false);
        assert_eq!(e6.action, "skipped_no_session");

        let e7 = IdentityHandlerCore::evaluate(Some("u@s.whatsapp.net"), true, None, None, false, true, true);
        assert_eq!(e7.action, "skipped_offline");

        let e8 = IdentityHandlerCore::evaluate(Some("u@s.whatsapp.net"), true, None, None, false, false, true);
        assert_eq!(e8.action, "proceed_refresh");
        assert!(e8.should_refresh);
    }
}
