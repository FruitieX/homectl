use palette::Lch;
use std::time::Instant;

// simple on/off devices such as relays, lights
#[derive(Copy, Clone)]
pub struct OnOffDevice {
    power: bool,
}

// lights with adjustable brightness and/or color
pub struct Light {
    power: bool,
    brightness: f64,
    color: Option<Lch>,
}

// button sensors, motion sensors
pub struct OnOffSensor {
    value: bool,
}

#[derive(Clone)]
pub enum DeviceKind {
    OnOffDevice,
    Light,
    OnOffSensor,
}

#[derive(Clone)]
pub struct DeviceSceneState {
    scene_name: String,
    activation_time: Instant,
}

#[derive(Clone)]
pub struct Device<T = DeviceKind> {
    // unique identifier for the Device
    id: String,

    // active scene that's controlling the device state, if any
    scene: Option<DeviceSceneState>,

    // useful for disabling a Device completely, for example disabling a motion sensor during nighttime
    enabled: bool,

    kind: T,
}
