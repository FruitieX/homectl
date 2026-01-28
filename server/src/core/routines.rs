use color_eyre::Result;
use evalexpr::HashMapContext;
use eyre::ContextCompat;

use crate::db::config_queries;
use crate::types::{
    action::Actions,
    device::{Device, DeviceKey, DevicesState, SensorDevice},
    event::{Event, TxEventChannel},
    rule::{
        AnyRule, DeviceRule, GroupRule, Routine, RoutineId, RoutinesConfig, Rule, ScriptRule,
        SensorRule, TriggerMode,
    },
};
use std::collections::HashSet;

use super::{devices::Devices, expr::Expr, groups::Groups, scripting::ScriptEngine};

#[derive(Clone)]
pub struct Routines {
    config: RoutinesConfig,
    event_tx: TxEventChannel,
    /// Tracks which (routine_id, device_key) pairs have been triggered.
    /// Used for edge-triggered rules to prevent re-triggering until state changes away.
    prev_edge_triggered: HashSet<(RoutineId, DeviceKey)>,
}

impl Routines {
    pub fn new(config: RoutinesConfig, event_tx: TxEventChannel) -> Self {
        Routines {
            config,
            event_tx,
            prev_edge_triggered: HashSet::new(),
        }
    }

    /// Hot-reload routines configuration from the database
    pub async fn reload_from_db(&mut self) -> Result<()> {
        let db_routines = config_queries::db_get_routines().await?;

        // Convert DB rows to RoutinesConfig
        let mut new_config = RoutinesConfig::new();
        for routine in db_routines {
            // Skip disabled routines
            if !routine.enabled {
                continue;
            }

            // Parse rules and actions from JSON
            let rules: Vec<Rule> = serde_json::from_value(routine.rules).unwrap_or_default();
            let actions: Actions = serde_json::from_value(routine.actions).unwrap_or_default();

            new_config.insert(
                RoutineId::from(routine.id),
                Routine {
                    name: routine.name,
                    rules,
                    actions,
                },
            );
        }

        self.config = new_config;
        // Reset triggered state on reload
        self.prev_edge_triggered.clear();

        Ok(())
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
        expr: &Expr,
    ) {
        // For sensors in pulse mode, we need to process even when the device
        // already exists and state hasn't changed. Skip only for truly new devices.
        if old.is_some() || event_source.is_sensor() {
            let event_source_key = event_source.get_device_key();
            let matching_actions = self.find_matching_actions(
                old_state,
                new_state,
                Some(&event_source_key),
                devices,
                groups,
                expr,
            );

            for action in matching_actions {
                self.event_tx.send(Event::Action(action.clone()));
            }
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

    /// Find any rules that were triggered by transitioning from `old_state` to
    /// `new_state`, and return all actions of those rules.
    fn find_matching_actions(
        &mut self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        expr: &Expr,
    ) -> Actions {
        // Note: We do NOT bail out early when old_state == new_state, because
        // pulse mode routines need to trigger on every sensor update, even when
        // the value is the same (e.g., repeated button presses).

        let eval_context = expr.get_context();
        let mut triggered_actions = Vec::new();

        // Collect routine IDs first to avoid borrow issues
        let routine_ids: Vec<RoutineId> = self.config.keys().cloned().collect();

        for routine_id in routine_ids {
            let routine = self.config.get(&routine_id).unwrap().clone();
            let trigger_result = self.check_routine_triggered(
                &routine_id,
                &routine,
                old_state,
                new_state,
                event_source,
                devices,
                groups,
                eval_context,
            );

            if trigger_result {
                triggered_actions.extend(routine.actions.clone());
            }
        }

        triggered_actions
    }

    /// Check if a routine should trigger based on its rules and trigger modes.
    #[allow(clippy::too_many_arguments)]
    fn check_routine_triggered(
        &mut self,
        routine_id: &RoutineId,
        routine: &Routine,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        eval_context: &HashMapContext,
    ) -> bool {
        if routine.rules.is_empty() {
            return false;
        }

        // Check if all rules are triggered
        let all_rules_match = routine.rules.iter().all(|rule| {
            let result = self.is_rule_triggered(
                routine_id,
                rule,
                old_state,
                new_state,
                event_source,
                devices,
                groups,
                eval_context,
            );
            match result {
                Ok(triggered) => triggered,
                Err(error) => {
                    error!(
                        "Error while checking routine {name}: {error}",
                        name = routine.name
                    );
                    false
                }
            }
        });

        all_rules_match
    }

    /// Returns true if a rule is triggered, taking trigger_mode into account.
    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::only_used_in_recursion)]
    fn is_rule_triggered(
        &mut self,
        routine_id: &RoutineId,
        rule: &Rule,
        old_state: &DevicesState,
        new_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
        eval_context: &HashMapContext,
    ) -> Result<bool> {
        match rule {
            Rule::Any(AnyRule { any: rules }) => {
                let any_triggered = rules.iter().any(|rule| {
                    self.is_rule_triggered(
                        routine_id,
                        rule,
                        old_state,
                        new_state,
                        event_source,
                        devices,
                        groups,
                        eval_context,
                    )
                    .unwrap_or(false)
                });
                Ok(any_triggered)
            }
            Rule::Sensor(sensor_rule) => self.check_sensor_rule_triggered(
                routine_id,
                sensor_rule,
                old_state,
                event_source,
                devices,
            ),
            Rule::Device(device_rule) => self.check_device_rule_triggered(
                routine_id,
                device_rule,
                old_state,
                event_source,
                devices,
            ),
            Rule::Group(group_rule) => self.check_group_rule_triggered(
                routine_id,
                group_rule,
                old_state,
                event_source,
                devices,
                groups,
            ),
            Rule::EvalExpr(expr) => {
                let result = expr.eval_boolean_with_context(eval_context)?;
                Ok(result)
            }
            Rule::Script(ScriptRule { script }) => {
                // Evaluate JavaScript script
                let mut engine = ScriptEngine::new();
                let device_state = devices.get_state();
                let flattened_groups = groups.get_flattened_groups();
                match engine.eval_rule_script(script, device_state, flattened_groups) {
                    Ok(result) => Ok(result),
                    Err(e) => {
                        error!("Script rule evaluation error: {e}");
                        Ok(false)
                    }
                }
            }
        }
    }

