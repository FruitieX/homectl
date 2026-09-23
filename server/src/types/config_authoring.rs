//! Read-only data for guided configuration forms and routine previews.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::automation_definition::NodeId;
use super::automation_trace::{ConditionEvaluation, PlannedStepStatus, UnknownReason};

#[derive(TS, Clone, Debug, Serialize, Deserialize)]
#[ts(export)]
pub struct ValueHistoryEntry {
    pub changed_at_ms: i64,
    pub value: Value,
}

#[derive(TS, Clone, Debug, Serialize, Deserialize)]
#[ts(export)]
pub struct ValueFieldInfo {
    pub path: String,
    #[serde(rename = "type")]
    pub value_type: String,
    pub value: Option<Value>,
    pub available: bool,
    pub reason: Option<UnknownReason>,
    pub error: Option<String>,
}

#[derive(TS, Clone, Debug, Serialize, Deserialize)]
#[ts(export)]
pub struct RoutinePreviewOverride {
    pub device_key: String,
    pub path: String,
    pub value: Value,
}

#[derive(TS, Clone, Debug, Serialize, Deserialize)]
#[ts(export)]
pub struct RoutinePreviewRequest {
    pub definition: Value,
    pub trigger_id: String,
    #[serde(default)]
    pub overrides: Vec<RoutinePreviewOverride>,
}

#[derive(TS, Clone, Debug, Serialize, Deserialize)]
#[ts(export)]
pub struct PreviewValidationError {
    pub path: String,
    pub message: String,
}

#[derive(TS, Clone, Debug, Serialize, Deserialize)]
#[ts(export)]
pub struct PreviewStep {
    pub id: NodeId,
    pub kind: String,
    pub targets: Vec<String>,
}

#[derive(TS, Clone, Debug, Default, Serialize, Deserialize)]
#[ts(export)]
pub struct RoutinePreviewResponse {
    pub error: Option<String>,
    pub validation_errors: Vec<PreviewValidationError>,
    pub condition: Option<ConditionEvaluation>,
    pub would_run: bool,
    pub steps: Vec<PreviewStep>,
    pub suppressions: Vec<PlannedStepStatus>,
    pub script_unsupported: bool,
}
