//! Native automation v2 runtime: pure compiler (P03), pure evaluator (P04),
//! configured group semantics, and actor-facing lifecycle state.
//!
//! `compile` takes a tagged `RoutineDefinitionV2` plus a `ConfigCatalog` and
//! returns normalized data, resolved typed references, trigger subscriptions,
//! dependencies, write capabilities, stable node IDs, and a fingerprint, or a
//! path-specific `RoutineValidationReport`. The same entry points are used by
//! save/enable validation, runtime loading, import validation, reference
//! inventory, and simulation scanning; no endpoint re-implements traversal.
//!
//! The compiler never executes script bodies. JavaScript is syntax-parsed
//! only (as P01 already does for v1 rules); execution belongs to the P06
//! worker.
//!
//! `evaluate` is the native decision engine: scan-all, pure, three-valued,
//! with error/unknown separation and per-trigger transition memory. It does
//! not dispatch actions; P05 adds planning and execution.

pub mod compile;
pub mod evaluate;
pub mod groups;
pub mod plan;
pub mod runtime;
pub mod script_contract;
pub mod script_coordinator;
pub mod script_runtime;
pub mod timers;

pub use compile::{
    compile_definition, compile_definition_value, compile_row, definition_fingerprint,
    next_revision, parse_definition, prepare_write, reference_inventory, referenced_devices,
    rewrite_invoked_routine_references, row_semantics, CompiledDefinition, CompiledRoutine,
    ConfigCatalog, ReferenceInventory, ReferenceInventoryEntry, ResolvedReference,
    SubscriptionKind, TriggerSubscription, WriteCapability, WriteKind, MAX_CHOOSE_DEPTH,
    MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_PROGRAM_ACTIONS, MAX_TIMER_DELAY_MS,
    MAX_TRIGGERS,
};
pub use evaluate::{
    evaluate_condition, evaluate_routine_frame, resolve_value, seed_routine_memory, EvaluationView,
    FrameContext, ResolvedValue, RoutineFrameEvaluation, TriggerMemory, TriggerMemoryEntry,
    TriggerMemoryKey,
};
pub use groups::{evaluate_group, MAX_GROUP_EVAL_MEMBERS};
pub use plan::{
    action_kind, guard_suppression, plan_evaluation, plan_script_actions, step_status,
    step_targets, IntentTarget, IntentTracker, PlanInputs, PlannedStep, PlannedStepBody,
    RoutinePlan, MAX_PLANNED_STEPS,
};
pub use runtime::{V2Definition, V2Runtime};
pub use script_contract::{
    parse_computed_source_outcome, parse_condition_outcome, parse_routine_handler_outcome,
    parse_scene_materializer_outcome, ComputedSourceOutcome, ConditionOutcome,
    RoutineHandlerOutcome, SceneMaterializerOutcome, ScriptOutputContract,
    MAX_SCENE_MATERIALIZED_DEVICES, MAX_SCRIPT_ACTION_NODES, MAX_SCRIPT_STATE_BYTES,
};
pub use script_coordinator::{
    Admission, AdmissionError, CoalescePolicy, CompleteResult, InvocationToken, OwnerKind,
    ScriptCoordinator, ScriptInvocation, ScriptOwnerId, StaleReason,
    MAX_PENDING_INVOCATIONS_PER_OWNER,
};
pub use script_runtime::{
    bounded_text, PreparedLegacyLeaf, PreparedSceneMaterialization, PreparedScriptRun,
    SceneMaterializationCompletion, ScriptExecution, LEGACY_DEFINITION_REVISION,
    MAX_SCRIPT_ERROR_CHARS,
};
pub use timers::{
    PredicateDeadlineFire, TimerCancellation, TimerFire, TimerOperationError, TimerStore,
    TimerWakeup, MAX_TIMERS_PER_OWNER,
};
