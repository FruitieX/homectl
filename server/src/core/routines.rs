use color_eyre::Result;
use eyre::ContextCompat;

use crate::db::config_queries;
use crate::types::{
    action::Actions,
    device::{Device, DeviceKey, DevicesState, SensorDevice},
    event::{Event, TxEventChannel},
    routine_status::{RoutineRuntimeStatus, RoutineStatuses, RuleRuntimeStatus},
    rule::{
        AnyRule, DeviceRule, GroupRule, Routine, RoutineId, RoutinesConfig, Rule, ScriptRule,
        SensorRule, TriggerMode,
    },
};
use std::collections::{HashMap, HashSet};

use super::{devices::Devices, groups::Groups, scripting::ScriptEngine};

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

            let rules: Vec<Rule> = serde_json::from_value(routine.rules.clone()).unwrap_or_default();
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
                triggered_actions.extend(routine.actions.clone());
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
