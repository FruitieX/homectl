use color_eyre::Result;
use eyre::ContextCompat;
use regex::Regex;
use serde_json::Value;

use crate::db::config_queries;
use crate::types::{
    action::{Action, Actions},
    automation_event::{DeviceMutation, EventCausation, EventId, EventOrigin, MAX_CAUSATION_DEPTH},
    automation_trace::{PlannedRunStatus, TruthValue},
    device::{Device, DeviceKey, DeviceRef, DevicesState, SensorDevice},
    dim::DimDescriptor,
    event::{Event, TxEventChannel},
    group::GroupId,
    routine_status::{RoutineRuntimeStatus, RoutineStatuses, RuleRuntimeStatus},
    rule::{
        AnyRule, DeviceRule, GroupRule, RawRule, RawRuleOperator, Routine, RoutineId,
        RoutinesConfig, Rule, ScriptRule, SensorRule, TriggerMode,
    },
    scene::{ActivateSceneActionDescriptor, CycleScenesDescriptor},
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
};

use super::{
    automation::{
        self, ConfigCatalog, FrameContext, PlanInputs, RoutineFrameEvaluation, RoutinePlan,
        V2Definition, V2Runtime,
    },
    devices::Devices,
    groups::Groups,
    helpers::Helpers,
    routine_history,
    routine_validation::{self, RoutineValidationReport},
    scripting::ScriptEngine,
};

const TRIGGERING_DEVICE_ROLLOUT_SOURCE: &str = "__homectl_runtime__/triggering_device";

/// Merges `source_groups` into `group_keys` (without duplicates), sets the
/// option to `Some(..)` if anything was merged.
fn merge_source_groups(group_keys: &mut Option<Vec<GroupId>>, source_groups: &[GroupId]) {
    if source_groups.is_empty() {
        return;
    }

    let existing = group_keys.take().unwrap_or_default();
    let mut seen: HashSet<GroupId> = existing.iter().cloned().collect();
    let mut merged = existing;
    for group_id in source_groups {
        if seen.insert(group_id.clone()) {
            merged.push(group_id.clone());
        }
    }
    *group_keys = Some(merged);
}

fn resolve_triggering_device_rollout_source(
    rollout_source_device_key: &mut Option<DeviceKey>,
    event_source: Option<&DeviceKey>,
) {
    let Some(existing) = rollout_source_device_key.as_ref() else {
        return;
    };

    if existing.to_string() != TRIGGERING_DEVICE_ROLLOUT_SOURCE {
        return;
    }

    *rollout_source_device_key = event_source.cloned();
}

/// Rewrites an action so that any descriptor requesting event-source-derived
/// values is expanded before dispatch. This currently covers source-group
/// filters and the special rollout source value that maps to the rule's
/// triggering device.
fn expand_action_source_context(
    mut action: Action,
    event_source: Option<&DeviceKey>,
    groups: &Groups,
) -> Action {
    let source_groups: Vec<GroupId> = match event_source {
        Some(device_key) => groups.groups_containing_device(device_key),
        None => Vec::new(),
    };

    match &mut action {
        Action::ActivateScene(ActivateSceneActionDescriptor {
            group_keys,
            include_source_groups,
            rollout_source_device_key,
            ..
        }) => {
            if *include_source_groups {
                merge_source_groups(group_keys, &source_groups);
                *include_source_groups = false;
            }

            resolve_triggering_device_rollout_source(rollout_source_device_key, event_source);
        }
        Action::CycleScenes(CycleScenesDescriptor {
            group_keys,
            include_source_groups,
            rollout_source_device_key,
            scenes,
            ..
        }) => {
            if *include_source_groups {
                merge_source_groups(group_keys, &source_groups);
                for scene in scenes.iter_mut() {
                    merge_source_groups(&mut scene.group_keys, &source_groups);
                }
                *include_source_groups = false;
            }

            resolve_triggering_device_rollout_source(rollout_source_device_key, event_source);
        }
        Action::Dim(DimDescriptor {
            group_keys,
            include_source_groups,
            ..
        }) if *include_source_groups => {
            merge_source_groups(group_keys, &source_groups);
            *include_source_groups = false;
        }
        _ => {}
    }

    action
}

#[derive(Clone)]
pub struct Routines {
    config: RoutinesConfig,
    event_tx: TxEventChannel,
    runtime_statuses: Arc<RoutineStatuses>,
    /// Tracks which (routine_id, device_key) pairs have been triggered.
    /// Used for edge-triggered rules to prevent re-triggering until state changes away.
    prev_edge_triggered: HashSet<(RoutineId, DeviceKey)>,
    /// Enabled routine rows that failed validation. They are retained (the raw
    /// rows stay in `runtime_config`) but are not runnable, and their errors are
    /// surfaced through `get_runtime_statuses`.
    quarantined: HashMap<RoutineId, RoutineValidationReport>,
    /// P04: compiled v2 definitions, transition memory, and evaluation
    /// statuses. Native evaluation runs, but decisions are not executed until
    /// P05 wires the action planner.
    v2: V2Runtime,
}

struct RuleEvaluationContext<'a> {
    event_source: Option<&'a DeviceKey>,
    old_event_source: Option<&'a Device>,
    /// The coherent device view for this evaluation. For a queued internal
    /// update this is the transaction's own `after` state for the event source
    /// device, not necessarily the latest `Devices` snapshot. See `P02`.
    devices_state: &'a DevicesState,
    groups: &'a Groups,
    update_edge_state: bool,
    /// Whether this evaluation is an actual dispatch and may record routine
    /// history. Status refresh/preview passes must not write history.
    record_history: bool,
    /// P02: origin of the frame being evaluated, for trace/status metadata.
    origin: EventOrigin,
    /// P02: causation reaching this frame. Actions dispatched here get a child
    /// causation pointing at `frame_id`.
    causation: EventCausation,
    /// P02: identity of the frame being evaluated, if any.
    frame_id: Option<EventId>,
    /// P02: seed transition memory from current state without firing. Used at
    /// startup and configuration reload (E06).
    seed_only: bool,
}

impl RuleEvaluationContext<'_> {
    fn old_device_for(&self, device_key: &DeviceKey) -> Option<&Device> {
        if self.event_source == Some(device_key) {
            self.old_event_source
        } else {
            self.devices_state.0.get(device_key)
        }
    }

    /// Causation to stamp on actions dispatched while evaluating this frame.
    fn child_causation(&self) -> EventCausation {
        match self.frame_id {
            Some(frame_id) => EventCausation::child_of(frame_id, self.causation),
            None => self.causation,
        }
    }
}

fn device_by_ref<'a>(state: &'a DevicesState, device_ref: &DeviceRef) -> Option<&'a Device> {
    let device_key = match device_ref {
        DeviceRef::Id(id_ref) => id_ref.clone().into_device_key(),
    };
    state.0.get(&device_key)
}

#[derive(Default)]
struct EvaluationResult {
    actions: Actions,
    statuses: RoutineStatuses,
}

