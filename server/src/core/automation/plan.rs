//! Pure native action planning for v2 routines (P05).
//!
//! Planning freezes every decision that must not drift between acceptance and
//! dispatch: resolved scenes (including helper-driven selection and mirrors),
//! resolved device/group targets, and the manual-intent revisions that guard
//! them (A01/A03/A04/A05). The planner never touches `AppState`; the actor
//! dispatches the returned plan.
//!
//! Native timer steps are planned as actor-authoritative operations (P09);
//! awaited invocations remain deferred to later packages.

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use super::compile::CompiledDefinition;
use super::evaluate::{evaluate_condition, EvaluationView};
use crate::core::groups::Groups;
use crate::core::helpers::Helpers;
use crate::types::{
    action::Action,
    automation_definition::{
        HelperId, InvokeMode, NativeAction, NodeId, Program, SceneSelection, TargetSpec,
        TimerIntentCapture, TimerIntentTarget, TimerOperation,
    },
    automation_trace::{PlannedStepStatus, StepDisposition},
    device::{DeviceData, DeviceKey, DeviceRef, DevicesState},
    dim::DimDescriptor,
    group::GroupId,
    rule::{ForceTriggerRoutineDescriptor, RoutineId},
    scene::{ActivateSceneActionDescriptor, SceneId},
};

/// Maximum number of steps one routine run may plan. Mirrors the compiler's
/// `MAX_EXECUTION_ACTIONS`; the planner is also used for previews of drafts, so
/// it re-checks the bound.
pub const MAX_PLANNED_STEPS: usize = 64;

/// A target of manual intent. Plans capture the revision at acceptance and are
/// suppressed if a newer manual intent arrives first (A03).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum IntentTarget {
    Device(DeviceKey),
    Group(GroupId),
    Scene(SceneId),
}

impl IntentTarget {
    pub fn label(&self) -> String {
        match self {
            Self::Device(key) => key.to_string(),
            Self::Group(id) => id.to_string(),
            Self::Scene(id) => id.to_string(),
        }
    }
}

/// Monotonic revision per intent target. Only manual (`Command` origin)
/// changes bump revisions; reports and internal derivations do not.
#[derive(Clone, Debug, Default)]
pub struct IntentTracker {
    revisions: HashMap<IntentTarget, u64>,
}

impl IntentTracker {
    pub fn revision(&self, target: &IntentTarget) -> u64 {
        self.revisions.get(target).copied().unwrap_or(0)
    }

    pub fn bump(&mut self, target: IntentTarget) -> u64 {
        let revision = self.revisions.entry(target).or_insert(0);
        *revision += 1;
        *revision
    }

    pub fn bump_device(&mut self, key: &DeviceKey) {
        self.bump(IntentTarget::Device(key.clone()));
    }

    pub fn bump_group(&mut self, id: &GroupId) {
        self.bump(IntentTarget::Group(id.clone()));
    }

    pub fn bump_scene(&mut self, id: &SceneId) {
        self.bump(IntentTarget::Scene(id.clone()));
    }
}

/// Read-only state the planner resolves against.
pub struct PlanInputs<'a> {
    pub devices: &'a DevicesState,
    pub groups: &'a Groups,
    pub helpers: &'a Helpers,
    pub intents: &'a IntentTracker,
}

/// One step ready for dispatch.
#[derive(Clone, Debug)]
pub struct PlannedStep {
    pub action_id: NodeId,
    pub kind: &'static str,
    pub body: PlannedStepBody,
    /// Intent revisions captured at plan time; dispatch re-checks them.
    pub intent_guard: Vec<(IntentTarget, u64)>,
    /// Frozen intent targets riding the timer operation this step schedules
    /// (J08). The actor records their tokens at acceptance.
    pub timer_capture: Option<crate::types::automation_definition::TimerIntentCapture>,
}

#[derive(Clone, Debug)]
pub enum PlannedStepBody {
    Dispatch(Box<Action>),
    SetHelper {
        helper: HelperId,
        value: Value,
    },
    /// Actor-authoritative named timer operation (P09).
    TimerOperation {
        operation: crate::types::automation_definition::TimerOperation,
    },
}

/// Result of planning one routine evaluation.
#[derive(Clone, Debug)]
pub struct RoutinePlan {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    /// Monotonic run id assigned when the runtime accepts the plan.
    pub run_id: u64,
    pub steps: Vec<PlannedStep>,
    /// Steps that were dropped during planning, with visible reasons (X02).
    pub suppressions: Vec<PlannedStepStatus>,
}

impl RoutinePlan {
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }
}

