//! Offline v1 -> v2 routine conversion (one-time migration stage).
//!
//! The converter maps legacy `rules`/`actions` rows onto the v2 definition
//! schema and validates the result through the same strict compiler the
//! runtime uses (`compile_definition`). It is deliberately conservative: any
//! rule or action that cannot be translated with an obvious equivalence is
//! reported instead of guessed, and the row keeps running as v1.
//!
//! Equivalences used here:
//!
//! - v1 `pulse` sensor rules fire whenever the device is the event source and
//!   its value matches, even on repeated reports. v2 `report` triggers carry
//!   the event and a `Comparison` condition carries the value match.
//! - v1 `edge` sensor rules fire on the non-matching -> matching transition of
//!   the same predicate, which is exactly `predicate_transition`.
//! - v1 `pulse`/`edge` device power rules observe any mutation of the device
//!   and fire while/to when `power` is true; v2 `state_change` with `level`/
//!   `transition` mode observes active truth the same way.
//! - v1 level rules are state guards and become conditions.
//! - v1 `any` rules with only level children are disjunctive conditions.
//!
//! Deliberately not converted:
//!
//! - raw rules (they read the report payload, which v2 conditions do not
//!   expose), script rules, numeric/color sensor rules that v1 never matched,
//!   `any` rules containing event leaves, group event leaves, level-only
//!   routines (v1 fires on every eligible update; v2 has no such trigger),
//!   routines whose actions have no native equivalent, and descriptors that
//!   rely on dispatch-time expansion (`include_source_groups`, rollout,
//!   mirroring extras, scene transitions).

use serde::Serialize;

use crate::core::routine_validation;
use crate::db::config_queries::RoutineRow;
use crate::types::action::Action;
use crate::types::automation_definition::{
    ConditionExpr, ExecutionPolicy, NativeAction, NativeProgram, NodeId, Program,
    RoutineDefinitionV2, SceneSelection, StateChangeMode, TargetSpec, TriggerSpec,
};
use crate::types::device::{DeviceKey, DeviceRef, SensorDevice};
use crate::types::rule::{RawRuleOperator, Rule, TriggerMode};

use super::compile::{compile_definition, CompiledDefinition, ConfigCatalog};

/// Per-row conversion outcome. `Converted` carries the normalized v2
/// definition; the other variants carry human-readable reasons and leave the
/// row on v1 semantics.
#[derive(Clone, Debug, Serialize)]
pub struct RoutineConversion {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(flatten)]
    pub status: ConversionStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ConversionStatus {
    AlreadyV2,
    Converted {
        definition: Box<RoutineDefinitionV2>,
        fingerprint: String,
        notes: Vec<String>,
    },
    NeedsManual {
        reasons: Vec<String>,
    },
    Unsupported {
        reasons: Vec<String>,
    },
}

impl RoutineConversion {
    pub fn is_converted(&self) -> bool {
        matches!(self.status, ConversionStatus::Converted { .. })
    }

    pub fn converted_definition(&self) -> Option<&RoutineDefinitionV2> {
        match &self.status {
            ConversionStatus::Converted { definition, .. } => Some(definition.as_ref()),
            _ => None,
        }
    }
}