/// Outcome of evaluating one mutation: how many routine actions were
/// dispatched, and how many were suppressed by the causal depth bound.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RoutineDispatchSummary {
    pub dispatched: usize,
    pub suppressed: usize,
}

impl RoutineDispatchSummary {
    pub fn is_empty(&self) -> bool {
        self.dispatched == 0 && self.suppressed == 0
    }
}

impl RuleRuntimeStatus {
    fn from_match(condition_match: bool, trigger_match: bool) -> Self {
        Self {
            condition_match,
            trigger_match,
            error: None,
            children: None,
        }
    }

    fn from_children(
        condition_match: bool,
        trigger_match: bool,
        children: Vec<RuleRuntimeStatus>,
    ) -> Self {
        Self {
            condition_match,
            trigger_match,
            error: None,
            children: Some(children),
        }
    }

    fn from_error(error: impl Into<String>) -> Self {
        Self {
            condition_match: false,
            trigger_match: false,
            error: Some(error.into()),
            children: None,
        }
    }
}

impl Routines {
    pub fn new(config: RoutinesConfig, event_tx: TxEventChannel) -> Self {
        Routines {
            config,
            event_tx,
            runtime_statuses: Arc::new(RoutineStatuses::default()),
            prev_edge_triggered: HashSet::new(),
            quarantined: HashMap::new(),
            v2: V2Runtime::default(),
        }
    }

    /// Load routines with the authoritative semantics-version dispatch.
    ///
    /// v1 rows keep the legacy validator; v2 rows are compiled by the shared
    /// compiler. Unknown versions are quarantined and never interpreted as v1.
    /// `catalog` is permissive about devices at runtime load because
    /// integrations register devices asynchronously.
    pub fn load_config_rows(
        &mut self,
        routines: &[config_queries::RoutineRow],
        catalog: &ConfigCatalog,
    ) {
        use crate::types::automation_definition::RoutineSemantics;

        let mut new_config = RoutinesConfig::new();
        let mut quarantined = HashMap::new();
        let mut compiled_v2 = BTreeMap::new();
        for routine in routines {
            if !routine.enabled {
                // Disabled rows stay in `runtime_config` for display/edit and
                // are deliberately not validated or run.
                continue;
            }

            match automation::row_semantics(routine) {
                RoutineSemantics::V1 => {
                    let rules = match routine_validation::validate_rules_value(&routine.rules) {
                        Ok(rules) => rules,
                        Err(report) => {
                            warn!(
                                "Quarantining enabled routine {}: {}",
                                routine.id,
                                report.summary()
                            );
                            quarantined.insert(RoutineId::from(routine.id.clone()), report);
                            continue;
                        }
                    };
                    let actions = match routine_validation::validate_actions_value(&routine.actions)
                    {
                        Ok(actions) => actions,
                        Err(report) => {
                            warn!(
                                "Quarantining enabled routine {}: {}",
                                routine.id,
                                report.summary()
                            );
                            quarantined.insert(RoutineId::from(routine.id.clone()), report);
                            continue;
                        }
                    };

                    new_config.insert(
                        RoutineId::from(routine.id.clone()),
                        Routine {
                            name: routine.name.clone(),
                            rules,
                            actions,
                        },
                    );
                }
                RoutineSemantics::V2 => match automation::compile_row(routine, catalog) {
                    Ok(automation::CompiledRoutine::V2(compiled)) => {
                        compiled_v2.insert(
                            RoutineId::from(routine.id.clone()),
                            V2Definition {
                                revision: routine.revision,
                                compiled: *compiled,
                            },
                        );
                    }
                    Ok(automation::CompiledRoutine::V1(_)) => {
                        unreachable!("v2 row compiled through the v1 validator")
                    }
                    Err(report) => {
                        warn!(
                            "Quarantining enabled v2 routine {}: {}",
                            routine.id,
                            report.summary()
                        );
                        quarantined.insert(RoutineId::from(routine.id.clone()), report);
                    }
                },
                RoutineSemantics::Unknown(version) => {
                    let mut report = RoutineValidationReport::default();
                    report.error(
                        "/semantics_version",
                        "unsupported_semantics_version",
                        format!(
                            "Unsupported routine semantics version {version}; this build supports versions 1 and 2."
                        ),
                    );
                    warn!(
                        "Quarantining enabled routine {} with unsupported semantics version {version}",
                        routine.id
                    );
                    quarantined.insert(RoutineId::from(routine.id.clone()), report);
                }
            }
        }

        self.config = new_config;
        self.quarantined = quarantined;
        self.v2.load(compiled_v2);
        self.runtime_statuses = Arc::new(RoutineStatuses::default());
        self.prev_edge_triggered.clear();
    }

    /// Enabled routines that failed validation and are therefore not runnable.
    pub fn quarantined_routines(&self) -> &HashMap<RoutineId, RoutineValidationReport> {
        &self.quarantined
    }

    /// Compiled v2 definitions by routine id.
    pub fn compiled_v2_routines(&self) -> &BTreeMap<RoutineId, V2Definition> {
        self.v2.definitions()
    }

    /// Hot-reload routines configuration from the database
    pub async fn reload_from_db(&mut self, catalog: &ConfigCatalog) -> Result<()> {
        let db_routines = config_queries::db_get_routines().await?;

        self.load_config_rows(&db_routines, catalog);

        Ok(())
    }

    pub fn refresh_runtime_statuses(
        &mut self,
        devices: &Devices,
        groups: &Groups,
        helpers: Option<&Helpers>,
    ) {
        let ctx = RuleEvaluationContext {
            event_source: None,
            old_event_source: None,
            devices_state: devices.get_state(),
            groups,
            update_edge_state: false,
            record_history: false,
            origin: EventOrigin::Derived,
            causation: EventCausation::default(),
            frame_id: None,
            seed_only: false,
        };
        let mut statuses = self.evaluate_routines(&ctx).statuses;

        // Surface quarantined routines as visible, non-runnable errors.
        for (routine_id, report) in &self.quarantined {
            statuses.0.insert(
                routine_id.clone(),
                RoutineRuntimeStatus {
                    all_conditions_match: false,
                    will_trigger: false,
                    rules: report
                        .errors
                        .iter()
                        .map(|error| {
                            RuleRuntimeStatus::from_error(format!(
                                "{}: {}",
                                error.path, error.message
                            ))
                        })
                        .collect(),
                    v2: None,
                },
            );
        }

        // P04: v2 conditions are evaluated against current state for status
        // display; transition memory and matched triggers are untouched.
        self.v2
            .refresh_statuses(devices.get_state(), groups, helpers);
        for (routine_id, v2_status) in self.v2.statuses() {
            statuses.0.insert(
                routine_id.clone(),
                RoutineRuntimeStatus {
                    all_conditions_match: !v2_status.condition.is_error()
                        && v2_status.condition.truth == TruthValue::True,
                    will_trigger: v2_status.will_trigger,
                    rules: v2_status
                        .triggers
                        .iter()
                        .map(|trigger| RuleRuntimeStatus {
                            condition_match: v2_status.condition.truth.is_true(),
                            trigger_match: trigger.fired,
                            error: trigger.error.clone(),
                            children: None,
                        })
                        .collect(),
                    v2: Some(v2_status.clone()),
                },
            );
        }

        self.runtime_statuses = Arc::new(statuses);
    }