/// Check a step's intent guard at dispatch time. Returns the suppression
/// reason when a newer manual intent superseded the plan (A03).
pub fn guard_suppression(step: &PlannedStep, intents: &IntentTracker) -> Option<String> {
    step.intent_guard.iter().find_map(|(target, captured)| {
        let current = intents.revision(target);
        (current > *captured).then(|| {
            format!(
                "superseded_by_newer_intent: {} (revision {current} > {captured})",
                target.label()
            )
        })
    })
}

pub fn step_status(
    step: &PlannedStep,
    disposition: StepDisposition,
    reason: Option<String>,
) -> PlannedStepStatus {
    PlannedStepStatus {
        action_id: step.action_id.clone(),
        kind: step.kind.to_string(),
        targets: step_targets(step),
        disposition,
        reason,
    }
}

pub fn step_targets(step: &PlannedStep) -> Vec<String> {
    let mut targets = Vec::new();
    let PlannedStepBody::Dispatch(action) = &step.body else {
        match &step.body {
            PlannedStepBody::SetHelper { helper, .. } => targets.push(helper.to_string()),
            PlannedStepBody::TimerOperation { operation } => {
                targets.push(timer_operation_target(operation));
            }
            PlannedStepBody::Dispatch(_) => {}
        }
        return targets;
    };
    match action.as_ref() {
        Action::ActivateScene(descriptor) => {
            targets.push(descriptor.scene_id.to_string());
            if let Some(keys) = &descriptor.device_keys {
                targets.extend(keys.iter().map(ToString::to_string));
            }
            if let Some(keys) = &descriptor.group_keys {
                targets.extend(keys.iter().map(ToString::to_string));
            }
        }
        Action::Dim(descriptor) => {
            if let Some(keys) = &descriptor.device_keys {
                targets.extend(keys.iter().map(ToString::to_string));
            }
            if let Some(keys) = &descriptor.group_keys {
                targets.extend(keys.iter().map(ToString::to_string));
            }
        }
        Action::ForceTriggerRoutine(descriptor) => {
            targets.push(descriptor.routine_id.to_string());
        }
        Action::SetDeviceState(device) => {
            targets.push(device.get_device_key().to_string());
        }
        _ => {}
    }
    targets
}

fn timer_operation_target(operation: &TimerOperation) -> String {
    match operation {
        TimerOperation::Schedule { timer, .. }
        | TimerOperation::Replace { timer, .. }
        | TimerOperation::Cancel { timer } => timer.to_string(),
    }
}

/// Plan one accepted evaluation. The caller has already established
/// `will_trigger`; this function resolves the program against acceptance-time
/// state.
pub fn plan_evaluation(
    evaluation: &super::evaluate::RoutineFrameEvaluation,
    compiled: &CompiledDefinition,
    inputs: &PlanInputs<'_>,
) -> RoutinePlan {
    let mut planner = Planner {
        inputs,
        steps: Vec::new(),
        suppressions: Vec::new(),
        timer_captures: evaluation.timer_captures.clone(),
    };
    match &compiled.normalized.program {
        Program::Native(program) => planner.plan_steps(&program.steps),
        // Script programs have no steps to plan until the worker returns typed
        // actions; `V2Runtime::plan_runs` skips them and the result path plans
        // the returned actions with `plan_script_actions`.
        Program::Script(_) => {}
    }
    RoutinePlan {
        routine_id: evaluation.routine_id.clone(),
        definition_revision: evaluation.definition_revision,
        run_id: 0,
        steps: planner.steps,
        suppressions: planner.suppressions,
    }
}

/// Plan the typed actions returned by a script handler at result-acceptance
/// time. Uses the same resolver, target/scene freezing, dedupe, and intent
/// guards as native programs so script and native fixtures produce equivalent
/// plans (A09/X05).
pub fn plan_script_actions(
    routine_id: &RoutineId,
    definition_revision: i64,
    actions: &[NativeAction],
    inputs: &PlanInputs<'_>,
) -> RoutinePlan {
    let mut planner = Planner {
        inputs,
        steps: Vec::new(),
        suppressions: Vec::new(),
        timer_captures: Vec::new(),
    };
    planner.plan_steps(actions);
    RoutinePlan {
        routine_id: routine_id.clone(),
        definition_revision,
        run_id: 0,
        steps: planner.steps,
        suppressions: planner.suppressions,
    }
}

struct Planner<'a> {
    inputs: &'a PlanInputs<'a>,
    steps: Vec<PlannedStep>,
    suppressions: Vec<PlannedStepStatus>,
    /// Intent tokens frozen by the timer generation(s) firing in this frame
    /// (J08), flattened across captures.
    timer_captures: Vec<super::timers::TimerIntentTokens>,
}

