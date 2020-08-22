use super::{integration::IntegrationId, scene::SceneId};
use palette::Hsv;
use std::time::Instant;

/// simple on/off devices such as relays, lights
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct OnOffDevice {
    pub power: bool,
}

// TODO: use Lch?
pub type DeviceColor = Hsv;

/// lights with adjustable brightness and/or color
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    pub power: bool,

    /// Current brightness, if supported
    pub brightness: Option<f64>,

    /// Current color, if supported
    pub color: Option<DeviceColor>,
}

/// lights with multiple individually adjustable light sources
#[derive(Clone, Debug, PartialEq)]
pub struct MultiSourceLight {
    pub power: bool,

    /// Global brightness control for all lights in this MultiSourceLight
    pub brightness: Option<f64>,

    /// List of colors, one for each light in this MultiSourceLight
    pub lights: Vec<DeviceColor>,
}

/// button sensors, motion sensors
#[derive(Copy, Clone, Debug, PartialEq)]
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

#[derive(Clone, Debug, PartialEq)]
pub enum DeviceState {
    OnOffDevice(OnOffDevice),
    Light(Light),
    MultiSourceLight(MultiSourceLight),
    Sensor(SensorKind),
}

/// active scene that's controlling the device state, if any
#[derive(Clone, Debug, PartialEq)]
pub struct DeviceSceneState {
    pub scene_id: SceneId,
    pub activation_time: Instant,
}

/// unique identifier for the Device
pub type DeviceId = String;

#[derive(Clone, Debug, PartialEq)]
pub struct Device<T = DeviceState> {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub scene: Option<DeviceSceneState>,
    pub state: T,
}
