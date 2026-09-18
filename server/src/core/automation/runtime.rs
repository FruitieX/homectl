//! Runtime bridge between the actor and the pure v2 evaluator (P04).
//!
//! [`V2Runtime`] owns compiled v2 definitions, per-trigger transition memory,
//! and the latest observable evaluation status. All decision logic lives in
//! [`super::evaluate`]; this module only tracks lifecycle: loading definitions,
//! invalidating memory on definition/group revision changes, seeding at
//! startup, and publishing statuses.
//!
//! P04 evaluates decisions but does not dispatch actions; `will_trigger`
//! decisions carry `execution_pending: true` until P05 wires the planner.

use std::collections::BTreeMap;

use crate::core::groups::Groups;
use crate::core::helpers::Helpers;
use crate::types::{
    automation_definition::{NativeAction, NodeId, Program},
    automation_trace::{
        PlannedRunStatus, PlannedStepStatus, RoutineV2RuntimeStatus, StepDisposition,
    },
    device::DevicesState,
    rule::RoutineId,
};

use super::{
    compile::CompiledDefinition,
    evaluate::{
        evaluate_condition, evaluate_routine_frame, seed_routine_memory, EvaluationView,
        FrameContext, RoutineFrameEvaluation, TriggerMemory,
    },
    plan::{plan_evaluation, plan_script_actions, PlanInputs, RoutinePlan},
};

/// One compiled, enabled v2 definition plus its stored revision.
#[derive(Clone, Debug)]
pub struct V2Definition {
    pub revision: i64,
    pub compiled: CompiledDefinition,
}

/// Owns v2 evaluation state for the state actor.
#[derive(Clone, Default)]
pub struct V2Runtime {
    definitions: BTreeMap<RoutineId, V2Definition>,
    memory: TriggerMemory,
    statuses: BTreeMap<RoutineId, RoutineV2RuntimeStatus>,
    group_revision: Option<u64>,
    next_run_id: u64,
}

impl V2Runtime {
    /// Replace the compiled definitions. Memory for changed or removed
    /// definition revisions is dropped; unrelated routines keep their history
    /// (T05).
    pub fn load(&mut self, definitions: BTreeMap<RoutineId, V2Definition>) {
        let current: BTreeMap<RoutineId, i64> = definitions
            .iter()
            .map(|(id, definition)| (id.clone(), definition.revision))
            .collect();
        self.memory.retain_current(&current);
        self.definitions = definitions;
        self.statuses.clear();
        self.group_revision = None;
    }

    pub fn definitions(&self) -> &BTreeMap<RoutineId, V2Definition> {
        &self.definitions
    }

    pub fn statuses(&self) -> &BTreeMap<RoutineId, RoutineV2RuntimeStatus> {
        &self.statuses
    }

    pub fn memory(&self) -> &TriggerMemory {
        &self.memory
    }

    pub fn is_empty(&self) -> bool {
        self.definitions.is_empty()
    }

    pub fn clear(&mut self) {
        self.definitions.clear();
        self.memory.clear();
        self.statuses.clear();
        self.group_revision = None;
    }

    /// Seed transition memory from current state without firing (E06).
    pub fn seed(&mut self, devices: &DevicesState, groups: &Groups, helpers: Option<&Helpers>) {
        let view = EvaluationView {
            devices,
            groups,
            helpers,
        };
        for (routine_id, definition) in &self.definitions {
            seed_routine_memory(
                routine_id,
                definition.revision,
                &definition.compiled,
                &mut self.memory,
                view,
            );
        }
        self.group_revision = Some(groups.definition_revision());
    }

    /// Evaluate one coherent frame. Returns one decision per compiled routine
    /// in stable ID order (T01).
    pub fn evaluate_frame(&mut self, frame: &FrameContext<'_>) -> Vec<RoutineFrameEvaluation> {
        if self.group_revision != Some(frame.groups.definition_revision()) {
            // G06: configured membership changed. Predicate subscriptions and
            // transition memory are invalidated; the new frame seeds from its
            // before view, so no false edge fires.
            self.memory.clear();
            self.group_revision = Some(frame.groups.definition_revision());
        }

        let mut evaluations = Vec::with_capacity(self.definitions.len());
        for (routine_id, definition) in &self.definitions {
            let evaluation = evaluate_routine_frame(
                routine_id,
                definition.revision,
                &definition.compiled,
                &mut self.memory,
                frame,
            );
            self.statuses.insert(
                routine_id.clone(),
                evaluation
                    .clone()
                    .into_status(&definition.compiled.fingerprint),
            );
            evaluations.push(evaluation);
        }
        evaluations
    }