    pub fn get_runtime_statuses(&self) -> Arc<RoutineStatuses> {
        Arc::clone(&self.runtime_statuses)
    }

    /// Evaluate one coherent mutation from an actor transaction. The mutation's
    /// own `before`/`after` supplies the event source frame even when newer
    /// reports have already landed in `devices` (P02 E01 coherence).
    /// Returns whether actions were dispatched or suppressed by the causal
    /// depth bound.
    pub async fn handle_internal_state_update(
        &mut self,
        mutation: &DeviceMutation,
        devices: &Devices,
        groups: &Groups,
        origin: EventOrigin,
        causation: EventCausation,
        frame_id: Option<EventId>,
    ) -> RoutineDispatchSummary {
        let event_source_key = &mutation.device_key;
        let event_source = &mutation.after;

        // For sensors in pulse mode, we need to process even when the device
        // already exists and state hasn't changed. Skip only for truly new
        // non-sensor devices.
        if mutation.before.is_some() || event_source.is_sensor() {
            let mut coherent_state = devices.get_state().clone();
            coherent_state
                .0
                .insert(event_source_key.clone(), event_source.clone());
            let suppressed = causation.depth > MAX_CAUSATION_DEPTH;
            let ctx = RuleEvaluationContext {
                event_source: Some(event_source_key),
                old_event_source: mutation.before.as_ref(),
                devices_state: &coherent_state,
                groups,
                update_edge_state: true,
                record_history: true,
                origin,
                causation,
                frame_id,
                seed_only: false,
            };
            let evaluation = self.evaluate_routines(&ctx);
            self.runtime_statuses = Arc::new(evaluation.statuses);

            if suppressed {
                if !evaluation.actions.is_empty() {
                    warn!(
                        "Causation limit {MAX_CAUSATION_DEPTH} reached at routine evaluation; \
                         suppressing {} action(s) (origin={origin:?}, cause={:?})",
                        evaluation.actions.len(),
                        causation.cause_id
                    );
                }
                return RoutineDispatchSummary {
                    dispatched: 0,
                    suppressed: evaluation.actions.len(),
                };
            }

            let dispatched = evaluation.actions.len();
            for action in evaluation.actions {
                self.event_tx.send(Event::RoutineAction {
                    action: action.clone(),
                    causation: ctx.child_causation(),
                });
            }

            RoutineDispatchSummary {
                dispatched,
                suppressed: 0,
            }
        } else {
            self.refresh_runtime_statuses(devices, groups, None);
            RoutineDispatchSummary::default()
        }
    }

    /// Seed transition memory from current state without firing. Called at
    /// startup and configuration reload so an already-true predicate is not
    /// treated as a fresh edge (E06). Does not touch runtime statuses or
    /// history.
    pub fn seed_transitions(
        &mut self,
        devices: &Devices,
        groups: &Groups,
        helpers: Option<&Helpers>,
    ) {
        let ctx = RuleEvaluationContext {
            event_source: None,
            old_event_source: None,
            devices_state: devices.get_state(),
            groups,
            update_edge_state: false,
            record_history: false,
            origin: EventOrigin::Startup,
            causation: EventCausation::default(),
            frame_id: None,
            seed_only: true,
        };
        let _ = self.evaluate_routines(&ctx);
        self.v2.seed(devices.get_state(), groups, helpers);
    }

    /// Evaluate all v2 routines against one coherent actor frame. P04 records
    /// decisions and per-trigger memory; P05 plans and dispatches actions from
    /// the returned evaluations.
    pub fn handle_v2_frame(&mut self, frame: &FrameContext<'_>) -> Vec<RoutineFrameEvaluation> {
        if self.v2.is_empty() {
            return Vec::new();
        }
        let evaluations = self.v2.evaluate_frame(frame);
        for evaluation in &evaluations {
            if evaluation.will_trigger {
                info!(
                    "v2 routine matched: id={} triggers={:?}",
                    evaluation.routine_id.0,
                    evaluation
                        .matched_trigger_ids
                        .iter()
                        .map(|id| id.0.as_str())
                        .collect::<Vec<_>>()
                );
            }
        }
        evaluations
    }

    /// Plan every triggered evaluation against acceptance-time state. The
    /// returned plans are pure; the actor dispatches them (P05).
    pub fn plan_v2_runs(
        &mut self,
        evaluations: &[RoutineFrameEvaluation],
        inputs: &PlanInputs<'_>,
    ) -> Vec<RoutinePlan> {
        self.v2.plan_runs(evaluations, inputs)
    }

    /// Record the dispatched outcome of one v2 run for status displays (X03).
    pub fn record_v2_run(&mut self, routine_id: &RoutineId, status: PlannedRunStatus) {
        self.v2.record_run(routine_id, status);
    }

    /// The declared script spec for a compiled v2 script program, if any.
    pub fn script_spec(
        &self,
        routine_id: &RoutineId,
    ) -> Option<&crate::types::automation_definition::ScriptSpec> {
        let definition = self.v2.definitions().get(routine_id)?;
        match &definition.compiled.normalized.program {
            crate::types::automation_definition::Program::Script(program) => Some(&program.spec),
            crate::types::automation_definition::Program::Native(_) => None,
        }
    }

    /// Plan the typed actions returned by a script handler at result-acceptance
    /// time (P07).
    pub fn plan_v2_script_run(
        &mut self,
        routine_id: &RoutineId,
        actions: &[crate::types::automation_definition::NativeAction],
        inputs: &PlanInputs<'_>,
    ) -> Option<RoutinePlan> {
        self.v2.plan_script_run(routine_id, actions, inputs)
    }

    /// Record a visible rejected script run (worker failure, stale result, or
    /// contract error) for status displays.
    pub fn record_v2_script_failure(&mut self, routine_id: &RoutineId, reason: String) {
        self.v2.record_script_failure(routine_id, reason);
    }

    pub fn force_trigger_routine(
        &self,
        routine_id: &RoutineId,
        causation: Option<EventCausation>,
    ) -> Result<()> {
        let routine = self
            .config
            .get(routine_id)
            .with_context(|| eyre!("Routine not found"))?;

        let routine_actions = routine.actions.clone();

        info!(
            "Routine force-triggered: id={} name={:?} actions={}",
            routine_id.0,
            routine.name,
            routine_actions.len(),
        );

        routine_history::record_force_trigger(
            routine_id,
            &routine.name,
            routine_actions.len(),
            self.runtime_statuses.0.get(routine_id),
        );

        let causation = causation.unwrap_or_default();
        for action in routine_actions {
            self.event_tx.send(Event::RoutineAction {
                action: action.clone(),
                causation,
            });
        }

        Ok(())
    }

