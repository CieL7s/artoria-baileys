use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SenderKeyName {
    pub group_id: String,
    pub sender: String,
    pub device_id: u32,
}

impl SenderKeyName {
    pub fn new(group_id: impl Into<String>, sender: impl Into<String>, device_id: u32) -> Self {
        Self {
            group_id: group_id.into(),
            sender: sender.into(),
            device_id,
        }
    }

    pub fn parse(serialized: &str) -> Option<Self> {
        let parts: Vec<&str> = serialized.split("::").collect();
        if parts.len() == 3 {
            let device_id = parts[2].parse::<u32>().unwrap_or(0);
            Some(Self {
                group_id: parts[0].to_string(),
                sender: parts[1].to_string(),
                device_id,
            })
        } else if parts.len() == 2 {
            Some(Self {
                group_id: parts[0].to_string(),
                sender: parts[1].to_string(),
                device_id: 0,
            })
        } else {
            None
        }
    }

    pub fn serialize(&self) -> String {
        format!("{}::{}::{}", self.group_id, self.sender, self.device_id)
    }

    pub fn group_id(&self) -> &str {
        &self.group_id
    }

    pub fn sender(&self) -> &str {
        &self.sender
    }

    pub fn device_id(&self) -> u32 {
        self.device_id
    }
}

impl std::fmt::Display for SenderKeyName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.serialize())
    }
}
