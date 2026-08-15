use prost::Message;
use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: u8 = 3;
pub const SIGNATURE_LENGTH: usize = 64;

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ProtoSenderKeyMessage {
    #[prost(uint32, optional, tag = "1")]
    pub id: ::core::option::Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub iteration: ::core::option::Option<u32>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub ciphertext: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ProtoSenderKeyDistributionMessage {
    #[prost(uint32, optional, tag = "1")]
    pub id: ::core::option::Option<u32>,
    #[prost(uint32, optional, tag = "2")]
    pub iteration: ::core::option::Option<u32>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub chain_key: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "4")]
    pub signing_key: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderKeyMessage {
    pub message_version: u8,
    pub key_id: u32,
    pub iteration: u32,
    pub ciphertext: Vec<u8>,
    pub signature: Vec<u8>,
    pub serialized: Vec<u8>,
}

impl SenderKeyMessage {
    pub fn new(key_id: u32, iteration: u32, ciphertext: &[u8], signature_key_private: &[u8]) -> Result<Self, String> {
        let version_byte = ((CURRENT_VERSION << 4) | CURRENT_VERSION) & 0xff;
        let proto_msg = ProtoSenderKeyMessage {
            id: Some(key_id),
            iteration: Some(iteration),
            ciphertext: Some(ciphertext.to_vec()),
        };
        let mut proto_bytes = Vec::new();
        proto_msg.encode(&mut proto_bytes).map_err(|e| e.to_string())?;

        let mut signed_payload = Vec::with_capacity(1 + proto_bytes.len());
        signed_payload.push(version_byte);
        signed_payload.extend_from_slice(&proto_bytes);

        if signature_key_private.len() != 32 {
            return Err("Invalid private key length for signing (expected 32 bytes)".to_string());
        }
        let priv_32: [u8; 32] = signature_key_private[..32].try_into().unwrap();
        let sig_bytes = crate::noise::crypto::curve25519_sign(&priv_32, &signed_payload).to_vec();

        let mut serialized = Vec::with_capacity(signed_payload.len() + SIGNATURE_LENGTH);
        serialized.extend_from_slice(&signed_payload);
        serialized.extend_from_slice(&sig_bytes);

        Ok(Self {
            message_version: CURRENT_VERSION,
            key_id,
            iteration,
            ciphertext: ciphertext.to_vec(),
            signature: sig_bytes,
            serialized,
        })
    }

    pub fn from_serialized(serialized: &[u8]) -> Result<Self, String> {
        if serialized.len() <= 1 + SIGNATURE_LENGTH {
            return Err("SenderKeyMessage serialized length too short".to_string());
        }
        let version_byte = serialized[0];
        let message_version = (version_byte & 0xff) >> 4;
        let message_bytes = &serialized[1..serialized.len() - SIGNATURE_LENGTH];
        let signature = &serialized[serialized.len() - SIGNATURE_LENGTH..];

        let proto_msg = ProtoSenderKeyMessage::decode(message_bytes)
            .map_err(|e| format!("Protobuf decode error: {}", e))?;

        let key_id = proto_msg.id.unwrap_or(0);
        let iteration = proto_msg.iteration.unwrap_or(0);
        let ciphertext = proto_msg.ciphertext.unwrap_or_default();

        Ok(Self {
            message_version,
            key_id,
            iteration,
            ciphertext,
            signature: signature.to_vec(),
            serialized: serialized.to_vec(),
        })
    }

    pub fn key_id(&self) -> u32 {
        self.key_id
    }

    pub fn iteration(&self) -> u32 {
        self.iteration
    }

    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    pub fn signature(&self) -> &[u8] {
        &self.signature
    }

    pub fn serialized(&self) -> &[u8] {
        &self.serialized
    }

    pub fn verify_signature(&self, public_key: &[u8]) -> Result<(), String> {
        let pub_bytes = if public_key.len() == 33 && public_key[0] == 0x05 {
            &public_key[1..]
        } else {
            public_key
        };

        if pub_bytes.len() != 32 {
            return Err("Invalid public key length for signature verification".to_string());
        }

        let mut pk_arr = [0u8; 32];
        pk_arr.copy_from_slice(pub_bytes);

        if self.serialized.len() <= SIGNATURE_LENGTH {
            return Err("Serialized message too short".to_string());
        }

        let signed_part = &self.serialized[..self.serialized.len() - SIGNATURE_LENGTH];
        if self.signature.len() != SIGNATURE_LENGTH {
            return Err("Invalid signature length".to_string());
        }

        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(&self.signature);

        if !crate::noise::crypto::curve25519_verify(&pk_arr, signed_part, &sig_arr) {
            return Err("Signature verification failed".to_string());
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SenderKeyDistributionMessage {
    pub id: u32,
    pub iteration: u32,
    pub chain_key: Vec<u8>,
    pub signature_key: Vec<u8>,
    pub serialized: Vec<u8>,
}

impl SenderKeyDistributionMessage {
    pub fn new(id: u32, iteration: u32, chain_key: &[u8], signature_key: &[u8]) -> Result<Self, String> {
        let version_byte = ((CURRENT_VERSION << 4) | CURRENT_VERSION) & 0xff;
        let proto_msg = ProtoSenderKeyDistributionMessage {
            id: Some(id),
            iteration: Some(iteration),
            chain_key: Some(chain_key.to_vec()),
            signing_key: Some(signature_key.to_vec()),
        };
        let mut proto_bytes = Vec::new();
        proto_msg.encode(&mut proto_bytes).map_err(|e| e.to_string())?;

        let mut serialized = Vec::with_capacity(1 + proto_bytes.len());
        serialized.push(version_byte);
        serialized.extend_from_slice(&proto_bytes);

        Ok(Self {
            id,
            iteration,
            chain_key: chain_key.to_vec(),
            signature_key: signature_key.to_vec(),
            serialized,
        })
    }

    pub fn from_serialized(serialized: &[u8]) -> Result<Self, String> {
        if serialized.is_empty() {
            return Err("SenderKeyDistributionMessage serialized is empty".to_string());
        }
        let message_bytes = &serialized[1..];
        let proto_msg = ProtoSenderKeyDistributionMessage::decode(message_bytes)
            .map_err(|e| format!("Protobuf decode error: {}", e))?;

        let id = proto_msg.id.unwrap_or(0);
        let iteration = proto_msg.iteration.unwrap_or(0);
        let chain_key = proto_msg.chain_key.unwrap_or_default();
        let signature_key = proto_msg.signing_key.unwrap_or_default();

        Ok(Self {
            id,
            iteration,
            chain_key,
            signature_key,
            serialized: serialized.to_vec(),
        })
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn iteration(&self) -> u32 {
        self.iteration
    }

    pub fn chain_key(&self) -> &[u8] {
        &self.chain_key
    }

    pub fn signature_key(&self) -> &[u8] {
        &self.signature_key
    }

    pub fn serialized(&self) -> &[u8] {
        &self.serialized
    }
}