/// Convert one stored routine row. v2 rows are reported as `AlreadyV2` and
/// never rewritten.
pub fn convert_routine(row: &RoutineRow, catalog: &ConfigCatalog) -> RoutineConversion {
    let mut conversion = RoutineConversion {
        id: row.id.clone(),
        name: row.name.clone(),
        enabled: row.enabled,
        status: ConversionStatus::AlreadyV2,
    };

    if row.semantics_version != 1 {
        return conversion;
    }

    let validated = match routine_validation::validate_definition(&row.rules, &row.actions) {
        Ok(validated) => validated,
        Err(report) => {
            conversion.status = ConversionStatus::Unsupported {
                reasons: vec![format!(
                    "v1 definition does not validate: {}",
                    report.summary()
                )],
            };
            return conversion;
        }
    };

    let mut ids = NodeIdGenerator::default();
    let mut triggers = Vec::new();
    let mut conditions = Vec::new();
    let mut notes = Vec::new();
    let mut unsupported = Vec::new();
    let mut needs_manual = Vec::new();

    for rule in &validated.rules {
        match classify_rule(rule, &mut ids, &mut notes) {
            LeafOutcome::Event(event) => {
                let (trigger, implied) = event.into_parts();
                triggers.push(trigger);
                conditions.extend(implied);
            }
            LeafOutcome::Condition(condition) => conditions.push(condition),
            LeafOutcome::Unsupported(reason) => unsupported.push(reason),
        }
    }

    if !unsupported.is_empty() {
        unsupported.extend(needs_manual);
        conversion.status = ConversionStatus::Unsupported {
            reasons: unsupported,
        };
        return conversion;
    }

    if triggers.is_empty() {
        conversion.status = ConversionStatus::NeedsManual {
            reasons: vec![
                "level-only routine: v1 fires on every eligible state update while the rules match, which v2 has no equivalent trigger for; redesign as report/transition/predicate_for before converting".to_string(),
            ],
        };
        return conversion;
    }

    if triggers.len() > 1 {
        conversion.status = ConversionStatus::NeedsManual {
            reasons: vec![format!(
                "multiple event leaves ({}): v1 requires all of them to be the event source in the same frame, which v2 triggers cannot express; split or redesign deliberately",
                triggers.len()
            )],
        };
        return conversion;
    }

    if validated.actions.is_empty() {
        conversion.status = ConversionStatus::Unsupported {
            reasons: vec![
                "v1 routine has no actions; v2 native programs must not be empty".to_string(),
            ],
        };
        return conversion;
    }

    let mut steps = Vec::new();
    for action in &validated.actions {
        match convert_action(action, &mut ids) {
            Ok(step) => steps.push(step),
            Err(reason) => needs_manual.push(reason),
        }
    }
    if !needs_manual.is_empty() {
        conversion.status = ConversionStatus::NeedsManual {
            reasons: needs_manual,
        };
        return conversion;
    }

    let definition = RoutineDefinitionV2 {
        triggers,
        condition: and_conditions(conditions),
        program: Program::Native(NativeProgram { steps }),
        execution: ExecutionPolicy::default(),
    };

    match compile_definition(&definition, catalog) {
        Ok(compiled) => {
            let CompiledDefinition {
                normalized,
                fingerprint,
                ..
            } = compiled;
            conversion.status = ConversionStatus::Converted {
                definition: Box::new(normalized),
                fingerprint,
                notes,
            };
        }
        Err(report) => {
            conversion.status = ConversionStatus::Unsupported {
                reasons: vec![format!(
                    "converted definition does not compile: {}",
                    report.summary()
                )],
            };
        }
    }

    conversion
}

fn and_conditions(mut conditions: Vec<ConditionExpr>) -> ConditionExpr {
    match conditions.len() {
        0 => ConditionExpr::default(),
        1 => conditions.remove(0),
        _ => ConditionExpr::All { conditions },
    }
}

#[derive(Default)]
struct NodeIdGenerator {
    next_trigger: usize,
    next_action: usize,
}

impl NodeIdGenerator {
    fn trigger_id(&mut self) -> NodeId {
        self.next_trigger += 1;
        NodeId::new(format!("t{}", self.next_trigger))
    }

    fn action_id(&mut self) -> NodeId {
        self.next_action += 1;
        NodeId::new(format!("a{}", self.next_action))
    }
}

enum LeafOutcome {
    Event(EventLeaf),
    Condition(ConditionExpr),
    Unsupported(String),
}

struct EventLeaf {
    trigger: TriggerSpec,
    implied: Vec<ConditionExpr>,
}

impl EventLeaf {
    fn into_parts(self) -> (TriggerSpec, Vec<ConditionExpr>) {
        (self.trigger, self.implied)
    }
}

