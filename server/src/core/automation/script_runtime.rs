//! P07 v2 script execution: lazy supervised pool, owner contexts, and result
//! delivery.
//!
//! Script work never runs on the state actor. The actor only:
//!
//! * lazily creates the supervised worker pool when an enabled script program
//!   actually has work (a missing `script-worker` binary degrades to a visible
//!   failure instead of blocking startup),
//! * builds an immutable, declaration-scoped `ctx` from the coherent frame,
//! * submits the invocation to the owner coordinator, and
//! * receives the typed result back as an actor event for planning/dispatch.
//!
//! The invocation context deliberately exposes only devices the routine
//! declared (plus the devices mutated by the triggering frame), so undeclared
//! reads are absent instead of silently observed; the exposed set never
//! depends on which branch a previous invocation took (S14/S15). A script may
//! opt into the explicitly broad `AllState` compatibility declaration, which
//! exposes every device in the current frame instead of narrowing by
//! declarations. Devices declared before they are discovered stay absent
//! until they appear in the frame (S13).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::types::{
    automation_definition::{ScriptDeclaration, ScriptSpec},
    automation_event::{EventCausation, EventId, EventOrigin},
    device::{Device, DeviceKey, DeviceRef},
    event::{Event, TxEventChannel},
    rule::RoutineId,
    scene::SceneId,
};

use crate::core::js_worker::{JsWorkerPool, SupervisorConfig};

use super::evaluate::FrameContext;
use super::runtime::V2Definition;
use super::script_coordinator::{
    Admission, AdmissionError, CompleteResult, InvocationToken, OwnerKind, ScriptCoordinator,
    ScriptInvocation, ScriptOwnerId, StaleReason,
};

/// Maximum characters retained from a worker failure in a visible status.
pub const MAX_SCRIPT_ERROR_CHARS: usize = 512;

/// Definition revision recorded for legacy (v1) script owners. V1 routine rows
/// have no revision, so every configuration load re-registers the owner and
/// bumps its generation: any in-flight v1 result is conservatively rejected
/// after a reload (Section 6.4).
pub const LEGACY_DEFINITION_REVISION: i64 = 0;

/// One admitted handler invocation ready to be handed to the worker pool.
#[derive(Clone, Debug)]
pub struct PreparedScriptRun {
    pub routine_id: RoutineId,
    pub token: InvocationToken,
    pub source_body: String,
    pub context: Value,
    pub causation: EventCausation,
}

/// One admitted legacy (v1) rule-script leaf ready for the worker pool.
#[derive(Clone, Debug)]
pub struct PreparedLegacyLeaf {
    pub routine_id: RoutineId,
    pub token: InvocationToken,
    pub script: String,
    pub context: Value,
}

/// One admitted legacy (v1) scene materialization ready for the worker pool.
#[derive(Clone, Debug)]
pub struct PreparedSceneMaterialization {
    pub scene_id: SceneId,
    pub token: InvocationToken,
    pub script: String,
    pub context: Value,
}

/// Outcome of completing one scene materialization event.
#[derive(Debug)]
pub enum SceneMaterializationCompletion {
    /// The result was current and carries the raw legacy JSON value.
    Applied(Value),
    /// The result belongs to an edited/removed owner; it must be ignored.
    Stale(StaleReason),
    /// The worker failed while the owner was current; last-good stays served.
    Failed(String),
}

/// Owner state for script programs owned by the state actor.
pub struct ScriptExecution {
    coordinator: ScriptCoordinator,
    pool: Option<Arc<JsWorkerPool>>,
    pool_error: Option<String>,
    /// Optional worker executable override; `None` resolves `script-worker`
    /// next to the running server binary (tests/alternate deployments).
    pub worker_binary: Option<PathBuf>,
    invocation_counter: u64,
}

impl Default for ScriptExecution {
    fn default() -> Self {
        Self {
            coordinator: ScriptCoordinator::new(),
            pool: None,
            pool_error: None,
            worker_binary: None,
            invocation_counter: 0,
        }
    }
}

impl ScriptExecution {
    pub fn coordinator(&self) -> &ScriptCoordinator {
        &self.coordinator
    }

    pub fn coordinator_mut(&mut self) -> &mut ScriptCoordinator {
        &mut self.coordinator
    }

