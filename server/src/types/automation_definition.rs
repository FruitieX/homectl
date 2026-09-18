//! Typed schema for automation v2 routine definitions (P03).
//!
//! These types describe the versioned `definition_v2` body carried by a
//! `RoutineRow`. The schema is deliberately data-only: it is compiled by the
//! pure compiler in `core::automation`, never interpreted directly by the
//! v1 evaluator. The raw JSON stays authoritative in storage, so unknown or
//! newer fields survive save/export/import even when this build cannot
//! compile them.
//!
//! Stable node IDs (`NodeId`) identify triggers, actions, and `choose`
//! branches. Renaming display labels never rewrites node IDs.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    device::DeviceRef,
    group::GroupId,
    rule::{RawRuleOperator, RoutineId},
    scene::SceneId,
};

/// Authoritative routine semantics marker for legacy `rules`/`actions` rows.
pub const ROUTINE_SEMANTICS_VERSION_V1: i32 = 1;

/// Authoritative routine semantics marker for `definition_v2` rows.
pub const ROUTINE_SEMANTICS_VERSION_V2: i32 = 2;

/// Strictly classified version of a routine definition.
///
/// Unknown versions are retained as `Unknown(i32)` and must be rejected or
/// quarantined. They are never interpreted as v1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoutineSemantics {
    V1,
    V2,
    Unknown(i32),
}

impl RoutineSemantics {
    pub fn from_version(version: i32) -> Self {
        match version {
            ROUTINE_SEMANTICS_VERSION_V1 => Self::V1,
            ROUTINE_SEMANTICS_VERSION_V2 => Self::V2,
            other => Self::Unknown(other),
        }
    }

    pub fn version(self) -> i32 {
        match self {
            Self::V1 => ROUTINE_SEMANTICS_VERSION_V1,
            Self::V2 => ROUTINE_SEMANTICS_VERSION_V2,
            Self::Unknown(version) => version,
        }
    }

    pub fn is_supported(self) -> bool {
        !matches!(self, Self::Unknown(_))
    }
}

/// Stable identifier for a definition node (trigger, action, branch).
#[derive(TS, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[ts(export)]
pub struct NodeId(pub String);

impl NodeId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for NodeId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Stable identifier for a named timer key.
#[derive(TS, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[ts(export)]
pub struct TimerId(pub String);

impl TimerId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for TimerId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Stable identifier for a helper value. Helpers become settable in P05;
/// P03 only resolves references against the catalog.
#[derive(TS, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[ts(export)]
pub struct HelperId(pub String);

impl HelperId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for HelperId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Stable identifier for a computed source. Computed sources arrive in P11;
/// P03 only resolves references against the catalog.
#[derive(TS, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[ts(export)]
pub struct SourceId(pub String);

impl SourceId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for SourceId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Versioned v2 routine definition.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct RoutineDefinitionV2 {
    pub triggers: Vec<TriggerSpec>,

    /// Omitted conditions normalize to literal `true`.
    #[serde(default)]
    pub condition: ConditionExpr,

    pub program: Program,

    #[serde(default)]
    pub execution: ExecutionPolicy,
}

/// A declared trigger subscription with a stable ID and tagged body.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum TriggerSpec {
    /// A raw device report pulse. Reports fire even when the value repeats.
    Report {
        id: NodeId,
        device: DeviceRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        field: Option<String>,
    },

    /// A device state change (edge or level, explicitly declared).
    StateChange {
        id: NodeId,
        device: DeviceRef,
        #[serde(default)]
        mode: StateChangeMode,
    },

    /// Fires when the predicate transitions from false/unknown to true.
    PredicateTransition {
        id: NodeId,
        predicate: ConditionExpr,
    },

    /// Fires when the predicate has held continuously for a duration.
    PredicateFor {
        id: NodeId,
        predicate: ConditionExpr,
        duration_ms: u64,
    },

    /// Wall-clock scheduling (cron or fixed interval).
    Schedule { id: NodeId, schedule: ScheduleSpec },

    /// A named timer fired.
    TimerFired { id: NodeId, timer: TimerId },

    /// Runtime/startup seeding. Never fires during startup seeding (E06).
    Startup { id: NodeId },

    /// Explicit invocation only.
    Manual { id: NodeId },
}

impl TriggerSpec {
    pub fn id(&self) -> &NodeId {
        match self {
            Self::Report { id, .. }
            | Self::StateChange { id, .. }
            | Self::PredicateTransition { id, .. }
            | Self::PredicateFor { id, .. }
            | Self::Schedule { id, .. }
            | Self::TimerFired { id, .. }
            | Self::Startup { id }
            | Self::Manual { id } => id,
        }
    }
}

#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum StateChangeMode {
    /// Fire once per false -> true transition (rearmed by true -> false).
    #[default]
    Transition,
    /// Fire on every matching state update while true.
    Level,
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct ScheduleSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cron: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub every_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub timezone: Option<String>,
}

/// Three-valued condition expression. `All`/`Any` require at least one child.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ConditionExpr {
    Literal {
        value: bool,
    },
    All {
        conditions: Vec<ConditionExpr>,
    },
    Any {
        conditions: Vec<ConditionExpr>,
    },
    Not {
        condition: Box<ConditionExpr>,
    },
    Comparison {
        source: ValueSource,
        operator: RawRuleOperator,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<serde_json::Value>,
    },
    Group {
        group_id: GroupId,
        quantifier: Quantifier,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        power: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        scene: Option<SceneId>,
    },
}

