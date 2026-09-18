use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::automation_trace::RoutineV2RuntimeStatus;
use super::rule::RoutineId;

#[derive(TS, Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[ts(export)]
pub struct RuleRuntimeStatus {
    pub condition_match: bool,
    pub trigger_match: bool,
    pub error: Option<String>,
    pub children: Option<Vec<RuleRuntimeStatus>>,
}

#[derive(TS, Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[ts(export)]
pub struct RoutineRuntimeStatus {
    pub all_conditions_match: bool,
    pub will_trigger: bool,
    pub rules: Vec<RuleRuntimeStatus>,
    /// P04 v2 evaluation detail. Absent for v1 rows and quarantined rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub v2: Option<RoutineV2RuntimeStatus>,
}

#[derive(TS, Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[ts(export)]
pub struct RoutineStatuses(pub HashMap<RoutineId, RoutineRuntimeStatus>);
