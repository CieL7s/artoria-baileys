use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const RECENT_MESSAGES_SIZE: usize = 512;
pub const RECREATE_SESSION_TIMEOUT_MS: u64 = 60 * 60 * 1000;
pub const PHONE_REQUEST_DELAY_MS: u64 = 3000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
pub enum RetryReason {
    UnknownError = 0,
    SignalErrorNoSession = 1,
    SignalErrorInvalidKey = 2,
    SignalErrorInvalidKeyId = 3,
    SignalErrorInvalidMessage = 4,
    SignalErrorInvalidSignature = 5,
    SignalErrorFutureMessage = 6,
    SignalErrorBadMac = 7,
    SignalErrorInvalidSession = 8,
    SignalErrorInvalidMsgKey = 9,
    BadBroadcastEphemeralSetting = 10,
    UnknownCompanionNoPrekey = 11,
    AdvFailure = 12,
    StatusRevokeDelay = 13,
}

impl RetryReason {
    pub fn from_u32(val: u32) -> Option<Self> {
        match val {
            0 => Some(Self::UnknownError),
            1 => Some(Self::SignalErrorNoSession),
            2 => Some(Self::SignalErrorInvalidKey),
            3 => Some(Self::SignalErrorInvalidKeyId),
            4 => Some(Self::SignalErrorInvalidMessage),
            5 => Some(Self::SignalErrorInvalidSignature),
            6 => Some(Self::SignalErrorFutureMessage),
            7 => Some(Self::SignalErrorBadMac),
            8 => Some(Self::SignalErrorInvalidSession),
            9 => Some(Self::SignalErrorInvalidMsgKey),
            10 => Some(Self::BadBroadcastEphemeralSetting),
            11 => Some(Self::UnknownCompanionNoPrekey),
            12 => Some(Self::AdvFailure),
            13 => Some(Self::StatusRevokeDelay),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::UnknownError => "UnknownError",
            Self::SignalErrorNoSession => "SignalErrorNoSession",
            Self::SignalErrorInvalidKey => "SignalErrorInvalidKey",
            Self::SignalErrorInvalidKeyId => "SignalErrorInvalidKeyId",
            Self::SignalErrorInvalidMessage => "SignalErrorInvalidMessage",
            Self::SignalErrorInvalidSignature => "SignalErrorInvalidSignature",
            Self::SignalErrorFutureMessage => "SignalErrorFutureMessage",
            Self::SignalErrorBadMac => "SignalErrorBadMac",
            Self::SignalErrorInvalidSession => "SignalErrorInvalidSession",
            Self::SignalErrorInvalidMsgKey => "SignalErrorInvalidMsgKey",
            Self::BadBroadcastEphemeralSetting => "BadBroadcastEphemeralSetting",
            Self::UnknownCompanionNoPrekey => "UnknownCompanionNoPrekey",
            Self::AdvFailure => "AdvFailure",
            Self::StatusRevokeDelay => "StatusRevokeDelay",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecreateDecision {
    pub recreate: bool,
    pub reason: String,
}

pub struct RetryManagerCore;

impl RetryManagerCore {
    pub fn is_mac_error(error_code: Option<u32>) -> bool {
        match error_code {
            Some(4) | Some(7) => true,
            _ => false,
        }
    }

    pub fn parse_retry_error_code(error_attr: Option<&str>) -> Option<u32> {
        let attr = match error_attr {
            Some(s) if !s.trim().is_empty() => s.trim(),
            _ => return None,
        };

        match attr.parse::<i64>() {
            Ok(code) => {
                if code >= 0 && code <= 13 {
                    Some(code as u32)
                } else {
                    Some(0)
                }
            }
            Err(_) => None,
        }
    }

    pub fn should_recreate_session(
        _jid: &str,
        has_session: bool,
        error_code: Option<u32>,
        last_recreate_time: Option<u64>,
        now: u64,
    ) -> RecreateDecision {
        if !has_session {
            return RecreateDecision {
                recreate: true,
                reason: "we don't have a Signal session with them".to_string(),
            };
        }

        if let Some(code) = error_code {
            if Self::is_mac_error(Some(code)) {
                let reason_str = RetryReason::from_u32(code)
                    .map(|r| r.name())
                    .unwrap_or("UnknownError");
                return RecreateDecision {
                    recreate: true,
                    reason: format!("MAC error (code {}: {}), immediate session recreation", code, reason_str),
                };
            }
        }

        match last_recreate_time {
            None => RecreateDecision {
                recreate: true,
                reason: "retry count > 1 and over an hour since last recreation".to_string(),
            },
            Some(prev) if now.saturating_sub(prev) > RECREATE_SESSION_TIMEOUT_MS => RecreateDecision {
                recreate: true,
                reason: "retry count > 1 and over an hour since last recreation".to_string(),
            },
            _ => RecreateDecision {
                recreate: false,
                reason: String::new(),
            },
        }
    }

    pub fn has_same_base_key(stored: Option<&[u8]>, current: &[u8]) -> bool {
        match stored {
            Some(s) => s == current,
            None => false,
        }
    }
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct NativeRetryState {
    pub retry_counters: HashMap<String, u32>,
    pub base_keys: HashMap<String, Vec<u8>>,
    pub session_recreate_history: HashMap<String, u64>,
    pub max_msg_retry_count: u32,
}

impl NativeRetryState {
    pub fn new(max_retries: u32) -> Self {
        Self {
            retry_counters: HashMap::new(),
            base_keys: HashMap::new(),
            session_recreate_history: HashMap::new(),
            max_msg_retry_count: max_retries,
        }
    }

    pub fn increment_retry_count(&mut self, message_id: &str) -> u32 {
        if let Some(val) = self.retry_counters.get_mut(message_id) {
            *val += 1;
            return *val;
        }
        self.retry_counters.insert(message_id.to_string(), 1);
        1
    }

    pub fn get_retry_count(&self, message_id: &str) -> u32 {
        self.retry_counters.get(message_id).copied().unwrap_or(0)
    }

    pub fn has_exceeded_max_retries(&self, message_id: &str) -> bool {
        self.get_retry_count(message_id) >= self.max_msg_retry_count
    }

    pub fn remove_retry_count(&mut self, message_id: &str) {
        self.retry_counters.remove(message_id);
    }

    pub fn save_base_key(&mut self, addr: &str, msg_id: &str, base_key: Vec<u8>) {
        let key = format!("{}:{}", addr, msg_id);
        self.base_keys.insert(key, base_key);
    }

    pub fn has_same_base_key(&self, addr: &str, msg_id: &str, base_key: &[u8]) -> bool {
        let key = format!("{}:{}", addr, msg_id);
        self.base_keys.get(&key).map(|v| v.as_slice() == base_key).unwrap_or(false)
    }

    pub fn delete_base_key(&mut self, addr: &str, msg_id: &str) {
        let key = format!("{}:{}", addr, msg_id);
        self.base_keys.remove(&key);
    }

    pub fn record_session_recreate(&mut self, jid: &str, timestamp: u64) {
        self.session_recreate_history.insert(jid.to_string(), timestamp);
    }

    pub fn get_session_recreate_time(&self, jid: &str) -> Option<u64> {
        self.session_recreate_history.get(jid).copied()
    }

    pub fn clear(&mut self) {
        self.retry_counters.clear();
        self.base_keys.clear();
        self.session_recreate_history.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retry_manager_mac_error_detection() {
        assert!(RetryManagerCore::is_mac_error(Some(4)));
        assert!(RetryManagerCore::is_mac_error(Some(7)));
        assert!(!RetryManagerCore::is_mac_error(Some(1)));
        assert!(!RetryManagerCore::is_mac_error(Some(0)));
        assert!(!RetryManagerCore::is_mac_error(None));
    }

    #[test]
    fn test_retry_manager_parse_code() {
        assert_eq!(RetryManagerCore::parse_retry_error_code(Some("4")), Some(4));
        assert_eq!(RetryManagerCore::parse_retry_error_code(Some("7")), Some(7));
        assert_eq!(RetryManagerCore::parse_retry_error_code(Some("99")), Some(0));
        assert_eq!(RetryManagerCore::parse_retry_error_code(Some("abc")), None);
        assert_eq!(RetryManagerCore::parse_retry_error_code(None), None);
        assert_eq!(RetryManagerCore::parse_retry_error_code(Some("")), None);
    }

    #[test]
    fn test_retry_manager_should_recreate() {
        let dec1 = RetryManagerCore::should_recreate_session("u1@s.whatsapp.net", false, None, None, 1000);
        assert!(dec1.recreate);
        assert_eq!(dec1.reason, "we don't have a Signal session with them");

        let dec2 = RetryManagerCore::should_recreate_session("u1@s.whatsapp.net", true, Some(4), Some(1000), 1010);
        assert!(dec2.recreate);
        assert!(dec2.reason.contains("MAC error"));

        let dec3 = RetryManagerCore::should_recreate_session("u1@s.whatsapp.net", true, Some(1), Some(1000), 1010);
        assert!(!dec3.recreate);

        let dec4 = RetryManagerCore::should_recreate_session("u1@s.whatsapp.net", true, Some(1), Some(1000), 1000 + RECREATE_SESSION_TIMEOUT_MS + 10);
        assert!(dec4.recreate);
    }

    #[test]
    fn test_native_retry_state() {
        let mut state = NativeRetryState::new(3);
        assert_eq!(state.increment_retry_count("m1"), 1);
        assert_eq!(state.increment_retry_count("m1"), 2);
        assert_eq!(state.get_retry_count("m1"), 2);
        assert!(!state.has_exceeded_max_retries("m1"));
        assert_eq!(state.increment_retry_count("m1"), 3);
        assert!(state.has_exceeded_max_retries("m1"));

        state.save_base_key("addr1", "m1", vec![1, 2, 3]);
        assert!(state.has_same_base_key("addr1", "m1", &[1, 2, 3]));
        assert!(!state.has_same_base_key("addr1", "m1", &[1, 2, 4]));
        state.delete_base_key("addr1", "m1");
        assert!(!state.has_same_base_key("addr1", "m1", &[1, 2, 3]));
    }
}
