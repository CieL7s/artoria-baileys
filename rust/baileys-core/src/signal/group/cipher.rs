use super::chain_key::SenderMessageKey;
use super::message::SenderKeyMessage;
use super::record::SenderKeyRecord;
use super::state::SenderKeyState;
use crate::media::{aes_cbc_decrypt, aes_cbc_encrypt};

pub struct GroupCipher;

impl GroupCipher {
    /// Encrypts plaintext using SenderKeyRecord and advances the sender chain key.
    /// Returns the serialized SenderKeyMessage bytes.
    pub fn encrypt(
        record: &mut SenderKeyRecord,
        padded_plaintext: &[u8],
    ) -> Result<Vec<u8>, String> {
        let sender_key_state = record
            .get_sender_key_state_mut(None)
            .ok_or_else(|| "No session to encrypt message".to_string())?;

        let current_iteration = sender_key_state.get_sender_chain_key().iteration();
        let target_iteration = if current_iteration == 0 { 0 } else { current_iteration + 1 };

        let sender_key = Self::get_sender_key(sender_key_state, target_iteration)?;

        let mut key_arr = [0u8; 32];
        key_arr.copy_from_slice(sender_key.cipher_key());
        let mut iv_arr = [0u8; 16];
        iv_arr.copy_from_slice(sender_key.iv());

        let ciphertext = aes_cbc_encrypt(&key_arr, &iv_arr, padded_plaintext)
            .map_err(|e| format!("Encryption error: {}", e))?;

        let signing_key_private = sender_key_state.get_signing_key_private();
        if signing_key_private.is_empty() {
            return Err("No signing key private found in state".to_string());
        }

        let msg = SenderKeyMessage::new(
            sender_key_state.key_id(),
            sender_key.iteration(),
            &ciphertext,
            signing_key_private,
        )?;

        Ok(msg.serialized().to_vec())
    }

    /// Decrypts serialized SenderKeyMessage bytes and updates SenderKeyRecord.
    /// Returns the decrypted plaintext bytes.
    pub fn decrypt(
        record: &mut SenderKeyRecord,
        sender_key_message_bytes: &[u8],
    ) -> Result<Vec<u8>, String> {
        let sender_key_message = SenderKeyMessage::from_serialized(sender_key_message_bytes)?;
        let key_id = sender_key_message.key_id();

        let sender_key_state = record
            .get_sender_key_state_mut(Some(key_id))
            .ok_or_else(|| format!("No session found to decrypt message with key ID {}", key_id))?;

        let pub_key = sender_key_state.get_signing_key_public();
        sender_key_message.verify_signature(&pub_key)?;

        let sender_key = Self::get_sender_key(sender_key_state, sender_key_message.iteration())?;

        let mut key_arr = [0u8; 32];
        key_arr.copy_from_slice(sender_key.cipher_key());
        let mut iv_arr = [0u8; 16];
        iv_arr.copy_from_slice(sender_key.iv());

        let plaintext = aes_cbc_decrypt(&key_arr, &iv_arr, sender_key_message.ciphertext())
            .map_err(|_| "InvalidMessageException".to_string())?;

        Ok(plaintext)
    }

    /// Steps chain key to target iteration, saving intermediate skipped message keys in sender_key_state
    pub fn get_sender_key(
        sender_key_state: &mut SenderKeyState,
        iteration: u32,
    ) -> Result<SenderMessageKey, String> {
        let mut current_chain = sender_key_state.get_sender_chain_key();
        if current_chain.iteration() > iteration {
            if let Some(msg_key) = sender_key_state.remove_sender_message_key(iteration) {
                return Ok(msg_key);
            }
            return Err(format!(
                "Received message with old counter: {}, {}",
                current_chain.iteration(), iteration
            ));
        }

        if iteration.saturating_sub(current_chain.iteration()) > 2000 {
            return Err("Over 2000 messages into the future!".to_string());
        }

        while current_chain.iteration() < iteration {
            let mk = current_chain.get_sender_message_key();
            sender_key_state.add_sender_message_key(&mk);
            current_chain = current_chain.get_next();
        }

        let next_chain = current_chain.get_next();
        let target_msg_key = current_chain.get_sender_message_key();
        sender_key_state.set_sender_chain_key(&next_chain);

        Ok(target_msg_key)
    }
}
