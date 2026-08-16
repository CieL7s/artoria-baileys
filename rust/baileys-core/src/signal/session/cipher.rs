use std::collections::HashMap;
use prost::Message;
use sha2::{Digest, Sha256};
use hmac::{Hmac, Mac};
use crate::media::{aes_cbc_decrypt, aes_cbc_encrypt};
use crate::noise::crypto::hkdf_sha256;
use super::record::{BufferBytes, Chain, ChainKey, EphemeralKeyPair, SessionEntry, SessionRecord};

type HmacSha256 = Hmac<Sha256>;

pub const PROTOCOL_VERSION: u8 = 3;
pub const VERSION_TUPLE: u8 = (PROTOCOL_VERSION << 4) | PROTOCOL_VERSION; // 0x33 = 51
pub const MAC_LENGTH: usize = 8;
pub const MAX_FUTURE_MESSAGES: u32 = 2000;

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ProtoWhisperMessage {
    #[prost(bytes = "vec", optional, tag = "1")]
    pub ephemeral_key: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
    #[prost(uint32, optional, tag = "2")]
    pub counter: ::core::option::Option<u32>,
    #[prost(uint32, optional, tag = "3")]
    pub previous_counter: ::core::option::Option<u32>,
    #[prost(bytes = "vec", optional, tag = "4")]
    pub ciphertext: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ProtoPreKeyWhisperMessage {
    #[prost(uint32, optional, tag = "1")]
    pub pre_key_id: ::core::option::Option<u32>,
    #[prost(bytes = "vec", optional, tag = "2")]
    pub base_key: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "3")]
    pub identity_key: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
    #[prost(bytes = "vec", optional, tag = "4")]
    pub message: ::core::option::Option<::prost::alloc::vec::Vec<u8>>,
    #[prost(uint32, optional, tag = "5")]
    pub registration_id: ::core::option::Option<u32>,
    #[prost(uint32, optional, tag = "6")]
    pub signed_pre_key_id: ::core::option::Option<u32>,
}

pub struct SessionCipher;

impl SessionCipher {
    /// Encrypts plaintext using the open session in `record`.
    /// `our_identity_pub`: 33-byte public identity key of the sender.
    pub fn encrypt(
        record: &mut SessionRecord,
        our_identity_pub: &[u8],
        plaintext: &[u8],
    ) -> Result<Vec<u8>, String> {
        if !record.have_open_session() {
            return Err("No open session".to_string());
        }

        let session = record
            .get_open_session_mut()
            .ok_or_else(|| "No open session".to_string())?;

        let our_ephemeral_pub_b64 = session.current_ratchet.ephemeral_key_pair.pub_key.to_base64();
        let chain = session
            .get_chain_mut(&our_ephemeral_pub_b64)
            .ok_or_else(|| "Sending chain not found".to_string())?;

        if chain.chain_type == 2 {
            return Err("Tried to encrypt on a receiving chain".to_string());
        }

        let target_counter = chain.chain_key.counter + 1;
        Self::fill_message_keys(chain, target_counter as u32)?;

        let message_key = chain
            .message_keys
            .remove(&target_counter.to_string())
            .ok_or_else(|| "Failed to generate message key".to_string())?;

        let secrets = Self::derive_secrets(message_key.as_slice(), b"WhisperMessageKeys", 96)?;
        let cipher_key: [u8; 32] = secrets[0..32].try_into().unwrap();
        let mac_key = &secrets[32..64];
        let iv: [u8; 16] = secrets[64..80].try_into().unwrap();

        let ciphertext = aes_cbc_encrypt(&cipher_key, &iv, plaintext)
            .map_err(|e| format!("AES-CBC encrypt error: {}", e))?;

        let proto_msg = ProtoWhisperMessage {
            ephemeral_key: Some(session.current_ratchet.ephemeral_key_pair.pub_key.as_slice().to_vec()),
            counter: Some(target_counter as u32),
            previous_counter: Some(session.current_ratchet.previous_counter),
            ciphertext: Some(ciphertext),
        };

        let mut msg_buf = Vec::new();
        proto_msg.encode(&mut msg_buf).map_err(|e| e.to_string())?;

        let remote_identity = session.index_info.remote_identity_key.as_slice();

        // macInput = ourIdentityKey (33B) + remoteIdentityKey (33B) + VERSION_TUPLE (1B) + msgBuf
        let mut mac_input = Vec::with_capacity(33 + 33 + 1 + msg_buf.len());
        mac_input.extend_from_slice(our_identity_pub);
        mac_input.extend_from_slice(remote_identity);
        mac_input.push(VERSION_TUPLE);
        mac_input.extend_from_slice(&msg_buf);

        let mac = Self::calculate_mac(mac_key, &mac_input);

        let mut result = Vec::with_capacity(1 + msg_buf.len() + MAC_LENGTH);
        result.push(VERSION_TUPLE);
        result.extend_from_slice(&msg_buf);
        result.extend_from_slice(&mac[..MAC_LENGTH]);

        Ok(result)
    }