    fn evaluate_routines(&mut self, ctx: &RuleEvaluationContext<'_>) -> EvaluationResult {
        let mut triggered_actions = Vec::new();
        let mut routine_statuses = HashMap::new();

        let routine_ids: Vec<RoutineId> = self.config.keys().cloned().collect();

        for routine_id in routine_ids {
            let routine = self.config.get(&routine_id).unwrap().clone();
            let status = self.evaluate_routine_status(&routine_id, &routine, ctx);

            if status.will_trigger {
                // Only real dispatch records history. Status refresh/preview
                // evaluations must not advance the fired-history log.
                if ctx.record_history {
                    info!(
                        "Routine triggered: id={} name={:?} actions={} event_source={:?} origin={:?}",
                        routine_id.0,
                        routine.name,
                        routine.actions.len(),
                        ctx.event_source,
                        ctx.origin,
                    );
                    routine_history::record_rule_match(
                        &routine_id,
                        &routine.name,
                        ctx.event_source,
                        routine.actions.len(),
                        &status,
                    );
                }
                if !ctx.seed_only {
                    triggered_actions.extend(routine.actions.iter().cloned().map(|action| {
                        expand_action_source_context(action, ctx.event_source, ctx.groups)
                    }));
                }
            }

            routine_statuses.insert(routine_id, status);
        }

        EvaluationResult {
            actions: triggered_actions,
            statuses: RoutineStatuses(routine_statuses),
        }
    }

    fn evaluate_routine_status(
        &mut self,
        routine_id: &RoutineId,
        routine: &Routine,
        ctx: &RuleEvaluationContext<'_>,
    ) -> RoutineRuntimeStatus {
        let rule_statuses = routine
            .rules
            .iter()
            .map(|rule| self.evaluate_rule_status(routine_id, rule, ctx))
            .collect::<Vec<_>>();

        let all_conditions_match =
            !rule_statuses.is_empty() && rule_statuses.iter().all(|status| status.condition_match);
        let will_trigger =
            !rule_statuses.is_empty() && rule_statuses.iter().all(|status| status.trigger_match);

        RoutineRuntimeStatus {
            all_conditions_match,
            will_trigger,
            rules: rule_statuses,
            v2: None,
        }
    }

    fn evaluate_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &Rule,
        ctx: &RuleEvaluationContext<'_>,
    ) -> RuleRuntimeStatus {
        match self.try_evaluate_rule_status(routine_id, rule, ctx) {
            Ok(status) => status,
            Err(error) => {
                error!("Routine rule evaluation error: {error}");
                RuleRuntimeStatus::from_error(error.to_string())
            }
        }
    }

    #[allow(clippy::only_used_in_recursion)]
    fn try_evaluate_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &Rule,
        ctx: &RuleEvaluationContext<'_>,
    ) -> Result<RuleRuntimeStatus> {
        match rule {
            Rule::Any(AnyRule { any: rules }) => {
                let children = rules
                    .iter()
                    .map(|child_rule| self.evaluate_rule_status(routine_id, child_rule, ctx))
                    .collect::<Vec<_>>();

                Ok(RuleRuntimeStatus::from_children(
                    children.iter().any(|status| status.condition_match),
                    children.iter().any(|status| status.trigger_match),
                    children,
                ))
            }
            Rule::Sensor(sensor_rule) => {
                self.evaluate_sensor_rule_status(routine_id, sensor_rule, ctx)
            }
            Rule::Raw(raw_rule) => self.evaluate_raw_rule_status(routine_id, raw_rule, ctx),
            Rule::Device(device_rule) => {
                self.evaluate_device_rule_status(routine_id, device_rule, ctx)
            }
            Rule::Group(group_rule) => self.evaluate_group_rule_status(routine_id, group_rule, ctx),
            Rule::EvalExpr(expr) => Err(eyre!(
                "Legacy evalexpr rules are no longer supported: {expr}"
            )),
            Rule::Script(ScriptRule { script }) => {
                let mut engine = ScriptEngine::new();
                let device_state = ctx.devices_state;
                let flattened_groups = ctx.groups.get_flattened_groups();
                match engine.eval_rule_script(script, device_state, flattened_groups) {
                    Ok(result) => Ok(RuleRuntimeStatus::from_match(result, result)),
                    Err(error) => Err(eyre!("Script rule evaluation error: {error}")),
                }
            }
        }
    }

    fn evaluate_sensor_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &SensorRule,
        ctx: &RuleEvaluationContext<'_>,
    ) -> Result<RuleRuntimeStatus> {
        let device = device_by_ref(ctx.devices_state, &rule.device_ref)
            .ok_or_else(|| eyre!("Could not find matching sensor for rule: {:?}", rule))?;

        let device_key = device.get_device_key();
        let sensor_state = device.get_sensor_state();

        // Check if the current state matches the rule
        let state_matches = match (&rule.state, sensor_state) {
            (
                SensorDevice::Boolean { value: rule_value },
                Some(SensorDevice::Boolean {
                    value: sensor_value,
                }),
            ) => rule_value == sensor_value,
            (
                SensorDevice::Text { value: rule_value },
                Some(SensorDevice::Text {
                    value: sensor_value,
                }),
            ) => rule_value == sensor_value,
            _ => false,
        };

        if !state_matches {
            if ctx.update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        if ctx.seed_only {
            if rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .insert((routine_id.clone(), device_key.clone()));
            }
            return Ok(RuleRuntimeStatus::from_match(true, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => ctx
                .event_source
                .map(|es| es == &device_key)
                .unwrap_or(false),
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    false
                } else {
                    let is_event_source = ctx
                        .event_source
                        .map(|es| es == &device_key)
                        .unwrap_or(false);
                    if !is_event_source {
                        false
                    } else {
                        let old_device = ctx.old_device_for(&device_key);
                        let old_matched = old_device
                            .map(|d| match (&rule.state, d.get_sensor_state()) {
                                (
                                    SensorDevice::Boolean { value: rule_value },
                                    Some(SensorDevice::Boolean {
                                        value: sensor_value,
                                    }),
                                ) => rule_value == sensor_value,
                                (
                                    SensorDevice::Text { value: rule_value },
                                    Some(SensorDevice::Text {
                                        value: sensor_value,
                                    }),
                                ) => rule_value == sensor_value,
                                _ => false,
                            })
                            .unwrap_or(false);

                        let trigger_match = !old_matched;
                        if trigger_match && ctx.update_edge_state {
                            self.prev_edge_triggered.insert(edge_key);
                        }
                        trigger_match
                    }
                }
            }
            TriggerMode::Level => true,
        };

        Ok(RuleRuntimeStatus::from_match(true, trigger_match))
    }

    fn evaluate_raw_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &RawRule,
        ctx: &RuleEvaluationContext<'_>,
    ) -> Result<RuleRuntimeStatus> {
        let device = device_by_ref(ctx.devices_state, &rule.device_ref)
            .ok_or_else(|| eyre!("Could not find matching device for raw rule: {:?}", rule))?;

        let device_key = device.get_device_key();
        let state_matches = evaluate_raw_rule_match(device.get_raw_value().as_ref(), rule)?;

        if !state_matches {
            if ctx.update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        if ctx.seed_only {
            if rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .insert((routine_id.clone(), device_key.clone()));
            }
            return Ok(RuleRuntimeStatus::from_match(true, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => ctx
                .event_source
                .map(|es| es == &device_key)
                .unwrap_or(false),
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    false
                } else {
                    let is_event_source = ctx
                        .event_source
                        .map(|es| es == &device_key)
                        .unwrap_or(false);
                    if !is_event_source {
                        false
                    } else {
                        let old_device = ctx.old_device_for(&device_key);
                        let old_matched = match old_device {
                            Some(device) => {
                                evaluate_raw_rule_match(device.get_raw_value().as_ref(), rule)?
                            }
                            None => false,
                        };

                        let trigger_match = !old_matched;
                        if trigger_match && ctx.update_edge_state {
                            self.prev_edge_triggered.insert(edge_key);
                        }
                        trigger_match
                    }
                }
            }
            TriggerMode::Level => true,
        };

        Ok(RuleRuntimeStatus::from_match(true, trigger_match))
    }

    fn evaluate_device_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &DeviceRule,
        ctx: &RuleEvaluationContext<'_>,
    ) -> Result<RuleRuntimeStatus> {
        let device = device_by_ref(ctx.devices_state, &rule.device_ref)
            .ok_or_else(|| eyre!("Could not find matching device for rule: {:?}", rule))?;

        let device_key = device.get_device_key();

        let state_matches = check_device_state_matches(device, &rule.scene, &rule.power);

        if !state_matches {
            if ctx.update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        if ctx.seed_only {
            if rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .insert((routine_id.clone(), device_key.clone()));
            }
            return Ok(RuleRuntimeStatus::from_match(true, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => ctx
                .event_source
                .map(|es| es == &device_key)
                .unwrap_or(false),
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    false
                } else {
                    let is_event_source = ctx
                        .event_source
                        .map(|es| es == &device_key)
                        .unwrap_or(false);
                    if !is_event_source {
                        false
                    } else {
                        let old_device = ctx.old_device_for(&device_key);
                        let old_matched = old_device
                            .map(|d| check_device_state_matches(d, &rule.scene, &rule.power))
                            .unwrap_or(false);

                        let trigger_match = !old_matched;
                        if trigger_match && ctx.update_edge_state {
                            self.prev_edge_triggered.insert(edge_key);
                        }
                        trigger_match
                    }
                }
            }
            TriggerMode::Level => true,
        };

        Ok(RuleRuntimeStatus::from_match(true, trigger_match))
    }

    fn evaluate_group_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &GroupRule,
        ctx: &RuleEvaluationContext<'_>,
    ) -> Result<RuleRuntimeStatus> {
        let group_devices = ctx
            .groups
            .find_group_devices(ctx.devices_state, &rule.group_id);

        if group_devices.is_empty() {
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let all_match = group_devices
            .iter()
            .all(|device| check_device_state_matches(device, &rule.scene, &rule.power));

        if !all_match {
            if ctx.update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                for device in &group_devices {
                    self.prev_edge_triggered
                        .remove(&(routine_id.clone(), device.get_device_key()));
                }
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => group_devices.iter().any(|device| {
                ctx.event_source
                    .map(|es| es == &device.get_device_key())
                    .unwrap_or(false)
            }),
            TriggerMode::Edge => {
                let any_is_source = group_devices.iter().any(|device| {
                    ctx.event_source
                        .map(|es| es == &device.get_device_key())
                        .unwrap_or(false)
                });

                if !any_is_source {
                    false
                } else {
                    let old_all_matched = group_devices.iter().all(|device| {
                        let device_key = device.get_device_key();
                        ctx.old_device_for(&device_key)
                            .map(|d| check_device_state_matches(d, &rule.scene, &rule.power))
                            .unwrap_or(false)
                    });

                    !old_all_matched
                }
            }
            TriggerMode::Level => true,
        };

        Ok(RuleRuntimeStatus::from_match(true, trigger_match))
    }
}

