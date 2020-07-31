use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeLightState {
    pub on: bool,
    pub bri: Option<u32>,
    pub hue: Option<u32>,
    pub sat: Option<u32>,
    pub xy: Option<(f32, f32)>,
    pub transitiontime: Option<u32>,
    pub reachable: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeLight {
    pub state: BridgeLightState,
    pub name: String,
}

pub type BridgeLightId = String;
pub type BridgeLights = HashMap<BridgeLightId, BridgeLight>;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ZLLPresenceState {
    pub presence: bool,
    pub lastupdated: String,
}

pub type BridgeButtonEvent = u32;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ZLLSwitchState {
    // Might be None for new switches with no buttonevents yet
    pub buttonevent: Option<BridgeButtonEvent>,
    pub lastupdated: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
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

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeState {
    pub lights: BridgeLights,
    pub sensors: BridgeSensors,
}