    /// Reconcile routine owners with the compiled definitions, legacy
    /// script-bearing routines, and scene scripts. V2 definitions whose
    /// revision is unchanged keep their generation and pending results; edited
    /// definitions bump the generation (S16); removed definitions drop their
    /// owner state. Legacy routine owners are re-registered on every
    /// reconciliation so a configuration reload always invalidates in-flight
    /// v1 results (Section 6.4). Scene owners keep their generation while the
    /// per-scene revision is unchanged, so an edit rejects in-flight
    /// materializations without disturbing untouched scenes (SC06).
    pub fn sync_owners(
        &mut self,
        definitions: &BTreeMap<RoutineId, V2Definition>,
        legacy_script_owners: &BTreeSet<RoutineId>,
        scene_owners: &BTreeMap<SceneId, i64>,
    ) {
        let mut live: BTreeSet<String> = BTreeSet::new();
        for (routine_id, definition) in definitions {
            if !matches!(
                definition.compiled.normalized.program,
                crate::types::automation_definition::Program::Script(_)
            ) {
                continue;
            }
            let owner = ScriptOwnerId::routine(routine_id.0.clone());
            let current = self.coordinator.definition_revision(&owner);
            if current != Some(definition.revision) || !self.coordinator.is_enabled(&owner) {
                self.coordinator
                    .load_owner(&owner, definition.revision, Value::Null);
            }
            live.insert(owner.key());
        }
        for routine_id in legacy_script_owners {
            let owner = ScriptOwnerId::routine(routine_id.0.clone());
            self.coordinator
                .load_owner(&owner, LEGACY_DEFINITION_REVISION, Value::Null);
            live.insert(owner.key());
        }
        for (scene_id, revision) in scene_owners {
            let owner = ScriptOwnerId::scene(scene_id.to_string());
            let current = self.coordinator.definition_revision(&owner);
            if current != Some(*revision) || !self.coordinator.is_enabled(&owner) {
                self.coordinator.load_owner(&owner, *revision, Value::Null);
            }
            live.insert(owner.key());
        }

        let stale: Vec<ScriptOwnerId> = self
            .coordinator
            .owner_keys()
            .into_iter()
            .filter(|(key, kind)| {
                matches!(kind, OwnerKind::Routine | OwnerKind::Scene) && !live.contains(key)
            })
            .map(|(key, kind)| ScriptOwnerId {
                kind,
                id: key
                    .strip_prefix(&format!("{}:", kind.as_str()))
                    .map(str::to_string)
                    .unwrap_or(key),
            })
            .collect();
        for owner in stale {
            self.coordinator.remove_owner(&owner);
        }

        // Configuration reload is the retry point for a missing worker.
        self.pool_error = None;
    }

    /// Lazily create the worker pool. The first failure is cached so a missing
    /// binary degrades to a visible per-run failure instead of spawning on
    /// every frame; a configuration reload clears the cached error.
    pub async fn ensure_pool(&mut self) -> Result<Arc<JsWorkerPool>, String> {
        if let Some(pool) = &self.pool {
            return Ok(Arc::clone(pool));
        }
        if let Some(error) = &self.pool_error {
            return Err(error.clone());
        }
        let config = SupervisorConfig {
            worker_binary: self.worker_binary.clone(),
            ..SupervisorConfig::default()
        };
        match JsWorkerPool::new(config).await {
            Ok(pool) => {
                let pool = Arc::new(pool);
                self.pool = Some(Arc::clone(&pool));
                Ok(pool)
            }
            Err(error) => {
                let message = format!("script worker pool unavailable: {error}");
                self.pool_error = Some(message.clone());
                Err(message)
            }
        }
    }