    /// Decrypts a `WhisperMessage` (`msg`) against sessions in `record`.
    /// `our_identity_pub`: 33-byte public identity key of the receiver.
    pub fn decrypt_whisper_message(
        record: &mut SessionRecord,
        our_identity_pub: &[u8],
        data: &[u8],
    ) -> Result<Vec<u8>, String> {
        if data.len() < 1 + MAC_LENGTH {
            return Err("WhisperMessage too short".to_string());
        }

        // Validate protocol version tuple
        let version_byte = data[0];
        let min_v = version_byte >> 4;
        let max_v = version_byte & 0x0F;
        if min_v > PROTOCOL_VERSION || max_v < PROTOCOL_VERSION {
            return Err("Incompatible version number on WhisperMessage".to_string());
        }

        let msg_proto_bytes = &data[1..data.len() - MAC_LENGTH];
        let received_mac = &data[data.len() - MAC_LENGTH..];

        let msg_proto = ProtoWhisperMessage::decode(msg_proto_bytes)
            .map_err(|e| format!("Failed to decode ProtoWhisperMessage: {}", e))?;

        let remote_ephemeral = msg_proto
            .ephemeral_key
            .ok_or_else(|| "Missing ephemeralKey in WhisperMessage".to_string())?;
        let counter = msg_proto
            .counter
            .ok_or_else(|| "Missing counter in WhisperMessage".to_string())?;
        let previous_counter = msg_proto.previous_counter.unwrap_or(0);
        let ciphertext = msg_proto
            .ciphertext
            .ok_or_else(|| "Missing ciphertext in WhisperMessage".to_string())?;

        // Collect matching session candidates ordered by recent use
        let mut session_keys: Vec<(String, u64)> = record
            .sessions
            .iter()
            .map(|(k, s)| (k.clone(), s.index_info.used))
            .collect::<Vec<_>>();
        session_keys.sort_by(|a, b| b.1.cmp(&a.1));

        let mut last_err = String::from("No sessions available");

for (base_key_b64, _) in session_keys {
            let mut candidate = match record.get_session(&base_key_b64).cloned() {
                Some(session) => session,
                None => continue,
            };
            match Self::do_decrypt_session(
                &mut candidate,
                our_identity_pub,
                &remote_ephemeral,
                counter,
                previous_counter,
                &ciphertext,
                msg_proto_bytes,
                received_mac,
            ) {
                Ok(plaintext) => {
                    record.sessions.insert(base_key_b64, candidate);
                    return Ok(plaintext);
                }
                Err(e) => last_err = e,
            }
        }

        Err(format!("No matching sessions found for message: {}", last_err))
    }

