use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{device::DeviceKey, routine_status::RoutineRuntimeStatus, rule::RoutineId};

#[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RoutineHistoryTriggerKind {
    RuleMatch,
    ForceTrigger,
}

#[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[ts(export)]
pub struct RoutineHistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub routine_id: RoutineId,
    pub routine_name: String,
    pub trigger_kind: RoutineHistoryTriggerKind,
    pub event_source_device_key: Option<DeviceKey>,
    pub action_count: usize,
    pub status: Option<RoutineRuntimeStatus>,
}
