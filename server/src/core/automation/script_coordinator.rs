//! P07 owner coordinator: per-owner queues, memory CAS, and stale rejection.
//!
//! The coordinator is pure bookkeeping; execution happens in the supervised
//! worker pool. For each owner (routine, scene, computed source) it tracks:
//!
//! * a **generation** bumped on every definition edit and every enable/disable
//!   transition, so results produced before the change can never publish
//!   (S16);
//! * a **state revision** for owner memory. A successful current result may
//!   apply `next_state` only if its CAS revision still matches (S12);
//! * a bounded set of **pending invocations**. Reports, button presses, and
//!   scripted transition histories use FIFO admission, while current-value
//!   recomputation (scene/source refresh) may coalesce to the latest revision
//!   and drop superseded results. Supersession is visible, never silent: the
//!   stale result is reported as [`StaleReason::Superseded`].
//!
//! Contract parsing happens on completion, after staleness checks, so an
//! obsolete result is rejected for being obsolete even if it is also
//! malformed.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::script_contract::{
    parse_computed_source_outcome, parse_condition_outcome, parse_routine_handler_outcome,
    parse_scene_materializer_outcome, ComputedSourceOutcome, ConditionOutcome,
    RoutineHandlerOutcome, SceneMaterializerOutcome, ScriptOutputContract, MAX_SCRIPT_STATE_BYTES,
};

/// Maximum in-flight (queued or running) invocations per owner.
pub const MAX_PENDING_INVOCATIONS_PER_OWNER: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum OwnerKind {
    Routine,
    Scene,
    ComputedSource,
}

impl OwnerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Routine => "routine",
            Self::Scene => "scene",
            Self::ComputedSource => "computed_source",
        }
    }
}

/// Stable identity of a script owner.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ScriptOwnerId {
    pub kind: OwnerKind,
    pub id: String,
}

impl ScriptOwnerId {
    pub fn routine(id: impl Into<String>) -> Self {
        Self {
            kind: OwnerKind::Routine,
            id: id.into(),
        }
    }

    pub fn scene(id: impl Into<String>) -> Self {
        Self {
            kind: OwnerKind::Scene,
            id: id.into(),
        }
    }

    pub fn computed_source(id: impl Into<String>) -> Self {
        Self {
            kind: OwnerKind::ComputedSource,
            id: id.into(),
        }
    }

    pub fn key(&self) -> String {
        format!("{}:{}", self.kind.as_str(), self.id)
    }
}

/// Queue behavior for one invocation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoalescePolicy {
    /// Keep every invocation (reports, button presses, transition histories).
    Queue,
    /// Keep only the newest invocation per owner and contract (current-value
    /// recomputation).
    LatestWins,
}

/// A request to invoke a script for an owner.
#[derive(Clone, Debug, PartialEq)]
pub struct ScriptInvocation {
    pub owner: ScriptOwnerId,
    pub definition_revision: i64,
    pub contract: ScriptOutputContract,
    /// Function body source; never executed in-process.
    pub source_body: String,
    /// Immutable, bounded JSON context, including `ctx.state.memory` and
    /// `ctx.state.revision` for this invocation.
    pub context: Value,
    pub coalesce: CoalescePolicy,
    pub run_id: Option<String>,
}

/// Ticket returned by admission; required to complete the invocation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvocationToken {
    pub request_id: u64,
    pub owner_key: String,
    pub owner_generation: u64,
    pub definition_revision: i64,
    pub state_revision: u64,
    pub contract: ScriptOutputContract,
}

/// Admission decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Admission {
    Accepted(InvocationToken),
    /// Accepted, but `superseded` older invocations will be rejected if they
    /// complete.
    Coalesced {
        token: InvocationToken,
        superseded: usize,
    },
}

/// Why an invocation was refused admission.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AdmissionError {
    UnknownOwner,
    Disabled,
    /// The caller's definition revision is not the loaded one.
    WrongRevision {
        expected: i64,
    },
    QueueFull {
        limit: usize,
    },
}

