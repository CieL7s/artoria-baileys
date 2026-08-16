use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;

pub const CLOSED_SESSIONS_MAX: usize = 40;
pub const SESSION_RECORD_VERSION: &str = "v1";

/// Helper for deserializing fields that can arrive as:
/// 1. Base64 string: `"BYk3eS9g..."`
/// 2. Baileys Buffer JSON object: `{"type": "Buffer", "data": [1, 2, 3...]}`
/// 3. Raw byte array: `[1, 2, 3...]`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BufferBytes(pub Vec<u8>);

impl BufferBytes {
    pub fn new(bytes: Vec<u8>) -> Self {
        BufferBytes(bytes)
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }

    pub fn to_base64(&self) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&self.0)
    }
}

impl Serialize for BufferBytes {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&self.0);
        serializer.serialize_str(&b64)
    }
}

impl<'de> Deserialize<'de> for BufferBytes {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Helper {
            Base64(String),
            Structured {
                #[serde(rename = "type")]
                _buf_type: Option<String>,
                data: Vec<u8>,
            },
            Raw(Vec<u8>),
        }

        let helper = Helper::deserialize(deserializer)?;
        match helper {
            Helper::Base64(s) => {
                use base64::Engine;
                let trimmed = s.trim();
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(trimmed) {
                    Ok(BufferBytes(bytes))
                } else if let Ok(bytes) = hex::decode(trimmed) {
                    Ok(BufferBytes(bytes))
                } else {
                    Ok(BufferBytes(s.into_bytes()))
                }
            }
            Helper::Structured { data, .. } => Ok(BufferBytes(data)),
            Helper::Raw(data) => Ok(BufferBytes(data)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EphemeralKeyPair {
    #[serde(rename = "pubKey")]
    pub pub_key: BufferBytes,
    #[serde(rename = "privKey")]
    pub priv_key: BufferBytes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CurrentRatchet {
    #[serde(rename = "ephemeralKeyPair")]
    pub ephemeral_key_pair: EphemeralKeyPair,
    #[serde(rename = "lastRemoteEphemeralKey")]
    pub last_remote_ephemeral_key: BufferBytes,
    #[serde(rename = "previousCounter")]
    pub previous_counter: u32,
    #[serde(rename = "rootKey")]
    pub root_key: BufferBytes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexInfo {
    #[serde(rename = "baseKey")]
    pub base_key: BufferBytes,
    #[serde(rename = "baseKeyType")]
    pub base_key_type: u32,
    #[serde(default = "default_closed")]
    pub closed: i64,
    #[serde(default)]
    pub used: u64,
    #[serde(default)]
    pub created: u64,
    #[serde(rename = "remoteIdentityKey")]
    pub remote_identity_key: BufferBytes,
}

fn default_closed() -> i64 {
    -1
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainKey {
    pub counter: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<BufferBytes>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chain {
    #[serde(rename = "chainKey")]
    pub chain_key: ChainKey,
    #[serde(rename = "chainType")]
    pub chain_type: u32, // 1 = SENDING, 2 = RECEIVING
    #[serde(rename = "messageKeys", default)]
    pub message_keys: HashMap<String, BufferBytes>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingPreKey {
    #[serde(rename = "signedKeyId", alias = "signedPreKeyId")]
    pub signed_key_id: u32,
    #[serde(rename = "baseKey")]
    pub base_key: BufferBytes,
    #[serde(rename = "preKeyId", skip_serializing_if = "Option::is_none")]
    pub pre_key_id: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionEntry {
    #[serde(rename = "registrationId")]
    pub registration_id: u32,
    #[serde(rename = "currentRatchet")]
    pub current_ratchet: CurrentRatchet,
    #[serde(rename = "indexInfo")]
    pub index_info: IndexInfo,
    #[serde(rename = "_chains", default)]
    pub chains: HashMap<String, Chain>,
    #[serde(rename = "pendingPreKey", skip_serializing_if = "Option::is_none")]
    pub pending_pre_key: Option<PendingPreKey>,
}

impl SessionEntry {
    pub fn add_chain(&mut self, key_base64: String, chain: Chain) {
        self.chains.insert(key_base64, chain);
    }

    pub fn get_chain(&self, key_base64: &str) -> Option<&Chain> {
        self.chains.get(key_base64)
    }

    pub fn get_chain_mut(&mut self, key_base64: &str) -> Option<&mut Chain> {
        self.chains.get_mut(key_base64)
    }

    pub fn delete_chain(&mut self, key_base64: &str) -> Option<Chain> {
        self.chains.remove(key_base64)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionRecord {
    #[serde(rename = "_sessions", default)]
    pub sessions: HashMap<String, SessionEntry>,
    #[serde(default = "default_version")]
    pub version: String,
}

fn default_version() -> String {
    SESSION_RECORD_VERSION.to_string()
}

impl Default for SessionRecord {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRecord {
    pub fn new() -> Self {
        SessionRecord {
            sessions: HashMap::new(),
            version: SESSION_RECORD_VERSION.to_string(),
        }
    }

    pub fn deserialize_json(json_str: &str) -> std::result::Result<Self, String> {
        let mut record: SessionRecord = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse SessionRecord JSON: {}", e))?;
        record.remove_old_sessions();
        Ok(record)
    }

    pub fn serialize_json(&self) -> std::result::Result<String, String> {
        serde_json::to_string(self).map_err(|e| format!("Failed to serialize SessionRecord to JSON: {}", e))
    }

    pub fn have_open_session(&self) -> bool {
        self.get_open_session().is_some()
    }

    pub fn get_open_session(&self) -> Option<&SessionEntry> {
        self.sessions.values().find(|s| s.index_info.closed == -1)
    }

    pub fn get_open_session_mut(&mut self) -> Option<&mut SessionEntry> {
        self.sessions.values_mut().find(|s| s.index_info.closed == -1)
    }

    pub fn get_session(&self, base_key_b64: &str) -> Option<&SessionEntry> {
        self.sessions.get(base_key_b64)
    }

    pub fn get_session_mut(&mut self, base_key_b64: &str) -> Option<&mut SessionEntry> {
        self.sessions.get_mut(base_key_b64)
    }

    pub fn set_session(&mut self, session: SessionEntry) {
        let key_b64 = session.index_info.base_key.to_base64();
        self.sessions.insert(key_b64, session);
        self.remove_old_sessions();
    }

    pub fn close_session(&mut self, base_key_b64: &str, timestamp_ms: i64) {
        if let Some(session) = self.sessions.get_mut(base_key_b64) {
            if session.index_info.closed == -1 {
                session.index_info.closed = timestamp_ms;
            }
        }
    }

    pub fn open_session(&mut self, base_key_b64: &str) {
        if let Some(session) = self.sessions.get_mut(base_key_b64) {
            session.index_info.closed = -1;
        }
    }

    pub fn is_closed(session: &SessionEntry) -> bool {
        session.index_info.closed != -1
    }

    /// Enforces `CLOSED_SESSIONS_MAX = 40` limit by removing oldest closed sessions.
    pub fn remove_old_sessions(&mut self) {
        while self.sessions.len() > CLOSED_SESSIONS_MAX {
            let mut oldest_key: Option<String> = None;
            let mut oldest_closed: Option<i64> = None;

            for (key, session) in &self.sessions {
                if session.index_info.closed != -1 {
                    match oldest_closed {
                        None => {
                            oldest_closed = Some(session.index_info.closed);
                            oldest_key = Some(key.clone());
                        }
                        Some(t) if session.index_info.closed < t => {
                            oldest_closed = Some(session.index_info.closed);
                            oldest_key = Some(key.clone());
                        }
                        _ => {}
                    }
                }
            }

            if let Some(k) = oldest_key {
                self.sessions.remove(&k);
            } else {
                break;
            }
        }
    }

    pub fn get_sessions_ordered(&self) -> Vec<&SessionEntry> {
        let mut list: Vec<&SessionEntry> = self.sessions.values().collect();
        list.sort_by(|a, b| b.index_info.used.cmp(&a.index_info.used));
        list
    }
}