    fn do_decrypt_session(
        session: &mut SessionEntry,
        our_identity_pub: &[u8],
        remote_ephemeral: &[u8],
        counter: u32,
        previous_counter: u32,
        ciphertext: &[u8],
        msg_proto_bytes: &[u8],
        received_mac: &[u8],
    ) -> Result<Vec<u8>, String> {
        let remote_ephemeral_b64 = BufferBytes::new(remote_ephemeral.to_vec()).to_base64();

        // 1. Step Diffie-Hellman ratchet if remote ephemeral is new
        Self::maybe_step_ratchet(session, remote_ephemeral, previous_counter)?;

        // 2. Retrieve receiving chain
        let chain = session
            .get_chain_mut(&remote_ephemeral_b64)
            .ok_or_else(|| "Receiving chain not found for ephemeral key".to_string())?;

        if chain.chain_type == 1 {
            return Err("Tried to decrypt on a sending chain".to_string());
        }

        // 3. Fill intermediate message keys (with max 2000 future limit)
        Self::fill_message_keys(chain, counter)?;

        let message_key = chain
            .message_keys
            .remove(&counter.to_string())
            .ok_or_else(|| "Key used already or never filled".to_string())?;

        // 4. Derive keys: cipherKey, macKey, iv
        let secrets = Self::derive_secrets(message_key.as_slice(), b"WhisperMessageKeys", 96)?;
        let cipher_key: [u8; 32] = secrets[0..32].try_into().unwrap();
        let mac_key = &secrets[32..64];
        let iv: [u8; 16] = secrets[64..80].try_into().unwrap();

        // 5. Verify MAC (8-byte truncation)
        // macInput for receiver = remoteIdentityKey (33B) + ourIdentityKey (33B) + VERSION_TUPLE (1B) + msg_proto_bytes
        let remote_identity = session.index_info.remote_identity_key.as_slice();
        let mut mac_input = Vec::with_capacity(33 + 33 + 1 + msg_proto_bytes.len());
        mac_input.extend_from_slice(remote_identity);
        mac_input.extend_from_slice(our_identity_pub);
        mac_input.push(VERSION_TUPLE);
        mac_input.extend_from_slice(msg_proto_bytes);

        let computed_mac = Self::calculate_mac(mac_key, &mac_input);
        if &computed_mac[..MAC_LENGTH] != received_mac {
            return Err("Invalid MAC on message".to_string());
        }

        // 6. Decrypt ciphertext AES-CBC-256
        let plaintext = aes_cbc_decrypt(&cipher_key, &iv, ciphertext)
            .map_err(|e| format!("AES-CBC decrypt error: {}", e))?;

        session.pending_pre_key = None;
        Ok(plaintext)
    }

    /// Advances symmetric ratchet chain keys up to `counter`.
    /// Enforces `MAX_FUTURE_MESSAGES = 2000` limit.
    pub fn fill_message_keys(chain: &mut Chain, counter: u32) -> Result<(), String> {
        let current_counter = chain.chain_key.counter;
        if current_counter >= counter as i32 {
            return Ok(());
        }

        let diff = counter as i64 - current_counter as i64;
        if diff > MAX_FUTURE_MESSAGES as i64 {
            return Err("Over 2000 messages into the future!".to_string());
        }

        let mut current_key = match &chain.chain_key.key {
            Some(k) => k.as_slice().to_vec(),
            None => return Err("Chain closed".to_string()),
        };

        for i in (current_counter + 1)..=(counter as i32) {
            let msg_key = Self::hmac_sha256(&current_key, &[1]);
            let next_chain_key = Self::hmac_sha256(&current_key, &[2]);

            chain
                .message_keys
                .insert(i.to_string(), BufferBytes::new(msg_key.to_vec()));
            current_key = next_chain_key.to_vec();
        }

        chain.chain_key.key = Some(BufferBytes::new(current_key));
        chain.chain_key.counter = counter as i32;
        Ok(())
    }

    /// Steps Diffie-Hellman ratchet when a new remote ephemeral public key arrives.
    pub fn maybe_step_ratchet(
        session: &mut SessionEntry,
        remote_ephemeral: &[u8],
        previous_counter: u32,
    ) -> Result<(), String> {
        let remote_ephemeral_b64 = BufferBytes::new(remote_ephemeral.to_vec()).to_base64();
        if session.get_chain(&remote_ephemeral_b64).is_some() {
            return Ok(());
        }

        // 1. Advance and close previous receiving chain if present
        let last_remote_b64 = session.current_ratchet.last_remote_ephemeral_key.to_base64();
        if let Some(prev_chain) = session.get_chain_mut(&last_remote_b64) {
            let _ = Self::fill_message_keys(prev_chain, previous_counter);
            prev_chain.chain_key.key = None; // Close previous chain
        }

        // 2. Calculate new receiving chain from DH agreement with our current ephemeral private key
        Self::calculate_ratchet(session, remote_ephemeral, false)?;

        // 3. Swap ephemeral key pair and calculate new sending chain
        let our_current_pub_b64 = session.current_ratchet.ephemeral_key_pair.pub_key.to_base64();
        if let Some(prev_send_chain) = session.get_chain(&our_current_pub_b64) {
            session.current_ratchet.previous_counter = prev_send_chain.chain_key.counter as u32;
            session.delete_chain(&our_current_pub_b64);
        }

        let (new_pub, new_priv) = Self::generate_curve25519_keypair();
        session.current_ratchet.ephemeral_key_pair = EphemeralKeyPair {
            pub_key: BufferBytes::new(new_pub),
            priv_key: BufferBytes::new(new_priv),
        };

        Self::calculate_ratchet(session, remote_ephemeral, true)?;
        session.current_ratchet.last_remote_ephemeral_key = BufferBytes::new(remote_ephemeral.to_vec());

        Ok(())
    }