    /// Build the immutable handler context for one invocation.
    ///
    /// `ctx.event` carries the coherent frame identify and mutations;
    /// `ctx.before`/`ctx.after` expose only declared and mutated devices, so an
    /// undeclared read is absent rather than silently observed, unless the
    /// script opts into the explicitly broad `AllState` declaration. Declared
    /// entities that are not discovered yet are simply absent until they
    /// appear (S13). Helpers are exposed with their declared kind, and owner
    /// memory/revision come from the coordinator (S11/S12/S14/S15).
    ///
    /// `now_ms` is the actor clock sampled when this coherent frame was
    /// created, frozen into the invocation so a queued worker sees frame time
    /// rather than its own start time (P09).
    #[allow(clippy::too_many_arguments)]
    pub fn build_handler_context(
        &mut self,
        owner: &ScriptOwnerId,
        spec: &ScriptSpec,
        frame: &FrameContext<'_>,
        frame_id: EventId,
        origin: EventOrigin,
        causation: EventCausation,
        now_ms: i64,
    ) -> Result<Value, String> {
        let mut broad_reads = false;
        let mut device_keys: BTreeSet<DeviceKey> = BTreeSet::new();
        for declaration in &spec.declarations {
            match declaration {
                ScriptDeclaration::Device { device } => {
                    let DeviceRef::Id(id_ref) = device;
                    device_keys.insert(id_ref.clone().into_device_key());
                }
                ScriptDeclaration::Group { group_id } => {
                    for device in frame.groups.find_group_devices(frame.after, group_id) {
                        device_keys.insert(device.get_device_key());
                    }
                }
                ScriptDeclaration::Timer { .. } => {}
                ScriptDeclaration::AllState => broad_reads = true,
            }
        }
        if broad_reads {
            // S14 compatibility mode: expose every device in the coherent
            // frame instead of an exact declaration. The set is still fixed
            // per invocation from the current frame, so a previous branch can
            // never narrow or widen it (S15).
            device_keys.extend(frame.before.0.keys().cloned());
            device_keys.extend(frame.after.0.keys().cloned());
        }
        for mutation in frame.mutations {
            device_keys.insert(mutation.device_key.clone());
        }

        let mut before_devices = Map::new();
        let mut after_devices = Map::new();
        for key in &device_keys {
            if let Some(device) = frame.before.0.get(key) {
                before_devices.insert(key.to_string(), device_json(device)?);
            }
            if let Some(device) = frame.after.0.get(key) {
                after_devices.insert(key.to_string(), device_json(device)?);
            }
        }

        let mut event_mutations = Vec::with_capacity(frame.mutations.len());
        for mutation in frame.mutations {
            let mut entry = Map::new();
            entry.insert(
                "device".to_string(),
                Value::String(mutation.device_key.to_string()),
            );
            entry.insert(
                "origin".to_string(),
                serde_json::to_value(mutation.origin)
                    .map_err(|error| format!("mutation origin is not serializable: {error}"))?,
            );
            entry.insert(
                "before".to_string(),
                match frame.before.0.get(&mutation.device_key) {
                    Some(device) => device_json(device)?,
                    None => Value::Null,
                },
            );
            entry.insert(
                "after".to_string(),
                match frame.after.0.get(&mutation.device_key) {
                    Some(device) => device_json(device)?,
                    None => Value::Null,
                },
            );
            event_mutations.push(Value::Object(entry));
        }

        let mut helpers = Map::new();
        if let Some(helpers_state) = frame.helpers {
            for status in helpers_state.statuses() {
                helpers.insert(
                    status.id.to_string(),
                    serde_json::json!({
                        "kind": status.kind.code(),
                        "value": status.value,
                    }),
                );
            }
        }

        let memory = self
            .coordinator
            .memory(owner)
            .cloned()
            .unwrap_or(Value::Null);
        let revision = self.coordinator.state_revision(owner).unwrap_or(0);

        self.invocation_counter = self.invocation_counter.wrapping_add(1);
        let seed = fnv1a(&format!(
            "{}:{}:{}",
            owner.key(),
            revision,
            self.invocation_counter
        ));

        Ok(serde_json::json!({
            "now_ms": now_ms,
            "seed": seed,
            "event": {
                "frame_id": frame_id,
                "origin": origin,
                "causation": causation,
                "mutations": event_mutations,
            },
            "before": { "devices": before_devices },
            "after": { "devices": after_devices },
            "values": { "helpers": helpers },
            "state": { "memory": memory, "revision": revision },
        }))
    }

