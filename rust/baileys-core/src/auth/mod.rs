use rand::{thread_rng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("Key not found")]
    KeyNotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyPair {
    pub public: Vec<u8>,
    pub private: Vec<u8>,
}

impl KeyPair {
    pub fn generate() -> Self {
        let mut rng = thread_rng();
        let mut priv_bytes = [0u8; 32];
        rng.fill_bytes(&mut priv_bytes);
        priv_bytes[0] &= 248;
        priv_bytes[31] &= 127;
        priv_bytes[31] |= 64;

        let secret = x25519_dalek::StaticSecret::from(priv_bytes);
        let public = x25519_dalek::PublicKey::from(&secret);

        Self {
            public: public.as_bytes().to_vec(),
            private: priv_bytes.to_vec(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedKeyPair {
    pub key_pair: KeyPair,
    pub signature: Vec<u8>,
    pub key_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContactInfo {
    pub id: String,
    #[serde(default)]
    pub lid: Option<String>,
    pub name: Option<String>,
    pub notify: Option<String>,
    pub verified_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticationCreds {
    pub noise_key: KeyPair,
    pub pairing_ephemeral_key_pair: KeyPair,
    pub signed_identity_key: KeyPair,
    pub signed_pre_key: SignedKeyPair,
    pub registration_id: u32,
    pub adv_secret_key: String,
    pub me: Option<ContactInfo>,
    pub registered: bool,
    pub account_sync_counter: u32,
    pub next_pre_key_id: u32,
    pub first_unuploaded_pre_key_id: u32,
    pub pairing_code: Option<String>,
}

impl AuthenticationCreds {
    pub fn new() -> Self {
        let mut rng = thread_rng();
        let noise_key = KeyPair::generate();
        let pairing_ephemeral_key_pair = KeyPair::generate();
        let signed_identity_key = KeyPair::generate();
        let pre_key = KeyPair::generate();

        let mut ident_priv_32 = [0u8; 32];
        ident_priv_32.copy_from_slice(&signed_identity_key.private[..32]);

        // Generate signal pubKey with 0x05 prefix
        let mut pub_key_with_prefix = vec![0x05u8];
        pub_key_with_prefix.extend_from_slice(&pre_key.public);

        let sig_64 = crate::noise::crypto::curve25519_sign(&ident_priv_32, &pub_key_with_prefix);

        let signed_pre_key = SignedKeyPair {
            key_pair: pre_key,
            signature: sig_64.to_vec(),
            key_id: 1,
        };

        let registration_id = rng.gen_range(1..=16383);

        let mut adv_secret = [0u8; 32];
        rng.fill_bytes(&mut adv_secret);
        let adv_secret_key = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            adv_secret,
        );

        Self {
            noise_key,
            pairing_ephemeral_key_pair,
            signed_identity_key,
            signed_pre_key,
            registration_id,
            adv_secret_key,
            me: None,
            registered: false,
            account_sync_counter: 0,
            next_pre_key_id: 1,
            first_unuploaded_pre_key_id: 1,
            pairing_code: None,
        }
    }

    pub fn ensure_valid_signatures(&mut self) {
        if self.signed_identity_key.private.len() >= 32 && self.signed_pre_key.key_pair.public.len() >= 32 {
            let mut ident_priv = [0u8; 32];
            ident_priv.copy_from_slice(&self.signed_identity_key.private[..32]);
            ident_priv[0] &= 248;
            ident_priv[31] &= 127;
            ident_priv[31] |= 64;
            self.signed_identity_key.private = ident_priv.to_vec();

            let mut msg = vec![0x05u8];
            msg.extend_from_slice(&self.signed_pre_key.key_pair.public[..32]);

            let is_valid = if self.signed_identity_key.public.len() >= 32 && self.signed_pre_key.signature.len() == 64 {
                let mut pk = [0u8; 32];
                pk.copy_from_slice(&self.signed_identity_key.public[..32]);
                let mut sig = [0u8; 64];
                sig.copy_from_slice(&self.signed_pre_key.signature[..64]);
                crate::noise::crypto::curve25519_verify(&pk, &msg, &sig)
            } else {
                false
            };

            if !is_valid {
                let new_sig = crate::noise::crypto::curve25519_sign(&ident_priv, &msg);
                self.signed_pre_key.signature = new_sig.to_vec();
            }
        }
    }
}

impl Default for AuthenticationCreds {
    fn default() -> Self {
        Self::new()
    }
}

pub trait SignalKeyStore: Send + Sync {
    fn get_pre_key(&self, id: u32) -> Option<KeyPair>;
    fn set_pre_key(&mut self, id: u32, key: KeyPair);

    fn get_session(&self, jid: &str) -> Option<Vec<u8>>;
    fn set_session(&mut self, jid: &str, session: Vec<u8>);

    fn get_sender_key(&self, group_jid: &str) -> Option<Vec<u8>>;
    fn set_sender_key(&mut self, group_jid: &str, key: Vec<u8>);
}

#[derive(Default, Debug, Clone)]
pub struct MemorySignalStore {
    pre_keys: HashMap<u32, KeyPair>,
    sessions: HashMap<String, Vec<u8>>,
    sender_keys: HashMap<String, Vec<u8>>,
}

impl MemorySignalStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SignalKeyStore for MemorySignalStore {
    fn get_pre_key(&self, id: u32) -> Option<KeyPair> {
        self.pre_keys.get(&id).cloned()
    }

    fn set_pre_key(&mut self, id: u32, key: KeyPair) {
        self.pre_keys.insert(id, key);
    }

    fn get_session(&self, jid: &str) -> Option<Vec<u8>> {
        self.sessions.get(jid).cloned()
    }

    fn set_session(&mut self, jid: &str, session: Vec<u8>) {
        self.sessions.insert(jid.to_string(), session);
    }

    fn get_sender_key(&self, group_jid: &str) -> Option<Vec<u8>> {
        self.sender_keys.get(group_jid).cloned()
    }

    fn set_sender_key(&mut self, group_jid: &str, key: Vec<u8>) {
        self.sender_keys.insert(group_jid.to_string(), key);
    }
}

pub struct FileAuthState {
    pub folder: std::path::PathBuf,
    pub creds: AuthenticationCreds,
    pub store: MemorySignalStore,
}

impl FileAuthState {
    pub fn load_or_create(folder_path: impl AsRef<Path>) -> Result<Self, AuthError> {
        let folder = folder_path.as_ref().to_path_buf();
        if !folder.exists() {
            fs::create_dir_all(&folder)?;
        }

        let creds_path = folder.join("creds.json");
        let creds = if creds_path.exists() {
            let data = fs::read_to_string(&creds_path)?;
            match serde_json::from_str::<AuthenticationCreds>(&data) {
                Ok(mut c) => {
                    if !c.registered {
                        c.ensure_valid_signatures();
                        if let Ok(serialized) = serde_json::to_string_pretty(&c) {
                            let _ = fs::write(&creds_path, serialized);
                        }
                    }
                    c
                }
                Err(_) => {
                    let new_creds = AuthenticationCreds::new();
                    if let Ok(serialized) = serde_json::to_string_pretty(&new_creds) {
                        let _ = fs::write(&creds_path, serialized);
                    }
                    new_creds
                }
            }
        } else {
            let new_creds = AuthenticationCreds::new();
            let serialized = serde_json::to_string_pretty(&new_creds)?;
            fs::write(&creds_path, serialized)?;
            new_creds
        };

        Ok(Self {
            folder,
            creds,
            store: MemorySignalStore::new(),
        })
    }

    pub fn save_creds(&self) -> Result<(), AuthError> {
        let creds_path = self.folder.join("creds.json");
        let serialized = serde_json::to_string_pretty(&self.creds)?;
        fs::write(creds_path, serialized)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_creds_generation_and_serialization() {
        let creds = AuthenticationCreds::new();
        assert_eq!(creds.noise_key.public.len(), 32);
        assert_eq!(creds.noise_key.private.len(), 32);
        assert!(!creds.adv_secret_key.is_empty());
        assert_eq!(creds.signed_pre_key.key_id, 1);

        let json = serde_json::to_string(&creds).expect("serialize creds");
        let deserialized: AuthenticationCreds = serde_json::from_str(&json).expect("deserialize creds");

        assert_eq!(creds.registration_id, deserialized.registration_id);
        assert_eq!(creds.adv_secret_key, deserialized.adv_secret_key);
    }

    #[test]
    fn test_memory_signal_store() {
        let mut store = MemorySignalStore::new();
        let key = KeyPair::generate();
        store.set_pre_key(1, key.clone());

        let retrieved = store.get_pre_key(1).unwrap();
        assert_eq!(retrieved.public, key.public);

        store.set_session("user@s.whatsapp.net", vec![1, 2, 3, 4]);
        assert_eq!(store.get_session("user@s.whatsapp.net"), Some(vec![1, 2, 3, 4]));
    }
}