impl Default for ConditionExpr {
    fn default() -> Self {
        Self::Literal { value: true }
    }
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ValueSource {
    Device {
        device: DeviceRef,
        #[serde(default = "default_json_pointer")]
        path: String,
    },
    Helper {
        helper: HelperId,
    },
    ComputedSource {
        source: SourceId,
    },
}

fn default_json_pointer() -> String {
    "/".to_string()
}

#[derive(TS, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Quantifier {
    All,
    Any,
    None,
    /// True only with known disagreement: at least one known true and one
    /// known false member. All-members-known without a mixture is false, and
    /// fewer than two members stay unknown (G04).
    Partial,
}

/// Tagged program body: native typed actions or a sandboxed script.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum Program {
    Native(NativeProgram),
    Script(ScriptProgram),
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct NativeProgram {
    pub steps: Vec<NativeAction>,
}

/// One typed native action with a stable node ID.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
#[ts(export)]
pub enum NativeAction {
    /// Activates a scene. An empty `targets` uses the scene's own targets.
    /// Exactly one of `scene_id`/`select` must be present.
    ActivateScene {
        id: NodeId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        scene_id: Option<SceneId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        select: Option<SceneSelection>,
        #[serde(default)]
        targets: TargetSpec,
    },

    /// Sets power on one device.
    SetPower {
        id: NodeId,
        device: DeviceRef,
        power: bool,
    },

    /// Relative dim step in the -1.0..=1.0 range.
    Dim {
        id: NodeId,
        targets: TargetSpec,
        step: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        transition_ms: Option<u64>,
    },

    /// Ordered first-match branch selection. Unknown/error blocks selection.
    Choose {
        id: NodeId,
        branches: Vec<ChooseBranch>,
    },

    /// Creates a named timer, failing if a live generation exists.
    ScheduleTimer {
        id: NodeId,
        timer: TimerId,
        delay_ms: u64,
    },

    /// Replaces a named timer generation.
    ReplaceTimer {
        id: NodeId,
        timer: TimerId,
        delay_ms: u64,
    },

    /// Cancels a named timer. Cancelling a missing timer succeeds.
    CancelTimer { id: NodeId, timer: TimerId },

    /// Writes a helper value.
    SetHelper {
        id: NodeId,
        helper: HelperId,
        value: serde_json::Value,
    },

    /// Explicitly invokes another routine.
    InvokeRoutine {
        id: NodeId,
        routine_id: RoutineId,
        #[serde(default)]
        mode: InvokeMode,
    },
}

impl NativeAction {
    pub fn id(&self) -> &NodeId {
        match self {
            Self::ActivateScene { id, .. }
            | Self::SetPower { id, .. }
            | Self::Dim { id, .. }
            | Self::Choose { id, .. }
            | Self::ScheduleTimer { id, .. }
            | Self::ReplaceTimer { id, .. }
            | Self::CancelTimer { id, .. }
            | Self::SetHelper { id, .. }
            | Self::InvokeRoutine { id, .. } => id,
        }
    }
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct ChooseBranch {
    pub id: NodeId,
    pub condition: ConditionExpr,
    pub steps: Vec<NativeAction>,
}

/// Decision-time scene selection for a v2 activation. Resolved once at plan
/// time and frozen into the plan (A01).
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum SceneSelection {
    /// Map an enum helper's current value to a scene. Unknown values use the
    /// explicit fallback when present.
    HelperEnum {
        helper: HelperId,
        mapping: std::collections::BTreeMap<String, SceneId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        fallback_scene_id: Option<SceneId>,
    },
    /// Mirror the referenced group's unanimous currently-active scene, using
    /// only the configured fallback when the group is mixed or unknown (A04).
    GroupActive {
        group_id: GroupId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        fallback_scene_id: Option<SceneId>,
    },
}

#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum InvokeMode {
    #[default]
    FireAndForget,
    AwaitCompletion,
}

#[derive(TS, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct TargetSpec {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub devices: Vec<DeviceRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<GroupId>,
}

#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct ScriptProgram {
    pub spec: ScriptSpec,
}

/// Versioned script body plus declared subscriptions. The body is a function
/// body (unambiguous `return`) executed only by the P06 worker.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct ScriptSpec {
    pub api_version: u32,

    /// Function body source. Never executed during compilation or validation.
    pub source_body: String,

    #[serde(default)]
    pub declarations: Vec<ScriptDeclaration>,

    #[serde(default = "default_limits_profile")]
    pub limits_profile: String,
}

fn default_limits_profile() -> String {
    "default".to_string()
}

/// A declared read/subscription of a script program. A scripted trigger is a
/// declaration plus a pure filter; scripts cannot register hidden listeners.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ScriptDeclaration {
    Device { device: DeviceRef },
    Group { group_id: GroupId },
    Timer { timer: TimerId },
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct ExecutionPolicy {
    #[serde(default)]
    pub mode: ExecutionMode,

    /// Upper bound on dispatched actions per invocation.
    #[serde(default = "default_max_actions")]
    pub max_actions: u32,

    /// Optional minimum spacing between invocations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub min_interval_ms: Option<u64>,
}

impl Default for ExecutionPolicy {
    fn default() -> Self {
        Self {
            mode: ExecutionMode::default(),
            max_actions: default_max_actions(),
            min_interval_ms: None,
        }
    }
}

fn default_max_actions() -> u32 {
    16
}

#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ExecutionMode {
    /// Reject a new invocation while one is in flight.
    #[default]
    Single,
    /// Queue invocations in arrival order.
    Queued,
    /// Cancel the in-flight invocation and start the newest.
    Restart,
}
