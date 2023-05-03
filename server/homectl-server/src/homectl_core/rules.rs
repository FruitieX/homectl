use homectl_types::{
    action::{Action, Actions},
    device::{Device, DeviceState, DevicesState, SensorKind},
    event::{Message, TxEventChannel},
    rule::{
        AnyRule, DeviceRule, GroupRule, Routine, RoutineId, RoutinesConfig, Rule, SensorRuleState,
    },
};
use std::collections::HashSet;

use crate::homectl_core::devices::find_device;

use super::groups::Groups;

#[derive(Clone)]
pub struct Rules {
    config: RoutinesConfig,
    sender: TxEventChannel,
    groups: Groups,
}

impl Rules {
    pub fn new(config: RoutinesConfig, groups: Groups, sender: TxEventChannel) -> Self {
        Rules {
            config,
            sender,
            groups,
        }
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

        let prev_triggered_routine_ids =
            get_triggered_routine_ids(&self.config, &self.groups, old_state);
        let new_triggered_routine_ids =
            get_triggered_routine_ids(&self.config, &self.groups, new_state);

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

fn get_device_sensor_kind(device: &Device) -> Option<SensorKind> {
    match &device.state {
        DeviceState::Sensor(sensor_kind) => Some(sensor_kind.clone()),
        _ => None,
    }
}

fn compare_rule_device_state(rule: &Rule, device: &Device) -> Result<bool, String> {
    let sensor_kind = get_device_sensor_kind(device);

    match rule {
        Rule::Any(_) => {
            panic!("compare_rule_device_state() cannot be called directly on Any rule");
        }
        Rule::Sensor(rule) => {
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
        Rule::Group(GroupRule { scene, power, .. })
        | Rule::Device(DeviceRule { scene, power, .. }) => {
            #[allow(clippy::if_same_then_else)]
            if scene.is_some() && scene.as_ref() != device.scene.as_ref().map(|s| &s.scene_id) {
                Ok(false)
            } else if power.is_some() && power != &device.state.is_powered_on() {
                Ok(false)
            } else {
                Ok(true)
            }
        }
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::homectl_core::config::Config;
    use homectl_types::{group::GroupId, scene::SceneId, websockets::WebSocketResponse};

    #[test]
    fn test_is_rule_triggered() {
        let fixtures_file =
            std::fs::read_to_string("./src/homectl_core/state-downstairs-on-upstairs-off.json")
                .unwrap();
        let msg: WebSocketResponse = serde_json::from_str(&fixtures_file).unwrap();
        let config: Config = toml::from_str(
            r#"
[groups.kitchen]
name = "Kitchen"
devices = [
  { integration_id = "hue1", name = "Kitchen table" },
  { integration_id = "hue1", name = "Kitchen lightstrip" },
  { integration_id = "hue1", name = "Kitchen lightstrip upper" },
  { integration_id = "hue1", name = "Kitchen spot 1" },
  { integration_id = "hue1", name = "Kitchen spot 2" },
  { integration_id = "hue1", name = "Kitchen spot 3" },
  { integration_id = "tuya", name = "Kitchen downlight 1" },
  { integration_id = "tuya", name = "Kitchen downlight 2" },
  { integration_id = "tuya", name = "Kitchen downlight 3" },
  { integration_id = "tuya", name = "Kitchen downlight 4" },
]

[groups.living_room]
name = "Living room"
devices = [
  { integration_id = "hue1", name = "Living room" },
  { integration_id = "hue1", name = "Block lamp" },
  { integration_id = "hue1", name = "Hue play L" },
  { integration_id = "hue1", name = "Hue play R" },
  { integration_id = "tuya", name = "Living room downlight 1" },
  { integration_id = "tuya", name = "Living room downlight 2" },
  { integration_id = "tuya", name = "Living room downlight 3" },
  { integration_id = "tuya", name = "Living room downlight 4" },
]
        "#,
        )
        .unwrap();

        let groups = Groups::new(config.groups.unwrap());

        let WebSocketResponse::State(update) = msg;

        let state = update.devices;
        let rule = Rule::Group(GroupRule {
            group_id: GroupId::new("living_room".to_string()),
            power: None,
            scene: Some(SceneId::new("normal".to_string())),
        });

        assert!(is_rule_triggered(&state, &groups, &rule).unwrap());
    }
}
