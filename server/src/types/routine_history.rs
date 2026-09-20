use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    automation_trace::RoutineV2RuntimeStatus, device::DeviceKey,
    routine_status::RoutineRuntimeStatus, rule::RoutineId,
};

#[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RoutineHistoryTriggerKind {
    RuleMatch,
    ForceTrigger,
    V2Run,
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
    /// Evaluation and run snapshot for v2 entries: matched trigger ids, the
    /// condition trace, and the planned step dispositions. Absent for v1
    /// entries, which carry `status` instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub v2: Option<RoutineV2RuntimeStatus>,
}