fn classify_rule(rule: &Rule, ids: &mut NodeIdGenerator, notes: &mut Vec<String>) -> LeafOutcome {
    match rule {
        Rule::Sensor(sensor) => classify_sensor_rule(sensor, ids),
        Rule::Device(device) => classify_device_rule(device, ids, notes),
        Rule::Group(group) => classify_group_rule(group),
        Rule::Any(any) => classify_any_rule(&any.any, ids, notes),
        Rule::Raw(_) => LeafOutcome::Unsupported(
            "raw rules read the device report payload, which v2 conditions do not expose".to_string(),
        ),
        Rule::Script(_) => LeafOutcome::Unsupported(
            "v1 script rules have no v2 native condition; author a v2 condition or script program deliberately".to_string(),
        ),
        Rule::EvalExpr(_) => LeafOutcome::Unsupported(
            "legacy evalexpr rules are no longer executed and cannot be converted".to_string(),
        ),
    }
}

fn key_of(reference: &DeviceRef) -> DeviceKey {
    match reference {
        DeviceRef::Id(id) => id.clone().into_device_key(),
    }
}

fn sensor_condition(sensor: &crate::types::rule::SensorRule) -> Option<ConditionExpr> {
    let (path, value) = match &sensor.state {
        SensorDevice::Boolean { value } => ("/value", serde_json::Value::Bool(*value)),
        SensorDevice::Text { value } => ("/value", serde_json::Value::String(value.clone())),
        SensorDevice::Number { .. } | SensorDevice::Color(_) => return None,
    };
    Some(ConditionExpr::Comparison {
        source: crate::types::automation_definition::ValueSource::Device {
            device: DeviceRef::from(&key_of(&sensor.device_ref)),
            path: path.to_string(),
        },
        operator: RawRuleOperator::Eq,
        value: Some(value),
    })
}

fn classify_sensor_rule(
    sensor: &crate::types::rule::SensorRule,
    ids: &mut NodeIdGenerator,
) -> LeafOutcome {
    let Some(condition) = sensor_condition(sensor) else {
        return LeafOutcome::Unsupported(format!(
            "sensor rule for {} uses a state shape v1 never matched (only boolean and text sensor values are compared)",
            key_of(&sensor.device_ref)
        ));
    };

    match sensor.trigger_mode {
        TriggerMode::Pulse => LeafOutcome::Event(EventLeaf {
            trigger: TriggerSpec::Report {
                id: ids.trigger_id(),
                device: DeviceRef::from(&key_of(&sensor.device_ref)),
                field: None,
            },
            implied: vec![condition],
        }),
        TriggerMode::Edge => LeafOutcome::Event(EventLeaf {
            trigger: TriggerSpec::PredicateTransition {
                id: ids.trigger_id(),
                predicate: condition.clone(),
            },
            implied: vec![condition],
        }),
        TriggerMode::Level => LeafOutcome::Condition(condition),
    }
}

fn device_power_condition(device: &crate::types::device::DeviceRef, power: bool) -> ConditionExpr {
    ConditionExpr::Comparison {
        source: crate::types::automation_definition::ValueSource::Device {
            device: device.clone(),
            path: "/power".to_string(),
        },
        operator: RawRuleOperator::Eq,
        value: Some(serde_json::Value::Bool(power)),
    }
}

fn classify_device_rule(
    device: &crate::types::rule::DeviceRule,
    ids: &mut NodeIdGenerator,
    notes: &mut Vec<String>,
) -> LeafOutcome {
    let device_key = key_of(&device.device_ref);
    let device_ref = DeviceRef::from(&device_key);

    if device.scene.is_some() {
        return LeafOutcome::Unsupported(format!(
            "device rule on {device_key} matches an active scene, which has no v2 single-device condition"
        ));
    }

    match (device.power, device.trigger_mode.clone()) {
        (Some(true), TriggerMode::Pulse) => {
            notes.push(format!(
                "{device_key}: v1 pulse power rule mapped to v2 state_change level"
            ));
            LeafOutcome::Event(EventLeaf {
                trigger: TriggerSpec::StateChange {
                    id: ids.trigger_id(),
                    device: device_ref.clone(),
                    mode: StateChangeMode::Level,
                },
                implied: vec![device_power_condition(&device_ref, true)],
            })
        }
        (Some(true), TriggerMode::Edge) => LeafOutcome::Event(EventLeaf {
            trigger: TriggerSpec::StateChange {
                id: ids.trigger_id(),
                device: device_ref.clone(),
                mode: StateChangeMode::Transition,
            },
            implied: vec![device_power_condition(&device_ref, true)],
        }),
        (Some(true), TriggerMode::Level) => {
            LeafOutcome::Condition(device_power_condition(&device_ref, true))
        }
        (Some(false), TriggerMode::Level) => {
            LeafOutcome::Condition(device_power_condition(&device_ref, false))
        }
        (Some(false), _) => LeafOutcome::Unsupported(format!(
            "device rule on {device_key} triggers on power off, which v2 state_change cannot express"
        )),
        (None, _) => LeafOutcome::Unsupported(format!(
            "device rule on {device_key} has neither power nor scene constraints"
        )),
    }
}

