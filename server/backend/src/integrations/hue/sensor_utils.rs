use super::bridge::{
    BridgeButtonEvent, BridgeSensor, BridgeSensorId, BridgeSensors, ZLLSwitchState,
};
use homectl_types::{
    device::{Device, DeviceId, DeviceState, SensorKind},
    integration::IntegrationId,
};

#[derive(Clone, PartialEq)]
pub enum DimmerSwitchButtonId {
    On,
    Up,
    Down,
    Off,
    Unknown,
}

/// Returns which DimmerSwitchButtonId is referred to in BridgeButtonEvent
fn get_button_id(buttonevent: BridgeButtonEvent) -> DimmerSwitchButtonId {
    let str = buttonevent.to_string();
    let button_id = str.chars().next();

    match button_id {
        Some('1') => DimmerSwitchButtonId::On,
        Some('2') => DimmerSwitchButtonId::Up,
        Some('3') => DimmerSwitchButtonId::Down,
        Some('4') => DimmerSwitchButtonId::Off,
        _ => DimmerSwitchButtonId::Unknown,
    }
}

/// Returns whether BridgeButtonEvent refers to DimmerSwitchButtonId
pub fn cmp_button_id(buttonevent: BridgeButtonEvent, button_id: DimmerSwitchButtonId) -> bool {
    let event_button_id = get_button_id(buttonevent);

    event_button_id == button_id
}