    /// Build the context and admit a handler invocation. Admission failures
    /// (unknown owner, disabled owner, revision mismatch, queue bound) are
    /// returned as visible reasons; no worker is involved yet.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_handler_invocation(
        &mut self,
        routine_id: &RoutineId,
        definition_revision: i64,
        spec: &ScriptSpec,
        frame: &FrameContext<'_>,
        frame_id: EventId,
        origin: EventOrigin,
        causation: EventCausation,
        now_ms: i64,
    ) -> Result<PreparedScriptRun, String> {
        let owner = ScriptOwnerId::routine(routine_id.0.clone());
        let context =
            self.build_handler_context(&owner, spec, frame, frame_id, origin, causation, now_ms)?;
        let invocation = ScriptInvocation {
            owner,
            definition_revision,
            contract: super::script_contract::ScriptOutputContract::RoutineHandler,
            source_body: spec.source_body.clone(),
            context: context.clone(),
            coalesce: super::script_coordinator::CoalescePolicy::Queue,
            run_id: None,
        };
        match self.coordinator.submit(&invocation) {
            Ok(Admission::Accepted(token)) | Ok(Admission::Coalesced { token, .. }) => {
                Ok(PreparedScriptRun {
                    routine_id: routine_id.clone(),
                    token,
                    source_body: spec.source_body.clone(),
                    context,
                    causation,
                })
            }
            Err(error) => Err(admission_error_text(&error)),
        }
    }

    /// Admit one legacy rule-script leaf. Uses the same per-owner queues and
    /// generation checks as v2 handlers; admission failures are returned as
    /// visible reasons and never reach a worker.
    pub fn prepare_legacy_leaf(
        &mut self,
        routine_id: &RoutineId,
        script: String,
        context: Value,
    ) -> Result<PreparedLegacyLeaf, String> {
        let invocation = ScriptInvocation {
            owner: ScriptOwnerId::routine(routine_id.0.clone()),
            definition_revision: LEGACY_DEFINITION_REVISION,
            contract: super::script_contract::ScriptOutputContract::Condition,
            source_body: script.clone(),
            context: context.clone(),
            coalesce: super::script_coordinator::CoalescePolicy::Queue,
            run_id: None,
        };
        match self.coordinator.submit(&invocation) {
            Ok(Admission::Accepted(token)) | Ok(Admission::Coalesced { token, .. }) => {
                Ok(PreparedLegacyLeaf {
                    routine_id: routine_id.clone(),
                    token,
                    script,
                    context,
                })
            }
            Err(error) => Err(admission_error_text(&error)),
        }
    }

    /// Admit a legacy (v1) scene materialization. Scene refreshes coalesce to
    /// the latest revision (current-value recomputation), and admission
    /// failures are returned as visible reasons without reaching a worker.
    pub fn prepare_scene_materialization(
        &mut self,
        scene_id: &SceneId,
        definition_revision: i64,
        script: String,
        context: Value,
    ) -> Result<PreparedSceneMaterialization, String> {
        let invocation = ScriptInvocation {
            owner: ScriptOwnerId::scene(scene_id.to_string()),
            definition_revision,
            contract: super::script_contract::ScriptOutputContract::SceneMaterializer,
            source_body: script.clone(),
            context: context.clone(),
            coalesce: super::script_coordinator::CoalescePolicy::LatestWins,
            run_id: None,
        };
        match self.coordinator.submit(&invocation) {
            Ok(Admission::Accepted(token)) | Ok(Admission::Coalesced { token, .. }) => {
                Ok(PreparedSceneMaterialization {
                    scene_id: scene_id.clone(),
                    token,
                    script,
                    context,
                })
            }
            Err(error) => Err(admission_error_text(&error)),
        }
    }

    /// Complete one scene materialization event against the coordinator.
    #[allow(clippy::too_many_arguments)]
    pub fn complete_scene_materialization(
        &mut self,
        request_id: u64,
        owner_key: String,
        owner_generation: u64,
        definition_revision: i64,
        state_revision: u64,
        value: Option<Value>,
        error: Option<String>,
    ) -> SceneMaterializationCompletion {
        let token = InvocationToken {
            request_id,
            owner_key,
            owner_generation,
            definition_revision,
            state_revision,
            contract: super::script_contract::ScriptOutputContract::SceneMaterializer,
        };
        match (value, error) {
            (Some(value), _) => match self.coordinator.complete_legacy_scene(&token, &value) {
                CompleteResult::Applied { value, .. } => {
                    SceneMaterializationCompletion::Applied(value)
                }
                CompleteResult::Stale(reason) => SceneMaterializationCompletion::Stale(reason),
                CompleteResult::ContractError { message } => {
                    SceneMaterializationCompletion::Failed(message)
                }
            },
            (None, Some(message)) => match self.coordinator.abandon(&token) {
                Ok(()) => SceneMaterializationCompletion::Failed(message),
                Err(reason) => SceneMaterializationCompletion::Stale(reason),
            },
            (None, None) => SceneMaterializationCompletion::Failed(
                "scene worker returned no result".to_string(),
            ),
        }
    }

    /// Deliver a scene materialization result as an actor event.
    pub fn spawn_scene_materialization(
        &self,
        pool: Arc<JsWorkerPool>,
        event_tx: TxEventChannel,
        run: PreparedSceneMaterialization,
    ) {
        tokio::spawn(async move {
            let outcome = pool.execute_legacy_scene(&run.script, run.context).await;
            let (value, error) = match outcome {
                Ok(value) => (Some(value), None),
                Err(error) => (None, Some(bounded_text(&error.to_string()))),
            };
            event_tx
                .try_send(Event::SceneMaterializedResult {
                    scene_id: run.scene_id,
                    request_id: run.token.request_id,
                    owner_key: run.token.owner_key,
                    owner_generation: run.token.owner_generation,
                    definition_revision: run.token.definition_revision,
                    state_revision: run.token.state_revision,
                    value,
                    error,
                })
                .ok();
        });
    }

    /// Deliver a legacy leaf result as an actor event.
    pub fn spawn_legacy_execution(
        &self,
        pool: Arc<JsWorkerPool>,
        event_tx: TxEventChannel,
        run: PreparedLegacyLeaf,
    ) {
        tokio::spawn(async move {
            let outcome = pool.execute_legacy(&run.script, run.context).await;
            let (value, error) = match outcome {
                Ok(value) => (Some(value), None),
                Err(error) => (None, Some(bounded_text(&error.to_string()))),
            };
            event_tx
                .try_send(Event::RuleScriptLeafResult {
                    routine_id: run.routine_id,
                    request_id: run.token.request_id,
                    owner_key: run.token.owner_key,
                    owner_generation: run.token.owner_generation,
                    definition_revision: run.token.definition_revision,
                    state_revision: run.token.state_revision,
                    value,
                    error,
                })
                .ok();
        });
    }

    /// Deliver a handler result as an actor event. The spawned task only owns
    /// the shared pool and the event sender; it never touches `AppState`.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_handler_execution(
        &self,
        pool: Arc<JsWorkerPool>,
        event_tx: TxEventChannel,
        routine_id: RoutineId,
        token: InvocationToken,
        source_body: String,
        context: Value,
        causation: EventCausation,
    ) {
        tokio::spawn(async move {
            let outcome = pool.execute(&source_body, context).await;
            let (value, error) = match outcome {
                Ok(value) => (Some(value), None),
                Err(error) => (None, Some(bounded_text(&error.to_string()))),
            };
            event_tx
                .try_send(Event::RoutineScriptResult {
                    routine_id,
                    request_id: token.request_id,
                    owner_key: token.owner_key,
                    owner_generation: token.owner_generation,
                    definition_revision: token.definition_revision,
                    state_revision: token.state_revision,
                    causation,
                    value,
                    error,
                })
                .ok();
        });
    }
}