/// Helper function to check if a device matches scene/power criteria.
fn check_device_state_matches(
    device: &Device,
    scene: &Option<crate::types::scene::SceneId>,
    power: &Option<bool>,
) -> bool {
    // Check for scene field mismatch (if provided)
    if scene.is_some() && scene.as_ref() != device.get_scene_id().as_ref() {
        return false;
    }
    // Check for power field mismatch (if provided)
    if power.is_some() && power != &device.is_powered_on() {
        return false;
    }
    true
}

fn evaluate_raw_rule_match(raw: Option<&Value>, rule: &RawRule) -> Result<bool> {
    let Some(raw) = raw else {
        return Ok(false);
    };

    let resolved = rule.path.resolve(raw);

    match rule.operator {
        RawRuleOperator::Exists => Ok(resolved.is_ok()),
        RawRuleOperator::Truthy => Ok(resolved.map(is_json_truthy).unwrap_or(false)),
        _ => {
            let Ok(resolved) = resolved else {
                return Ok(false);
            };
            let expected = rule.value.as_ref().ok_or_else(|| {
                eyre!(
                    "Raw rule operator {:?} requires a comparison value",
                    rule.operator
                )
            })?;

            match rule.operator {
                RawRuleOperator::Eq => Ok(json_values_equal(resolved, expected)),
                RawRuleOperator::Ne => Ok(!json_values_equal(resolved, expected)),
                RawRuleOperator::Gt => {
                    compare_json_numbers(resolved, expected, |left, right| left > right)
                }
                RawRuleOperator::Gte => {
                    compare_json_numbers(resolved, expected, |left, right| left >= right)
                }
                RawRuleOperator::Lt => {
                    compare_json_numbers(resolved, expected, |left, right| left < right)
                }
                RawRuleOperator::Lte => {
                    compare_json_numbers(resolved, expected, |left, right| left <= right)
                }
                RawRuleOperator::Contains => json_contains(resolved, expected),
                RawRuleOperator::StartsWith => json_starts_with(resolved, expected),
                RawRuleOperator::Regex => json_regex_match(resolved, expected),
                RawRuleOperator::Exists | RawRuleOperator::Truthy => unreachable!(),
            }
        }
    }
}

fn json_values_equal(left: &Value, right: &Value) -> bool {
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => left == right,
    }
}

fn compare_json_numbers(
    left: &Value,
    right: &Value,
    comparator: impl FnOnce(f64, f64) -> bool,
) -> Result<bool> {
    let Some(left) = left.as_f64() else {
        return Ok(false);
    };
    let Some(right) = right.as_f64() else {
        return Ok(false);
    };

    Ok(comparator(left, right))
}

fn json_contains(left: &Value, right: &Value) -> Result<bool> {
    match (left, right) {
        (Value::String(left), Value::String(right)) => Ok(left.contains(right)),
        (Value::Array(left), _) => Ok(left.iter().any(|item| json_values_equal(item, right))),
        _ => Ok(false),
    }
}

