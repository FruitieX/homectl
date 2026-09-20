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
    scene::{RolloutStyle, SceneId},
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

/// Stable identifier for a named timer within its owning routine. Not
/// globally unique: two routines may each own an `"off"` timer.
#[derive(TS, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[ts(export)]
pub struct TimerId(pub String);

/// One timer mutation produced by a plan step (P09). Timer state is
/// actor-authoritative; the plan only names the operation.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
#[ts(export)]
pub enum TimerOperation {
    /// Create a named timer, failing when a live generation exists.
    Schedule { timer: TimerId, delay_ms: u64 },
    /// Replace the same owner/key and bump its generation.
    Replace { timer: TimerId, delay_ms: u64 },
    /// Cancel a named timer; cancelling a missing timer succeeds (J02).
    Cancel { timer: TimerId },
}

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

/// Calendar policy for cron schedules (K). The DST defaults are fixed for now:
/// nonexistent spring-forward locals are skipped and repeated fall-back locals
/// run once at the earlier occurrence. Backlog handling is explicit and
/// distinct from scheduler lateness.
#[derive(TS, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BacklogPolicy {
    /// Missed occurrences while the process was down or blocked are dropped.
    #[default]
    Skip,
    /// At most one coalesced occurrence runs within the bounded lateness.
    CatchUpOnce,
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct ScheduleSpec {
    /// Six-field cron (`second minute hour day-of-month month day-of-week`).
    /// The DOM/DOW-OR behavior is preserved; calendar resolution is our own
    /// (croner only parses the grammar).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cron: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub every_ms: Option<u64>,
    /// IANA timezone name (or a fixed offset). Calendar schedules should store
    /// an explicit IANA zone so DST behavior is stable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub timezone: Option<String>,
    /// Missed-occurrence handling for cron schedules.
    #[serde(default)]
    pub backlog: BacklogPolicy,
    /// Bounded lateness for the single coalesced catch-up. Required when
    /// `backlog` is `catch_up_once` and rejected otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub catch_up_lateness_ms: Option<u64>,
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

/// One scene in a cycle list: the scene plus optional target and transition
/// overrides for its activation.
#[derive(TS, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[ts(export)]
pub struct CycleSceneSpec {
    pub scene_id: SceneId,
    #[serde(default)]
    pub targets: TargetSpec,
    /// Preserve scene-derived transitions during activation. Defaults to true
    /// like `ActivateScene`; the converter stores the v1 value explicitly.
    #[serde(default = "default_use_scene_transition")]
    pub use_scene_transition: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transition_ms: Option<u64>,
}

/// Staggered activation of scene targets. The style mirrors the v1 rollout
/// options; the source is either a fixed device or the routine's triggering
/// device, resolved at plan time from the matched trigger.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct RolloutSpec {
    pub style: RolloutStyle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<RolloutSource>,
    /// Total spread in milliseconds; targets without a saved position apply
    /// immediately, and a missing/zero duration applies everything at once.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub duration_ms: Option<u64>,
}

#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum RolloutSource {
    Device {
        device: DeviceRef,
    },
    /// The device whose event triggered this routine run.
    TriggeringDevice,
}

fn default_use_scene_transition() -> bool {
    true
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
        #[serde(default = "default_json_pointer")]
        path: String,
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
        /// Preserve scene-derived transitions during activation. Defaults to
        /// true for native definitions (v1 action descriptors default to
        /// false; the converter stores the v1 value explicitly).
        #[serde(default = "default_use_scene_transition")]
        use_scene_transition: bool,
        /// Explicit transition override in milliseconds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        transition_ms: Option<u64>,
        /// Stagger the activation across target positions.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rollout: Option<RolloutSpec>,
    },

    /// Advances to the next scene in a cycle list. The current scene is
    /// detected from the devices' tracked `scene_id` (optionally restricted to
    /// `detection` targets), then the entry after it activates; `nowrap`
    /// stops at the last entry instead of returning to the first.
    CycleScenes {
        id: NodeId,
        scenes: Vec<CycleSceneSpec>,
        #[serde(default)]
        nowrap: bool,
        /// Restrict current-scene detection to these devices/groups. Empty
        /// uses every device common to the cycled scenes.
        #[serde(default)]
        detection: TargetSpec,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rollout: Option<RolloutSpec>,
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
        /// Freeze intent tokens for these targets at actor acceptance (J08).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        capture_target_intents: Option<TargetSpec>,
    },

    /// Replaces a named timer generation.
    ReplaceTimer {
        id: NodeId,
        timer: TimerId,
        delay_ms: u64,
        /// Freeze intent tokens for these targets at actor acceptance (J08).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        capture_target_intents: Option<TargetSpec>,
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
            | Self::CycleScenes { id, .. }
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

/// Intent targets captured when a timer is scheduled (J08/J09). The actor
/// records the tokens at acceptance, after earlier plan steps have bumped
/// intents, and a delayed plan may act only on unchanged tokens and on the
/// group membership frozen here.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct TimerIntentCapture {
    pub targets: Vec<TimerIntentTarget>,
    /// Group membership resolved at plan time (J09). A delayed action may not
    /// expand a captured group to members added after the capture.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frozen_members: Vec<FrozenGroupMembers>,
}

/// Members of one captured group as resolved at plan time.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[ts(export)]
pub struct FrozenGroupMembers {
    pub group: GroupId,
    pub devices: Vec<crate::types::device::DeviceKey>,
}

/// One capturable intent target.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum TimerIntentTarget {
    Device {
        device: crate::types::device::DeviceKey,
    },
    Group {
        group: GroupId,
    },
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
///
/// Device/group declarations may name entities that are not configured yet:
/// the declaration is a standing dependency, so discovery can wake the script
/// later (S13). Until then the runtime simply has no state for the entity.
#[derive(TS, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum ScriptDeclaration {
    Device {
        device: DeviceRef,
    },
    Group {
        group_id: GroupId,
    },
    Timer {
        timer: TimerId,
    },
    /// Explicitly broad compatibility declaration (S14): the script opts into
    /// reading any device state in the triggering frame instead of an exact
    /// declaration. Strict scripts keep undeclared devices absent.
    AllState,
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