/// Why a completed result was not applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StaleReason {
    UnknownOwner,
    Disabled,
    /// The definition was edited after the invocation was admitted.
    DefinitionChanged,
    /// A newer coalesced invocation replaced this one.
    Superseded,
    /// Owner memory changed since admission; the result cannot advance it.
    StateChanged,
}

impl StaleReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UnknownOwner => "unknown_owner",
            Self::Disabled => "owner_disabled",
            Self::DefinitionChanged => "definition_changed",
            Self::Superseded => "superseded",
            Self::StateChanged => "state_changed",
        }
    }
}

/// Result of completing one invocation.
#[derive(Clone, Debug, PartialEq)]
pub enum CompleteResult<T> {
    Applied { value: T, state_applied: bool },
    Stale(StaleReason),
    ContractError { message: String },
}

struct OwnerEntry {
    kind: OwnerKind,
    generation: u64,
    definition_revision: i64,
    state_revision: u64,
    memory: Value,
    enabled: bool,
    pending: BTreeSet<u64>,
    latest: BTreeMap<ScriptOutputContract, u64>,
}

/// Per-owner admission and stale-result bookkeeping.
#[derive(Default)]
pub struct ScriptCoordinator {
    owners: BTreeMap<String, OwnerEntry>,
    next_request_id: u64,
    max_pending_per_owner: Option<usize>,
}

