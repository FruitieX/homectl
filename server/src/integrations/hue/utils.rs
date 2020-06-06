use super::bridge::{BridgeSensor, BridgeSensors, ZLLSwitchState};
use crate::homectl_core::{
    device::{Device, DeviceKind, SensorKind},
    events::Message,
    integration::IntegrationId,
    integrations_manager::DeviceId,
};

#[derive(PartialEq)]
pub enum DimmerSwitchButtonId {
    On,
    Up,
    Down,
    Off,
    Unknown,
}

pub fn get_button_id(buttonevent: u32) -> DimmerSwitchButtonId {
    let str = buttonevent.to_string();
    let button_id = str.chars().nth(0);

    match button_id {
        Some('1') => DimmerSwitchButtonId::On,
        Some('2') => DimmerSwitchButtonId::Up,
        Some('3') => DimmerSwitchButtonId::Down,
        Some('4') => DimmerSwitchButtonId::Off,
        _ => DimmerSwitchButtonId::Unknown,
    }
}

pub fn cmp_button_id(buttonevent: u32, button_id: DimmerSwitchButtonId) -> bool {
    let event_button_id = get_button_id(buttonevent);

    event_button_id == button_id
}

pub fn get_button_state(buttonevent: u32) -> bool {
    let str = buttonevent.to_string();
    let state = str.chars().nth(3);

    match state {
        Some('0') => true,  // INITIAL_PRESSED
        Some('1') => true,  // HOLD
        Some('2') => false, // SHORT_RELEASED
        Some('3') => false, // LONG_RELEASED
        _ => true,
    }
}

pub fn is_button_pressed(buttonevent: Option<u32>, button_id: DimmerSwitchButtonId) -> bool {
    match buttonevent {
        Some(buttonevent) => {
            let button_id_match = cmp_button_id(buttonevent, button_id);
            let pressed = get_button_state(buttonevent);

            button_id_match && pressed
        }
        _ => false,
    }
}

pub fn find_old_bridge_sensor(
    old_bridge_sensors: &BridgeSensors,
    sensor_id: &String,
) -> Option<BridgeSensor> {
    old_bridge_sensors
        .get(sensor_id)
        .map(|bridge_sensor| bridge_sensor.clone())
}

fn get_bridge_sensor_name(bridge_sensor: BridgeSensor) -> String {
    match bridge_sensor {
        BridgeSensor::Daylight { name } => name,
        BridgeSensor::ZLLLightLevel { name } => name,
        BridgeSensor::ZLLPresence { name, .. } => name,
        BridgeSensor::ZLLSwitch { name, .. } => name,
        BridgeSensor::ZLLTemperature { name } => name,
    }
}

fn bridge_sensor_to_device(
    id: DeviceId,
    integration_id: IntegrationId,
    bridge_sensor: BridgeSensor,
) -> Device {
    let name = get_bridge_sensor_name(bridge_sensor.clone());
    let scene = None;

    match bridge_sensor {
        BridgeSensor::ZLLPresence { state, .. } => {
            let kind = DeviceKind::Sensor(SensorKind::OnOffSensor {
                value: state.presence,
            });

            Device {
                id,
                name,
                integration_id,
                scene,
                kind,
            }
        }

        BridgeSensor::ZLLSwitch { state, .. } => {
            let kind = DeviceKind::Sensor(SensorKind::DimmerSwitch {
                on: is_button_pressed(state.buttonevent, DimmerSwitchButtonId::On),
                up: is_button_pressed(state.buttonevent, DimmerSwitchButtonId::Up),
                down: is_button_pressed(state.buttonevent, DimmerSwitchButtonId::Down),
                off: is_button_pressed(state.buttonevent, DimmerSwitchButtonId::Off),
            });

            Device {
                id,
                name,
                integration_id,
                scene,
                kind,
            }
        }

        _ => {
            let kind = DeviceKind::Sensor(SensorKind::Unknown);

            Device {
                id,
                name,
                integration_id,
                scene,
                kind,
            }
        }
    }
}

/// Do some extrapolation on old and new bridge_sensor states to try and figure
/// out what individual state transitions might have occurred
///
/// Usually this will return a Vec with 0 or 1 items, but there are some
/// scenarios where we might have missed some events due to polling.
pub fn get_sensor_device_update_messages(
    sensor_id: DeviceId,
    integration_id: IntegrationId,
    old_bridge_sensor: Option<BridgeSensor>,
    bridge_sensor: BridgeSensor,
) -> Vec<Message> {
    // Quick optimization: if the states are equal, there are no updates
    if old_bridge_sensor == Some(bridge_sensor.clone()) {
        return vec![];
    }

    match (old_bridge_sensor.clone(), bridge_sensor.clone()) {
        // ZLLPresence sensor updates are infrequent enough that we should not
        // need to worry about missing out on updates
        (_, BridgeSensor::ZLLPresence { .. }) => {
            let old = old_bridge_sensor.map(|bridge_sensor| {
                bridge_sensor_to_device(
                    sensor_id.clone(),
                    integration_id.clone(),
                    bridge_sensor.clone(),
                )
            });

            let new = bridge_sensor_to_device(sensor_id, integration_id, bridge_sensor);

            vec![Message::DeviceRefresh { device: new }]
        }

        // ZLLSwitches can be pressed quickly, and a naive polling implementation would
        // miss out on a lot of button events.
        (
            Some(BridgeSensor::ZLLSwitch {
                state:
                    ZLLSwitchState {
                        buttonevent: Some(old_buttonevent),
                        lastupdated: old_lastupdated,
                    },
                ..
            }),
            BridgeSensor::ZLLSwitch {
                state:
                    ZLLSwitchState {
                        buttonevent: Some(buttonevent),
                        lastupdated,
                    },
                ..
            },
        ) => {
            let mut events = Vec::new();

            let prev_button_id = get_button_id(buttonevent);
            let next_button_id = get_button_id(buttonevent);

            let prev_button_state = get_button_state(old_buttonevent);
            let next_button_state = get_button_state(buttonevent);

            // button ID and states remained unchanged but timestamp changed, assume we missed the first half of a button press/release (or release/press) cycle
            if prev_button_id == next_button_id && prev_button_state == next_button_state {
                // events.push(Message::DeviceRefresh {})
            }

            events
        }
        _ => Vec::new(),
    }
}
