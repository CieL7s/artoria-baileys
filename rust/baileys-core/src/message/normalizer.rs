use serde_json::Value;

const FUTURE_PROOF_KEYS: [&str; 9] = [
    "ephemeralMessage",
    "viewOnceMessage",
    "documentWithCaptionMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "editedMessage",
    "associatedChildMessage",
    "groupStatusMessage",
    "groupStatusMessageV2",
];

pub struct MessageNormalizer;

impl MessageNormalizer {
    /// Normalizes ephemeral, view once messages to regular message content.
    /// Iterates up to 5 times to unwrap nested wrappers.
    pub fn normalize_message_content(mut content: Value) -> Option<Value> {
        if content.is_null() {
            return None;
        }

        for _ in 0..5 {
            let mut found_inner = None;
            if let Value::Object(ref map) = content {
                for key in &FUTURE_PROOF_KEYS {
                    if let Some(wrapper) = map.get(*key) {
                        if let Some(inner_msg) = wrapper.get("message") {
                            if !inner_msg.is_null() {
                                found_inner = Some(inner_msg.clone());
                                break;
                            }
                        }
                    }
                }
            }

            match found_inner {
                Some(inner) => content = inner,
                None => break,
            }
        }

        Some(content)
    }

    /// Extracts the true message content from template / buttons wrappers.
    pub fn extract_message_content(content: Value) -> Option<Value> {
        let normalized = Self::normalize_message_content(content)?;

        if let Value::Object(ref map) = normalized {
            if let Some(btn_msg) = map.get("buttonsMessage") {
                return Some(Self::extract_from_template_message(btn_msg));
            }
            if let Some(tpl_msg) = map.get("templateMessage") {
                if let Some(h4) = tpl_msg.get("hydratedFourRowTemplate") {
                    return Some(Self::extract_from_template_message(h4));
                }
                if let Some(ht) = tpl_msg.get("hydratedTemplate") {
                    return Some(Self::extract_from_template_message(ht));
                }
                if let Some(f4) = tpl_msg.get("fourRowTemplate") {
                    return Some(Self::extract_from_template_message(f4));
                }
            }
        }

        Some(normalized)
    }

    fn extract_from_template_message(msg: &Value) -> Value {
        let mut res = serde_json::Map::new();
        if let Some(img) = msg.get("imageMessage") {
            res.insert("imageMessage".to_string(), img.clone());
        } else if let Some(doc) = msg.get("documentMessage") {
            res.insert("documentMessage".to_string(), doc.clone());
        } else if let Some(vid) = msg.get("videoMessage") {
            res.insert("videoMessage".to_string(), vid.clone());
        } else if let Some(loc) = msg.get("locationMessage") {
            res.insert("locationMessage".to_string(), loc.clone());
        } else {
            let text = msg.get("contentText")
                .or_else(|| msg.get("hydratedContentText"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            res.insert("conversation".to_string(), Value::String(text.to_string()));
        }
        Value::Object(res)
    }

    /// Gets the primary content type key of a normalized message.
    pub fn get_content_type(content: &Value) -> Option<String> {
        if let Value::Object(ref map) = content {
            for key in map.keys() {
                if (key == "conversation" || key.contains("Message")) && key != "senderKeyDistributionMessage" {
                    return Some(key.clone());
                }
            }
        }
        None
    }

    /// Returns the predicted device type from a WhatsApp message ID.
    pub fn get_device(id: &str) -> &'static str {
        if id.starts_with("3A") && id.len() == 20 {
            "ios"
        } else if id.starts_with("3E") && id.len() == 22 {
            "web"
        } else if id.len() == 21 || id.len() == 32 {
            "android"
        } else {
            "unknown"
        }
    }
}
