use homectl_types::device::DeviceId;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
pub enum ColorMode {
    #[serde(rename = "hs")]
    Hs,

    #[serde(rename = "xy")]
    Xy,

    #[serde(rename = "ct")]
    Ct
}

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeLightState {
    pub on: bool,
    pub bri: Option<u8>,
    pub hue: Option<u16>,
    pub sat: Option<u8>,
    pub xy: Option<(f32, f32)>,
    pub ct: Option<u16>,
    pub colormode: Option<ColorMode>,
    pub transitiontime: Option<u16>,
    pub reachable: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeLight {
    pub state: BridgeLightState,
    pub name: String,
}

pub type BridgeLightId = DeviceId;
pub type BridgeLights = HashMap<BridgeLightId, BridgeLight>;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ZLLPresenceState {
    pub presence: Option<bool>,
    pub lastupdated: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ZLLTemperatureState {
    pub temperature: Option<f64>,
    pub lastupdated: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ZLLLightLevelState {
    pub lightlevel: Option<f64>,
    pub dark: Option<bool>,
    pub daylight: Option<bool>,
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
        state: ZLLLightLevelState,
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
        state: ZLLTemperatureState,
    },
    CLIPPresence {
        name: String,
    },
    CLIPGenericStatus {
        name: String,
    },
    CLIPGenericFlag {
        name: String,
    },
}

pub type BridgeSensorId = DeviceId;
pub type BridgeSensors = HashMap<BridgeSensorId, BridgeSensor>;

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeState {
    pub lights: BridgeLights,
    pub sensors: BridgeSensors,
}
