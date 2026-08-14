use serde::{Deserialize, Serialize};
use crate::proto::WebMessageInfo;
use crate::auth::AuthenticationCreds;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum BotEvent {
    ConnectionUpdate {
        status: String,
        qr: Option<String>,
        is_logged_in: bool,
    },
    CredsUpdate(AuthenticationCreds),
    MessageUpsert {
        messages: Vec<WebMessageInfo>,
        r#type: String,
    },
}
