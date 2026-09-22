//! Types for the configuration assistant plan flow (AI config assistant P1).
//!
//! The assistant turns a prompt into a reviewed plan of configuration
//! operations. Nothing here is persisted by the server: a plan lives in the
//! in-memory plan store until it expires or is applied.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// Entity kinds the assistant can plan operations for.
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AssistantEntityKind {
    Routine,
    Scene,
    Group,
    Device,
    Floorplan,
    Integration,
    Helper,
    ComputedSource,
}

impl AssistantEntityKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::Routine => "routine",
            Self::Scene => "scene",
            Self::Group => "group",
            Self::Device => "device",
            Self::Floorplan => "floorplan",
            Self::Integration => "integration",
            Self::Helper => "helper",
            Self::ComputedSource => "computed_source",
        }
    }

    /// Kinds the deterministic search endpoint can query.
    pub fn searchable() -> [Self; 8] {
        [
            Self::Routine,
            Self::Scene,
            Self::Group,
            Self::Device,
            Self::Floorplan,
            Self::Integration,
            Self::Helper,
            Self::ComputedSource,
        ]
    }
}

/// A context entity the user attached to the assistant prompt.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantAttachment {
    pub kind: AssistantEntityKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantPlanRequest {
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<AssistantAttachment>,
}

#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AssistantOpKind {
    Create,
    Update,
    Delete,
}

/// One proposed configuration operation inside a plan.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantOperation {
    /// Stable per-plan id (`op-1`, `op-2`, ...) used for accept/apply.
    pub op_id: String,
    pub op: AssistantOpKind,
    pub kind: AssistantEntityKind,
    /// Existing entity id for update/delete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_id: Option<String>,
    /// Human label shown in the review list.
    pub label: String,
    /// Masked snapshot before the operation (update/delete).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub before: Option<Value>,
    /// Proposed final state (create/update).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub after: Option<Value>,
    /// Destructive or in-use warnings surfaced during review.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantPlan {
    pub plan_id: String,
    pub summary: String,
    pub operations: Vec<AssistantOperation>,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApplyAssistantPlanRequest {
    #[serde(default)]
    pub accepted_operation_ids: Vec<String>,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApplyAssistantPlanResponse {
    pub results: Vec<AssistantOperationResult>,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantOperationResult {
    pub op_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

/// One deterministic search hit for the assistant context builder / UI.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantSearchResult {
    pub kind: AssistantEntityKind,
    pub id: String,
    pub label: String,
    pub summary: String,
}
