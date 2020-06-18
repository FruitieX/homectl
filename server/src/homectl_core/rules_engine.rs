use super::{
    device::{Device, DeviceState, SensorKind},
    devices_manager::{mk_device_state_key, DevicesState},
    events::{Message, TxEventChannel},
    rule::{Action, Actions, Routine, RoutineId, RoutinesConfig, Rule, SensorRuleState},
};
use std::collections::HashSet;

pub struct RulesEngine {
    config: RoutinesConfig,
    sender: TxEventChannel,
}

impl RulesEngine {
    pub fn new(config: RoutinesConfig, sender: TxEventChannel) -> Self {
        RulesEngine { config, sender }
    }

    pub fn handle_device_update(
        &self,
        old_state: DevicesState,
        new_state: DevicesState,
        old: Option<Device>,
        new: Device,
    ) {
        match old {
            Some(old) => {
                println!("device_updated {:?} (was: {:?})", new, old);

                let matching_actions = self.find_matching_actions(old_state, new_state);

                for action in matching_actions {
                    self.run_action(&action);
                }
            }
            None => {}
        }
    }

    fn run_action(&self, action: &Action) {
        match action {
            Action::ActivateScene(action) => {
                self.sender
                    .send(Message::ActivateScene(action.clone()))
                    .unwrap();
            }
        }
    }

    fn find_matching_actions(&self, old_state: DevicesState, new_state: DevicesState) -> Actions {
        let prev_triggered_routine_ids: HashSet<RoutineId> = self
            .config
            .clone()
            .into_iter()
            .filter(|(_, routine)| is_routine_triggered(&old_state, routine).unwrap())
            .map(|(routine_id, _)| routine_id)
            .collect();

        let new_triggered_routine_ids: HashSet<RoutineId> = self
            .config
            .clone()
            .into_iter()
            .filter(|(_, routine)| is_routine_triggered(&new_state, routine).unwrap())
            .map(|(routine_id, _)| routine_id)
            .collect();

        let triggered_routine_ids =
            new_triggered_routine_ids.difference(&prev_triggered_routine_ids);

        triggered_routine_ids
            .map(|id| {
                let routine = self.config.get(id).unwrap();
                routine.actions.clone()
            })
            .flatten()
            .collect()
    }
}

fn is_routine_triggered(state: &DevicesState, routine: &Routine) -> Result<bool, String> {
    Ok(routine
        .rules
        .iter()
        // FIXME: unsafe .unwrap()
        .all(|rule| is_rule_triggered(state, rule).unwrap()))
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
    let device = state
        .get(&mk_device_state_key(&rule.integration_id, &rule.device_id))
        .ok_or(format!(
            "Could not find device: {} / {}",
            rule.integration_id, rule.device_id
        ))?;

    let triggered = compare_rule_device_state(rule, device)?;

    Ok(triggered)
}
