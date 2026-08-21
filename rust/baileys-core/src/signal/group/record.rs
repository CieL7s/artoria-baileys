use serde::{Deserialize, Serialize};
use super::state::{SenderKeyState, SenderKeyStateStructure, BufferObject};

pub const MAX_STATES: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SenderKeyRecord {
    pub sender_key_states: Vec<SenderKeyState>,
}

impl Default for SenderKeyRecord {
    fn default() -> Self {
        Self::new()
    }
}

impl SenderKeyRecord {
    pub fn new() -> Self {
        Self {
            sender_key_states: Vec::new(),
        }
    }

    pub fn from_states(states: Vec<SenderKeyState>) -> Self {
        let mut record = Self {
            sender_key_states: states,
        };
        while record.sender_key_states.len() > MAX_STATES {
            record.sender_key_states.remove(0);
        }
        record
    }

    pub fn is_empty(&self) -> bool {
        self.sender_key_states.is_empty()
    }

    pub fn get_sender_key_state(&self, key_id: Option<u32>) -> Option<&SenderKeyState> {
        match key_id {
            Some(id) => self.sender_key_states.iter().find(|s| s.key_id() == id),
            None => self.sender_key_states.last(),
        }
    }

    pub fn get_sender_key_state_mut(&mut self, key_id: Option<u32>) -> Option<&mut SenderKeyState> {
        match key_id {
            Some(id) => self.sender_key_states.iter_mut().find(|s| s.key_id() == id),
            None => self.sender_key_states.last_mut(),
        }
    }

    pub fn add_sender_key_state(
        &mut self,
        id: u32,
        iteration: u32,
        chain_key_seed: &[u8],
        signature_key_public: &[u8],
    ) {
        let new_state = SenderKeyState::new(
            id,
            iteration,
            chain_key_seed,
            signature_key_public,
            None,
        );
        self.sender_key_states.push(new_state);
        if self.sender_key_states.len() > MAX_STATES {
            self.sender_key_states.remove(0);
        }
    }

    pub fn set_sender_key_state(
        &mut self,
        id: u32,
        iteration: u32,
        chain_key_seed: &[u8],
        signature_key_public: &[u8],
        signature_key_private: Option<&[u8]>,
    ) {
        self.sender_key_states.clear();
        let new_state = SenderKeyState::new(
            id,
            iteration,
            chain_key_seed,
            signature_key_public,
            signature_key_private,
        );
        self.sender_key_states.push(new_state);
    }

    pub fn serialize(&self) -> Vec<SenderKeyStateStructure> {
        self.sender_key_states
            .iter()
            .map(|s| s.structure.clone())
            .collect()
    }

    pub fn deserialize_from_json(json_str: &str) -> Result<Self, String> {
        // Try parsing directly as array of states
        if let Ok(states) = serde_json::from_str::<Vec<SenderKeyState>>(json_str) {
            return Ok(Self::from_states(states));
        }

        // Try parsing as BufferObject { type: "Buffer", data: ... }
        if let Ok(buf_obj) = serde_json::from_str::<BufferObject>(json_str) {
            let bytes = buf_obj.into_bytes();
            // Could be utf-8 JSON string inside data
            if let Ok(inner_str) = std::str::from_utf8(&bytes) {
                if let Ok(states) = serde_json::from_str::<Vec<SenderKeyState>>(inner_str) {
                    return Ok(Self::from_states(states));
                }
            }
            // Or base64 encoded string
            if let Ok(base64_str) = std::str::from_utf8(&bytes) {
                use base64::Engine;
                if let Ok(decoded_bytes) = base64::engine::general_purpose::STANDARD.decode(base64_str) {
                    if let Ok(inner_str) = std::str::from_utf8(&decoded_bytes) {
                        if let Ok(states) = serde_json::from_str::<Vec<SenderKeyState>>(inner_str) {
                            return Ok(Self::from_states(states));
                        }
                    }
                }
            }
        }

        // Try parsing as base64 string directly
        use base64::Engine;
        if let Ok(decoded_bytes) = base64::engine::general_purpose::STANDARD.decode(json_str.trim().trim_matches('"')) {
            if let Ok(inner_str) = std::str::from_utf8(&decoded_bytes) {
                if let Ok(states) = serde_json::from_str::<Vec<SenderKeyState>>(inner_str) {
                    return Ok(Self::from_states(states));
                }
            }
        }

        Err("Failed to deserialize SenderKeyRecord from json".to_string())
    }

    pub fn serialize_to_msgpack(&self) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        let mut ser = rmp_serde::Serializer::new(&mut buf).with_struct_map();
        self.serialize().serialize(&mut ser).map_err(|e| e.to_string())?;
        Ok(buf)
    }

    pub fn deserialize_from_msgpack(bytes: &[u8]) -> Result<Self, String> {
        let mut de = rmp_serde::Deserializer::new(bytes);
        let states: Vec<SenderKeyState> = serde::Deserialize::deserialize(&mut de).map_err(|e| e.to_string())?;
        Ok(Self::from_states(states))
    }
}