fn device_json(device: &Device) -> Result<Value, String> {
    serde_json::to_value(device).map_err(|error| format!("device is not serializable: {error}"))
}

fn admission_error_text(error: &AdmissionError) -> String {
    match error {
        AdmissionError::UnknownOwner => "script_admission_failed: owner not loaded".to_string(),
        AdmissionError::Disabled => "script_admission_failed: owner disabled".to_string(),
        AdmissionError::WrongRevision { expected } => {
            format!("script_admission_failed: definition revision mismatch (loaded {expected})")
        }
        AdmissionError::QueueFull { limit } => {
            format!("script_admission_failed: pending queue full (limit {limit})")
        }
    }
}

pub fn bounded_text(text: &str) -> String {
    if text.chars().count() <= MAX_SCRIPT_ERROR_CHARS {
        return text.to_string();
    }
    let mut bounded: String = text.chars().take(MAX_SCRIPT_ERROR_CHARS).collect();
    bounded.push_str("... (truncated)");
    bounded
}

fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::types::{
        automation_definition::{ScriptDeclaration, ScriptSpec},
        automation_event::{DeviceMutation, EventId, EventOrigin},
        color::Capabilities,
        device::{
            ControllableDevice, DeviceData, DeviceId, DeviceKey, DeviceRef, DevicesState,
            ManageKind,
        },
        integration::IntegrationId,
    };

    use super::super::evaluate::FrameContext;
    use super::super::script_coordinator::{CompleteResult, StaleReason};
    use super::*;
    use crate::core::groups::Groups;

    fn key(id: &str) -> DeviceKey {
        DeviceKey::new(IntegrationId::from("dummy".to_string()), DeviceId::new(id))
    }

    fn lamp(id: &str, power: bool) -> Device {
        Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                power,
                None,
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            )),
            None,
        )
    }

    fn states(devices: Vec<Device>) -> DevicesState {
        DevicesState(
            devices
                .into_iter()
                .map(|device| (device.get_device_key(), device))
                .collect(),
        )
    }

    fn spec(declarations: Vec<ScriptDeclaration>) -> ScriptSpec {
        ScriptSpec {
            api_version: 1,
            source_body: "return true;".to_string(),
            declarations,
            limits_profile: "default".to_string(),
        }
    }

    // S14/S15: the exposed device view is declaration-derived and independent
    // of any previous branch; undeclared devices are absent, not observed.
    #[test]
    fn context_exposes_declared_and_mutated_devices_only() {
        let mut scripts = ScriptExecution::default();
        let before = states(vec![lamp("lamp", false), lamp("other", false)]);
        let after = states(vec![lamp("lamp", true), lamp("other", false)]);
        let mutations = vec![DeviceMutation {
            event_id: EventId::default(),
            device_key: key("lamp"),
            before: Some(lamp("lamp", false)),
            after: lamp("lamp", true),
            origin: EventOrigin::Report,
        }];
        let frame = FrameContext {
            mutations: &mutations,
            before: &before,
            after: &after,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let declaration = ScriptDeclaration::Device {
            device: DeviceRef::from(&key("lamp")),
        };
        let context = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(vec![declaration]),
                &frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                1000,
            )
            .expect("context builds");

        assert_eq!(context["now_ms"], json!(1000));
        assert!(context["after"]["devices"]["dummy/lamp"].is_object());
        assert!(
            context["after"]["devices"].get("dummy/other").is_none(),
            "undeclared devices are not exposed"
        );
        assert!(context["before"]["devices"]["dummy/lamp"].is_object());
        assert_eq!(context["event"]["mutations"].as_array().unwrap().len(), 1);
    }

    // S14: an explicit broad compatibility declaration exposes the whole
    // current frame instead of narrowing to exact device declarations.
    #[test]
    fn all_state_declaration_opens_the_whole_frame() {
        let mut scripts = ScriptExecution::default();
        let before = states(vec![lamp("lamp", false), lamp("other", false)]);
        let after = states(vec![lamp("lamp", true), lamp("other", false)]);
        let mutations = vec![DeviceMutation {
            event_id: EventId::default(),
            device_key: key("lamp"),
            before: Some(lamp("lamp", false)),
            after: lamp("lamp", true),
            origin: EventOrigin::Report,
        }];
        let frame = FrameContext {
            mutations: &mutations,
            before: &before,
            after: &after,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let context = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(vec![ScriptDeclaration::AllState]),
                &frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                1000,
            )
            .expect("context builds");

        assert!(context["after"]["devices"]["dummy/lamp"].is_object());
        assert!(
            context["after"]["devices"]["dummy/other"].is_object(),
            "broad reads expose undeclared devices in the current frame"
        );
        assert!(context["before"]["devices"]["dummy/other"].is_object());
    }

    // S15: the exposed scope is derived from the current frame and
    // declarations only; a device observed by a previous invocation never
    // leaks into the next one.
    #[test]
    fn context_scope_never_inherits_previous_branch_reads() {
        let mut scripts = ScriptExecution::default();
        let declaration = ScriptDeclaration::Device {
            device: DeviceRef::from(&key("lamp")),
        };
        let before = states(vec![lamp("lamp", false), lamp("other", false)]);
        let after = states(vec![lamp("lamp", true), lamp("other", false)]);

        let first_mutations = vec![DeviceMutation {
            event_id: EventId::default(),
            device_key: key("other"),
            before: Some(lamp("other", false)),
            after: lamp("other", true),
            origin: EventOrigin::Report,
        }];
        let first_frame = FrameContext {
            mutations: &first_mutations,
            before: &before,
            after: &after,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let first = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(vec![declaration.clone()]),
                &first_frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                1000,
            )
            .unwrap();
        assert!(
            first["after"]["devices"]["dummy/other"].is_object(),
            "mutated devices are exposed for the triggering invocation"
        );

        let second_mutations = vec![DeviceMutation {
            event_id: EventId::default(),
            device_key: key("lamp"),
            before: Some(lamp("lamp", false)),
            after: lamp("lamp", true),
            origin: EventOrigin::Report,
        }];
        let second_frame = FrameContext {
            mutations: &second_mutations,
            before: &before,
            after: &after,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let second = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(vec![declaration]),
                &second_frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                1000,
            )
            .unwrap();
        assert!(
            second["after"]["devices"].get("dummy/other").is_none(),
            "the previous invocation's mutation does not widen the next scope"
        );
    }

    // S13: a declaration for an entity that is not discovered yet stays absent
    // (but tracked) until the entity appears in a later frame.
    #[test]
    fn declared_missing_entity_enters_the_context_once_present() {
        let mut scripts = ScriptExecution::default();
        let declaration = ScriptDeclaration::Device {
            device: DeviceRef::from(&key("future")),
        };

        let before = states(vec![lamp("lamp", false)]);
        let after = states(vec![lamp("lamp", false)]);
        let no_mutations: Vec<DeviceMutation> = Vec::new();
        let missing_frame = FrameContext {
            mutations: &no_mutations,
            before: &before,
            after: &after,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let missing = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(vec![declaration.clone()]),
                &missing_frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                1000,
            )
            .unwrap();
        assert!(
            missing["after"]["devices"].get("dummy/future").is_none(),
            "an undiscovered declared device has no state yet"
        );

        // Discovery: the same declaration now resolves against the frame.
        let discovered_before = states(vec![lamp("lamp", false), lamp("future", false)]);
        let discovered_after = states(vec![lamp("lamp", false), lamp("future", true)]);
        let discovered_frame = FrameContext {
            mutations: &no_mutations,
            before: &discovered_before,
            after: &discovered_after,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let discovered = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(vec![declaration]),
                &discovered_frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                1000,
            )
            .unwrap();
        assert!(
            discovered["after"]["devices"]["dummy/future"].is_object(),
            "the declared device is readable once discovery puts it in the frame"
        );
    }

    // S11 direction: the clock and seed are context inputs, not ambient state.
    #[test]
    fn context_clock_and_seed_are_injected() {
        let mut scripts = ScriptExecution::default();
        let devices = states(vec![lamp("lamp", false)]);
        let mutations = vec![DeviceMutation {
            event_id: EventId::default(),
            device_key: key("lamp"),
            before: Some(lamp("lamp", false)),
            after: lamp("lamp", false),
            origin: EventOrigin::Report,
        }];
        let frame = FrameContext {
            mutations: &mutations,
            before: &devices,
            after: &devices,
            groups: &Groups::new(Default::default()),
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
        };
        let first = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(Vec::new()),
                &frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                4242,
            )
            .unwrap();
        let second = scripts
            .build_handler_context(
                &ScriptOwnerId::routine("r"),
                &spec(Vec::new()),
                &frame,
                EventId::default(),
                EventOrigin::Report,
                EventCausation::default(),
                4242,
            )
            .unwrap();
        assert_eq!(first["now_ms"], json!(4242));
        assert_ne!(
            first["seed"], second["seed"],
            "each invocation gets its own deterministic seed input"
        );
    }

    #[test]
    fn sync_owners_tracks_revisions_and_removals() {
        use std::collections::BTreeMap;

        use super::super::runtime::V2Definition;

        fn definition(id: &str, revision: i64, script: bool) -> (RoutineId, V2Definition) {
            let program = if script {
                json!({ "kind": "script", "spec": {
                    "api_version": 1,
                    "source_body": "return true;",
                    "declarations": [],
                    "limits_profile": "default"
                }})
            } else {
                json!({ "kind": "native", "steps": [
                    { "action": "cancel_timer", "id": "step", "timer": "t" }
                ]})
            };
            let compiled = super::super::compile::compile_definition_value(
                &json!({
                    "triggers": [{ "kind": "state_change", "id": "trig",
                        "device": { "integration_id": "dummy", "device_id": "lamp" } }],
                    "condition": { "kind": "literal", "value": true },
                    "program": program,
                }),
                &super::super::compile::ConfigCatalog::default(),
            )
            .expect("definition compiles");
            (
                RoutineId(id.to_string()),
                V2Definition { revision, compiled },
            )
        }

        let mut scripts = ScriptExecution::default();
        let owners: BTreeMap<RoutineId, V2Definition> = [
            definition("scripted", 1, true),
            definition("native", 1, false),
        ]
        .into_iter()
        .collect();
        scripts.sync_owners(&owners, &BTreeSet::new(), &BTreeMap::new());
        let owner = ScriptOwnerId::routine("scripted");
        assert_eq!(scripts.coordinator().definition_revision(&owner), Some(1));
        assert_eq!(
            scripts
                .coordinator()
                .owner_kind(&ScriptOwnerId::routine("native")),
            None
        );

        let edited: BTreeMap<RoutineId, V2Definition> =
            [definition("scripted", 2, true)].into_iter().collect();
        scripts.sync_owners(&edited, &BTreeSet::new(), &BTreeMap::new());
        assert_eq!(scripts.coordinator().definition_revision(&owner), Some(2));

        scripts.sync_owners(&BTreeMap::new(), &BTreeSet::new(), &BTreeMap::new());
        assert_eq!(scripts.coordinator().owner_kind(&owner), None);
    }

    // Section 6.4: legacy owners are re-registered on every reconciliation so
    // a configuration reload invalidates in-flight v1 results.
    #[test]
    fn legacy_owners_reload_and_bump_generation() {
        let mut scripts = ScriptExecution::default();
        let legacy: BTreeSet<RoutineId> = [RoutineId("legacy".to_string())].into_iter().collect();
        scripts.sync_owners(&BTreeMap::new(), &legacy, &BTreeMap::new());

        let owner = ScriptOwnerId::routine("legacy");
        assert_eq!(
            scripts.coordinator().definition_revision(&owner),
            Some(LEGACY_DEFINITION_REVISION)
        );
        let prepared = scripts
            .prepare_legacy_leaf(
                &RoutineId("legacy".to_string()),
                "true".to_string(),
                json!({"devices": {}, "groups": {}}),
            )
            .expect("legacy leaf is admitted");
        assert_eq!(prepared.token.owner_generation, 1);

        scripts.sync_owners(&BTreeMap::new(), &legacy, &BTreeMap::new());
        let completed = scripts
            .coordinator_mut()
            .complete_condition(&prepared.token, &json!(true));
        assert_eq!(
            completed,
            CompleteResult::Stale(StaleReason::DefinitionChanged),
            "a reload rejects the in-flight legacy result"
        );

        scripts.sync_owners(&BTreeMap::new(), &BTreeSet::new(), &BTreeMap::new());
        assert_eq!(scripts.coordinator().owner_kind(&owner), None);
    }

    // SC06 direction: scene owners keep their generation while the script
    // revision is unchanged and reject in-flight results after an edit.
    #[test]
    fn scene_owners_track_revisions_and_reject_edited_scripts() {
        use crate::types::scene::SceneId;

        let mut scripts = ScriptExecution::default();
        let scene = SceneId::new("evening".to_string());
        let owners: BTreeMap<SceneId, i64> = [(scene.clone(), 1)].into_iter().collect();
        scripts.sync_owners(&BTreeMap::new(), &BTreeSet::new(), &owners);

        let owner = ScriptOwnerId::scene("evening");
        assert_eq!(scripts.coordinator().definition_revision(&owner), Some(1));
        let prepared = scripts
            .prepare_scene_materialization(
                &scene,
                1,
                "defineSceneScript(function () { return {}; })".to_string(),
                json!({"devices": {}, "groups": {}}),
            )
            .expect("scene materialization is admitted");
        assert_eq!(prepared.token.owner_generation, 1);
        assert_eq!(
            prepared.token.contract,
            super::super::script_contract::ScriptOutputContract::SceneMaterializer
        );

        // Unchanged revision: the generation (and the pending result) survive.
        scripts.sync_owners(&BTreeMap::new(), &BTreeSet::new(), &owners);
        let applied = scripts
            .coordinator_mut()
            .complete_legacy_scene(&prepared.token, &json!({"dummy/lamp": {"power": true}}));
        match applied {
            CompleteResult::Applied {
                value,
                state_applied,
            } => {
                assert_eq!(value["dummy/lamp"]["power"], json!(true));
                assert!(!state_applied);
            }
            other => panic!("expected applied result, got {other:?}"),
        }

        // Edited revision: the new owner generation rejects the old token.
        let edited: BTreeMap<SceneId, i64> = [(scene.clone(), 2)].into_iter().collect();
        scripts.sync_owners(&BTreeMap::new(), &BTreeSet::new(), &edited);
        let stale_token = scripts
            .prepare_scene_materialization(
                &scene,
                2,
                "defineSceneScript(function () { return {}; })".to_string(),
                json!({"devices": {}, "groups": {}}),
            )
            .expect("edited scene is admitted")
            .token;
        assert_eq!(stale_token.owner_generation, 2);
        let stale = scripts
            .coordinator_mut()
            .complete_legacy_scene(&prepared.token, &json!({}));
        assert_eq!(
            stale,
            CompleteResult::Stale(StaleReason::DefinitionChanged),
            "the previous generation's result is rejected after an edit"
        );

        // Removed scene scripts drop their owner entirely.
        scripts.sync_owners(&BTreeMap::new(), &BTreeSet::new(), &BTreeMap::new());
        assert_eq!(scripts.coordinator().owner_kind(&owner), None);
    }
}
