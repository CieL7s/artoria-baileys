use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::protocol::jid::{is_hosted_lid_user, is_hosted_pn_user, is_lid_user, is_pn_user};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContactUpsertData {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lid: Option<String>,
    #[serde(rename = "phoneNumber", skip_serializing_if = "Option::is_none")]
    pub phone_number: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LidPnPair {
    pub lid: String,
    pub pn: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum SyncActionResult {
    #[serde(rename = "contacts.upsert")]
    ContactsUpsert(Vec<ContactUpsertData>),
    #[serde(rename = "lid-mapping.update")]
    LidMappingUpdate(LidPnPair),
}

pub struct SyncActionProcessor;

impl SyncActionProcessor {
    /// Process contactAction and return events to emit.
    pub fn process_contact_action(action: &Value, id: Option<&str>) -> Vec<SyncActionResult> {
        let mut results = Vec::new();
        let id_str = match id {
            Some(s) if !s.is_empty() => s,
            _ => return results,
        };

        let lid_jid = action.get("lidJid").and_then(|v| v.as_str());
        let pn_jid = action.get("pnJid").and_then(|v| v.as_str());
        let id_is_pn = is_pn_user(id_str);

        let phone_number = if id_is_pn {
            Some(id_str.to_string())
        } else {
            pn_jid.map(str::to_string)
        };

        let name = action.get("fullName")
            .or_else(|| action.get("firstName"))
            .or_else(|| action.get("username"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let username = action.get("username").and_then(|v| v.as_str()).map(str::to_string);

        results.push(SyncActionResult::ContactsUpsert(vec![ContactUpsertData {
            id: id_str.to_string(),
            name,
            username,
            lid: lid_jid.map(str::to_string),
            phone_number,
        }]));

        if let Some(lid) = lid_jid {
            if is_lid_user(lid) && id_is_pn {
                results.push(SyncActionResult::LidMappingUpdate(LidPnPair {
                    lid: lid.to_string(),
                    pn: id_str.to_string(),
                }));
            }
        }

        results
    }
}