fn group_condition(group: &crate::types::rule::GroupRule) -> ConditionExpr {
    ConditionExpr::Group {
        group_id: group.group_id.clone(),
        quantifier: crate::types::automation_definition::Quantifier::All,
        power: group.power,
        scene: group.scene.clone(),
    }
}

fn classify_group_rule(group: &crate::types::rule::GroupRule) -> LeafOutcome {
    match group.trigger_mode {
        TriggerMode::Level => {
            if group.power.is_none() && group.scene.is_none() {
                LeafOutcome::Unsupported(format!(
                    "group rule on {} has neither power nor scene constraints",
                    group.group_id
                ))
            } else {
                LeafOutcome::Condition(group_condition(group))
            }
        }
        TriggerMode::Pulse | TriggerMode::Edge => LeafOutcome::Unsupported(format!(
            "group rule on {} is an event leaf; v2 has no group trigger",
            group.group_id
        )),
    }
}

fn classify_any_rule(
    rules: &[Rule],
    ids: &mut NodeIdGenerator,
    notes: &mut Vec<String>,
) -> LeafOutcome {
    let mut conditions = Vec::new();
    for rule in rules {
        match classify_rule(rule, ids, notes) {
            LeafOutcome::Condition(condition) => conditions.push(condition),
            LeafOutcome::Event(_) => {
                return LeafOutcome::Unsupported(
                    "any rule contains an event leaf; v1 combines trigger matches disjunctively, which v2 cannot express".to_string(),
                );
            }
            LeafOutcome::Unsupported(reason) => {
                return LeafOutcome::Unsupported(reason);
            }
        }
    }
    LeafOutcome::Condition(ConditionExpr::Any { conditions })
}

fn device_refs(keys: &Option<Vec<crate::types::device::DeviceKey>>) -> Vec<DeviceRef> {
    keys.as_ref()
        .map(|keys| keys.iter().map(DeviceRef::from).collect())
        .unwrap_or_default()
}

fn convert_action(action: &Action, ids: &mut NodeIdGenerator) -> Result<NativeAction, String> {
    match action {
        Action::ActivateScene(descriptor) => {
            let mut descriptors = Vec::new();
            if descriptor.include_source_groups {
                descriptors.push("include_source_groups");
            }
            if descriptor.use_scene_transition {
                descriptors.push("use_scene_transition");
            }
            if descriptor.transition.is_some() {
                descriptors.push("transition");
            }
            if descriptor.rollout.is_some() {
                descriptors.push("rollout");
            }
            if descriptor.rollout_source_device_key.is_some() {
                descriptors.push("rollout_source_device_key");
            }
            if descriptor.rollout_duration_ms.is_some() {
                descriptors.push("rollout_duration_ms");
            }
            if !descriptors.is_empty() {
                return Err(format!(
                    "activate_scene uses {} which has no v2 native equivalent",
                    descriptors.join(", ")
                ));
            }

            let targets = TargetSpec {
                devices: device_refs(&descriptor.device_keys),
                groups: descriptor.group_keys.clone().unwrap_or_default(),
            };

            match &descriptor.mirror_from_group {
                Some(group) => Ok(NativeAction::ActivateScene {
                    id: ids.action_id(),
                    scene_id: None,
                    select: Some(SceneSelection::GroupActive {
                        group_id: group.clone(),
                        fallback_scene_id: Some(descriptor.scene_id.clone()),
                    }),
                    targets,
                }),
                None => Ok(NativeAction::ActivateScene {
                    id: ids.action_id(),
                    scene_id: Some(descriptor.scene_id.clone()),
                    select: None,
                    targets,
                }),
            }
        }
        Action::Dim(descriptor) => {
            if descriptor.include_source_groups {
                return Err(
                    "dim uses include_source_groups, which v2 resolves at rule evaluation time and has no native equivalent".to_string(),
                );
            }
            let targets = TargetSpec {
                devices: device_refs(&descriptor.device_keys),
                groups: descriptor.group_keys.clone().unwrap_or_default(),
            };
            if targets.devices.is_empty() && targets.groups.is_empty() {
                return Err("dim has no target devices or groups".to_string());
            }
            Ok(NativeAction::Dim {
                id: ids.action_id(),
                targets,
                step: descriptor.step.unwrap_or(0.1),
                transition_ms: None,
            })
        }
        other => Err(format!(
            "action {} has no v2 native equivalent",
            action_name(other)
        )),
    }
}

