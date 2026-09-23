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

/// One persisted assistant conversation as listed in the panel. Message
/// contents are only included when a single thread is fetched.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantThreadSummary {
    pub id: String,
    pub name: String,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
    pub message_count: usize,
}

/// A persisted assistant conversation thread.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantThread {
    pub id: String,
    pub name: String,
    #[ts(type = "number")]
    pub created_at_ms: i64,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
    pub messages: Vec<AssistantHistoryMessage>,
}

/// Who authored one turn of the conversation history.
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AssistantMessageRole {
    User,
    Assistant,
}

impl AssistantMessageRole {
    pub fn code(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

/// One earlier conversation turn sent back with a new request. History is
/// client-held and session-only; the server caps and truncates it.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantHistoryMessage {
    pub role: AssistantMessageRole,
    pub content: String,
    /// The plan or action this turn proposed, stored so a reopened thread can
    /// show what the assistant suggested. The proposal itself has expired by
    /// then and is only a record — it cannot be applied from history.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub proposal: Option<AssistantThreadProposal>,
    /// Result of applying that proposal, when the user applied it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub outcome: Option<AssistantThreadOutcome>,
}

/// A proposed plan or light-state action stored alongside the thread turn that
/// produced it.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AssistantThreadProposal {
    Plan { plan: AssistantPlan },
    Action { action: AssistantAction },
}

/// What became of a stored proposal: the result of applying it, recorded so a
/// reopened conversation shows the same applied state the user last saw.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AssistantThreadOutcome {
    Plan {
        results: Vec<AssistantOperationResult>,
        #[serde(rename = "acceptedOperationIds")]
        #[ts(rename = "acceptedOperationIds")]
        accepted_operation_ids: Vec<String>,
    },
    Action {
        results: Vec<AssistantActionChangeResult>,
    },
}

/// Request body for recording the outcome of applying a stored proposal.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantThreadOutcomeRequest {
    /// `planId` or `actionId` of the proposal inside the stored thread.
    pub proposal_id: String,
    pub outcome: AssistantThreadOutcome,
}

/// Stable id of a stored proposal, used to attach an outcome to its turn.
pub fn assistant_proposal_id(proposal: &AssistantThreadProposal) -> &str {
    match proposal {
        AssistantThreadProposal::Plan { plan } => &plan.plan_id,
        AssistantThreadProposal::Action { action } => &action.action_id,
    }
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantPlanRequest {
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<AssistantAttachment>,
    /// Prior plan turns, oldest first. Capped and truncated server-side.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub history: Option<Vec<AssistantHistoryMessage>>,
}

/// Unified assistant request: one prompt that the server routes to either a
/// reviewed configuration plan or a proposed light-state action.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantChatRequest {
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<AssistantAttachment>,
    /// Optional device scope for light-state actions (for example the current
    /// floorplan selection). Empty means every controllable device.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub device_keys: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub history: Option<Vec<AssistantHistoryMessage>>,
    /// Persisted thread to continue. When set, the stored messages are used as
    /// history and the new turn is appended to the thread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub thread_id: Option<String>,
}

/// Color component of a proposed light-state change.
#[derive(TS, Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantActionColor {
    pub h: f64,
    pub s: f64,
}

/// One proposed light-state change. Values are clamped during validation and
/// applied through the normal device command path only when the user applies.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantActionChange {
    pub device_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub power: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub brightness: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<AssistantActionColor>,
}

/// A stored, reviewable light-state action produced by the unified assistant.
/// Like plans, actions are in-memory only, single-use, and expire.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantAction {
    pub action_id: String,
    pub summary: String,
    pub changes: Vec<AssistantActionChange>,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub model: String,
}

/// Result of one applied (or rejected) action change.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantActionChangeResult {
    pub device_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApplyAssistantActionResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    pub results: Vec<AssistantActionChangeResult>,
    pub applied_count: u32,
}

/// Approximate context usage for the current thread. Token counts come from
/// the provider when it reports them and are estimated from character counts
/// otherwise (`approximate` is true in that case).
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub context_window: u64,
    pub approximate: bool,
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
