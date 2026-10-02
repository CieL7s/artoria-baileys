use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use crate::auth::KeyPair;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreKeyRecord {
    pub key_id: u32,
    pub key_pair: KeyPair,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OperationsResult {
    pub updates: HashMap<String, serde_json::Value>,
    pub valid_deletions: Vec<String>,
    pub skipped_deletions: Vec<String>,
}

pub struct PreKeyManagerCore;

impl PreKeyManagerCore {
    pub fn generate_pre_keys(start_id: u32, count: u32) -> Result<Vec<PreKeyRecord>, &'static str> {
        if (start_id as u64) + (count as u64) > (u32::MAX as u64) + 1 {
            return Err("PreKey ID range overflow");
        }
        let mut keys = Vec::with_capacity(count as usize);
        for i in 0..count {
            let key_id = start_id + i;
            let key_pair = KeyPair::generate();
            keys.push(PreKeyRecord { key_id, key_pair });
        }
        Ok(keys)
    }

    pub fn process_operations(
        key_data: HashMap<String, serde_json::Value>,
        known_keys: &HashSet<String>,
    ) -> OperationsResult {
        let cap = key_data.len();
        let mut updates = HashMap::with_capacity(cap);
        let mut valid_deletions = Vec::with_capacity(cap);
        let mut skipped_deletions = Vec::with_capacity(cap);

        for (id, val) in key_data {
            if val.is_null() {
                if known_keys.contains(&id) {
                    valid_deletions.push(id);
                } else {
                    skipped_deletions.push(id);
                }
            } else {
                updates.insert(id, val);
            }
        }

        OperationsResult {
            updates,
            valid_deletions,
            skipped_deletions,
        }
    }

    pub fn filter_invalid_deletions(
        deletion_ids: Vec<String>,
        existing_store_keys: &HashSet<String>,
    ) -> (Vec<String>, Vec<String>) {
        deletion_ids.into_iter().partition(|id| existing_store_keys.contains(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_pre_keys_normal_and_overflow() {
        let keys = PreKeyManagerCore::generate_pre_keys(1, 10).unwrap();
        assert_eq!(keys.len(), 10);
        assert_eq!(keys[0].key_id, 1);
        assert_eq!(keys[9].key_id, 10);
        assert_eq!(keys[0].key_pair.public.len(), 32);

        let err = PreKeyManagerCore::generate_pre_keys(u32::MAX, 10);
        assert!(err.is_err());
    }

    #[test]
    fn test_process_operations_zero_copy() {
        let mut map = HashMap::new();
        map.insert("1".to_string(), serde_json::json!({"public": "key1"}));
        map.insert("2".to_string(), serde_json::Value::Null);
        map.insert("3".to_string(), serde_json::Value::Null);

        let mut known = HashSet::new();
        known.insert("2".to_string());

        let res = PreKeyManagerCore::process_operations(map, &known);
        assert_eq!(res.updates.len(), 1);
        assert!(res.updates.contains_key("1"));
        assert_eq!(res.valid_deletions, vec!["2".to_string()]);
        assert_eq!(res.skipped_deletions, vec!["3".to_string()]);
    }

    #[test]
    fn test_filter_invalid_deletions_partition() {
        let ids = vec!["10".to_string(), "20".to_string(), "30".to_string()];
        let mut existing = HashSet::new();
        existing.insert("10".to_string());
        existing.insert("30".to_string());

        let (valid, invalid) = PreKeyManagerCore::filter_invalid_deletions(ids, &existing);
        assert_eq!(valid, vec!["10".to_string(), "30".to_string()]);
        assert_eq!(invalid, vec!["20".to_string()]);
    }
}
