use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::message::normalizer::MessageNormalizer;
use crate::noise::crypto::aes_gcm_decrypt;
use crate::protocol::jid::{
    are_jids_same_user, is_hosted_lid_user, is_hosted_pn_user, is_jid_broadcast,
    is_jid_status_broadcast, jid_decode, jid_encode, jid_normalized_user,
};

type HmacSha256 = Hmac<Sha256>;

pub struct MessageProcessor;

impl MessageProcessor {
    /// Normalize message key remoteJid, participant and invert reaction/poll perspectives.
    pub fn clean_message(mut message: Value, me_id: &str, me_lid: Option<&str>) -> Value {
        let from_me = message
            .get("key")
            .and_then(|k| k.get("fromMe"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Normalize remoteJid
        let remote_jid_clean = if let Some(key) = message.get("key") {
            if let Some(r_jid) = key.get("remoteJid").and_then(|v| v.as_str()) {
                if is_hosted_pn_user(r_jid) {
                    let user = jid_decode(r_jid).map(|d| d.user).unwrap_or_else(|| r_jid.to_string());
                    jid_encode(&user, "s.whatsapp.net", None, None)
                } else if is_hosted_lid_user(r_jid) {
                    let user = jid_decode(r_jid).map(|d| d.user).unwrap_or_else(|| r_jid.to_string());
                    jid_encode(&user, "lid", None, None)
                } else {
                    jid_normalized_user(r_jid)
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Normalize participant
        let participant_clean = if let Some(key) = message.get("key") {
            if let Some(p_jid) = key.get("participant").and_then(|v| v.as_str()) {
                if is_hosted_pn_user(p_jid) {
                    let user = jid_decode(p_jid).map(|d| d.user).unwrap_or_else(|| p_jid.to_string());
                    Some(jid_encode(&user, "s.whatsapp.net", None, None))
                } else if is_hosted_lid_user(p_jid) {
                    let user = jid_decode(p_jid).map(|d| d.user).unwrap_or_else(|| p_jid.to_string());
                    Some(jid_encode(&user, "lid", None, None))
                } else {
                    Some(jid_normalized_user(p_jid))
                }
            } else {
                None
            }
        } else {
            None
        };

        if let Some(key_obj) = message.get_mut("key").and_then(|k| k.as_object_mut()) {
            if !remote_jid_clean.is_empty() {
                key_obj.insert("remoteJid".to_string(), Value::String(remote_jid_clean.clone()));
            }
            if let Some(p_clean) = &participant_clean {
                key_obj.insert("participant".to_string(), Value::String(p_clean.clone()));
            }
        }

        // Perspective Inversion for reactions and polls
        let raw_msg = message.get("message").cloned();
        if let Some(msg_val) = raw_msg {
            let normalized = MessageNormalizer::normalize_message_content(msg_val);
            if let Some(mut norm_val) = normalized {
                let mut mutated = false;

                // Reaction Message normaliseKey
                if let Some(reaction) = norm_val.get_mut("reactionMessage").and_then(|r| r.as_object_mut()) {
                    if let Some(target_key) = reaction.get_mut("key").and_then(|k| k.as_object_mut()) {
                        Self::normalise_target_key(
                            target_key,
                            from_me,
                            &remote_jid_clean,
                            participant_clean.as_deref(),
                            me_id,
                            me_lid,
                        );
                        mutated = true;
                    }
                }

                // Poll Update Message normaliseKey
                if let Some(poll_update) = norm_val.get_mut("pollUpdateMessage").and_then(|p| p.as_object_mut()) {
                    if let Some(creation_key) = poll_update.get_mut("pollCreationMessageKey").and_then(|k| k.as_object_mut()) {
                        Self::normalise_target_key(
                            creation_key,
                            from_me,
                            &remote_jid_clean,
                            participant_clean.as_deref(),
                            me_id,
                            me_lid,
                        );
                        mutated = true;
                    }
                }

                if mutated {
                    if let Some(m_obj) = message.as_object_mut() {
                        m_obj.insert("message".to_string(), norm_val);
                    }
                }
            }
        }

        message
    }

    fn normalise_target_key(
        target_key: &mut serde_json::Map<String, Value>,
        message_from_me: bool,
        message_remote_jid: &str,
        message_participant: Option<&str>,
        me_id: &str,
        me_lid: Option<&str>,
    ) {
        if !message_from_me {
            let target_from_me = target_key
                .get("fromMe")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let target_author = target_key
                .get("participant")
                .or_else(|| target_key.get("remoteJid"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let new_from_me = if !target_from_me {
                are_jids_same_user(Some(target_author), Some(me_id))
                    || me_lid.map_or(false, |lid| are_jids_same_user(Some(target_author), Some(lid)))
            } else {
                false
            };

            target_key.insert("fromMe".to_string(), Value::Bool(new_from_me));
            target_key.insert("remoteJid".to_string(), Value::String(message_remote_jid.to_string()));

            if target_key.get("participant").is_none() || target_key.get("participant").and_then(|p| p.as_str()).map_or(true, |s| s.is_empty()) {
                if let Some(p) = message_participant {
                    target_key.insert("participant".to_string(), Value::String(p.to_string()));
                }
            }
        }
    }

    /// Determines if a message is a real content message.
    pub fn is_real_message(message: &Value) -> bool {
        let raw_msg = message.get("message").cloned().unwrap_or(Value::Null);
        let normalized = MessageNormalizer::normalize_message_content(raw_msg);
        let content_type = normalized.as_ref().and_then(MessageNormalizer::get_content_type);
        let has_some_content = content_type.is_some();

        let stub_type = message.get("messageStubType").and_then(|v| v.as_i64()).unwrap_or(0);
        let is_real_stub = matches!(stub_type, 9 | 10 | 11 | 12 | 27); // CALL_MISSED_* or GROUP_PARTICIPANT_ADD

        if (!normalized.is_some() && !is_real_stub) || !has_some_content {
            return false;
        }

        if let Some(norm) = &normalized {
            if norm.get("protocolMessage").is_some()
                || norm.get("reactionMessage").is_some()
                || norm.get("pollUpdateMessage").is_some()
            {
                return false;
            }
        }

        true
    }

    /// Determines if chat unread count should be incremented.
    pub fn should_increment_chat_unread(message: &Value) -> bool {
        let from_me = message
            .get("key")
            .and_then(|k| k.get("fromMe"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let has_stub = message.get("messageStubType").is_some();
        !from_me && !has_stub
    }

    /// Derive chat ID from message key.
    pub fn get_chat_id(
        remote_jid: &str,
        participant: Option<&str>,
        from_me: bool,
    ) -> Result<String, String> {
        if remote_jid.is_empty() {
            return Err("Cannot derive chat id: message key is missing remoteJid".to_string());
        }

        if is_jid_broadcast(remote_jid) && !is_jid_status_broadcast(remote_jid) && !from_me {
            match participant {
                Some(p) if !p.is_empty() => Ok(p.to_string()),
                _ => Err("Cannot derive chat id: broadcast message key is missing participant".to_string()),
            }
        } else {
            Ok(remote_jid.to_string())
        }
    }

    /// Decrypt a poll vote payload with strict HKDF + AES-GCM verification.
    pub fn decrypt_poll_vote(
        enc_payload: &[u8],
        enc_iv: &[u8],
        poll_creator_jid: &str,
        poll_msg_id: &str,
        poll_enc_key: &[u8],
        voter_jid: &str,
    ) -> Result<Vec<u8>, String> {
        if enc_iv.len() != 12 {
            return Err(format!("Invalid IV length for poll vote AES-GCM: expected 12, got {}", enc_iv.len()));
        }
        let mut iv_12 = [0u8; 12];
        iv_12.copy_from_slice(enc_iv);

        // 1. Construct sign buffer: pollMsgId + pollCreatorJid + voterJid + "Poll Vote" + [1]
        let mut sign = Vec::new();
        sign.extend_from_slice(poll_msg_id.as_bytes());
        sign.extend_from_slice(poll_creator_jid.as_bytes());
        sign.extend_from_slice(voter_jid.as_bytes());
        sign.extend_from_slice(b"Poll Vote");
        sign.push(1u8);

        // 2. key0 = HMAC-SHA256(key: zero_32B, data: pollEncKey)
        let mut mac0 = HmacSha256::new_from_slice(&[0u8; 32])
            .map_err(|e| format!("Invalid zero key: {}", e))?;
        mac0.update(poll_enc_key);
        let key0 = mac0.finalize().into_bytes();

        // 3. decKey = HMAC-SHA256(key: key0, data: sign)
        let mut mac_dec = HmacSha256::new_from_slice(&key0)
            .map_err(|e| format!("HMAC key0 error: {}", e))?;
        mac_dec.update(&sign);
        let dec_key = mac_dec.finalize().into_bytes();

        // 4. AAD = pollMsgId + "\0" + voterJid
        let mut aad = Vec::new();
        aad.extend_from_slice(poll_msg_id.as_bytes());
        aad.push(0u8);
        aad.extend_from_slice(voter_jid.as_bytes());

        // 5. AES-GCM Decrypt
        aes_gcm_decrypt(&dec_key, &iv_12, &aad, enc_payload)
            .map_err(|e| format!("Failed to decrypt poll vote: {:?}", e))
    }

    /// Decrypt an event response payload with strict HKDF + AES-GCM verification.
    pub fn decrypt_event_response(
        enc_payload: &[u8],
        enc_iv: &[u8],
        event_creator_jid: &str,
        event_msg_id: &str,
        event_enc_key: &[u8],
        responder_jid: &str,
    ) -> Result<Vec<u8>, String> {
        if enc_iv.len() != 12 {
            return Err(format!("Invalid IV length for event response AES-GCM: expected 12, got {}", enc_iv.len()));
        }
        let mut iv_12 = [0u8; 12];
        iv_12.copy_from_slice(enc_iv);

        // 1. Construct sign buffer: eventMsgId + eventCreatorJid + responderJid + "Event Response" + [1]
        let mut sign = Vec::new();
        sign.extend_from_slice(event_msg_id.as_bytes());
        sign.extend_from_slice(event_creator_jid.as_bytes());
        sign.extend_from_slice(responder_jid.as_bytes());
        sign.extend_from_slice(b"Event Response");
        sign.push(1u8);

        // 2. key0 = HMAC-SHA256(key: zero_32B, data: eventEncKey)
        let mut mac0 = HmacSha256::new_from_slice(&[0u8; 32])
            .map_err(|e| format!("Invalid zero key: {}", e))?;
        mac0.update(event_enc_key);
        let key0 = mac0.finalize().into_bytes();

        // 3. decKey = HMAC-SHA256(key: key0, data: sign)
        let mut mac_dec = HmacSha256::new_from_slice(&key0)
            .map_err(|e| format!("HMAC key0 error: {}", e))?;
        mac_dec.update(&sign);
        let dec_key = mac_dec.finalize().into_bytes();

        // 4. AAD = eventMsgId + "\0" + responderJid
        let mut aad = Vec::new();
        aad.extend_from_slice(event_msg_id.as_bytes());
        aad.push(0u8);
        aad.extend_from_slice(responder_jid.as_bytes());

        // 5. AES-GCM Decrypt
        aes_gcm_decrypt(&dec_key, &iv_12, &aad, enc_payload)
            .map_err(|e| format!("Failed to decrypt event response: {:?}", e))
    }
}