fn json_starts_with(left: &Value, right: &Value) -> Result<bool> {
    match (left, right) {
        (Value::String(left), Value::String(right)) => Ok(left.starts_with(right)),
        _ => Ok(false),
    }
}

fn json_regex_match(left: &Value, right: &Value) -> Result<bool> {
    let Value::String(left) = left else {
        return Ok(false);
    };
    let Value::String(pattern) = right else {
        return Ok(false);
    };

    let regex = Regex::new(pattern)
        .map_err(|error| eyre!("Invalid raw rule regex pattern {pattern:?}: {error}"))?;

    Ok(regex.is_match(left))
}

fn is_json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().map(|value| value != 0.0).unwrap_or(false),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_raw_rule_match, expand_action_source_context, Routines, RuleEvaluationContext,
    };
    use crate::core::{devices::Devices, groups::Groups, routine_history};
    use crate::db::config_queries;
    use crate::types::action::{Action, Actions};
    use crate::types::automation_event::{EventCausation, EventOrigin};
    use crate::types::device::{
        ControllableDevice, Device, DeviceData, DeviceId, DeviceKey, DeviceRef, ManageKind,
        SensorDevice,
    };
    use crate::types::event::{mk_event_channel, RxEventChannel};
    use crate::types::group::GroupsConfig;
    use crate::types::integration::IntegrationId;
    use crate::types::rule::{
        DeviceRule, RawRule, RawRuleOperator, Routine, RoutineId, RoutinesConfig, Rule, TriggerMode,
    };
    use crate::utils::cli::Cli;
    use jsonptr::PointerBuf;
    use serde_json::json;
    use std::str::FromStr;

    fn test_cli() -> Cli {
        Cli {
            dry_run: true,
            port: 45289,
            database_url: None,
            config: None,
            warmup_time: None,
            command: None,
        }
    }

    fn sensor_device(raw: serde_json::Value) -> Device {
        Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("sensor"),
            "Sensor".to_string(),
            DeviceData::Sensor(SensorDevice::Text {
                value: "raw".to_string(),
            }),
            Some(raw),
        )
    }

    fn raw_rule(operator: RawRuleOperator, value: Option<serde_json::Value>) -> RawRule {
        RawRule {
            path: PointerBuf::from_tokens(["payload", "temperature"]),
            operator,
            value,
            trigger_mode: TriggerMode::Pulse,
            device_ref: DeviceRef::new_with_id(
                IntegrationId::from("mqtt".to_string()),
                DeviceId::new("sensor"),
            ),
        }
    }

    fn test_devices() -> (Devices, RxEventChannel) {
        let (event_tx, _event_rx) = mk_event_channel();
        (Devices::new(event_tx, &test_cli()), _event_rx)
    }

    fn test_routines(rule: Rule) -> (Routines, RoutineId, RxEventChannel) {
        let (event_tx, event_rx) = mk_event_channel();
        let routine_id = RoutineId::from("raw-rule".to_string());
        let mut config = RoutinesConfig::new();
        config.insert(
            routine_id.clone(),
            Routine {
                name: "Raw rule".to_string(),
                rules: vec![rule],
                actions: Actions::default(),
            },
        );
        (Routines::new(config, event_tx), routine_id, event_rx)
    }

    fn sensor_key() -> DeviceKey {
        DeviceKey::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("sensor"),
        )
    }

    fn rule_eval_ctx<'a>(
        old_event_source: Option<&'a Device>,
        device_key: &'a DeviceKey,
        devices: &'a Devices,
        groups: &'a Groups,
    ) -> RuleEvaluationContext<'a> {
        RuleEvaluationContext {
            event_source: Some(device_key),
            old_event_source,
            devices_state: devices.get_state(),
            groups,
            update_edge_state: true,
            record_history: true,
            origin: EventOrigin::Report,
            causation: EventCausation::default(),
            frame_id: None,
            seed_only: false,
        }
    }

    #[test]
    fn raw_rule_matches_numeric_thresholds() {
        let rule = raw_rule(RawRuleOperator::Gt, Some(json!(20)));
        let raw = json!({ "payload": { "temperature": 21.5 } });

        assert!(evaluate_raw_rule_match(Some(&raw), &rule).expect("match should evaluate"));
    }

    #[test]
    fn raw_rule_supports_string_regex() {
        let rule = RawRule {
            path: PointerBuf::from_tokens(["payload", "action"]),
            operator: RawRuleOperator::Regex,
            value: Some(json!("^button_(press|hold)$")),
            trigger_mode: TriggerMode::Pulse,
            device_ref: DeviceRef::new_with_id(
                IntegrationId::from("mqtt".to_string()),
                DeviceId::new("sensor"),
            ),
        };
        let raw = json!({ "payload": { "action": "button_press" } });

        assert!(evaluate_raw_rule_match(Some(&raw), &rule).expect("regex should evaluate"));
    }

    #[test]
    fn raw_edge_rules_rearm_after_state_leaves_match() {
        let groups = Groups::new(GroupsConfig::default());
        let rule = Rule::Raw(RawRule {
            trigger_mode: TriggerMode::Edge,
            ..raw_rule(RawRuleOperator::Gt, Some(json!(20)))
        });
        let (mut routines, routine_id, _routine_events) = test_routines(rule.clone());
        let (mut devices, _device_events) = test_devices();
        let device_key = sensor_key();

        let old_device = sensor_device(json!({ "payload": { "temperature": 18 } }));
        devices.set_state(&old_device, true, true);

        let matching_device = sensor_device(json!({ "payload": { "temperature": 21 } }));
        devices.set_state(&matching_device, true, true);
        let first_ctx = rule_eval_ctx(Some(&old_device), &device_key, &devices, &groups);

        let first = routines.evaluate_rule_status(&routine_id, &rule, &first_ctx);
        assert!(first.condition_match);
        assert!(first.trigger_match);

        let second = routines.evaluate_rule_status(&routine_id, &rule, &first_ctx);
        assert!(second.condition_match);
        assert!(!second.trigger_match);

        let non_matching_device = sensor_device(json!({ "payload": { "temperature": 19 } }));
        devices.set_state(&non_matching_device, true, true);
        let rearm_ctx = rule_eval_ctx(Some(&matching_device), &device_key, &devices, &groups);

        let cleared = routines.evaluate_rule_status(&routine_id, &rule, &rearm_ctx);
        assert!(!cleared.condition_match);
        assert!(!cleared.trigger_match);

        devices.set_state(&matching_device, true, true);
        let reentered_ctx =
            rule_eval_ctx(Some(&non_matching_device), &device_key, &devices, &groups);

        let retriggered = routines.evaluate_rule_status(&routine_id, &rule, &reentered_ctx);
        assert!(retriggered.condition_match);
        assert!(retriggered.trigger_match);
    }

    #[test]
    fn expand_action_source_context_merges_memberships_into_activate_scene() {
        use crate::types::group::{GroupConfig, GroupLink};
        use crate::types::scene::{ActivateSceneActionDescriptor, RolloutStyle};
        use std::str::FromStr;

        let switch_key = DeviceKey::new(
            IntegrationId::from("z2m".to_string()),
            DeviceId::new("switch"),
        );
        let mut group_config = GroupsConfig::new();
        group_config.insert(
            crate::types::group::GroupId::from_str("room").unwrap(),
            GroupConfig {
                name: "Room".into(),
                devices: Some(vec![DeviceRef::new_with_id(
                    IntegrationId::from("z2m".to_string()),
                    DeviceId::new("switch"),
                )]),
                groups: None,
                hidden: None,
            },
        );
        group_config.insert(
            crate::types::group::GroupId::from_str("floor").unwrap(),
            GroupConfig {
                name: "Floor".into(),
                devices: None,
                groups: Some(vec![GroupLink {
                    group_id: crate::types::group::GroupId::from_str("room").unwrap(),
                }]),
                hidden: None,
            },
        );
        let mut groups = Groups::new(group_config);
        let (mut devices, _rx) = test_devices();
        devices.set_state(
            &Device::new(
                IntegrationId::from("z2m".to_string()),
                DeviceId::new("switch"),
                "Switch".to_string(),
                DeviceData::Sensor(SensorDevice::Text {
                    value: "idle".into(),
                }),
                None,
            ),
            true,
            true,
        );
        groups.force_invalidate(&devices);

        let action = Action::ActivateScene(ActivateSceneActionDescriptor {
            scene_id: crate::types::scene::SceneId::from_str("fallback").unwrap(),
            mirror_from_group: None,
            device_keys: None,
            group_keys: Some(vec![
                crate::types::group::GroupId::from_str("other").unwrap()
            ]),
            include_source_groups: true,
            use_scene_transition: false,
            transition: None,
            rollout: None::<RolloutStyle>,
            rollout_source_device_key: None,
            rollout_duration_ms: None,
        });

        let expanded = expand_action_source_context(action, Some(&switch_key), &groups);
        let Action::ActivateScene(descriptor) = expanded else {
            panic!("expected ActivateScene action after expansion");
        };
        assert!(!descriptor.include_source_groups);
        let mut keys = descriptor.group_keys.expect("group_keys expected");
        keys.sort();
        assert_eq!(
            keys,
            vec![
                crate::types::group::GroupId::from_str("floor").unwrap(),
                crate::types::group::GroupId::from_str("other").unwrap(),
                crate::types::group::GroupId::from_str("room").unwrap(),
            ]
        );
    }

    #[test]
    fn expand_action_source_context_noop_without_flag() {
        let (devices, _rx) = test_devices();
        let groups = Groups::new(GroupsConfig::default());
        let _ = devices;

        let action = Action::ActivateScene(crate::types::scene::ActivateSceneActionDescriptor {
            scene_id: crate::types::scene::SceneId::from_str("s").unwrap(),
            mirror_from_group: None,
            device_keys: None,
            group_keys: None,
            include_source_groups: false,
            use_scene_transition: false,
            transition: None,
            rollout: None,
            rollout_source_device_key: None,
            rollout_duration_ms: None,
        });

        let expanded = expand_action_source_context(
            action.clone(),
            Some(&DeviceKey::new(
                IntegrationId::from("z2m".to_string()),
                DeviceId::new("x"),
            )),
            &groups,
        );

        let Action::ActivateScene(descriptor) = expanded else {
            panic!("expected ActivateScene");
        };
        assert!(descriptor.group_keys.is_none());
    }

    #[test]
    fn expand_action_source_context_resolves_triggering_device_rollout_source() {
        use crate::types::scene::{ActivateSceneActionDescriptor, RolloutStyle, SceneId};

        let switch_key = DeviceKey::new(
            IntegrationId::from("z2m".to_string()),
            DeviceId::new("switch"),
        );

        let action = Action::ActivateScene(ActivateSceneActionDescriptor {
            scene_id: SceneId::from("fallback".to_string()),
            mirror_from_group: None,
            device_keys: None,
            group_keys: None,
            include_source_groups: false,
            use_scene_transition: false,
            transition: None,
            rollout: Some(RolloutStyle::Spatial),
            rollout_source_device_key: Some(DeviceKey::new(
                IntegrationId::from("__homectl_runtime__".to_string()),
                DeviceId::new("triggering_device"),
            )),
            rollout_duration_ms: Some(1500),
        });

        let expanded = expand_action_source_context(
            action,
            Some(&switch_key),
            &Groups::new(GroupsConfig::default()),
        );

        let Action::ActivateScene(descriptor) = expanded else {
            panic!("expected ActivateScene");
        };

        assert_eq!(descriptor.rollout_source_device_key, Some(switch_key));
    }

    // ------------------------------------------------------------------
    // P01: validation quarantine and truthful history
    // ------------------------------------------------------------------

    fn row(
        id: &str,
        enabled: bool,
        rules: serde_json::Value,
        actions: serde_json::Value,
    ) -> config_queries::RoutineRow {
        config_queries::RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled,
            rules,
            actions,
            ..Default::default()
        }
    }

    fn valid_rules_json() -> serde_json::Value {
        json!([{
            "state": { "value": true },
            "integration_id": "mqtt",
            "device_id": "sensor"
        }])
    }

    fn load(routines: &[config_queries::RoutineRow]) -> Routines {
        let (event_tx, _rx) = mk_event_channel();
        let mut loaded = Routines::new(RoutinesConfig::new(), event_tx);
        loaded.load_config_rows(routines, &super::automation::ConfigCatalog::default());
        loaded
    }

    #[test]
    fn v01_enabled_invalid_routine_is_quarantined_and_visible() {
        let mut routines = load(&[
            row("bad", true, json!({ "not": "a list" }), json!([])),
            row("good", true, valid_rules_json(), json!([])),
        ]);

        assert!(routines
            .config
            .contains_key(&RoutineId::from("good".to_string())));
        assert!(!routines
            .config
            .contains_key(&RoutineId::from("bad".to_string())));
        assert!(routines
            .quarantined_routines()
            .contains_key(&RoutineId::from("bad".to_string())));

        let (devices, _rx) = test_devices();
        let groups = Groups::new(GroupsConfig::default());
        routines.refresh_runtime_statuses(&devices, &groups, None);

        let status = routines
            .get_runtime_statuses()
            .0
            .get(&RoutineId::from("bad".to_string()))
            .cloned()
            .expect("quarantined routine must still be visible");
        assert!(!status.will_trigger);
        assert!(status.rules.iter().all(|rule| rule.error.is_some()));
    }

    #[test]
    fn v04_disabled_invalid_row_is_left_untouched() {
        let routines = load(&[
            row("disabled_bad", false, json!({ "not": "a list" }), json!(42)),
            row("enabled_bad", true, json!({ "not": "a list" }), json!(42)),
        ]);

        assert!(!routines
            .config
            .contains_key(&RoutineId::from("disabled_bad".to_string())));
        assert!(!routines
            .quarantined_routines()
            .contains_key(&RoutineId::from("disabled_bad".to_string())));
        assert!(routines
            .quarantined_routines()
            .contains_key(&RoutineId::from("enabled_bad".to_string())));
    }

    #[test]
    fn v05_status_refresh_does_not_record_history_or_edges() {
        let lamp_ref = DeviceRef::new_with_id(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("lamp"),
        );
        let rule = Rule::Device(DeviceRule {
            power: Some(true),
            scene: None,
            trigger_mode: TriggerMode::Level,
            device_ref: lamp_ref,
        });
        let mut config = RoutinesConfig::new();
        config.insert(
            RoutineId::from("level".to_string()),
            Routine {
                name: "Level".to_string(),
                rules: vec![rule],
                actions: Actions::default(),
            },
        );

        let (event_tx, _rx) = mk_event_channel();
        let mut routines = Routines::new(config, event_tx);
        let (mut devices, _devrx) = test_devices();
        let groups = Groups::new(GroupsConfig::default());

        let lamp = Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("lamp"),
            "Lamp".to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                None,
                None,
                None,
                Default::default(),
                ManageKind::Unmanaged,
            )),
            None,
        );
        devices.set_state(&lamp, true, true);

        // Sanity: the level routine is eligible to trigger on refresh.
        routines.refresh_runtime_statuses(&devices, &groups, None);
        let status = routines
            .get_runtime_statuses()
            .0
            .get(&RoutineId::from("level".to_string()))
            .cloned()
            .expect("status");
        assert!(status.will_trigger);

        let history_before = routine_history::recent_routine_history().len();
        for _ in 0..3 {
            routines.refresh_runtime_statuses(&devices, &groups, None);
        }
        assert_eq!(
            routine_history::recent_routine_history().len(),
            history_before,
            "status refresh must not write routine history"
        );
        assert!(
            routines.prev_edge_triggered.is_empty(),
            "status refresh must not mutate edge memory"
        );
    }

    // P03: v2 rows load through the shared compiler. Valid definitions compile
    // but are not executed yet; invalid enabled definitions are quarantined;
    // disabled drafts are untouched (V04).
    #[test]
    fn p03_v2_rows_compile_quarantine_and_never_run_as_v1() {
        fn v2_row(
            id: &str,
            enabled: bool,
            definition: serde_json::Value,
        ) -> config_queries::RoutineRow {
            config_queries::RoutineRow {
                id: id.to_string(),
                name: id.to_string(),
                enabled,
                semantics_version: 2,
                revision: 1,
                definition_v2: Some(definition),
                ..Default::default()
            }
        }

        let valid = json!({
            "triggers": [{ "kind": "manual", "id": "trig" }],
            "program": { "kind": "native", "steps": [
                { "action": "cancel_timer", "id": "step_timer", "timer": "t1" }
            ]}
        });
        let mut routines = load(&[
            v2_row("v2_valid", true, valid),
            v2_row("v2_invalid", true, json!({ "triggers": [] })),
            v2_row("v2_disabled", false, json!({ "triggers": "not a list" })),
        ]);

        assert!(routines
            .compiled_v2_routines()
            .contains_key(&RoutineId::from("v2_valid".to_string())));
        assert!(routines
            .quarantined_routines()
            .contains_key(&RoutineId::from("v2_invalid".to_string())));
        assert!(!routines
            .quarantined_routines()
            .contains_key(&RoutineId::from("v2_disabled".to_string())));
        assert!(
            routines.config.is_empty(),
            "v2 rows must never enter the v1 evaluator"
        );

        let (devices, _rx) = test_devices();
        let groups = Groups::new(GroupsConfig::default());
        let history_before = routine_history::recent_routine_history().len();
        routines.refresh_runtime_statuses(&devices, &groups, None);

        let status = routines
            .get_runtime_statuses()
            .0
            .get(&RoutineId::from("v2_valid".to_string()))
            .cloned()
            .expect("compiled v2 routine is visible");
        assert!(!status.will_trigger);
        assert!(
            status.v2.is_some(),
            "P04 attaches real v2 evaluation status"
        );
        assert!(status.v2.as_ref().unwrap().execution_pending);
        assert!(
            status.rules.iter().all(|rule| rule.error.is_none()),
            "compiled v2 routines no longer report semantics_not_executed"
        );

        let invalid = routines
            .get_runtime_statuses()
            .0
            .get(&RoutineId::from("v2_invalid".to_string()))
            .cloned()
            .expect("quarantined v2 routine is visible");
        assert!(invalid.rules.iter().all(|rule| rule.error.is_some()));

        assert_eq!(
            routine_history::recent_routine_history().len(),
            history_before,
            "status refresh must not write routine history for v2 rows"
        );
    }

    // P04: v2 frames evaluate through the actor path. A report trigger fires,
    // records transition memory, and surfaces a status with
    // `execution_pending` until P05 dispatches actions.
    #[test]
    fn p04_v2_frames_evaluate_triggers_and_conditions() {
        use crate::core::automation::{ConfigCatalog, FrameContext};
        use crate::types::automation_event::{DeviceMutation, EventId};
        use crate::types::device::DevicesState;
        use std::collections::BTreeMap;

        let (event_tx, _event_rx) = mk_event_channel();
        let mut routines = Routines::new(RoutinesConfig::new(), event_tx);
        let row = config_queries::RoutineRow {
            id: "v2_frame".to_string(),
            name: "V2 Frame".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 3,
            definition_v2: Some(json!({
                "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "mqtt", "device_id": "sensor" } }],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "native", "steps": [
                    { "action": "cancel_timer", "id": "step", "timer": "t1" }
                ]}
            })),
            ..Default::default()
        };
        routines.load_config_rows(&[row], &ConfigCatalog::default());

        let (devices, _rx) = test_devices();
        let groups = Groups::new(GroupsConfig::new());
        let device = sensor_device(json!({ "button": "single" }));
        let device_key = device.get_device_key();
        let before_view = DevicesState(BTreeMap::from([(device_key.clone(), device.clone())]));
        let after_view = before_view.clone();
        let mutation = DeviceMutation {
            event_id: EventId::default(),
            device_key,
            before: Some(device.clone()),
            after: device,
            origin: EventOrigin::Report,
        };
        let mutations = vec![mutation];
        let frame = FrameContext {
            mutations: &mutations,
            before: &before_view,
            after: &after_view,
            groups: &groups,
            helpers: None,
        };

        let evaluations = routines.handle_v2_frame(&frame);
        assert_eq!(evaluations.len(), 1);
        assert!(evaluations[0].will_trigger);
        assert_eq!(evaluations[0].matched_trigger_ids.len(), 1);

        routines.refresh_runtime_statuses(&devices, &groups, None);
        let status = routines
            .get_runtime_statuses()
            .0
            .get(&RoutineId::from("v2_frame".to_string()))
            .cloned()
            .expect("v2 status visible");
        assert!(status.will_trigger);
        let v2 = status.v2.expect("v2 detail attached");
        assert_eq!(v2.definition_revision, 3);
        assert!(v2.execution_pending);
        assert_eq!(v2.matched_trigger_ids.len(), 1);
    }
}
