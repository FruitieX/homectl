use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PersistenceStatus {
    Persisted,
    MemoryOnly,
    Failed,
}

/// Runtime application and durability are separate outcomes.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ConfigWriteStatus {
    pub applied: bool,
    pub persistence: PersistenceStatus,
    pub warning: Option<String>,
}