impl Planner<'_> {
    fn view(&self) -> EvaluationView<'_> {
        EvaluationView {
            devices: self.inputs.devices,
            groups: self.inputs.groups,
            helpers: Some(self.inputs.helpers),
        }
    }

    fn suppress(
        &mut self,
        action: &NativeAction,
        kind: &str,
        targets: Vec<String>,
        reason: String,
    ) {
        self.suppressions.push(PlannedStepStatus {
            action_id: action.id().clone(),
            kind: kind.to_string(),
            targets,
            disposition: StepDisposition::Suppressed,
            reason: Some(reason),
        });
    }

    fn push_dispatch(
        &mut self,
        action: &NativeAction,
        kind: &'static str,
        body: PlannedStepBody,
        intent_guard: Vec<IntentTarget>,
    ) {
        let intent_guard = self.capture_guard(intent_guard);
        self.steps.push(PlannedStep {
            action_id: action.id().clone(),
            kind,
            body,
            intent_guard,
            timer_capture: None,
        });
    }

    fn push_timer_step(
        &mut self,
        action: &NativeAction,
        kind: &'static str,
        operation: TimerOperation,
        timer_capture: Option<crate::types::automation_definition::TimerIntentCapture>,
    ) {
        self.steps.push(PlannedStep {
            action_id: action.id().clone(),
            kind,
            body: PlannedStepBody::TimerOperation { operation },
            intent_guard: Vec::new(),
            timer_capture,
        });
    }

    /// Resolve a `capture_target_intents` spec at plan time: `Ok(None)` means
    /// no capture, `Err(())` means the step was suppressed and must not plan.
    fn plan_timer_capture(
        &mut self,
        action: &NativeAction,
        kind: &str,
        spec: Option<&TargetSpec>,
    ) -> Result<Option<TimerIntentCapture>, ()> {
        let Some(spec) = spec else {
            return Ok(None);
        };
        if !spec.groups.is_empty() {
            self.suppress(
                action,
                kind,
                Vec::new(),
                "capture_group_intents_unsupported".to_string(),
            );
            return Err(());
        }
        Ok(Some(TimerIntentCapture {
            targets: spec
                .devices
                .iter()
                .map(|reference| TimerIntentTarget::Device {
                    device: device_key(reference),
                })
                .collect(),
        }))
    }

    fn capture_guard(&self, targets: Vec<IntentTarget>) -> Vec<(IntentTarget, u64)> {
        let captured: Vec<(TimerIntentTarget, u64)> =
            self.timer_captures.iter().flatten().cloned().collect();
        targets
            .into_iter()
            .map(|target| {
                let frozen = match &target {
                    IntentTarget::Device(key) => captured
                        .iter()
                        .find(|(captured_target, _)| {
                            *captured_target
                                == TimerIntentTarget::Device {
                                    device: key.clone(),
                                }
                        })
                        .map(|(_, revision)| *revision),
                    IntentTarget::Group(_) | IntentTarget::Scene(_) => None,
                };
                let revision = frozen.unwrap_or_else(|| self.inputs.intents.revision(&target));
                (target, revision)
            })
            .collect()
    }

    fn plan_steps(&mut self, steps: &[NativeAction]) {
        for action in steps {
            if self.steps.len() >= MAX_PLANNED_STEPS {
                self.suppress(
                    action,
                    action_kind(action),
                    Vec::new(),
                    format!("plan_step_bound_reached: {MAX_PLANNED_STEPS}"),
                );
                continue;
            }
            self.plan_action(action);
        }
    }

    fn plan_action(&mut self, action: &NativeAction) {
        let kind = action_kind(action);
        match action {
            NativeAction::ActivateScene {
                scene_id,
                select,
                targets,
                ..
            } => {
                let Some(scene) = self.resolve_scene(action, scene_id.as_ref(), select.as_ref())
                else {
                    return;
                };
                let (devices, groups) = resolve_targets(targets);
                let mut guard = vec![IntentTarget::Scene(scene.clone())];
                guard.extend(devices.iter().cloned().map(IntentTarget::Device));
                guard.extend(groups.iter().cloned().map(IntentTarget::Group));
                let descriptor = ActivateSceneActionDescriptor {
                    scene_id: scene,
                    mirror_from_group: None,
                    device_keys: (!devices.is_empty()).then_some(devices),
                    group_keys: (!groups.is_empty()).then_some(groups),
                    include_source_groups: false,
                    use_scene_transition: true,
                    transition: None,
                    rollout: None,
                    rollout_source_device_key: None,
                    rollout_duration_ms: None,
                };
                self.push_dispatch(
                    action,
                    kind,
                    PlannedStepBody::Dispatch(Box::new(Action::ActivateScene(descriptor))),
                    guard,
                );
            }
            NativeAction::SetPower { device, power, .. } => {
                let key = device_key(device);
                let Some(current) = self.inputs.devices.0.get(&key) else {
                    self.suppress(
                        action,
                        kind,
                        vec![key.to_string()],
                        format!("unknown_device: {key}"),
                    );
                    return;
                };
                let mut next = current.clone();
                let DeviceData::Controllable(controllable) = &mut next.data else {
                    self.suppress(
                        action,
                        kind,
                        vec![key.to_string()],
                        format!("not_controllable: {key}"),
                    );
                    return;
                };
                controllable.state.power = *power;
                controllable.scene_id = None;
                self.push_dispatch(
                    action,
                    kind,
                    PlannedStepBody::Dispatch(Box::new(Action::SetDeviceState(next))),
                    vec![IntentTarget::Device(key)],
                );
            }
            NativeAction::Dim {
                targets,
                step,
                transition_ms,
                ..
            } => {
                let _ = transition_ms;
                let (devices, groups) = resolve_targets(targets);
                if devices.is_empty() && groups.is_empty() {
                    self.suppress(action, kind, Vec::new(), "missing_targets".to_string());
                    return;
                }
                let mut guard: Vec<IntentTarget> =
                    devices.iter().cloned().map(IntentTarget::Device).collect();
                guard.extend(groups.iter().cloned().map(IntentTarget::Group));
                let descriptor = DimDescriptor {
                    device_keys: (!devices.is_empty()).then_some(devices),
                    group_keys: (!groups.is_empty()).then_some(groups),
                    include_source_groups: false,
                    step: Some(*step),
                };
                self.push_dispatch(
                    action,
                    kind,
                    PlannedStepBody::Dispatch(Box::new(Action::Dim(descriptor))),
                    guard,
                );
            }
            NativeAction::Choose { branches, .. } => {
                for branch in branches {
                    let condition = evaluate_condition(
                        &branch.condition,
                        self.view(),
                        &format!("/program/choose/{}/condition", branch.id),
                    );
                    match condition.truth {
                        crate::types::automation_trace::TruthValue::True => {
                            self.plan_steps(&branch.steps);
                            return;
                        }
                        crate::types::automation_trace::TruthValue::Unknown => {
                            let reason = condition
                                .error
                                .clone()
                                .unwrap_or_else(|| "choose_condition_unknown".to_string());
                            self.suppress(action, kind, Vec::new(), reason);
                            return;
                        }
                        crate::types::automation_trace::TruthValue::False => {}
                    }
                }
                self.suppress(action, kind, Vec::new(), "no_matching_branch".to_string());
            }
            NativeAction::ScheduleTimer {
                timer,
                delay_ms,
                capture_target_intents,
                ..
            } => {
                let Ok(capture) =
                    self.plan_timer_capture(action, kind, capture_target_intents.as_ref())
                else {
                    return;
                };
                self.push_timer_step(
                    action,
                    kind,
                    TimerOperation::Schedule {
                        timer: timer.clone(),
                        delay_ms: *delay_ms,
                    },
                    capture,
                );
            }
            NativeAction::ReplaceTimer {
                timer,
                delay_ms,
                capture_target_intents,
                ..
            } => {
                let Ok(capture) =
                    self.plan_timer_capture(action, kind, capture_target_intents.as_ref())
                else {
                    return;
                };
                self.push_timer_step(
                    action,
                    kind,
                    TimerOperation::Replace {
                        timer: timer.clone(),
                        delay_ms: *delay_ms,
                    },
                    capture,
                );
            }
            NativeAction::CancelTimer { timer, .. } => {
                self.push_dispatch(
                    action,
                    kind,
                    PlannedStepBody::TimerOperation {
                        operation: TimerOperation::Cancel {
                            timer: timer.clone(),
                        },
                    },
                    Vec::new(),
                );
            }
            NativeAction::SetHelper { helper, value, .. } => {
                match self.inputs.helpers.definition(helper) {
                    None => {
                        self.suppress(
                            action,
                            kind,
                            vec![helper.to_string()],
                            format!("unknown_helper: {helper}"),
                        );
                    }
                    Some(definition) => {
                        if let Err(error) = definition.kind.validate_value(value) {
                            self.suppress(
                                action,
                                kind,
                                vec![helper.to_string()],
                                format!("invalid_helper_value: {error}"),
                            );
                            return;
                        }
                        self.push_dispatch(
                            action,
                            kind,
                            PlannedStepBody::SetHelper {
                                helper: helper.clone(),
                                value: value.clone(),
                            },
                            Vec::new(),
                        );
                    }
                }
            }
            NativeAction::InvokeRoutine {
                routine_id, mode, ..
            } => {
                if *mode == InvokeMode::AwaitCompletion {
                    self.suppress(
                        action,
                        kind,
                        vec![routine_id.to_string()],
                        "await_completion_not_implemented".to_string(),
                    );
                    return;
                }
                self.push_dispatch(
                    action,
                    kind,
                    PlannedStepBody::Dispatch(Box::new(Action::ForceTriggerRoutine(
                        ForceTriggerRoutineDescriptor {
                            routine_id: routine_id.clone(),
                        },
                    ))),
                    Vec::new(),
                );
            }
        }
    }

    fn resolve_scene(
        &mut self,
        action: &NativeAction,
        scene_id: Option<&SceneId>,
        select: Option<&SceneSelection>,
    ) -> Option<SceneId> {
        let kind = action_kind(action);
        if let Some(scene_id) = scene_id {
            return Some(scene_id.clone());
        }
        let Some(selection) = select else {
            self.suppress(
                action,
                kind,
                Vec::new(),
                "missing_scene_selection".to_string(),
            );
            return None;
        };
        match selection {
            SceneSelection::HelperEnum {
                helper,
                mapping,
                fallback_scene_id,
            } => {
                let value = self
                    .inputs
                    .helpers
                    .value(helper)
                    .and_then(|value| value.as_str().map(str::to_string));
                let selected = value
                    .as_deref()
                    .and_then(|value| mapping.get(value))
                    .cloned()
                    .or_else(|| fallback_scene_id.clone());
                match selected {
                    Some(scene) => Some(scene),
                    None => {
                        self.suppress(
                            action,
                            kind,
                            vec![helper.to_string()],
                            format!(
                                "scene_selection_unresolved: helper '{helper}' value '{}' has no \
                                 mapping and no fallback",
                                value.unwrap_or_else(|| "<unknown>".to_string())
                            ),
                        );
                        None
                    }
                }
            }
            SceneSelection::GroupActive {
                group_id,
                fallback_scene_id,
            } => {
                let selected = self
                    .inputs
                    .groups
                    .get_group_scene_id(self.inputs.devices, group_id)
                    .or_else(|| fallback_scene_id.clone());
                match selected {
                    Some(scene) => Some(scene),
                    None => {
                        self.suppress(
                            action,
                            kind,
                            vec![group_id.to_string()],
                            format!(
                                "group_scene_unresolved: group '{group_id}' has no unanimous \
                                 active scene and no fallback"
                            ),
                        );
                        None
                    }
                }
            }
        }
    }
}

