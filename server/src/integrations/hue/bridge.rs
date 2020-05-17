use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct BridgeLightState {
    on: bool,
    bri: Option<u32>,
    hue: Option<u32>,
    sat: Option<u32>,
    transitiontime: Option<u32>,
    reachable: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct BridgeLight {
    state: BridgeLightState,
    name: String,
}

pub type BridgeLightId = String;
pub type BridgeLights = HashMap<BridgeLightId, BridgeLight>;

#[derive(Debug, Deserialize)]
pub struct ZLLPresenceState {
    presence: bool,
    lastupdated: String,
}

#[derive(Debug, Deserialize)]
pub struct ZLLSwitchState {
    buttonevent: Option<u32>,
    lastupdated: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeSensor {
    Daylight {
        name: String,
    },
    ZLLLightLevel {
        name: String,
    },
    ZLLPresence {
        name: String,
        state: ZLLPresenceState,
    },
    ZLLSwitch {
        name: String,
        state: ZLLSwitchState,
    },
    ZLLTemperature {
        name: String,
    },
}

pub type BridgeSensorId = String;
pub type BridgeSensors = HashMap<BridgeSensorId, BridgeSensor>;

#[derive(Debug, Deserialize)]
pub struct BridgeState {
    lights: BridgeLights,
    sensors: BridgeSensors,
}
