use super::integration::IntegrationId;
use palette::Lch;
use std::time::Instant;

/// simple on/off devices such as relays, lights
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct OnOffDevice {
    power: bool,
}

/// lights with adjustable brightness and/or color
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    pub power: bool,
    pub brightness: Option<f64>,
    pub color: Option<Lch>,
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
}

#[derive(Clone, Debug, PartialEq)]
pub enum DeviceKind {
    OnOffDevice(OnOffDevice),
    Light(Light),
    Sensor(SensorKind),
}

/// active scene that's controlling the device state, if any
#[derive(Clone, Debug, PartialEq)]
pub struct DeviceSceneState {
    scene_name: String,
    activation_time: Instant,
}

/// unique identifier for the Device
type DeviceId = String;

#[derive(Clone, Debug, PartialEq)]
pub struct Device<T = DeviceKind> {
    pub id: DeviceId,
    pub name: String,
    pub integration_id: IntegrationId,
    pub scene: Option<DeviceSceneState>,
    pub kind: T,
}