fn resolve_targets(targets: &TargetSpec) -> (Vec<DeviceKey>, Vec<GroupId>) {
    let devices: BTreeSet<DeviceKey> = targets.devices.iter().map(device_key).collect();
    let groups: BTreeSet<GroupId> = targets.groups.iter().cloned().collect();
    (devices.into_iter().collect(), groups.into_iter().collect())
}

fn device_key(reference: &DeviceRef) -> DeviceKey {
    let DeviceRef::Id(id_ref) = reference;
    id_ref.clone().into_device_key()
}

pub fn action_kind(action: &NativeAction) -> &'static str {
    match action {
        NativeAction::ActivateScene { .. } => "activate_scene",
        NativeAction::SetPower { .. } => "set_power",
        NativeAction::Dim { .. } => "dim",
        NativeAction::Choose { .. } => "choose",
        NativeAction::ScheduleTimer { .. } => "schedule_timer",
        NativeAction::ReplaceTimer { .. } => "replace_timer",
        NativeAction::CancelTimer { .. } => "cancel_timer",
        NativeAction::SetHelper { .. } => "set_helper",
        NativeAction::InvokeRoutine { .. } => "invoke_routine",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::types::{
        automation_definition::HelperId,
        automation_value::{HelperDefinition, HelperKind, HelperPersistence},
        color::Capabilities,
        device::{ControllableDevice, DeviceData, DeviceId, ManageKind},
        group::{GroupConfig, GroupsConfig},
        integration::IntegrationId,
    };

    use super::super::compile::{compile_definition_value, ConfigCatalog};
    use super::super::evaluate::{evaluate_condition, EvaluationView, RoutineFrameEvaluation};
    use super::*;

    fn key(id: &str) -> DeviceKey {
        DeviceKey::new(IntegrationId::from("dummy".to_string()), DeviceId::new(id))
    }

    fn lamp(id: &str, scene: Option<&str>, power: bool) -> crate::types::device::Device {
        crate::types::device::Device::new(
            IntegrationId::from("dummy".to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                scene.map(|scene| SceneId::from(scene.to_string())),
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

    fn states(devices: Vec<crate::types::device::Device>) -> DevicesState {
        DevicesState(
            devices
                .into_iter()
                .map(|device| (device.get_device_key(), device))
                .collect(),
        )
    }

    fn room_group(members: &[&str]) -> Groups {
        let mut config = GroupsConfig::new();
        config.insert(
            GroupId("room".to_string()),
            GroupConfig {
                name: "Room".to_string(),
                devices: Some(members.iter().map(|id| DeviceRef::from(&key(id))).collect()),
                groups: None,
                hidden: None,
            },
        );
        Groups::new(config)
    }

    fn helpers_with_mode(value: &str) -> Helpers {
        let mut helpers = Helpers::default();
        helpers
            .upsert_definition(HelperDefinition {
                id: HelperId("mode".to_string()),
                name: "Mode".to_string(),
                kind: HelperKind::Enum {
                    options: vec!["evening".to_string(), "night".to_string()],
                },
                initial_value: json!(value),
                persistence: HelperPersistence::Durable,
                hidden: None,
            })
            .expect("helper definition is valid");
        helpers
    }

    fn catalog() -> ConfigCatalog {
        ConfigCatalog::default()
            .with_device(key("lamp"))
            .with_device(key("second"))
            .with_scene(SceneId::from("evening".to_string()))
            .with_scene(SceneId::from("night".to_string()))
            .with_scene(SceneId::from("fallback".to_string()))
            .with_group(GroupId("room".to_string()))
            .with_helper_definition(HelperDefinition {
                id: HelperId("mode".to_string()),
                name: "Mode".to_string(),
                kind: HelperKind::Enum {
                    options: vec!["evening".to_string(), "night".to_string()],
                },
                initial_value: json!("evening"),
                persistence: HelperPersistence::Durable,
                hidden: None,
            })
    }

    fn evaluation(
        compiled: &CompiledDefinition,
        devices: &DevicesState,
        groups: &Groups,
        helpers: &Helpers,
    ) -> RoutineFrameEvaluation {
        let condition = evaluate_condition(
            &compiled.normalized.condition,
            EvaluationView {
                devices,
                groups,
                helpers: Some(helpers),
            },
            "/condition",
        );
        RoutineFrameEvaluation {
            routine_id: RoutineId("routine".to_string()),
            definition_revision: 1,
            matched_trigger_ids: Vec::new(),
            triggers: Vec::new(),
            condition,
            will_trigger: true,
            predicate_jobs: Vec::new(),
            timer_captures: Vec::new(),
        }
    }

    fn scene_selection_definition() -> serde_json::Value {
        json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                {
                    "action": "activate_scene",
                    "id": "step",
                    "select": {
                        "kind": "helper_enum",
                        "helper": "mode",
                        "mapping": { "evening": "evening", "night": "night" },
                        "fallback_scene_id": "fallback"
                    },
                    "targets": { "devices": [{ "integration_id": "dummy", "device_id": "lamp" }] }
                }
            ]}
        })
    }

    fn planned_scene(plan: &RoutinePlan) -> SceneId {
        let step = plan.steps.first().expect("one dispatch step");
        match &step.body {
            PlannedStepBody::Dispatch(action) => match action.as_ref() {
                Action::ActivateScene(descriptor) => descriptor.scene_id.clone(),
                other => panic!("expected scene dispatch, got {other:?}"),
            },
            other => panic!("expected scene dispatch, got {other:?}"),
        }
    }

    // A01: helper-driven scene choice is resolved at plan time and frozen into
    // the plan; changing the helper afterwards cannot alter the planned scene.
    #[test]
    fn helper_scene_selection_is_frozen_at_plan_time() {
        let compiled = compile_definition_value(&scene_selection_definition(), &catalog())
            .expect("definition compiles");
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = helpers_with_mode("night");
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &IntentTracker::default(),
        };
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        assert_eq!(planned_scene(&plan), SceneId::from("night".to_string()));

        let mut changed = helpers_with_mode("evening");
        changed
            .set_value(&HelperId("mode".to_string()), json!("evening"))
            .unwrap();
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &changed,
            intents: &IntentTracker::default(),
        };
        let replanned = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &changed),
            &compiled,
            &inputs,
        );
        assert_eq!(
            planned_scene(&replanned),
            SceneId::from("evening".to_string()),
            "a new decision uses the new helper value; the earlier plan keeps its own"
        );
        assert_eq!(planned_scene(&plan), SceneId::from("night".to_string()));
    }

    // A03: newer manual intent suppresses a stale plan at dispatch time.
    #[test]
    fn newer_manual_intent_suppresses_stale_plan() {
        let compiled = compile_definition_value(&scene_selection_definition(), &catalog())
            .expect("definition compiles");
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = helpers_with_mode("night");
        let mut intents = IntentTracker::default();
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &intents,
        };
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        assert!(guard_suppression(&plan.steps[0], &intents).is_none());

        intents.bump_device(&key("lamp"));
        let reason = guard_suppression(&plan.steps[0], &intents).expect("superseded");
        assert!(reason.contains("superseded_by_newer_intent"), "{reason}");
    }

    // S17: a script plan's stale rejection is scoped to its own targets. An
    // unrelated intent change does not invalidate the plan; a relevant one
    // does.
    #[test]
    fn script_plan_guards_only_relevant_targets() {
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = helpers_with_mode("night");
        let intents = IntentTracker::default();
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &intents,
        };
        let script_value = json!({
            "actions": [
                { "action": "set_power",
                  "device": { "integration_id": "dummy", "device_id": "lamp" }, "power": true }
            ]
        });
        let outcome = super::super::script_contract::parse_routine_handler_outcome(
            &script_value,
            super::super::script_contract::MAX_SCRIPT_STATE_BYTES,
        )
        .expect("script outcome parses");
        let plan = plan_script_actions(
            &RoutineId("routine".to_string()),
            1,
            &outcome.actions,
            &inputs,
        );
        assert_eq!(plan.steps.len(), 1);
        assert!(guard_suppression(&plan.steps[0], &intents).is_none());

        // Unrelated device and scene intents leave the plan intact.
        let mut unrelated = IntentTracker::default();
        unrelated.bump_device(&key("other"));
        unrelated.bump_scene(&SceneId::from("other_scene".to_string()));
        assert!(
            guard_suppression(&plan.steps[0], &unrelated).is_none(),
            "only the plan's relevant targets are guarded"
        );

        let mut relevant = IntentTracker::default();
        relevant.bump_device(&key("lamp"));
        let reason = guard_suppression(&plan.steps[0], &relevant).expect("superseded");
        assert!(reason.contains("superseded_by_newer_intent"), "{reason}");
    }

    // A04: a mixed group uses only the configured fallback; without a fallback
    // the activation is suppressed with a visible reason.
    #[test]
    fn mixed_group_mirror_uses_fallback_or_suppresses() {
        let definition = json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "activate_scene", "id": "step",
                  "select": { "kind": "group_active", "group_id": "room", "fallback_scene_id": "fallback" },
                  "targets": {} }
            ]}
        });
        let compiled = compile_definition_value(&definition, &catalog()).expect("compiles");
        let devices = states(vec![
            lamp("lamp", Some("evening"), false),
            lamp("second", Some("night"), false),
        ]);
        let groups = room_group(&["lamp", "second"]);
        let helpers = helpers_with_mode("night");
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &IntentTracker::default(),
        };
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        assert_eq!(planned_scene(&plan), SceneId::from("fallback".to_string()));

        let no_fallback = json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "activate_scene", "id": "step",
                  "select": { "kind": "group_active", "group_id": "room" },
                  "targets": {} }
            ]}
        });
        let compiled =
            compile_definition_value(&no_fallback, &catalog()).expect("compiles without fallback");
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        assert!(plan.steps.is_empty());
        assert_eq!(plan.suppressions.len(), 1);
        assert!(
            plan.suppressions[0]
                .reason
                .as_deref()
                .is_some_and(|reason| reason.contains("group_scene_unresolved")),
            "{:?}",
            plan.suppressions[0].reason
        );
    }

    // A05: duplicate source-derived targets are deduplicated and frozen.
    #[test]
    fn duplicate_targets_are_deduplicated() {
        let definition = json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "activate_scene", "id": "step", "scene_id": "evening",
                  "targets": { "devices": [
                      { "integration_id": "dummy", "device_id": "lamp" },
                      { "integration_id": "dummy", "device_id": "lamp" }
                  ]}}
            ]}
        });
        let compiled = compile_definition_value(&definition, &catalog()).expect("compiles");
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = helpers_with_mode("night");
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &IntentTracker::default(),
        };
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        let PlannedStepBody::Dispatch(action) = &plan.steps[0].body else {
            panic!("expected scene dispatch");
        };
        let Action::ActivateScene(descriptor) = action.as_ref() else {
            panic!("expected scene dispatch");
        };
        assert_eq!(
            descriptor.device_keys.as_deref(),
            Some([key("lamp")].as_slice())
        );
    }

    // P09: timer actions are planned as actor-authoritative operations.
    #[test]
    fn timer_actions_plan_as_timer_operations() {
        let definition = json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "schedule_timer", "id": "schedule", "timer": "t1", "delay_ms": 1000 },
                { "action": "replace_timer", "id": "replace", "timer": "t1", "delay_ms": 2000 },
                { "action": "cancel_timer", "id": "cancel", "timer": "t1" }
            ]}
        });
        let compiled = compile_definition_value(&definition, &catalog()).expect("compiles");
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = helpers_with_mode("night");
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &IntentTracker::default(),
        };
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        assert!(plan.suppressions.is_empty());
        assert_eq!(plan.steps.len(), 3);
        let operations = plan
            .steps
            .iter()
            .map(|step| match &step.body {
                PlannedStepBody::TimerOperation { operation } => operation.clone(),
                other => panic!("unexpected step body: {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            operations,
            vec![
                TimerOperation::Schedule {
                    timer: crate::types::automation_definition::TimerId("t1".to_string()),
                    delay_ms: 1_000,
                },
                TimerOperation::Replace {
                    timer: crate::types::automation_definition::TimerId("t1".to_string()),
                    delay_ms: 2_000,
                },
                TimerOperation::Cancel {
                    timer: crate::types::automation_definition::TimerId("t1".to_string()),
                },
            ]
        );
        assert_eq!(
            step_targets(&plan.steps[0]),
            vec!["t1".to_string()],
            "timer steps expose the timer key as their target"
        );
    }

    // Stale catalogs surface as suppressions rather than runtime failures.
    #[test]
    fn missing_helper_definition_suppresses_set_helper() {
        let definition = json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "set_helper", "id": "step", "helper": "mode", "value": "night" }
            ]}
        });
        let compiled = compile_definition_value(&definition, &catalog()).expect("compiles");
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = Helpers::default();
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &IntentTracker::default(),
        };
        let plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );
        assert!(plan.steps.is_empty());
        assert!(plan.suppressions[0]
            .reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with("unknown_helper")));
    }

    // X05/A09: a script handler returning the same typed actions as a native
    // program yields the same planned command bodies, resolved targets, and
    // intent guards through the shared planner.
    #[test]
    fn script_and_native_actions_plan_equivalently() {
        let native_definition = json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "set_power", "id": "native-step",
                  "device": { "integration_id": "dummy", "device_id": "lamp" }, "power": true },
                { "action": "activate_scene", "id": "native-scene", "scene_id": "evening",
                  "targets": { "groups": ["room"] } }
            ]}
        });
        let compiled =
            compile_definition_value(&native_definition, &catalog()).expect("native compiles");
        let devices = states(vec![lamp("lamp", Some("evening"), false)]);
        let groups = room_group(&["lamp"]);
        let helpers = helpers_with_mode("night");
        let intents = IntentTracker::default();
        let inputs = PlanInputs {
            devices: &devices,
            groups: &groups,
            helpers: &helpers,
            intents: &intents,
        };
        let native_plan = plan_evaluation(
            &evaluation(&compiled, &devices, &groups, &helpers),
            &compiled,
            &inputs,
        );

        let script_value = json!({
            "actions": [
                { "action": "set_power",
                  "device": { "integration_id": "dummy", "device_id": "lamp" }, "power": true },
                { "action": "activate_scene", "scene_id": "evening",
                  "targets": { "groups": ["room"] } }
            ]
        });
        let outcome = super::super::script_contract::parse_routine_handler_outcome(
            &script_value,
            super::super::script_contract::MAX_SCRIPT_STATE_BYTES,
        )
        .expect("script outcome parses");
        let script_plan = plan_script_actions(
            &RoutineId("routine".to_string()),
            1,
            &outcome.actions,
            &inputs,
        );

        let normalize = |plan: &RoutinePlan| {
            plan.steps
                .iter()
                .map(|step| {
                    (
                        step.kind.to_string(),
                        step_targets(step),
                        format!("{:?}", step.body),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(normalize(&native_plan), normalize(&script_plan));
        assert_eq!(
            native_plan.suppressions.len(),
            script_plan.suppressions.len()
        );
    }
}