    fn calculate_ratchet(
        session: &mut SessionEntry,
        remote_ephemeral: &[u8],
        sending: bool,
    ) -> Result<(), String> {
        let priv_key = session.current_ratchet.ephemeral_key_pair.priv_key.as_slice();
        let agreement = Self::curve25519_agree(priv_key, remote_ephemeral)?;

        let master_key = hkdf_sha256(
            session.current_ratchet.root_key.as_slice(),
            &agreement,
            b"WhisperRatchet",
            64,
        ).map_err(|e| format!("HKDF WhisperRatchet error: {:?}", e))?;

        let new_root_key = BufferBytes::new(master_key[0..32].to_vec());
        let chain_key_bytes = BufferBytes::new(master_key[32..64].to_vec());

        let chain_ephemeral_b64 = if sending {
            session.current_ratchet.ephemeral_key_pair.pub_key.to_base64()
        } else {
            BufferBytes::new(remote_ephemeral.to_vec()).to_base64()
        };

        session.add_chain(
            chain_ephemeral_b64,
            Chain {
                chain_key: ChainKey {
                    counter: -1,
                    key: Some(chain_key_bytes),
                },
                chain_type: if sending { 1 } else { 2 },
                message_keys: HashMap::new(),
            },
        );

        session.current_ratchet.root_key = new_root_key;
        Ok(())
    }

    pub fn generate_curve25519_keypair() -> (Vec<u8>, Vec<u8>) {
        use rand::Rng;
        use x25519_dalek::{PublicKey, StaticSecret};

        let mut rng = rand::thread_rng();
        let mut priv_bytes = [0u8; 32];
        rng.fill(&mut priv_bytes);
        priv_bytes[0] &= 248;
        priv_bytes[31] &= 127;
        priv_bytes[31] |= 64;

        let secret = StaticSecret::from(priv_bytes);
        let public_key = PublicKey::from(&secret);

        let mut pub_bytes = Vec::with_capacity(33);
        pub_bytes.push(0x05);
        pub_bytes.extend_from_slice(public_key.as_bytes());

        (pub_bytes, priv_bytes.to_vec())
    }

    pub fn curve25519_agree(priv_key: &[u8], pub_key: &[u8]) -> Result<[u8; 32], String> {
        if priv_key.len() != 32 {
            return Err("Invalid private key length (expected 32 bytes)".to_string());
        }
        let pub_32: &[u8] = if pub_key.len() == 33 && pub_key[0] == 5 {
            &pub_key[1..33]
        } else if pub_key.len() == 32 {
            pub_key
        } else {
            return Err(format!("Invalid public key length: {}", pub_key.len()));
        };

        let priv_arr: [u8; 32] = priv_key.try_into().unwrap();
        let pub_arr: [u8; 32] = pub_32.try_into().unwrap();

        Ok(crate::noise::crypto::curve25519_shared_key(&priv_arr, &pub_arr))
    }

    pub fn derive_secrets(ikm: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, String> {
        hkdf_sha256(&[0u8; 32], ikm, info, length)
            .map_err(|e| format!("HKDF derive error: {:?}", e))
    }

    pub fn calculate_mac(key: &[u8], data: &[u8]) -> [u8; 32] {
        Self::hmac_sha256(key, data)
    }

    fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
        mac.update(data);
        let result = mac.finalize().into_bytes();
        let mut out = [0u8; 32];
        out.copy_from_slice(&result);
        out
    }
}
