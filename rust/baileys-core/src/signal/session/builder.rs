use std::collections::HashMap;
use crate::noise::crypto::hkdf_sha256;
use super::cipher::{ProtoPreKeyWhisperMessage, ProtoWhisperMessage, SessionCipher, PROTOCOL_VERSION, VERSION_TUPLE};
use super::record::{
    BufferBytes, Chain, ChainKey, CurrentRatchet, EphemeralKeyPair, IndexInfo, PendingPreKey,
    SessionEntry, SessionRecord,
};

pub struct SessionBuilder;

#[derive(Debug, Clone)]
pub struct PreKeyBundle {
    pub registration_id: u32,
    pub identity_key: Vec<u8>,
    pub signed_pre_key_id: u32,
    pub signed_pre_key_public: Vec<u8>,
    pub signed_pre_key_signature: Vec<u8>,
    pub pre_key_id: Option<u32>,
    pub pre_key_public: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct DecryptedPkmsgResult {
    pub plaintext: Vec<u8>,
    pub pre_key_id: Option<u32>,
}

impl SessionBuilder {
    /// Ingests a `PreKeyWhisperMessage` (`pkmsg`) into `record`, initializes the incoming session,
    /// and decrypts the embedded `WhisperMessage`.
    pub fn process_incoming_pkmsg(
        record: &mut SessionRecord,
        our_identity_priv: &[u8],
        our_identity_pub: &[u8],
        our_signed_pre_key_priv: &[u8],
        our_signed_pre_key_pub: &[u8],
        our_pre_key_priv: Option<&[u8]>,
        pkmsg_data: &[u8],
    ) -> Result<DecryptedPkmsgResult, String> {
        if pkmsg_data.is_empty() {
            return Err("Empty PreKeyWhisperMessage".to_string());
        }

        // Validate version tuple byte
        let version_byte = pkmsg_data[0];
        let min_v = version_byte >> 4;
        let max_v = version_byte & 0x0F;
        if min_v > PROTOCOL_VERSION || max_v < PROTOCOL_VERSION {
            return Err("Incompatible version number on PreKeyWhisperMessage".to_string());
        }

        use prost::Message;
        let prekey_proto = ProtoPreKeyWhisperMessage::decode(&pkmsg_data[1..])
            .map_err(|e| format!("Failed to decode PreKeyWhisperMessage: {}", e))?;

        let their_identity = prekey_proto
            .identity_key
            .ok_or_else(|| "Missing identityKey in PreKeyWhisperMessage".to_string())?;
        let their_base_key = prekey_proto
            .base_key
            .ok_or_else(|| "Missing baseKey in PreKeyWhisperMessage".to_string())?;
        let inner_msg_bytes = prekey_proto
            .message
            .ok_or_else(|| "Missing message in PreKeyWhisperMessage".to_string())?;
        let registration_id = prekey_proto
            .registration_id
            .ok_or_else(|| "Missing registrationId in PreKeyWhisperMessage".to_string())?;
        let pre_key_id = prekey_proto.pre_key_id;

        let their_base_key_b64 = BufferBytes::new(their_base_key.clone()).to_base64();

        // If session with this baseKey already exists, decrypt using existing session
        if record.get_session(&their_base_key_b64).is_none() {
            // Check if one-time prekey is required but missing
            if pre_key_id.is_some() && our_pre_key_priv.is_none() {
                return Err("PreKey required but private key not provided".to_string());
            }

            // Close existing open session in favor of new incoming prekey bundle (TOFU archive)
            if let Some(open_session) = record.get_open_session() {
                let open_base_key_b64 = open_session.index_info.base_key.to_base64();
                record.close_session(&open_base_key_b64, chrono_now_ms());
            }

            // Initialize incoming session via X3DH
            let session = Self::init_session(
                false, // is_initiator = false (Bob / Receiver)
                our_pre_key_priv,
                our_signed_pre_key_priv,
                our_signed_pre_key_pub,
                our_identity_priv,
                &their_identity,
                &their_base_key,
                None, // their_pre_key (None for receiver)
                registration_id,
            )?;

            record.set_session(session);
        }

        // Decrypt the inner WhisperMessage
        let plaintext = SessionCipher::decrypt_whisper_message(
            record,
            our_identity_pub,
            &inner_msg_bytes,
        )?;

        Ok(DecryptedPkmsgResult {
            plaintext,
            pre_key_id,
        })
    }