    /// Check if a sensor rule is triggered, respecting trigger_mode.
    fn check_sensor_rule_triggered(
        &mut self,
        routine_id: &RoutineId,
        rule: &SensorRule,
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
    ) -> Result<bool> {
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
            // State doesn't match - for edge mode, clear the triggered state
            if rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(false);
        }

        // State matches - now check trigger mode
        match rule.trigger_mode {
            TriggerMode::Pulse => {
                // Pulse mode: only trigger if this device is the event source
                let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                Ok(is_event_source)
            }
            TriggerMode::Edge => {
                // Edge mode: only trigger on transition from non-matching to matching
                let edge_key = (routine_id.clone(), device_key.clone());

                // Check if we were already triggered
                if self.prev_edge_triggered.contains(&edge_key) {
                    // Already triggered, don't trigger again
                    return Ok(false);
                }

                // Check if this is the event source (state just changed)
                let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                if !is_event_source {
                    // Not the event source, so this is not a transition
                    return Ok(false);
                }

                // Check if the old state didn't match (this is a transition)
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

                if old_matched {
                    // Old state also matched, so this is not a transition
                    return Ok(false);
                }

                // This is a valid edge transition - mark as triggered
                self.prev_edge_triggered.insert(edge_key);
                Ok(true)
            }
            TriggerMode::Level => {
                // Level mode: trigger while state matches (original behavior)
                Ok(true)
            }
        }
    }

    /// Check if a device rule is triggered, respecting trigger_mode.
    fn check_device_rule_triggered(
        &mut self,
        routine_id: &RoutineId,
        rule: &DeviceRule,
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
    ) -> Result<bool> {
        let device = devices
            .get_device_by_ref(&rule.device_ref)
            .ok_or_else(|| eyre!("Could not find matching device for rule: {:?}", rule))?;

        let device_key = device.get_device_key();

        // Check if state matches
        let state_matches = check_device_state_matches(device, &rule.scene, &rule.power);

        if !state_matches {
            if rule.trigger_mode == TriggerMode::Edge {
                self.prev_edge_triggered
                    .remove(&(routine_id.clone(), device_key));
            }
            return Ok(false);
        }

        match rule.trigger_mode {
            TriggerMode::Pulse => {
                let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                Ok(is_event_source)
            }
            TriggerMode::Edge => {
                let edge_key = (routine_id.clone(), device_key.clone());

                if self.prev_edge_triggered.contains(&edge_key) {
                    return Ok(false);
                }

                let is_event_source = event_source.map(|es| es == &device_key).unwrap_or(false);
                if !is_event_source {
                    return Ok(false);
                }

                // Check if old state didn't match
                let old_device = old_state.0.get(&device_key);
                let old_matched = old_device
                    .map(|d| check_device_state_matches(d, &rule.scene, &rule.power))
                    .unwrap_or(false);

                if old_matched {
                    return Ok(false);
                }

                self.prev_edge_triggered.insert(edge_key);
                Ok(true)
            }
            TriggerMode::Level => Ok(true),
        }
    }

    /// Check if a group rule is triggered, respecting trigger_mode.
    fn check_group_rule_triggered(
        &mut self,
        routine_id: &RoutineId,
        rule: &GroupRule,
        old_state: &DevicesState,
        event_source: Option<&DeviceKey>,
        devices: &Devices,
        groups: &Groups,
    ) -> Result<bool> {
        let group_devices = groups.find_group_devices(devices.get_state(), &rule.group_id);

        if group_devices.is_empty() {
            return Ok(false);
        }

        // For group rules, ALL devices in the group must match
        let all_match = group_devices
            .iter()
            .all(|device| check_device_state_matches(device, &rule.scene, &rule.power));

        if !all_match {
            // Clear edge state for all devices in group
            if rule.trigger_mode == TriggerMode::Edge {
                for device in &group_devices {
                    self.prev_edge_triggered
                        .remove(&(routine_id.clone(), device.get_device_key()));
                }
            }
            return Ok(false);
        }

        match rule.trigger_mode {
            TriggerMode::Pulse => {
                // For group rules in pulse mode, at least one device must be the event source
                let any_is_source = group_devices.iter().any(|device| {
                    event_source
                        .map(|es| es == &device.get_device_key())
                        .unwrap_or(false)
                });
                Ok(any_is_source)
            }
            TriggerMode::Edge => {
                // For group rules in edge mode, we use a combined key
                // Only trigger on transition when at least one device changed
                let any_is_source = group_devices.iter().any(|device| {
                    event_source
                        .map(|es| es == &device.get_device_key())
                        .unwrap_or(false)
                });

                if !any_is_source {
                    return Ok(false);
                }

                // Check if old state didn't match for all devices
                let old_all_matched = group_devices.iter().all(|device| {
                    let device_key = device.get_device_key();
                    old_state
                        .0
                        .get(&device_key)
                        .map(|d| check_device_state_matches(d, &rule.scene, &rule.power))
                        .unwrap_or(false)
                });

                if old_all_matched {
                    // Group was already fully matching
                    return Ok(false);
                }

                Ok(true)
            }
            TriggerMode::Level => Ok(true),
        }
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
