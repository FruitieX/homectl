use crate::types::{
    action::Actions,
    device::{Device, DevicesState, SensorDevice},
    event::{Message, TxEventChannel},
    rule::{AnyRule, DeviceRule, GroupRule, Routine, RoutineId, RoutinesConfig, Rule},
};
use std::collections::HashSet;

use crate::core::devices::find_device;

use super::groups::Groups;

#[derive(Clone)]
pub struct Rules {
    config: RoutinesConfig,
    event_tx: TxEventChannel,
    groups: Groups,
}

impl Rules {
    pub fn new(config: RoutinesConfig, groups: Groups, event_tx: TxEventChannel) -> Self {
        Rules {
            config,
            event_tx,
            groups,
        }
    }

    /// An internal state update has occurred, we need to check if any rules are
    /// triggered by this change and run actions of triggered rules.
    pub async fn handle_internal_state_update(
        &self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        old: &Option<Device>,
        _new: &Device,
    ) {
        match old {
            Some(_) => {
                let matching_actions = self.find_matching_actions(old_state, new_state);

                for action in matching_actions {
                    self.event_tx.send(Message::Action(action.clone()));
                }
            }
            None => {}
        }
    }

    /// Find any rules that were triggered by transitioning from `old_state` to
    /// `new_state`, and return all actions of those rules.
    fn find_matching_actions(&self, old_state: &DevicesState, new_state: &DevicesState) -> Actions {
        // if states are equal we can bail out early
        if old_state == new_state {
            return vec![];
        }

        let prev_triggered_routine_ids =
            get_triggered_routine_ids(&self.config, &self.groups, old_state);
        let new_triggered_routine_ids =
            get_triggered_routine_ids(&self.config, &self.groups, new_state);

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
}

/// Returns a set of routine ids that are currently triggered with the given
/// state.
fn get_triggered_routine_ids(
    routines: &RoutinesConfig,
    groups: &Groups,
    state: &DevicesState,
) -> HashSet<RoutineId> {
    let triggered_routine_ids: HashSet<RoutineId> = routines
        .iter()
        .filter(
            |(_, routine)| match is_routine_triggered(state, groups, routine) {
                Ok(triggered) => triggered,
                Err(e) => {
                    println!("Error while checking routine {:?} rules: {}", routine, e);
                    false
                }
            },
        )
        .map(|(routine_id, _)| routine_id.clone())
        .collect();

    triggered_routine_ids
}

/// Returns true if all rules of the given routine are triggered.
fn is_routine_triggered(
    state: &DevicesState,
    groups: &Groups,
    routine: &Routine,
) -> Result<bool, String> {
    let result = routine
        .rules
        .iter()
        .map(|rule| is_rule_triggered(state, groups, rule))
        .all(|result| result == Ok(true));

    Ok(result)
}

/// Returns true if rule state matches device state
fn compare_rule_device_state(rule: &Rule, device: &Device) -> Result<bool, String> {
    let sensor_state: Option<&SensorDevice> = device.get_sensor_state();

    match rule {
        Rule::Any(_) => {
            panic!("compare_rule_device_state() cannot be called directly on Any rule");
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
            (rule, sensor) => Err(format!(
                "Unknown sensor states encountered when processing rule {:?}. (sensor: {:?})",
                rule, sensor,
            )),
        },
        Rule::Group(GroupRule { scene, power, .. })
        | Rule::Device(DeviceRule { scene, power, .. }) => {
            #[allow(clippy::if_same_then_else)]
            // Check for scene field mismatch (if provided)
            if scene.is_some() && scene.as_ref() != device.get_scene().as_ref() {
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
fn is_rule_triggered(state: &DevicesState, groups: &Groups, rule: &Rule) -> Result<bool, String> {
    // Try finding matching device
    let devices = match rule {
        Rule::Any(AnyRule { any: rules }) => {
            let any_triggered = rules
                .iter()
                .map(|rule| is_rule_triggered(state, groups, rule))
                .any(|result| result == Ok(true));

            return Ok(any_triggered);
        }
        Rule::Sensor(rule) => {
            vec![find_device(
                state,
                &rule.integration_id,
                rule.device_id.as_ref(),
                rule.name.as_ref(),
            )
            .ok_or(format!(
                "Could not find matching sensor for rule: {:?}",
                rule
            ))?]
        }
        Rule::Device(rule) => {
            vec![find_device(
                state,
                &rule.integration_id,
                rule.device_id.as_ref(),
                rule.name.as_ref(),
            )
            .ok_or(format!(
                "Could not find matching device for rule: {:?}",
                rule
            ))?]
        }
        Rule::Group(rule) => {
            let group_device_links = groups.find_group_device_links(&rule.group_id);
            let group_devices: Result<Vec<Device>, _> = group_device_links
                .iter()
                .map(|gdl| {
                    find_device(
                        state,
                        &gdl.integration_id,
                        gdl.device_id.as_ref(),
                        gdl.name.as_ref(),
                    )
                    .ok_or(format!(
                        "Could not find matching device for rule: {:?}",
                        rule
                    ))
                })
                .collect();

            group_devices?
        }
    };

    // Make sure rule is triggered for every device it contains
    for device in devices {
        let triggered = compare_rule_device_state(rule, &device)?;
        if !triggered {
            return Ok(false);
        }
    }

    Ok(true)
}