fn action_name(action: &Action) -> &'static str {
    match action {
        Action::ActivateScene(_) => "activate_scene",
        Action::CycleScenes(_) => "cycle_scenes",
        Action::Custom(_) => "custom",
        Action::Dim(_) => "dim",
        Action::ForceTriggerRoutine(_) => "force_trigger_routine",
        Action::SetDeviceState(_) => "set_device_state",
        Action::RandomizeColor(_) => "randomize_color",
        Action::ToggleDeviceOverride { .. } => "toggle_device_override",
        Action::Ui(_) => "ui",
        Action::EvalExpr(_) => "evalexpr",
    }
}

/// Human-readable one-line summary used by the text report.
pub fn conversion_summary(conversion: &RoutineConversion) -> String {
    match &conversion.status {
        ConversionStatus::AlreadyV2 => "already v2".to_string(),
        ConversionStatus::Converted {
            definition, notes, ..
        } => {
            let triggers = definition
                .triggers
                .iter()
                .map(trigger_name)
                .collect::<Vec<_>>()
                .join(", ");
            let actions = program_steps(&definition.program)
                .iter()
                .map(native_action_name)
                .collect::<Vec<_>>()
                .join(", ");
            let mut summary = format!("converted (triggers: {triggers}; actions: {actions})");
            if !notes.is_empty() {
                summary.push_str(&format!(" [{}]", notes.join("; ")));
            }
            summary
        }
        ConversionStatus::NeedsManual { reasons } => {
            format!("needs manual authoring: {}", reasons.join("; "))
        }
        ConversionStatus::Unsupported { reasons } => {
            format!("unsupported: {}", reasons.join("; "))
        }
    }
}

fn trigger_name(trigger: &TriggerSpec) -> String {
    match trigger {
        TriggerSpec::Report { device, .. } => format!("report {}", device_key(device)),
        TriggerSpec::StateChange { device, mode, .. } => match mode {
            StateChangeMode::Transition => format!("transition {}", device_key(device)),
            StateChangeMode::Level => format!("level {}", device_key(device)),
        },
        TriggerSpec::PredicateTransition { .. } => "predicate_transition".to_string(),
        TriggerSpec::PredicateFor { .. } => "predicate_for".to_string(),
        TriggerSpec::Schedule { .. } => "schedule".to_string(),
        TriggerSpec::TimerFired { timer, .. } => format!("timer {timer}"),
        TriggerSpec::Startup { .. } => "startup".to_string(),
        TriggerSpec::Manual { .. } => "manual".to_string(),
    }
}

fn native_action_name(action: &NativeAction) -> &'static str {
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

fn program_steps(program: &Program) -> &[NativeAction] {
    match program {
        Program::Native(program) => &program.steps,
        Program::Script(_) => &[],
    }
}

fn device_key(device: &DeviceRef) -> String {
    match device {
        DeviceRef::Id(id) => format!("{}/{}", id.integration_id, id.device_id),
    }
}

#[cfg(test)]
#[path = "convert_tests.rs"]
mod tests;
