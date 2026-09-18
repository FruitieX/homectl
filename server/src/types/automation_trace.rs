//! Evaluation results, group summaries, and decision traces (P04).
//!
//! These types are the observable contract of the native v2 evaluator. The
//! evaluator is three-valued: a condition is `true`, `false`, or `unknown`,
//! and evaluation failures are kept separate from unknown values. An error
//! never authorizes execution, even under `not`/`all`/`any` (C04). Unknown
//! values carry a structured [`UnknownReason`] instead of being folded into
//! `false` (C06).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    automation_definition::{NodeId, Quantifier},
    device::DeviceKey,
    group::GroupId,
    scene::SceneId,
};

/// Strong three-valued logic result. Errors are represented separately on the
/// enclosing evaluation, never as a truth value.
#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TruthValue {
    True,
    False,
    #[default]
    Unknown,
}

impl TruthValue {
    pub fn from_bool(value: bool) -> Self {
        if value {
            Self::True
        } else {
            Self::False
        }
    }

    pub fn is_true(self) -> bool {
        matches!(self, Self::True)
    }

    pub fn is_known(self) -> bool {
        !matches!(self, Self::Unknown)
    }

    /// Strong three-valued negation: `not unknown` stays unknown.
    pub fn negate(self) -> Self {
        match self {
            Self::True => Self::False,
            Self::False => Self::True,
            Self::Unknown => Self::Unknown,
        }
    }
}

/// Why a value or predicate is unknown. Unknown is not an error: an entity
/// that disappears after save becomes a runtime unknown with a visible reason.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum UnknownReason {
    /// The referenced entity does not exist in runtime state.
    MissingEntity { entity: String },
    /// The entity exists but does not expose the requested field.
    MissingField { field: String },
    /// Observed state is unknown because the device is explicitly offline.
    Offline { device: String },
    /// Observed state is older than the configured freshness bound.
    Stale { device: String },
    /// A group condition selected zero members.
    EmptySelection { group: String },
    /// The value has not been observed yet (no report or not yet evaluated).
    NotInitialized { entity: String },
    /// A helper or computed source has no current value.
    UnknownSourceValue { source: String },
}

/// One node in a complete condition trace. The evaluator visits every node of
/// an eligible condition tree; short-circuiting requires an explicit semantics
/// review and is not implemented.
#[derive(TS, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct ConditionTraceNode {
    /// JSON-pointer-style path of this node in the stored definition.
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub node_id: Option<NodeId>,
    #[serde(default)]
    pub truth: TruthValue,
    #[serde(default)]
    pub evaluated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unknown_reason: Option<UnknownReason>,
    /// Full group evaluation for group condition nodes, so native results,
    /// SDK helpers, and UI traces agree exactly (G07).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<Box<GroupEvaluation>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ConditionTraceNode>,
}

/// Result of one condition evaluation. When `error` is set the `truth` field
/// must not be interpreted as a decision; `not`/`all`/`any` all stay errors.
#[derive(TS, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct ConditionEvaluation {
    pub truth: TruthValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unknown_reason: Option<UnknownReason>,
    pub trace: ConditionTraceNode,
}

impl ConditionEvaluation {
    pub fn is_error(&self) -> bool {
        self.error.is_some()
    }

    /// Only a known true condition without evaluation errors may run.
    pub fn authorizes_execution(&self) -> bool {
        !self.is_error() && self.truth.is_true()
    }
}

/// How the assigned scene of a group's configured members summarizes.
#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum GroupSceneSummaryKind {
    /// Every member has the same assigned scene.
    Uniform,
    /// No member has an assigned scene.
    Unassigned,
    /// Members disagree about the assigned scene.
    Mixed,
    /// At least one configured member is missing or has no assignment.
    #[default]
    Unknown,
}

/// Common assigned-scene summary. Never inferred from a majority or the first
/// device (G05).
#[derive(TS, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct GroupSceneSummary {
    pub kind: GroupSceneSummaryKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scene_id: Option<SceneId>,
    pub assigned_count: usize,
    pub unassigned_count: usize,
    pub unknown_count: usize,
}

/// Per-member result of a group evaluation, including unresolved configured
/// members (G01/G02).
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct GroupMemberEvaluation {
    /// Configured reference as written in the group definition.
    pub device: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub device_key: Option<DeviceKey>,
    pub present: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub power: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scene_id: Option<SceneId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unknown_reason: Option<UnknownReason>,
}

/// Shared group evaluation used by native rules, SDK helpers (P07), and
/// explanations (G07).
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct GroupEvaluation {
    pub group_id: GroupId,
    pub quantifier: Quantifier,
    /// All configured members, deduplicated across nested groups, including
    /// unresolved references.
    pub configured_count: usize,
    pub true_count: usize,
    pub false_count: usize,
    pub unknown_count: usize,
    pub members: Vec<GroupMemberEvaluation>,
    pub truth: TruthValue,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<UnknownReason>,
    pub scene: GroupSceneSummary,
}

/// Per-trigger outcome for one frame.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct TriggerRuntimeStatus {
    pub trigger_id: NodeId,
    pub kind: String,
    /// Whether this trigger fired for the frame.
    pub fired: bool,
    pub eligible: bool,
    pub truth: TruthValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unknown_reason: Option<UnknownReason>,
}

/// Observable v2 evaluation state for one routine.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct RoutineV2RuntimeStatus {
    pub definition_revision: i64,
    pub fingerprint: String,
    /// Trigger IDs that fired for the current/last evaluated frame, in
    /// stable declaration order. One event matching several triggers lists
    /// all of them and invokes the routine once (T01).
    pub matched_trigger_ids: Vec<NodeId>,
    pub triggers: Vec<TriggerRuntimeStatus>,
    pub condition: ConditionEvaluation,
    /// Known-true condition plus at least one fired trigger.
    pub will_trigger: bool,
    /// P04 evaluates decisions; action planning and dispatch land in P05.
    pub execution_pending: bool,
    /// Outcome of the most recent accepted plan for this routine (P05/X03).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_run: Option<PlannedRunStatus>,
}

/// Disposition of one planned step.
#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum StepDisposition {
    /// Dispatched to the actor for application.
    Dispatched,
    /// Dropped before dispatch; `reason` explains why.
    Suppressed,
}

/// Observable outcome of one planned native step (X02).
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct PlannedStepStatus {
    pub action_id: NodeId,
    /// Native action kind, e.g. `activate_scene`.
    pub kind: String,
    /// Fully resolved targets as stable strings (device keys, group/scene IDs,
    /// or helper IDs). Frozen at plan time.
    pub targets: Vec<String>,
    pub disposition: StepDisposition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
}

/// Observable outcome of accepting and dispatching one routine run (X03).
/// Matching ([`TriggerRuntimeStatus`]) is separate from acceptance (this type)
/// and from per-step dispatch ([`PlannedStepStatus`]).
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct PlannedRunStatus {
    /// Monotonic run id within this process.
    pub run_id: u64,
    pub definition_revision: i64,
    /// Whether the plan was accepted (triggers matched and condition passed).
    pub accepted: bool,
    pub steps: Vec<PlannedStepStatus>,
    /// Steps dropped by the bounded execution queue (A08).
    pub dropped: u64,
}
