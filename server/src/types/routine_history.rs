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
    /// A configured trigger matched but the condition blocked the run: false,
    /// unknown, or errored. Recorded at the decision point, never inferred
    /// later from live status.
    V2Blocked,
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
    /// How many identical blocked attempts this entry stands for. Absent on
    /// older entries and on runs; read it as one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub occurrence_count: Option<u32>,
    /// When the first of the coalesced attempts happened. Only set once an
    /// entry stands for more than one attempt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub first_timestamp: Option<String>,
    /// Short reason a matched trigger produced no run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub blocked_reason: Option<String>,
}
