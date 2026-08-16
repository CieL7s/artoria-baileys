use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::protocol::jid::{jid_decode, jid_encode};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LidPnPair {
    pub pn: String,
    pub lid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidatedUserPair {
    pub pn_user: String,
    pub lid_user: String,
}

#[derive(Debug, Clone, Default)]
pub struct LidMappingCache {
    pn_to_lid: HashMap<String, String>,
    lid_to_pn: HashMap<String, String>,
}

impl LidMappingCache {
    pub fn new() -> Self {
        Self {
            pn_to_lid: HashMap::new(),
            lid_to_pn: HashMap::new(),
        }
    }

    pub fn insert(&mut self, pn_user: String, lid_user: String) {
        self.pn_to_lid.insert(pn_user.clone(), lid_user.clone());
        self.lid_to_pn.insert(lid_user, pn_user);
    }

    pub fn get_lid_by_pn_user(&self, pn_user: &str) -> Option<&String> {
        self.pn_to_lid.get(pn_user)
    }

    pub fn get_pn_by_lid_user(&self, lid_user: &str) -> Option<&String> {
        self.lid_to_pn.get(lid_user)
    }

    pub fn clear(&mut self) {
        self.pn_to_lid.clear();
        self.lid_to_pn.clear();
    }
}

/// Validates raw JID pairs and extracts canonical user IDs
pub fn validate_lid_pn_pairs(pairs: &[LidPnPair]) -> Vec<ValidatedUserPair> {
    let mut validated = Vec::new();
    for pair in pairs {
        let lid_decoded = jid_decode(&pair.lid);
        let pn_decoded = jid_decode(&pair.pn);

        if let (Some(lid), Some(pn)) = (lid_decoded, pn_decoded) {
            let is_lid_valid = lid.server == "lid" || lid.server == "hosted.lid";
            let is_pn_valid = pn.server == "s.whatsapp.net" || pn.server == "c.us" || pn.server == "hosted";

            if is_lid_valid && is_pn_valid && !lid.user.is_empty() && !pn.user.is_empty() {
                validated.push(ValidatedUserPair {
                    pn_user: pn.user,
                    lid_user: lid.user,
                });
            }
        }
    }
    validated
}

/// Resolves a full PN JID into a device-specific LID JID using a known LID user mapping
pub fn resolve_pn_to_lid(pn_jid: &str, lid_user: &str) -> Option<String> {
    if lid_user.is_empty() {
        return None;
    }
    let pn_decoded = jid_decode(pn_jid)?;
    let is_hosted = pn_decoded.server == "hosted";
    let target_server = if is_hosted { "hosted.lid" } else { "lid" };
    
    Some(jid_encode(
        lid_user,
        target_server,
        pn_decoded.device,
        None,
    ))
}

/// Resolves a full LID JID into a device-specific PN JID using a known PN user mapping
pub fn resolve_lid_to_pn(lid_jid: &str, pn_user: &str) -> Option<String> {
    if pn_user.is_empty() {
        return None;
    }
    let lid_decoded = jid_decode(lid_jid)?;
    let is_hosted = lid_decoded.server == "hosted.lid";
    let target_server = if is_hosted { "hosted" } else { "s.whatsapp.net" };

    Some(jid_encode(
        pn_user,
        target_server,
        lid_decoded.device,
        None,
    ))
}

/// Builds database payload batch for persistent storage
pub fn build_lid_db_batch(pairs: &[ValidatedUserPair]) -> HashMap<String, String> {
    let mut batch = HashMap::new();
    for pair in pairs {
        batch.insert(pair.pn_user.clone(), pair.lid_user.clone());
        batch.insert(format!("{}_reverse", pair.lid_user), pair.pn_user.clone());
    }
    batch
}
