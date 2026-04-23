use color_eyre::Result;
use eyre::ContextCompat;
use regex::Regex;
use serde_json::Value;

use crate::db::config_queries;
use crate::types::{
    action::{Action, Actions},
    device::{Device, DeviceKey, DevicesState, SensorDevice},
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
use std::collections::{HashMap, HashSet};

use super::{devices::Devices, groups::Groups, scripting::ScriptEngine};

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
        }) => {
            if *include_source_groups {
                merge_source_groups(group_keys, &source_groups);
                *include_source_groups = false;
            }
        }
        _ => {}
    }

    action
}

#[derive(Clone)]
pub struct Routines {
    config: RoutinesConfig,
    event_tx: TxEventChannel,
    runtime_statuses: RoutineStatuses,
    /// Tracks which (routine_id, device_key) pairs have been triggered.
    /// Used for edge-triggered rules to prevent re-triggering until state changes away.
    prev_edge_triggered: HashSet<(RoutineId, DeviceKey)>,
}

#[derive(Default)]
struct EvaluationResult {
    actions: Actions,
    statuses: RoutineStatuses,
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
            runtime_statuses: Default::default(),
            prev_edge_triggered: HashSet::new(),
        }
    }

    pub fn load_config_rows(&mut self, routines: &[config_queries::RoutineRow]) {
        let mut new_config = RoutinesConfig::new();
        for routine in routines {
            if !routine.enabled {
                continue;
            }

            let rules: Vec<Rule> =
                serde_json::from_value(routine.rules.clone()).unwrap_or_default();
            let actions: Actions =
                serde_json::from_value(routine.actions.clone()).unwrap_or_default();

            new_config.insert(
                RoutineId::from(routine.id.clone()),
                Routine {
                    name: routine.name.clone(),
                    rules,
                    actions,
                },
            );
        }

        self.config = new_config;
        self.runtime_statuses = Default::default();
        self.prev_edge_triggered.clear();
    }

    /// Hot-reload routines configuration from the database
    pub async fn reload_from_db(&mut self) -> Result<()> {
        let db_routines = config_queries::db_get_routines().await?;

        self.load_config_rows(&db_routines);

        Ok(())
    }

    pub fn refresh_runtime_statuses(&mut self, devices: &Devices, groups: &Groups) {
        let current_state = devices.get_state().clone();
        let evaluation =
            self.evaluate_routines(&current_state, &current_state, None, devices, groups, false);
        self.runtime_statuses = evaluation.statuses;
    }

    pub fn get_runtime_statuses(&self) -> RoutineStatuses {
        self.runtime_statuses.clone()
    }

    /// An internal state update has occurred, we need to check if any routines
    /// are triggered by this change and run actions of triggered rules.
    #[allow(clippy::too_many_arguments)]
    pub async fn handle_internal_state_update(
        &mut self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        old: &Option<Device>,
        event_source: &Device,
        devices: &Devices,
        groups: &Groups,
    ) {
        // For sensors in pulse mode, we need to process even when the device
        // already exists and state hasn't changed. Skip only for truly new devices.
        if old.is_some() || event_source.is_sensor() {
            let event_source_key = event_source.get_device_key();
            let evaluation = self.evaluate_routines(
                old_state,
                new_state,
                Some(&event_source_key),
                devices,
                groups,
                true,
            );
            self.runtime_statuses = evaluation.statuses;

            for action in evaluation.actions {
                self.event_tx.send(Event::Action(action.clone()));
            }
        } else {
            self.refresh_runtime_statuses(devices, groups);
        }
    }

    pub fn force_trigger_routine(&self, routine_id: &RoutineId) -> Result<()> {
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

        for action in routine_actions {
            self.event_tx.send(Event::Action(action.clone()));
        }

        Ok(())
    }

    fn evaluate_routines(
        &mut self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        update_edge_state: bool,
    ) -> EvaluationResult {
        let mut triggered_actions = Vec::new();
        let mut routine_statuses = HashMap::new();

        let routine_ids: Vec<RoutineId> = self.config.keys().cloned().collect();

        for routine_id in routine_ids {
            let routine = self.config.get(&routine_id).unwrap().clone();
            let status = self.evaluate_routine_status(
                &routine_id,
                &routine,
                old_state,
                new_state,
                event_source,
                devices,
                groups,
                update_edge_state,
            );

            if status.will_trigger {
                info!(
                    "Routine triggered: id={} name={:?} actions={} event_source={:?}",
                    routine_id.0,
                    routine.name,
                    routine.actions.len(),
                    event_source,
                );
                triggered_actions.extend(
                    routine
                        .actions
                        .iter()
                        .cloned()
                        .map(|action| expand_action_source_context(action, event_source, groups)),
                );
            }

            routine_statuses.insert(routine_id, status);
        }

        EvaluationResult {
            actions: triggered_actions,
            statuses: RoutineStatuses(routine_statuses),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn evaluate_routine_status(
        &mut self,
        routine_id: &RoutineId,
        routine: &Routine,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        update_edge_state: bool,
    ) -> RoutineRuntimeStatus {
        let rule_statuses = routine
            .rules
            .iter()
            .map(|rule| {
                self.evaluate_rule_status(
                    routine_id,
                    rule,
                    old_state,
                    new_state,
                    event_source,
                    devices,
                    groups,
                    update_edge_state,
                )
            })
            .collect::<Vec<_>>();

        let all_conditions_match =
            !rule_statuses.is_empty() && rule_statuses.iter().all(|status| status.condition_match);
        let will_trigger =
            !rule_statuses.is_empty() && rule_statuses.iter().all(|status| status.trigger_match);

        RoutineRuntimeStatus {
            all_conditions_match,
            will_trigger,
            rules: rule_statuses,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn evaluate_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &Rule,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        update_edge_state: bool,
    ) -> RuleRuntimeStatus {
        match self.try_evaluate_rule_status(
            routine_id,
            rule,
            old_state,
            new_state,
            event_source,
            devices,
            groups,
            update_edge_state,
        ) {
            Ok(status) => status,
            Err(error) => {
                error!("Routine rule evaluation error: {error}");
                RuleRuntimeStatus::from_error(error.to_string())
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::only_used_in_recursion)]
    fn try_evaluate_rule_status(
        &mut self,
        routine_id: &RoutineId,
        rule: &Rule,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        update_edge_state: bool,
    ) -> Result<RuleRuntimeStatus> {
        match rule {
            Rule::Any(AnyRule { any: rules }) => {
                let children = rules
                    .iter()
                    .map(|child_rule| {
                        self.evaluate_rule_status(
                            routine_id,
                            child_rule,
                            old_state,
                            new_state,
                            event_source,
                            devices,
                            groups,
                            update_edge_state,
                        )
                    })
                    .collect::<Vec<_>>();

                Ok(RuleRuntimeStatus::from_children(
                    children.iter().any(|status| status.condition_match),
                    children.iter().any(|status| status.trigger_match),
                    children,
                ))
            }
            Rule::Sensor(sensor_rule) => self.evaluate_sensor_rule_status(
                routine_id,
                sensor_rule,
                old_state,
                event_source,
                devices,
                update_edge_state,
            ),
            Rule::Raw(raw_rule) => self.evaluate_raw_rule_status(
                routine_id,
                raw_rule,
                old_state,
                event_source,
                devices,
                update_edge_state,
            ),
            Rule::Device(device_rule) => self.evaluate_device_rule_status(
                routine_id,
                device_rule,
                old_state,
                event_source,
                devices,
                update_edge_state,
            ),
            Rule::Group(group_rule) => self.evaluate_group_rule_status(
                routine_id,
                group_rule,
                old_state,
                event_source,
                devices,
                groups,
                update_edge_state,
            ),
            Rule::EvalExpr(expr) => Err(eyre!(
                "Legacy evalexpr rules are no longer supported: {expr}"
            )),
            Rule::Script(ScriptRule { script }) => {
                let mut engine = ScriptEngine::new();
                let device_state = devices.get_state();
                let flattened_groups = groups.get_flattened_groups();
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
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        update_edge_state: bool,
    ) -> Result<RuleRuntimeStatus> {
        let device = devices
            .get_device_by_ref(&rule.device_ref)
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
            if update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => event_source.map(|es| es == &device_key).unwrap_or(false),
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    false
                } else {
                    let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                    if !is_event_source {
                        false
                    } else {
                        let old_device = old_state.0.get(&device_key);
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
                        if trigger_match && update_edge_state {
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
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        update_edge_state: bool,
    ) -> Result<RuleRuntimeStatus> {
        let device = devices
            .get_device_by_ref(&rule.device_ref)
            .ok_or_else(|| eyre!("Could not find matching device for raw rule: {:?}", rule))?;

        let device_key = device.get_device_key();
        let state_matches = evaluate_raw_rule_match(device.get_raw_value().as_ref(), rule)?;

        if !state_matches {
            if update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => event_source.map(|es| es == &device_key).unwrap_or(false),
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    false
                } else {
                    let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                    if !is_event_source {
                        false
                    } else {
                        let old_device = old_state.0.get(&device_key);
                        let old_matched = match old_device {
                            Some(device) => {
                                evaluate_raw_rule_match(device.get_raw_value().as_ref(), rule)?
                            }
                            None => false,
                        };

                        let trigger_match = !old_matched;
                        if trigger_match && update_edge_state {
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
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        update_edge_state: bool,
    ) -> Result<RuleRuntimeStatus> {
        let device = devices
            .get_device_by_ref(&rule.device_ref)
            .ok_or_else(|| eyre!("Could not find matching device for rule: {:?}", rule))?;

        let device_key = device.get_device_key();

        let state_matches = check_device_state_matches(device, &rule.scene, &rule.power);

        if !state_matches {
            if update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => event_source.map(|es| es == &device_key).unwrap_or(false),
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    false
                } else {
                    let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                    if !is_event_source {
                        false
                    } else {
                        let old_device = old_state.0.get(&device_key);
                        let old_matched = old_device
                            .map(|d| check_device_state_matches(d, &rule.scene, &rule.power))
                            .unwrap_or(false);

                        let trigger_match = !old_matched;
                        if trigger_match && update_edge_state {
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
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        update_edge_state: bool,
    ) -> Result<RuleRuntimeStatus> {
        let group_devices = groups.find_group_devices(devices.get_state(), &rule.group_id);

        if group_devices.is_empty() {
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let all_match = group_devices
            .iter()
            .all(|device| check_device_state_matches(device, &rule.scene, &rule.power));

        if !all_match {
            if update_edge_state && rule.trigger_mode == TriggerMode::Edge {
                for device in &group_devices {
                    self.prev_edge_triggered
                        .remove(&(routine_id.clone(), device.get_device_key()));
                }
            }
            return Ok(RuleRuntimeStatus::from_match(false, false));
        }

        let trigger_match = match rule.trigger_mode {
            TriggerMode::Pulse => group_devices.iter().any(|device| {
                event_source
                    .map(|es| es == &device.get_device_key())
                    .unwrap_or(false)
            }),
            TriggerMode::Edge => {
                let any_is_source = group_devices.iter().any(|device| {
                    event_source
                        .map(|es| es == &device.get_device_key())
                        .unwrap_or(false)
                });

                if !any_is_source {
                    false
                } else {
                    let old_all_matched = group_devices.iter().all(|device| {
                        let device_key = device.get_device_key();
                        old_state
                            .0
                            .get(&device_key)
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
    use super::{evaluate_raw_rule_match, expand_action_source_context, Routines};
    use crate::core::{devices::Devices, groups::Groups};
    use crate::types::action::{Action, Actions};
    use crate::types::device::{Device, DeviceData, DeviceId, DeviceKey, DeviceRef, SensorDevice};
    use crate::types::event::{mk_event_channel, RxEventChannel};
    use crate::types::group::GroupsConfig;
    use crate::types::integration::IntegrationId;
    use crate::types::rule::{
        RawRule, RawRuleOperator, Routine, RoutineId, RoutinesConfig, Rule, TriggerMode,
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
        let old_state = devices.get_state().clone();

        let matching_device = sensor_device(json!({ "payload": { "temperature": 21 } }));
        devices.set_state(&matching_device, true, true);
        let new_state = devices.get_state().clone();

        let first = routines.evaluate_rule_status(
            &routine_id,
            &rule,
            &old_state,
            &new_state,
            Some(&device_key),
            &devices,
            &groups,
            true,
        );
        assert!(first.condition_match);
        assert!(first.trigger_match);

        let second = routines.evaluate_rule_status(
            &routine_id,
            &rule,
            &old_state,
            &new_state,
            Some(&device_key),
            &devices,
            &groups,
            true,
        );
        assert!(second.condition_match);
        assert!(!second.trigger_match);

        let leaving_state = devices.get_state().clone();
        let non_matching_device = sensor_device(json!({ "payload": { "temperature": 19 } }));
        devices.set_state(&non_matching_device, true, true);
        let rearm_state = devices.get_state().clone();

        let cleared = routines.evaluate_rule_status(
            &routine_id,
            &rule,
            &leaving_state,
            &rearm_state,
            Some(&device_key),
            &devices,
            &groups,
            true,
        );
        assert!(!cleared.condition_match);
        assert!(!cleared.trigger_match);

        let old_non_matching = devices.get_state().clone();
        devices.set_state(&matching_device, true, true);
        let reentered_state = devices.get_state().clone();

        let retriggered = routines.evaluate_rule_status(
            &routine_id,
            &rule,
            &old_non_matching,
            &reentered_state,
            Some(&device_key),
            &devices,
            &groups,
            true,
        );
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
}