impl ScriptCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bound in-flight work per owner (tests and future settings profiles).
    pub fn with_max_pending_per_owner(mut self, limit: usize) -> Self {
        self.max_pending_per_owner = Some(limit);
        self
    }

    fn pending_limit(&self) -> usize {
        self.max_pending_per_owner
            .unwrap_or(MAX_PENDING_INVOCATIONS_PER_OWNER)
    }

    /// Load or edit an owner definition.
    ///
    /// The first load creates generation 1. A later load with a different
    /// definition (or the same owner re-registered after removal) bumps the
    /// generation and drops pending results while preserving owner memory.
    pub fn load_owner(
        &mut self,
        owner: &ScriptOwnerId,
        definition_revision: i64,
        initial_memory: Value,
    ) {
        let key = owner.key();
        match self.owners.get_mut(&key) {
            Some(entry) => {
                entry.generation = entry.generation.wrapping_add(1);
                entry.definition_revision = definition_revision;
                entry.pending.clear();
                entry.latest.clear();
                entry.enabled = true;
            }
            None => {
                self.owners.insert(
                    key,
                    OwnerEntry {
                        kind: owner.kind,
                        generation: 1,
                        definition_revision,
                        state_revision: 0,
                        memory: initial_memory,
                        enabled: true,
                        pending: BTreeSet::new(),
                        latest: BTreeMap::new(),
                    },
                );
            }
        }
    }

    /// Enable or disable an owner. Any transition bumps the generation, so
    /// pending results from before the change are rejected (S16).
    pub fn set_enabled(&mut self, owner: &ScriptOwnerId, enabled: bool) {
        let Some(entry) = self.owners.get_mut(&owner.key()) else {
            return;
        };
        if entry.enabled == enabled {
            return;
        }
        entry.enabled = enabled;
        entry.generation = entry.generation.wrapping_add(1);
        entry.pending.clear();
        entry.latest.clear();
    }

    /// Remove an owner (deleted routine/scene/source); drops memory and any
    /// pending results.
    pub fn remove_owner(&mut self, owner: &ScriptOwnerId) {
        self.owners.remove(&owner.key());
    }

    pub fn owner_kind(&self, owner: &ScriptOwnerId) -> Option<OwnerKind> {
        self.owners.get(&owner.key()).map(|entry| entry.kind)
    }

    pub fn is_enabled(&self, owner: &ScriptOwnerId) -> bool {
        self.owners
            .get(&owner.key())
            .is_some_and(|entry| entry.enabled)
    }

    pub fn memory(&self, owner: &ScriptOwnerId) -> Option<&Value> {
        self.owners.get(&owner.key()).map(|entry| &entry.memory)
    }

    pub fn state_revision(&self, owner: &ScriptOwnerId) -> Option<u64> {
        self.owners
            .get(&owner.key())
            .map(|entry| entry.state_revision)
    }

    /// Number of in-flight invocations for an owner.
    pub fn pending_count(&self, owner: &ScriptOwnerId) -> usize {
        self.owners
            .get(&owner.key())
            .map_or(0, |entry| entry.pending.len())
    }

    /// Admit an invocation for execution.
    pub fn submit(&mut self, invocation: &ScriptInvocation) -> Result<Admission, AdmissionError> {
        let key = invocation.owner.key();
        let limit = self.pending_limit();
        let request_id = self.next_request_id.wrapping_add(1);
        let entry = self
            .owners
            .get_mut(&key)
            .ok_or(AdmissionError::UnknownOwner)?;

        if !entry.enabled {
            return Err(AdmissionError::Disabled);
        }
        if entry.definition_revision != invocation.definition_revision {
            return Err(AdmissionError::WrongRevision {
                expected: entry.definition_revision,
            });
        }
        if entry.pending.len() >= limit {
            return Err(AdmissionError::QueueFull { limit });
        }

        let mut superseded = 0usize;
        if invocation.coalesce == CoalescePolicy::LatestWins {
            let stale: Vec<u64> = entry
                .pending
                .iter()
                .copied()
                .filter(|request| entry.latest.get(&invocation.contract) == Some(request))
                .collect();
            for request in stale {
                entry.pending.remove(&request);
                superseded += 1;
            }
            entry.latest.insert(invocation.contract, request_id);
        }

        entry.pending.insert(request_id);
        self.next_request_id = request_id;

        let token = InvocationToken {
            request_id,
            owner_key: key,
            owner_generation: entry.generation,
            definition_revision: entry.definition_revision,
            state_revision: entry.state_revision,
            contract: invocation.contract,
        };

        if superseded == 0 {
            Ok(Admission::Accepted(token))
        } else {
            Ok(Admission::Coalesced { token, superseded })
        }
    }

    fn begin_completion(
        &mut self,
        token: &InvocationToken,
    ) -> Result<&mut OwnerEntry, StaleReason> {
        let entry = self
            .owners
            .get_mut(&token.owner_key)
            .ok_or(StaleReason::UnknownOwner)?;
        if !entry.enabled {
            return Err(StaleReason::Disabled);
        }
        if entry.generation != token.owner_generation
            || entry.definition_revision != token.definition_revision
        {
            return Err(StaleReason::DefinitionChanged);
        }
        if !entry.pending.remove(&token.request_id) {
            return Err(StaleReason::Superseded);
        }
        if entry.state_revision != token.state_revision {
            return Err(StaleReason::StateChanged);
        }
        Ok(entry)
    }

    fn apply_state(entry: &mut OwnerEntry, next_state: &Option<Value>) -> bool {
        match next_state {
            Some(state) => {
                entry.memory = state.clone();
                entry.state_revision = entry.state_revision.wrapping_add(1);
                true
            }
            None => false,
        }
    }

    pub fn complete_condition(
        &mut self,
        token: &InvocationToken,
        value: &Value,
    ) -> CompleteResult<ConditionOutcome> {
        let _entry = match self.begin_completion(token) {
            Ok(entry) => entry,
            Err(reason) => return CompleteResult::Stale(reason),
        };
        match parse_condition_outcome(value) {
            Ok(outcome) => CompleteResult::Applied {
                value: outcome,
                state_applied: false,
            },
            Err(message) => CompleteResult::ContractError { message },
        }
    }

    pub fn complete_handler(
        &mut self,
        token: &InvocationToken,
        value: &Value,
    ) -> CompleteResult<RoutineHandlerOutcome> {
        let entry = match self.begin_completion(token) {
            Ok(entry) => entry,
            Err(reason) => return CompleteResult::Stale(reason),
        };
        match parse_routine_handler_outcome(value, MAX_SCRIPT_STATE_BYTES) {
            Ok(outcome) => {
                let state_applied = Self::apply_state(entry, &outcome.next_state);
                CompleteResult::Applied {
                    value: outcome,
                    state_applied,
                }
            }
            Err(message) => CompleteResult::ContractError { message },
        }
    }

    pub fn complete_scene_materializer(
        &mut self,
        token: &InvocationToken,
        value: &Value,
    ) -> CompleteResult<SceneMaterializerOutcome> {
        let _entry = match self.begin_completion(token) {
            Ok(entry) => entry,
            Err(reason) => return CompleteResult::Stale(reason),
        };
        match parse_scene_materializer_outcome(value) {
            Ok(outcome) => CompleteResult::Applied {
                value: outcome,
                state_applied: false,
            },
            Err(message) => CompleteResult::ContractError { message },
        }
    }

    pub fn complete_computed_source(
        &mut self,
        token: &InvocationToken,
        value: &Value,
    ) -> CompleteResult<ComputedSourceOutcome> {
        let entry = match self.begin_completion(token) {
            Ok(entry) => entry,
            Err(reason) => return CompleteResult::Stale(reason),
        };
        match parse_computed_source_outcome(value, MAX_SCRIPT_STATE_BYTES) {
            Ok(outcome) => {
                let state_applied = Self::apply_state(entry, &outcome.next_state);
                CompleteResult::Applied {
                    value: outcome,
                    state_applied,
                }
            }
            Err(message) => CompleteResult::ContractError { message },
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn owner() -> ScriptOwnerId {
        ScriptOwnerId::routine("staircase")
    }

    fn invocation(revision: i64, coalesce: CoalescePolicy) -> ScriptInvocation {
        ScriptInvocation {
            owner: owner(),
            definition_revision: revision,
            contract: ScriptOutputContract::RoutineHandler,
            source_body: "return { actions: [] };".to_string(),
            context: json!({}),
            coalesce,
            run_id: None,
        }
    }

    fn accepted(admission: Admission) -> InvocationToken {
        match admission {
            Admission::Accepted(token) | Admission::Coalesced { token, .. } => token,
        }
    }

    #[test]
    fn s12_memory_applies_only_for_the_current_revision() {
        let mut coordinator = ScriptCoordinator::new();
        coordinator.load_owner(&owner(), 1, json!({"step": 0}));

        let first = accepted(
            coordinator
                .submit(&invocation(1, CoalescePolicy::Queue))
                .unwrap(),
        );
        let second = accepted(
            coordinator
                .submit(&invocation(1, CoalescePolicy::Queue))
                .unwrap(),
        );

        let result = coordinator
            .complete_handler(&first, &json!({"actions": [], "next_state": {"step": 1}}));
        assert_eq!(
            result,
            CompleteResult::Applied {
                value: RoutineHandlerOutcome {
                    actions: Vec::new(),
                    next_state: Some(json!({"step": 1})),
                },
                state_applied: true,
            }
        );
        assert_eq!(coordinator.memory(&owner()), Some(&json!({"step": 1})));
        assert_eq!(coordinator.state_revision(&owner()), Some(1));

        // The second invocation was admitted against revision 0.
        let stale = coordinator
            .complete_handler(&second, &json!({"actions": [], "next_state": {"step": 2}}));
        assert_eq!(stale, CompleteResult::Stale(StaleReason::StateChanged));
        assert_eq!(coordinator.memory(&owner()), Some(&json!({"step": 1})));
        assert_eq!(coordinator.pending_count(&owner()), 0);
    }

    #[test]
    fn s16_edit_and_disable_invalidate_pending_results() {
        let mut coordinator = ScriptCoordinator::new();
        coordinator.load_owner(&owner(), 1, json!({"step": 0}));
        let before_edit = accepted(
            coordinator
                .submit(&invocation(1, CoalescePolicy::Queue))
                .unwrap(),
        );
        coordinator.load_owner(&owner(), 2, json!({"step": 0}));
        assert_eq!(
            coordinator.complete_handler(&before_edit, &json!({"actions": []})),
            CompleteResult::Stale(StaleReason::DefinitionChanged)
        );

        let before_disable = accepted(
            coordinator
                .submit(&invocation(2, CoalescePolicy::Queue))
                .unwrap(),
        );
        coordinator.set_enabled(&owner(), false);
        assert!(matches!(
            coordinator.submit(&invocation(2, CoalescePolicy::Queue)),
            Err(AdmissionError::Disabled)
        ));
        assert_eq!(
            coordinator.complete_handler(&before_disable, &json!({"actions": []})),
            CompleteResult::Stale(StaleReason::Disabled)
        );

        coordinator.set_enabled(&owner(), true);
        let after_enable = accepted(
            coordinator
                .submit(&invocation(2, CoalescePolicy::Queue))
                .unwrap(),
        );
        assert!(matches!(
            coordinator.complete_handler(&after_enable, &json!({"actions": []})),
            CompleteResult::Applied { .. }
        ));
    }

    #[test]
    fn coalescing_drops_superseded_results_visibly() {
        let mut coordinator = ScriptCoordinator::new();
        coordinator.load_owner(&ScriptOwnerId::scene("movie"), 1, serde_json::Value::Null);

        let mut scene_invocation = invocation(1, CoalescePolicy::LatestWins);
        scene_invocation.owner = ScriptOwnerId::scene("movie");
        scene_invocation.contract = ScriptOutputContract::SceneMaterializer;

        let first = accepted(coordinator.submit(&scene_invocation).unwrap());
        let second = match coordinator.submit(&scene_invocation).unwrap() {
            Admission::Coalesced { token, superseded } => {
                assert_eq!(superseded, 1);
                token
            }
            other => panic!("expected coalescing, got {other:?}"),
        };

        assert_eq!(
            coordinator.complete_scene_materializer(&first, &json!({"devices": {}})),
            CompleteResult::Stale(StaleReason::Superseded)
        );
        assert!(matches!(
            coordinator.complete_scene_materializer(&second, &json!({"devices": {}})),
            CompleteResult::Applied { .. }
        ));
    }

    #[test]
    fn queue_policy_keeps_every_invocation_and_enforces_the_bound() {
        let mut coordinator = ScriptCoordinator::new().with_max_pending_per_owner(2);
        coordinator.load_owner(&owner(), 1, serde_json::Value::Null);

        let first = accepted(
            coordinator
                .submit(&invocation(1, CoalescePolicy::Queue))
                .unwrap(),
        );
        let second = accepted(
            coordinator
                .submit(&invocation(1, CoalescePolicy::Queue))
                .unwrap(),
        );
        assert_eq!(
            coordinator.submit(&invocation(1, CoalescePolicy::Queue)),
            Err(AdmissionError::QueueFull { limit: 2 })
        );
        assert_eq!(coordinator.pending_count(&owner()), 2);

        assert!(matches!(
            coordinator.complete_handler(&first, &json!({"actions": []})),
            CompleteResult::Applied { .. }
        ));
        assert!(matches!(
            coordinator.complete_handler(&second, &json!({"actions": []})),
            CompleteResult::Applied { .. }
        ));
    }

    #[test]
    fn contract_errors_do_not_advance_memory() {
        let mut coordinator = ScriptCoordinator::new();
        coordinator.load_owner(&owner(), 1, json!({"step": 0}));
        let token = accepted(
            coordinator
                .submit(&invocation(1, CoalescePolicy::Queue))
                .unwrap(),
        );

        let result = coordinator.complete_handler(&token, &json!({"actions": "nope"}));
        assert!(matches!(result, CompleteResult::ContractError { .. }));
        assert_eq!(coordinator.memory(&owner()), Some(&json!({"step": 0})));
        assert_eq!(coordinator.state_revision(&owner()), Some(0));
        assert_eq!(coordinator.pending_count(&owner()), 0);
    }

    #[test]
    fn unknown_and_wrong_revision_submissions_are_rejected() {
        let mut coordinator = ScriptCoordinator::new();
        assert_eq!(
            coordinator.submit(&invocation(1, CoalescePolicy::Queue)),
            Err(AdmissionError::UnknownOwner)
        );

        coordinator.load_owner(&owner(), 3, serde_json::Value::Null);
        assert_eq!(
            coordinator.submit(&invocation(1, CoalescePolicy::Queue)),
            Err(AdmissionError::WrongRevision { expected: 3 })
        );
        assert!(coordinator
            .submit(&invocation(3, CoalescePolicy::Queue))
            .is_ok());
    }
}
