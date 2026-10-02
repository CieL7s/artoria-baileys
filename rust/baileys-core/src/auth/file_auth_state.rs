use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde_json::Value;

pub struct FileAuthStateCore;

impl FileAuthStateCore {
    pub fn fix_file_name(file: &str) -> String {
        file.replace(['/', '\\'], "__").replace(':', "-")
    }

    pub fn read_file_content(folder: &Path, file_name: &str) -> Option<String> {
        let fixed = Self::fix_file_name(file_name);
        let path = folder.join(fixed);
        fs::read_to_string(path).ok()
    }

    pub fn write_file_direct(folder: &Path, file_name: &str, content: &str) -> Result<(), std::io::Error> {
        let fixed = Self::fix_file_name(file_name);
        let path = folder.join(fixed);
        fs::write(path, content)
    }

    pub fn write_file_content(folder: &Path, file_name: &str, content: &str) -> Result<(), std::io::Error> {
        if !folder.exists() {
            fs::create_dir_all(folder)?;
        }
        Self::write_file_direct(folder, file_name, content)
    }

    pub fn remove_file(folder: &Path, file_name: &str) -> Result<(), std::io::Error> {
        let fixed = Self::fix_file_name(file_name);
        let path = folder.join(fixed);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub fn read_keys_batch(folder: &Path, key_type: &str, ids: &[String]) -> HashMap<String, Option<String>> {
        let mut result = HashMap::with_capacity(ids.len());
        for id in ids {
            let file_name = format!("{}-{}.json", key_type, id);
            let content = Self::read_file_content(folder, &file_name);
            result.insert(id.clone(), content);
        }
        result
    }

    pub fn write_keys_batch(
        folder: &Path,
        operations: &HashMap<String, HashMap<String, Option<String>>>,
    ) -> Result<(), std::io::Error> {
        if !folder.exists() {
            fs::create_dir_all(folder)?;
        }

        for (category, keys) in operations {
            for (id, val) in keys {
                let file_name = format!("{}-{}.json", category, id);
                match val {
                    Some(content) => {
                        Self::write_file_direct(folder, &file_name, content)?;
                    }
                    None => {
                        Self::remove_file(folder, &file_name)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn normalize_creds_json(creds_json: &str) -> Result<String, serde_json::Error> {
        let mut v: Value = serde_json::from_str(creds_json)?;
        if let Value::Object(ref mut map) = v {
            if !map.contains_key("noiseKey") && map.contains_key("noise_key") {
                if let Some(val) = map.remove("noise_key") {
                    map.insert("noiseKey".to_string(), val);
                }
            }
            if !map.contains_key("pairingEphemeralKeyPair") && map.contains_key("pairing_ephemeral_key_pair") {
                if let Some(val) = map.remove("pairing_ephemeral_key_pair") {
                    map.insert("pairingEphemeralKeyPair".to_string(), val);
                }
            }
            if !map.contains_key("signedIdentityKey") && map.contains_key("signed_identity_key") {
                if let Some(val) = map.remove("signed_identity_key") {
                    map.insert("signedIdentityKey".to_string(), val);
                }
            }

            let pre_key_val = if map.contains_key("signedPreKey") {
                map.remove("signedPreKey")
            } else if map.contains_key("signed_pre_key") {
                map.remove("signed_pre_key")
            } else {
                None
            };

            if let Some(mut spk) = pre_key_val {
                if let Value::Object(ref mut spk_map) = spk {
                    if !spk_map.contains_key("keyPair") && spk_map.contains_key("key_pair") {
                        if let Some(val) = spk_map.remove("key_pair") {
                            spk_map.insert("keyPair".to_string(), val);
                        }
                    }
                    if !spk_map.contains_key("keyId") && spk_map.contains_key("key_id") {
                        if let Some(val) = spk_map.remove("key_id") {
                            spk_map.insert("keyId".to_string(), val);
                        }
                    }
                }
                map.insert("signedPreKey".to_string(), spk);
            }

            if !map.contains_key("registrationId") && map.contains_key("registration_id") {
                if let Some(val) = map.remove("registration_id") {
                    map.insert("registrationId".to_string(), val);
                }
            }
            if !map.contains_key("advSecretKey") && map.contains_key("adv_secret_key") {
                if let Some(val) = map.remove("adv_secret_key") {
                    map.insert("advSecretKey".to_string(), val);
                }
            }
            if !map.contains_key("nextPreKeyId") && map.contains_key("next_pre_key_id") {
                if let Some(val) = map.remove("next_pre_key_id") {
                    map.insert("nextPreKeyId".to_string(), val);
                }
            }
            if !map.contains_key("firstUnuploadedPreKeyId") && map.contains_key("first_unuploaded_pre_key_id") {
                if let Some(val) = map.remove("first_unuploaded_pre_key_id") {
                    map.insert("firstUnuploadedPreKeyId".to_string(), val);
                }
            }
            if !map.contains_key("accountSyncCounter") && map.contains_key("account_sync_counter") {
                if let Some(val) = map.remove("account_sync_counter") {
                    map.insert("accountSyncCounter".to_string(), val);
                }
            }
            if !map.contains_key("pairingCode") && map.contains_key("pairing_code") {
                if let Some(val) = map.remove("pairing_code") {
                    map.insert("pairingCode".to_string(), val);
                }
            }
        }
        serde_json::to_string(&v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fix_file_name() {
        assert_eq!(FileAuthStateCore::fix_file_name("app/state:1.json"), "app__state-1.json");
        assert_eq!(FileAuthStateCore::fix_file_name("app\\state:1.json"), "app__state-1.json");
        assert_eq!(FileAuthStateCore::fix_file_name("session:user@s.whatsapp.net.json"), "session-user@s.whatsapp.net.json");
    }

    #[test]
    fn test_normalize_creds_nested() {
        let raw = r#"{"signed_pre_key":{"key_pair":{"public":"pk1","private":"sk1"},"signature":"sig1","key_id":42},"registration_id":999}"#;
        let normalized = FileAuthStateCore::normalize_creds_json(raw).unwrap();
        let val: Value = serde_json::from_str(&normalized).unwrap();
        assert!(val.get("signedPreKey").is_some());
        let spk = &val["signedPreKey"];
        assert!(spk.get("keyPair").is_some());
        assert_eq!(spk["keyPair"]["public"], "pk1");
        assert_eq!(spk["keyId"], 42);
        assert_eq!(val["registrationId"], 999);
    }

    #[test]
    fn test_atomic_remove_not_found() {
        let dir = std::env::temp_dir().join("test_baileys_atomic_rem");
        let _ = fs::create_dir_all(&dir);
        let res = FileAuthStateCore::remove_file(&dir, "non_existent_file.json");
        assert!(res.is_ok());
        let _ = fs::remove_dir_all(&dir);
    }
}