/// Returns whether BridgeButtonEvent is in a pressed state or not
fn get_button_state(buttonevent: BridgeButtonEvent) -> bool {
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

/// Returns whether DimmerSwitchButtonId is in a pressed state in the
/// BridgeButtonEvent
pub fn is_button_pressed(
    buttonevent: Option<BridgeButtonEvent>,
    button_id: DimmerSwitchButtonId,
) -> bool {
    match buttonevent {
        Some(buttonevent) => {
            let button_id_match = cmp_button_id(buttonevent, button_id);
            let pressed = get_button_state(buttonevent);

            button_id_match && pressed
        }
        _ => false,
    }
}

/// Tries to find BridgeSensor with matching BridgeSensorId
pub fn find_bridge_sensor(
    bridge_sensors: &BridgeSensors,
    sensor_id: &BridgeSensorId,
) -> Option<BridgeSensor> {
    bridge_sensors.get(sensor_id).cloned()
}

/// Returns name of BridgeSensor
fn get_bridge_sensor_name(bridge_sensor: BridgeSensor) -> String {
    match bridge_sensor {
        BridgeSensor::Daylight { name } => name,
        BridgeSensor::ZLLLightLevel { name } => name,
        BridgeSensor::ZLLPresence { name, .. } => name,
        BridgeSensor::ZLLSwitch { name, .. } => name,
        BridgeSensor::ZLLTemperature { name } => name,
        BridgeSensor::CLIPPresence { name } => name,
        BridgeSensor::CLIPGenericStatus { name } => name,
        BridgeSensor::CLIPGenericFlag { name } => name,
    }
}

/// Converts BridgeSensor into Device
pub fn bridge_sensor_to_device(
    id: DeviceId,
    integration_id: IntegrationId,
    bridge_sensor: BridgeSensor,
) -> Device {
    let id = DeviceId::new(&format!("sensors/{}", id));
    let name = get_bridge_sensor_name(bridge_sensor.clone());
    let scene = None;

    match bridge_sensor {
        BridgeSensor::ZLLPresence { state, .. } => {
            let kind = DeviceState::Sensor(SensorKind::OnOffSensor {
                value: state.presence.unwrap_or_default(),
            });

            Device {
                id,
                name,
                integration_id,
                scene,
                state: kind,
            }
        }

        BridgeSensor::ZLLSwitch { state, .. } => {
            let kind = DeviceState::Sensor(SensorKind::DimmerSwitch {
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
                state: kind,
            }
        }

        _ => {
            let kind = DeviceState::Sensor(SensorKind::Unknown);

            Device {
                id,
                name,
                integration_id,
                scene,
                state: kind,
            }
        }
    }
}

/// Best effort conversion of DimmerSwitchButtonId and button_state back into a
/// BridgeButtonEvent. This conversion is lossy because we don't have the data
/// needed to reconstruct the exact button state.
fn to_buttonevent(button_id: DimmerSwitchButtonId, button_state: bool) -> BridgeButtonEvent {
    let mut s = String::new();

    s.push(match button_id {
        DimmerSwitchButtonId::On => '1',
        DimmerSwitchButtonId::Up => '2',
        DimmerSwitchButtonId::Down => '3',
        DimmerSwitchButtonId::Off => '4',
        _ => '0',
    });
    s.push('0');
    s.push('0');
    s.push(match button_state {
        true => '0',  // INITIAL_PRESSED
        false => '2', // SHORT_RELEASED
    });

    let buttonevent: BridgeButtonEvent = s.parse().unwrap_or(1000);

    buttonevent
}

/// Do some extrapolation on old and new bridge_sensor states to try and figure
/// out what individual state transitions might have occurred
///
/// Usually this will return a Vec with 0 or 1 items, but there are some
/// scenarios where we might have missed some events due to polling.
pub fn extrapolate_sensor_updates(
    prev_bridge_sensor: Option<BridgeSensor>,
    next_bridge_sensor: BridgeSensor,
) -> Vec<BridgeSensor> {
    // Quick optimization: if the states are equal, there are no updates
    if prev_bridge_sensor == Some(next_bridge_sensor.clone()) {
        return vec![];
    }

    match (prev_bridge_sensor, next_bridge_sensor.clone()) {
        // ZLLPresence sensor updates are infrequent enough that we should not
        // need to worry about missing out on updates
        (_, BridgeSensor::ZLLPresence { .. }) => vec![next_bridge_sensor],

        // ZLLSwitches can be pressed quickly, and a naive polling implementation would
        // miss out on a lot of button state transition events.
        (
            Some(BridgeSensor::ZLLSwitch {
                state:
                    ZLLSwitchState {
                        buttonevent: Some(prev_buttonevent),
                        lastupdated: prev_lastupdated,
                    },
                ..
            }),
            BridgeSensor::ZLLSwitch {
                state:
                    ZLLSwitchState {
                        buttonevent: Some(next_buttonevent),
                        lastupdated: next_lastupdated,
                    },
                name,
            },
        ) => {
            let mut updates = Vec::new();

            let prev_button_id = get_button_id(prev_buttonevent);
            let next_button_id = get_button_id(next_buttonevent);

            let prev_button_state = get_button_state(prev_buttonevent);
            let next_button_state = get_button_state(next_buttonevent);

            // button ID and states remained unchanged but timestamp changed,
            // assume we missed the first half of a button press/release (or
            // release/press) cycle
            if prev_button_id == next_button_id
                && prev_button_state == next_button_state
                && prev_lastupdated != next_lastupdated
            {
                updates.push(BridgeSensor::ZLLSwitch {
                    state: ZLLSwitchState {
                        buttonevent: Some(to_buttonevent(
                            prev_button_id.clone(),
                            !prev_button_state,
                        )),
                        lastupdated: next_lastupdated.clone(),
                    },
                    name: name.clone(),
                });
            }

            // button ID has changed and the old button state was left pressed,
            // release it
            if prev_button_id != next_button_id && prev_button_state {
                updates.push(BridgeSensor::ZLLSwitch {
                    state: ZLLSwitchState {
                        buttonevent: Some(to_buttonevent(prev_button_id.clone(), false)),
                        lastupdated: next_lastupdated.clone(),
                    },
                    name: name.clone(),
                });
            }

            // button ID has changed and the new button state is released,
            // assume we missed a button press event
            if prev_button_id != next_button_id && !next_button_state {
                updates.push(BridgeSensor::ZLLSwitch {
                    state: ZLLSwitchState {
                        buttonevent: Some(to_buttonevent(next_button_id, true)),
                        lastupdated: next_lastupdated,
                    },
                    name,
                });
            }

            // push most recent button event last
            updates.push(next_bridge_sensor);

            updates
        }
        _ => Vec::new(),
    }
}