    /// Re-evaluate conditions against current state for status displays
    /// without touching transition memory (V05/X01).
    pub fn refresh_statuses(
        &mut self,
        devices: &DevicesState,
        groups: &Groups,
        helpers: Option<&Helpers>,
    ) {
        let view = EvaluationView {
            devices,
            groups,
            helpers,
        };
        for (routine_id, definition) in &self.definitions {
            let condition = evaluate_condition(
                &definition.compiled.normalized.condition,
                view,
                "/condition",
            );
            match self.statuses.get_mut(routine_id) {
                Some(status) => {
                    status.will_trigger =
                        !status.matched_trigger_ids.is_empty() && condition.authorizes_execution();
                    status.condition = condition;
                }
                None => {
                    self.statuses.insert(
                        routine_id.clone(),
                        RoutineV2RuntimeStatus {
                            definition_revision: definition.revision,
                            fingerprint: definition.compiled.fingerprint.clone(),
                            matched_trigger_ids: Vec::new(),
                            triggers: Vec::new(),
                            condition,
                            will_trigger: false,
                            execution_pending: true,
                            last_run: None,
                        },
                    );
                }
            }
        }
    }

    /// Plan every triggered evaluation against acceptance-time state (P05).
    /// Plans are pure; the caller dispatches them and records the run status.
    ///
    /// Script programs are skipped here: their typed actions arrive later from
    /// the worker and are planned at result-acceptance time via
    /// [`Self::plan_script_run`].
    pub fn plan_runs(
        &mut self,
        evaluations: &[RoutineFrameEvaluation],
        inputs: &PlanInputs<'_>,
    ) -> Vec<RoutinePlan> {
        let mut plans = Vec::new();
        for evaluation in evaluations {
            if !evaluation.will_trigger {
                continue;
            }
            let Some(definition) = self.definitions.get(&evaluation.routine_id) else {
                continue;
            };
            if matches!(definition.compiled.normalized.program, Program::Script(_)) {
                continue;
            }
            let mut plan = plan_evaluation(evaluation, &definition.compiled, inputs);
            plan.run_id = self.next_run_id;
            self.next_run_id = self.next_run_id.wrapping_add(1);
            plans.push(plan);
        }
        plans
    }

    /// Plan the actions a script handler returned. The plan is resolved against
    /// state at result-acceptance time and shares the native planner (A09/X05).
    pub fn plan_script_run(
        &mut self,
        routine_id: &RoutineId,
        actions: &[NativeAction],
        inputs: &PlanInputs<'_>,
    ) -> Option<RoutinePlan> {
        let definition_revision = self.definitions.get(routine_id)?.revision;
        let mut plan = plan_script_actions(routine_id, definition_revision, actions, inputs);
        plan.run_id = self.next_run_id;
        self.next_run_id = self.next_run_id.wrapping_add(1);
        Some(plan)
    }

    /// Record the dispatched outcome of one run for status displays (X03).
    pub fn record_run(&mut self, routine_id: &RoutineId, status: PlannedRunStatus) {
        if let Some(existing) = self.statuses.get_mut(routine_id) {
            existing.execution_pending = false;
            existing.last_run = Some(status);
        }
    }

