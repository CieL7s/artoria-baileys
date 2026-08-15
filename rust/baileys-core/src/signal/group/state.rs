use serde::{Deserialize, Serialize, Deserializer, Serializer};
use super::chain_key::{SenderChainKey, SenderMessageKey};

pub const MAX_MESSAGE_KEYS: usize = 2000;

// Helper to deserialize either raw byte array, hex/base64 string, or { type: "Buffer", data: [...] }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BufferObject {
    Structured {
        #[serde(rename = "type")]
        buf_type: String,
        data: Vec<u8>,
    },
    Raw(Vec<u8>),
}

impl BufferObject {
    pub fn into_bytes(self) -> Vec<u8> {
        match self {
            BufferObject::Structured { data, .. } => data,
            BufferObject::Raw(bytes) => bytes,
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        match self {
            BufferObject::Structured { data, .. } => data,
            BufferObject::Raw(bytes) => bytes,
        }
    }
}

pub fn serialize_buffer_json<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    use serde::ser::SerializeStruct;
    let mut state = serializer.serialize_struct("BufferJSON", 2)?;
    state.serialize_field("type", "Buffer")?;
    state.serialize_field("data", bytes)?;
    state.end()
}

pub fn deserialize_buffer_json<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
    D: Deserializer<'de>,
{
    let obj = BufferObject::deserialize(deserializer)?;
    Ok(obj.into_bytes())
}

pub fn deserialize_optional_buffer_json<'de, D>(deserializer: D) -> Result<Option<Vec<u8>>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<BufferObject>::deserialize(deserializer)?;
    Ok(opt.map(|o| o.into_bytes()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderChainKeyStructure {
    pub iteration: u32,
    #[serde(
        serialize_with = "serialize_buffer_json",
        deserialize_with = "deserialize_buffer_json"
    )]
    pub seed: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderSigningKeyStructure {
    #[serde(
        serialize_with = "serialize_buffer_json",
        deserialize_with = "deserialize_buffer_json"
    )]
    pub public: Vec<u8>,
    #[serde(
        default,
        serialize_with = "serialize_buffer_json",
        deserialize_with = "deserialize_buffer_json"
    )]
    pub private: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderMessageKeyStructure {
    pub iteration: u32,
    #[serde(
        serialize_with = "serialize_buffer_json",
        deserialize_with = "deserialize_buffer_json"
    )]
    pub seed: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderKeyStateStructure {
    #[serde(rename = "senderKeyId")]
    pub sender_key_id: u32,
    #[serde(rename = "senderChainKey")]
    pub sender_chain_key: SenderChainKeyStructure,
    #[serde(rename = "senderSigningKey")]
    pub sender_signing_key: SenderSigningKeyStructure,
    #[serde(rename = "senderMessageKeys", default)]
    pub sender_message_keys: Vec<SenderMessageKeyStructure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderKeyState {
    #[serde(flatten)]
    pub structure: SenderKeyStateStructure,
}

impl SenderKeyState {
    pub fn new(
        id: u32,
        iteration: u32,
        chain_key_seed: &[u8],
        signature_key_public: &[u8],
        signature_key_private: Option<&[u8]>,
    ) -> Self {
        let pub_buf = if signature_key_public.len() == 32 {
            let mut fixed = Vec::with_capacity(33);
            fixed.push(0x05);
            fixed.extend_from_slice(signature_key_public);
            fixed
        } else {
            signature_key_public.to_vec()
        };

        Self {
            structure: SenderKeyStateStructure {
                sender_key_id: id,
                sender_chain_key: SenderChainKeyStructure {
                    iteration,
                    seed: chain_key_seed.to_vec(),
                },
                sender_signing_key: SenderSigningKeyStructure {
                    public: pub_buf,
                    private: signature_key_private.unwrap_or(&[]).to_vec(),
                },
                sender_message_keys: Vec::new(),
            },
        }
    }

    pub fn key_id(&self) -> u32 {
        self.structure.sender_key_id
    }

    pub fn get_sender_chain_key(&self) -> SenderChainKey {
        SenderChainKey::new(
            self.structure.sender_chain_key.iteration,
            &self.structure.sender_chain_key.seed,
        )
    }

    pub fn set_sender_chain_key(&mut self, chain_key: &SenderChainKey) {
        self.structure.sender_chain_key = SenderChainKeyStructure {
            iteration: chain_key.iteration(),
            seed: chain_key.seed().to_vec(),
        };
    }

    pub fn get_signing_key_public(&self) -> Vec<u8> {
        let raw = &self.structure.sender_signing_key.public;
        if raw.len() == 32 {
            let mut fixed = Vec::with_capacity(33);
            fixed.push(0x05);
            fixed.extend_from_slice(raw);
            fixed
        } else {
            raw.clone()
        }
    }

    pub fn get_signing_key_private(&self) -> &[u8] {
        &self.structure.sender_signing_key.private
    }

    pub fn has_sender_message_key(&self, iteration: u32) -> bool {
        self.structure
            .sender_message_keys
            .iter()
            .any(|k| k.iteration == iteration)
    }

    pub fn add_sender_message_key(&mut self, message_key: &SenderMessageKey) {
        self.structure
            .sender_message_keys
            .push(SenderMessageKeyStructure {
                iteration: message_key.iteration(),
                seed: message_key.seed().to_vec(),
            });
        if self.structure.sender_message_keys.len() > MAX_MESSAGE_KEYS {
            self.structure.sender_message_keys.remove(0);
        }
    }

    pub fn remove_sender_message_key(&mut self, iteration: u32) -> Option<SenderMessageKey> {
        if let Some(pos) = self
            .structure
            .sender_message_keys
            .iter()
            .position(|k| k.iteration == iteration)
        {
            let removed = self.structure.sender_message_keys.remove(pos);
            Some(SenderMessageKey::new(removed.iteration, &removed.seed))
        } else {
            None
        }
    }
}
