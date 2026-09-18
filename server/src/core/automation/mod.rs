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
pub mod runtime;

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
pub use runtime::{V2Definition, V2Runtime};