    /// Initializes an outgoing session to `bundle` (Alice initiating X3DH).
    pub fn init_outgoing_session(
        record: &mut SessionRecord,
        our_identity_priv: &[u8],
        bundle: &PreKeyBundle,
    ) -> Result<Vec<u8>, String> {
        // Generate new ephemeral base keypair
        let (base_pub, base_priv) = SessionCipher::generate_curve25519_keypair();

        let session = Self::init_session(
            true, // is_initiator = true (Alice / Initiator)
            None,
            &base_priv,
            &base_pub,
            our_identity_priv,
            &bundle.identity_key,
            &bundle.signed_pre_key_public,
            bundle.pre_key_public.as_deref(),
            bundle.registration_id,
        )?;

        // Close stale open session if any (TOFU archive)
        if let Some(open_session) = record.get_open_session() {
            let open_base_key_b64 = open_session.index_info.base_key.to_base64();
            record.close_session(&open_base_key_b64, chrono_now_ms());
        }

        let mut session_entry = session;
        session_entry.pending_pre_key = Some(PendingPreKey {
            signed_key_id: bundle.signed_pre_key_id,
            base_key: BufferBytes::new(base_pub.clone()),
            pre_key_id: bundle.pre_key_id,
        });

        record.set_session(session_entry);
        Ok(base_pub)
    }

