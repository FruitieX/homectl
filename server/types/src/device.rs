use std::collections::HashMap;

use super::{integration::IntegrationId, scene::SceneId};
use chrono::{DateTime, Utc};
use palette::Hsv;
use rocket::request::FromParam;
use serde::{Deserialize, Serialize};

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    /// unique identifier for the Device
    pub struct DeviceId(String);
}

impl DeviceId {
    pub fn new(id: &str) -> DeviceId {
        DeviceId(String::from(id))
    }
}

impl<'a> FromParam<'a> for DeviceId {
    type Error = ();

    fn from_param(param: &'a str) -> Result<Self, Self::Error> {
        Ok(DeviceId::new(param))
    }
}

/// simple on/off devices such as relays, lights
#[derive(Copy, Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct OnOffDevice {
    pub power: bool,
}

// TODO: use Lch?
pub type DeviceColor = Hsv;

/// lights with adjustable brightness and/or color
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Light {
    pub power: bool,

    /// Current brightness, if supported
    pub brightness: Option<f64>,

    /// Current color, if supported
    pub color: Option<DeviceColor>,

    /// Transition time in milliseconds
    pub transition_ms: Option<u64>,
}

/// lights with multiple individually adjustable light sources
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct MultiSourceLight {
    pub power: bool,

    /// Global brightness control for all lights in this MultiSourceLight
    pub brightness: Option<f64>,

    /// List of colors, one for each light in this MultiSourceLight
    pub lights: Vec<DeviceColor>,
}

/// button sensors, motion sensors
#[derive(Copy, Clone, Debug, PartialEq, Deserialize, Serialize)]
pub enum SensorKind {
    OnOffSensor {
        value: bool,
    },
    DimmerSwitch {
        on: bool,
        up: bool,
        down: bool,
        off: bool,
    },
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub enum DeviceState {
    OnOffDevice(OnOffDevice),
    Light(Light),
    MultiSourceLight(MultiSourceLight),
    Sensor(SensorKind),
}

/// active scene that's controlling the device state, if any
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct DeviceSceneState {
    pub scene_id: SceneId,

    pub activation_time: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Device<T = DeviceState> {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub scene: Option<DeviceSceneState>,
    pub state: T,
    pub locked: bool,
}

pub type DeviceStateKey = (IntegrationId, DeviceId);
pub type DevicesState = HashMap<DeviceStateKey, Device>;
