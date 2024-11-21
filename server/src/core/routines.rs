use evalexpr::HashMapContext;
use eyre::{ContextCompat, Result};

use crate::types::{
    action::Actions,
    device::{Device, DevicesState, SensorDevice},
    event::{Event, TxEventChannel},
    rule::{AnyRule, DeviceRule, GroupRule, Routine, RoutineId, RoutinesConfig, Rule},
};
use std::collections::HashSet;

use super::{devices::Devices, expr::Expr, groups::Groups};

#[derive(Clone)]
pub struct Routines {
    config: RoutinesConfig,
    event_tx: TxEventChannel,
    prev_triggered_routine_ids: Option<HashSet<RoutineId>>,
}

impl Routines {
    pub fn new(config: RoutinesConfig, event_tx: TxEventChannel) -> Self {
        Routines {
            config,
            event_tx,
            prev_triggered_routine_ids: Default::default(),
        }
    }

    /// An internal state update has occurred, we need to check if any routines
    /// are triggered by this change and run actions of triggered rules.
    pub async fn handle_internal_state_update(
        &mut self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        old: &Option<Device>,
        devices: &Devices,
        groups: &Groups,
        expr: &Expr,
    ) {
        if old.is_some() {
            let matching_actions =
                self.find_matching_actions(old_state, new_state, devices, groups, expr);

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
        devices: &Devices,
        groups: &Groups,
        expr: &Expr,
    ) -> Actions {
        // if states are equal we can bail out early
        if old_state == new_state {
            return vec![];
        }

        let prev_triggered_routine_ids =
            self.prev_triggered_routine_ids.clone().unwrap_or_default();
        let new_triggered_routine_ids = self.get_triggered_routine_ids(devices, groups, expr);

        {
            self.prev_triggered_routine_ids = Some(new_triggered_routine_ids.clone());
        }

        // The difference between the two sets will contain only routines that
        // were triggered just now.
        let triggered_routine_ids =
            new_triggered_routine_ids.difference(&prev_triggered_routine_ids);

        triggered_routine_ids.flat_map(|id| {
                let routine = self
                    .config
                    .get(id)
                    .expect("Expected triggered_routine_ids to only contain ids of routines existing in the RoutinesConfig");
                routine.actions.clone()
            })
            .collect()
    }

    /// Returns a set of routine ids that are currently triggered with the given
    /// state.
    fn get_triggered_routine_ids(
        &self,
        devices: &Devices,
        groups: &Groups,
        expr: &Expr,
    ) -> HashSet<RoutineId> {
        let eval_context = expr.get_context();

        let triggered_routine_ids: HashSet<RoutineId> = self
            .config
            .iter()
            .filter(|(_, routine)| is_routine_triggered(devices, groups, routine, eval_context))
            .map(|(routine_id, _)| routine_id.clone())
            .collect();

        triggered_routine_ids
    }
}

/// Returns true if all rules of the given routine are triggered.
fn is_routine_triggered(
    devices: &Devices,
    groups: &Groups,
    routine: &Routine,
    eval_context: &HashMapContext,
) -> bool {
    if routine.rules.is_empty() {
        return false;
    }

    routine.rules.iter().all(|rule| {
        let result = is_rule_triggered(devices, groups, rule, eval_context);
        match result {
            Ok(result) => result,
            Err(error) => {
                error!(
                    "Error while checking routine {name}: {error}",
                    name = routine.name
                );
                false
            }
        }
    })
}

/// Returns true if rule state matches device state
fn compare_rule_device_state(rule: &Rule, device: &Device) -> Result<bool> {
    let sensor_state: Option<&SensorDevice> = device.get_sensor_state();

    match rule {
        Rule::Any(_) | Rule::EvalExpr(_) => {
            unreachable!("compare_rule_device_state() cannot be called for Any or EvalExpr rules");
        }
        // Check for sensor value matches
        Rule::Sensor(rule) => match (&rule.state, sensor_state) {
            (
                SensorDevice::Boolean { value: rule_value },
                Some(SensorDevice::Boolean {
                    value: sensor_value,
                }),
            ) => Ok(rule_value == sensor_value),
            (
                SensorDevice::Text { value: rule_value },
                Some(SensorDevice::Text {
                    value: sensor_value,
                }),
            ) => Ok(rule_value == sensor_value),
            (rule, sensor) => Err(eyre!(
                "Unknown sensor states encountered when processing rule {rule:?}. (sensor: {sensor:?})"
            )),
        },
        Rule::Group(GroupRule { scene, power, .. })
        | Rule::Device(DeviceRule { scene, power, .. }) => {
            #[allow(clippy::if_same_then_else)]
            // Check for scene field mismatch (if provided)
            if scene.is_some() && scene.as_ref() != device.get_scene_id().as_ref() {
                Ok(false)
            }
            // Check for power field mismatch (if provided)
            else if power.is_some() && power != &device.is_powered_on() {
                Ok(false)
            }
            // Otherwise rule matches
            else {
                Ok(true)
            }
        }
    }
}

/// Returns true if rule is triggered
fn is_rule_triggered(
    devices: &Devices,
    groups: &Groups,
    rule: &Rule,
    eval_context: &HashMapContext,
) -> Result<bool> {
    // Try finding matching device
    let devices = match rule {
        Rule::Any(AnyRule { any: rules }) => {
            let any_triggered = rules
                .iter()
                .map(|rule| is_rule_triggered(devices, groups, rule, eval_context))
                .any(|result| matches!(result, Ok(true)));

            return Ok(any_triggered);
        }
        Rule::Sensor(rule) => {
            vec![devices
                .get_device_by_ref(&rule.device_ref)
                .ok_or(eyre!("Could not find matching sensor for rule: {rule:?}"))?]
        }
        Rule::Device(rule) => {
            vec![devices
                .get_device_by_ref(&rule.device_ref)
                .ok_or(eyre!("Could not find matching device for rule: {rule:?}"))?]
        }
        Rule::Group(rule) => groups.find_group_devices(devices.get_state(), &rule.group_id),
        Rule::EvalExpr(expr) => {
            let result = expr.eval_boolean_with_context(eval_context)?;
            return Ok(result);
        }
    };

    // Make sure we found at least one device to check against
    if devices.is_empty() {
        return Ok(false);
    }

    // Make sure rule is triggered for every device it contains
    for device in devices {
        let triggered = compare_rule_device_state(rule, device)?;
        if !triggered {
            return Ok(false);
        }
    }

    Ok(true)
}
