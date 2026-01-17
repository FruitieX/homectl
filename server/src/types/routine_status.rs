use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
}

#[derive(TS, Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[ts(export)]
pub struct RoutineStatuses(pub HashMap<RoutineId, RoutineRuntimeStatus>);
