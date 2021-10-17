use homectl_types::{action::{Action, Actions}, device::{Device, DeviceState, DevicesState, SensorKind}, event::{Message, TxEventChannel}, rule::{Routine, RoutineId, RoutinesConfig, Rule, SensorRuleState}};
use std::collections::HashSet;

use crate::homectl_core::devices::find_device;

#[derive(Clone)]
pub struct Rules {
    config: RoutinesConfig,
    sender: TxEventChannel,
}

impl Rules {
    pub fn new(config: RoutinesConfig, sender: TxEventChannel) -> Self {
        Rules { config, sender }
    }

    pub async fn handle_device_update(
        &self,
        old_state: &DevicesState,
        new_state: &DevicesState,
        old: &Option<Device>,
        _new: &Device,
    ) {
        match old {
            Some(_) => {
                // println!("device_updated {:?} (was: {:?})", new, old);

                let matching_actions = self.find_matching_actions(old_state, new_state);

                for action in matching_actions {
                    self.run_action(&action).await;
                }
            }
            None => {}
        }
    }

    async fn run_action(&self, action: &Action) {
        self.sender.send(Message::Action(action.clone()));
    }

    fn find_matching_actions(&self, old_state: &DevicesState, new_state: &DevicesState) -> Actions {
        // if states are equal we can bail out early
        if old_state == new_state {
            return vec![];
        }

        let prev_triggered_routine_ids = get_triggered_routine_ids(&self.config, old_state);
        let new_triggered_routine_ids = get_triggered_routine_ids(&self.config, new_state);

        let triggered_routine_ids =
            new_triggered_routine_ids.difference(&prev_triggered_routine_ids);

        triggered_routine_ids
            .map(|id| {
                let routine = self
                    .config
                    .get(id)
                    .expect("Expected triggered_routine_ids to only contain ids of routines existing in the RoutinesConfig");
                routine.actions.clone()
            })
            .flatten()
            .collect()
    }
}

fn get_triggered_routine_ids(
    routines: &RoutinesConfig,
    state: &DevicesState,
) -> HashSet<RoutineId> {
    let triggered_routine_ids: HashSet<RoutineId> = routines
        .iter()
        .filter(|(_, routine)| match is_routine_triggered(state, routine) {
            Ok(triggered) => triggered,
            Err(e) => {
                println!("Error while checking routine {:?} rules: {}", routine, e);
                false
            }
        })
        .map(|(routine_id, _)| routine_id.clone())
        .collect();

    triggered_routine_ids
}

fn is_routine_triggered(state: &DevicesState, routine: &Routine) -> Result<bool, String> {
    let result = routine
        .rules
        .iter()
        .map(|rule| is_rule_triggered(state, rule))
        .all(|result| result == Ok(true));

    Ok(result)
}

fn get_device_sensor_kind(device: &Device) -> Option<SensorKind> {
    match device.state {
        DeviceState::Sensor(sensor_kind) => Some(sensor_kind),
        _ => None,
    }
}

fn compare_rule_device_state(rule: &Rule, device: &Device) -> Result<bool, String> {
    let sensor_kind = get_device_sensor_kind(device);

    // FIXME: there must be a better way
    match (rule.state.clone(), sensor_kind) {
        (
            SensorRuleState::OnOffSensor { value: rule_value },
            Some(SensorKind::OnOffSensor {
                value: sensor_value,
            }),
        ) => Ok(rule_value == sensor_value),
        (
            SensorRuleState::DimmerSwitch {
                on: Some(rule_on),
                up: _,
                down: _,
                off: _,
            },
            Some(SensorKind::DimmerSwitch {
                on: sensor_on,
                up: _,
                down: _,
                off: _,
            }),
        ) => Ok(rule_on == sensor_on),
        (
            SensorRuleState::DimmerSwitch {
                on: _,
                up: Some(rule_up),
                down: _,
                off: _,
            },
            Some(SensorKind::DimmerSwitch {
                on: _,
                up: sensor_up,
                down: _,
                off: _,
            }),
        ) => Ok(rule_up == sensor_up),
        (
            SensorRuleState::DimmerSwitch {
                on: _,
                up: _,
                down: Some(rule_down),
                off: _,
            },
            Some(SensorKind::DimmerSwitch {
                on: _,
                up: _,
                down: sensor_down,
                off: _,
            }),
        ) => Ok(rule_down == sensor_down),
        (
            SensorRuleState::DimmerSwitch {
                on: _,
                up: _,
                down: _,
                off: Some(rule_off),
            },
            Some(SensorKind::DimmerSwitch {
                on: _,
                up: _,
                down: _,
                off: sensor_off,
            }),
        ) => Ok(rule_off == sensor_off),
        (rule, sensor) => Err(format!(
            "Unknown sensor states encountered when processing rule {:?}. (sensor: {:?})",
            rule, sensor,
        )),
    }
}

fn is_rule_triggered(state: &DevicesState, rule: &Rule) -> Result<bool, String> {
    // Try finding matching device
    let device = find_device(
        state,
        &rule.integration_id,
        rule.device_id.as_ref(),
        rule.name.as_ref(),
    )
    .ok_or(format!(
        "Could not find matching device for rule: {:?}",
        rule
    ))?;

    let triggered = compare_rule_device_state(rule, &device)?;

    Ok(triggered)
}
