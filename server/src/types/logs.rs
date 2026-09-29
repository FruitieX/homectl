use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(TS, Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[ts(export)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

#[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[ts(export)]
pub struct UiLogEntry {
    pub timestamp: String,
    pub level: LogLevel,
    pub target: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<LogEntityReference>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub details: Option<serde_json::Value>,
}

#[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[ts(export)]
pub struct LogEntityReference {
    pub entity: String,
    pub entity_id: String,
}