    /// Record a visible rejected script run (worker failure, stale result, or
    /// contract error). Nothing is dispatched and the pending flag clears so a
    /// stuck pending state cannot masquerade as success (X03).
    pub fn record_script_failure(&mut self, routine_id: &RoutineId, reason: String) {
        let Some(definition) = self.definitions.get(routine_id) else {
            return;
        };
        let revision = definition.revision;
        let fingerprint = definition.compiled.fingerprint.clone();
        let run_id = self.next_run_id;
        self.next_run_id = self.next_run_id.wrapping_add(1);
        let status = PlannedRunStatus {
            run_id,
            definition_revision: revision,
            accepted: false,
            steps: vec![PlannedStepStatus {
                action_id: NodeId("script".to_string()),
                kind: "script".to_string(),
                targets: Vec::new(),
                disposition: StepDisposition::Suppressed,
                reason: Some(reason),
            }],
            dropped: 1,
        };
        match self.statuses.get_mut(routine_id) {
            Some(existing) => {
                existing.execution_pending = false;
                existing.last_run = Some(status);
            }
            None => {
                self.statuses.insert(
                    routine_id.clone(),
                    RoutineV2RuntimeStatus {
                        definition_revision: revision,
                        fingerprint,
                        matched_trigger_ids: Vec::new(),
                        triggers: Vec::new(),
                        condition: Default::default(),
                        will_trigger: false,
                        execution_pending: false,
                        last_run: Some(status),
                    },
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::types::{
        automation_event::{DeviceMutation, EventId, EventOrigin},
        color::Capabilities,
        device::{
            ControllableState, Device, DeviceData, DeviceId, DeviceKey, DeviceReport, DevicesState,
            ManageKind,
        },
        group::{GroupConfig, GroupId, GroupsConfig},
        integration::IntegrationId,
    };

    use super::super::compile::{compile_definition_value, ConfigCatalog};
    use super::*;

    fn key(id: &str) -> DeviceKey {
        DeviceKey::new(IntegrationId::from("dummy".to_string()), DeviceId::new(id))
    }

    fn lamp(id: &str, power: bool) -> Device {
        let mut device = Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Controllable(crate::types::device::ControllableDevice::new(
                None,
                power,
                None,
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            )),
            None,
        );
        if let DeviceData::Controllable(controllable) = &mut device.data {
            controllable.last_report = Some(Box::new(DeviceReport {
                state: ControllableState {
                    power,
                    brightness: None,
                    color: None,
                    transition: None,
                },
                received_at_ms: 1,
                retained: false,
                matches_requested: true,
            }));
        }
        device
    }

    fn states(devices: Vec<Device>) -> DevicesState {
        DevicesState(
            devices
                .into_iter()
                .map(|device| (device.get_device_key(), device))
                .collect(),
        )
    }

    fn mutation(before: Device, after: Device) -> DeviceMutation {
        DeviceMutation {
            event_id: EventId::default(),
            device_key: after.get_device_key(),
            before: Some(before),
            after,
            origin: EventOrigin::Report,
        }
    }

    fn definition(id: &str, revision: i64) -> (RoutineId, V2Definition) {
        let compiled = compile_definition_value(
            &json!({
                "triggers": [{ "kind": "state_change", "id": "trig", "device": { "integration_id": "dummy", "device_id": id } }],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "native", "steps": [
                    { "action": "cancel_timer", "id": "step", "timer": "t1" }
                ]}
            }),
            &ConfigCatalog::default(),
        )
        .expect("definition should compile");
        (
            RoutineId(id.to_string()),
            V2Definition { revision, compiled },
        )
    }

    fn runtime_with(definitions: Vec<(RoutineId, V2Definition)>) -> V2Runtime {
        let mut runtime = V2Runtime::default();
        runtime.load(definitions.into_iter().collect());
        runtime
    }

    fn no_groups() -> Groups {
        Groups::new(GroupsConfig::new())
    }

    fn group_membership(groups: &mut Groups, members: &[&str]) {
        let mut config = GroupsConfig::new();
        config.insert(
            GroupId("room".to_string()),
            GroupConfig {
                name: "Room".to_string(),
                devices: Some(
                    members
                        .iter()
                        .map(|id| crate::types::device::DeviceRef::from(&key(id)))
                        .collect(),
                ),
                groups: None,
                hidden: None,
            },
        );
        let loaded = Groups::new(config);
        *groups = loaded;
    }

    #[test]
    fn startup_seeding_does_not_fire_and_status_is_visible() {
        let mut runtime = runtime_with(vec![definition("lamp", 1)]);
        let devices = states(vec![lamp("lamp", true)]);
        let groups = no_groups();

        runtime.seed(&devices, &groups, None);
        assert!(runtime
            .memory()
            .entry_for_test("lamp", 1, "trig")
            .is_some_and(|entry| entry.truth == crate::types::automation_trace::TruthValue::True));

        let before = states(vec![lamp("lamp", true)]);
        let after = states(vec![lamp("lamp", true)]);
        let mutations = vec![mutation(lamp("lamp", true), lamp("lamp", true))];
        let frame = FrameContext {
            mutations: &mutations,
            before: &before,
            after: &after,
            groups: &groups,
            helpers: None,
            fired_timers: &[],
        };
        runtime.seed(&before, &groups, None);
        let evaluations = runtime.evaluate_frame(&frame);
        assert_eq!(evaluations.len(), 1);
        assert!(!evaluations[0].will_trigger);
        let status = runtime
            .statuses()
            .get(&RoutineId("lamp".to_string()))
            .unwrap();
        assert_eq!(status.definition_revision, 1);
        assert!(status.execution_pending);
    }

    #[test]
    fn reload_invalidates_changed_revision_and_keeps_unrelated_memory() {
        let mut runtime = runtime_with(vec![definition("lamp", 1), definition("other", 1)]);
        let before = states(vec![lamp("lamp", false), lamp("other", false)]);
        let after = states(vec![lamp("lamp", true), lamp("other", false)]);
        let mutations = vec![mutation(lamp("lamp", false), lamp("lamp", true))];
        let groups = no_groups();
        runtime.seed(&before, &groups, None);
        let frame = FrameContext {
            mutations: &mutations,
            before: &before,
            after: &after,
            groups: &groups,
            helpers: None,
            fired_timers: &[],
        };
        runtime.evaluate_frame(&frame);
        assert!(runtime
            .memory()
            .entry_for_test("lamp", 1, "trig")
            .is_some_and(|entry| entry.truth == crate::types::automation_trace::TruthValue::True));

        runtime.load(
            vec![definition("lamp", 2), definition("other", 1)]
                .into_iter()
                .collect(),
        );
        assert!(
            runtime.memory().entry_for_test("lamp", 1, "trig").is_none(),
            "changed revision memory is dropped"
        );
        assert!(
            runtime
                .memory()
                .entry_for_test("other", 1, "trig")
                .is_some(),
            "unrelated routine memory survives a reload"
        );
    }

    #[test]
    fn group_membership_change_clears_transition_memory() {
        let mut runtime = runtime_with(vec![definition("lamp", 1)]);
        let mut groups = no_groups();
        let before = states(vec![lamp("lamp", false)]);
        let after = states(vec![lamp("lamp", true)]);
        let mutations = vec![mutation(lamp("lamp", false), lamp("lamp", true))];
        let frame = FrameContext {
            mutations: &mutations,
            before: &before,
            after: &after,
            groups: &groups,
            helpers: None,
            fired_timers: &[],
        };
        runtime.evaluate_frame(&frame);
        assert!(runtime.memory().entry_for_test("lamp", 1, "trig").is_some());

        group_membership(&mut groups, &["lamp"]);
        let frame = FrameContext {
            mutations: &mutations,
            before: &before,
            after: &after,
            groups: &groups,
            helpers: None,
            fired_timers: &[],
        };
        runtime.evaluate_frame(&frame);
        assert!(
            runtime.memory().entry_for_test("lamp", 1, "trig").is_some(),
            "the frame's own evaluation reseeds memory after invalidation"
        );
        assert_eq!(
            runtime.group_revision,
            Some(groups.definition_revision()),
            "the runtime tracks the group definition revision"
        );
    }

    #[test]
    fn status_refresh_does_not_touch_memory() {
        let mut runtime = runtime_with(vec![definition("lamp", 1)]);
        let devices = states(vec![lamp("lamp", true)]);
        let groups = no_groups();
        runtime.seed(&devices, &groups, None);
        let before = runtime.memory().clone();
        runtime.refresh_statuses(&devices, &groups, None);
        assert_eq!(
            runtime.memory().len(),
            before.len(),
            "status refresh never writes transition memory"
        );
        let status = runtime
            .statuses()
            .get(&RoutineId("lamp".to_string()))
            .unwrap();
        assert_eq!(
            status.condition.truth,
            crate::types::automation_trace::TruthValue::True
        );
        assert!(!status.will_trigger, "no frame fired");
    }
}