    /// Computes X3DH Shared Secret and initializes `SessionEntry`.
    ///
    /// Concatenation order:
    /// - 0..32: `0xFF` * 32
    /// - 32..64: `ECDH(Identity_A, SignedPreKey_B)`
    /// - 64..96: `ECDH(BaseKey_A, Identity_B)`
    /// - 96..128: `ECDH(BaseKey_A, SignedPreKey_B)`
    /// - 128..160 (if OTPK present): `ECDH(BaseKey_A, OneTimePreKey_B)`
    pub fn init_session(
        is_initiator: bool,
        our_pre_key_priv: Option<&[u8]>,
        our_base_or_signed_priv: &[u8],
        our_base_or_signed_pub: &[u8],
        our_identity_priv: &[u8],
        their_identity_pub: &[u8],
        their_base_or_signed_pub: &[u8],
        their_pre_key_pub: Option<&[u8]>,
        registration_id: u32,
    ) -> Result<SessionEntry, String> {
        let has_otpk = if is_initiator {
            their_pre_key_pub.is_some()
        } else {
            our_pre_key_priv.is_some()
        };

        let secret_len = if has_otpk { 32 * 5 } else { 32 * 4 };
        let mut shared_secret = vec![0xFFu8; secret_len];

        let a1 = SessionCipher::curve25519_agree(our_identity_priv, their_base_or_signed_pub)?;
        let a2 = SessionCipher::curve25519_agree(our_base_or_signed_priv, their_identity_pub)?;
        let a3 = SessionCipher::curve25519_agree(our_base_or_signed_priv, their_base_or_signed_pub)?;

        if is_initiator {
            // Alice (Initiator):
            // a1 = Identity_A x SignedPreKey_B -> offset 32
            // a2 = BaseKey_A x Identity_B -> offset 64
            shared_secret[32..64].copy_from_slice(&a1);
            shared_secret[64..96].copy_from_slice(&a2);
        } else {
            // Bob (Receiver):
            // a1 = Identity_B x BaseKey_A -> offset 64
            // a2 = SignedPreKey_B x Identity_A -> offset 32
            shared_secret[64..96].copy_from_slice(&a1);
            shared_secret[32..64].copy_from_slice(&a2);
        }
        shared_secret[96..128].copy_from_slice(&a3);

        if has_otpk {
            let a4 = if is_initiator {
                SessionCipher::curve25519_agree(our_base_or_signed_priv, their_pre_key_pub.unwrap())?
            } else {
                SessionCipher::curve25519_agree(our_pre_key_priv.unwrap(), their_base_or_signed_pub)?
            };
            shared_secret[128..160].copy_from_slice(&a4);
        }

        let master_key = hkdf_sha256(
            &[0u8; 32],
            &shared_secret,
            b"WhisperText",
            64,
        ).map_err(|e| format!("HKDF WhisperText error: {:?}", e))?;

        let root_key = master_key[0..32].to_vec();
        let (ephemeral_key_pair, last_remote_ephemeral) = if is_initiator {
            let (pub_k, priv_k) = SessionCipher::generate_curve25519_keypair();
            (
                EphemeralKeyPair {
                    pub_key: BufferBytes::new(pub_k),
                    priv_key: BufferBytes::new(priv_k),
                },
                BufferBytes::new(their_base_or_signed_pub.to_vec()),
            )
        } else {
            (
                EphemeralKeyPair {
                    pub_key: BufferBytes::new(our_base_or_signed_pub.to_vec()),
                    priv_key: BufferBytes::new(our_base_or_signed_priv.to_vec()),
                },
                BufferBytes::new(their_base_or_signed_pub.to_vec()),
            )
        };

        let now = chrono_now_ms();
        let mut session = SessionEntry {
            registration_id,
            current_ratchet: CurrentRatchet {
                ephemeral_key_pair,
                last_remote_ephemeral_key: last_remote_ephemeral,
                previous_counter: 0,
                root_key: BufferBytes::new(root_key),
            },
            index_info: IndexInfo {
                base_key: BufferBytes::new(if is_initiator { our_base_or_signed_pub.to_vec() } else { their_base_or_signed_pub.to_vec() }),
                base_key_type: if is_initiator { 1 } else { 2 },
                closed: -1,
                used: now as u64,
                created: now as u64,
                remote_identity_key: BufferBytes::new(their_identity_pub.to_vec()),
            },
            chains: HashMap::new(),
            pending_pre_key: None,
        };

        if is_initiator {
            // Alice initializes first sending ratchet chain
            let priv_k = session.current_ratchet.ephemeral_key_pair.priv_key.as_slice();
            let dh = SessionCipher::curve25519_agree(priv_k, their_base_or_signed_pub)?;
            let master2 = hkdf_sha256(
                session.current_ratchet.root_key.as_slice(),
                &dh,
                b"WhisperRatchet",
                64,
            ).map_err(|e| format!("HKDF WhisperRatchet error: {:?}", e))?;

            let sending_ephemeral_b64 = session.current_ratchet.ephemeral_key_pair.pub_key.to_base64();
            session.add_chain(
                sending_ephemeral_b64,
                Chain {
                    chain_key: ChainKey {
                        counter: -1,
                        key: Some(BufferBytes::new(master2[32..64].to_vec())),
                    },
                    chain_type: 1, // SENDING
                    message_keys: HashMap::new(),
                },
            );
            session.current_ratchet.root_key = BufferBytes::new(master2[0..32].to_vec());
        }

        Ok(session)
    }

    /// Encapsulates an encrypted WhisperMessage into a `PreKeyWhisperMessage` (`pkmsg`) envelope.
    pub fn build_pkmsg_envelope(
        our_identity_pub: &[u8],
        our_registration_id: u32,
        base_key: &[u8],
        signed_pre_key_id: u32,
        pre_key_id: Option<u32>,
        inner_whisper_message: &[u8],
    ) -> Result<Vec<u8>, String> {
        use prost::Message;

        let proto = ProtoPreKeyWhisperMessage {
            pre_key_id,
            base_key: Some(base_key.to_vec()),
            identity_key: Some(our_identity_pub.to_vec()),
            message: Some(inner_whisper_message.to_vec()),
            registration_id: Some(our_registration_id),
            signed_pre_key_id: Some(signed_pre_key_id),
        };

        let mut buf = Vec::new();
        proto.encode(&mut buf).map_err(|e| e.to_string())?;

        let mut result = Vec::with_capacity(1 + buf.len());
        result.push(VERSION_TUPLE);
        result.extend_from_slice(&buf);
        Ok(result)
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
