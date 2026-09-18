//! Pure v2 definition compiler (P03).
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

pub mod compile;

pub use compile::{
    compile_definition, compile_definition_value, compile_row, definition_fingerprint,
    next_revision, parse_definition, prepare_write, reference_inventory, referenced_devices,
    rewrite_invoked_routine_references, row_semantics, CompiledDefinition, CompiledRoutine,
    ConfigCatalog, ReferenceInventory, ReferenceInventoryEntry, ResolvedReference,
    SubscriptionKind, TriggerSubscription, WriteCapability, WriteKind, MAX_CHOOSE_DEPTH,
    MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_PROGRAM_ACTIONS, MAX_TIMER_DELAY_MS,
    MAX_TRIGGERS,
};
