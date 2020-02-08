use palette::Lch;
use std::time::{SystemTime, UNIX_EPOCH};

// simple on/off devices such as relays, lights
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

pub enum DeviceKind {
  OnOffDevice,
  Light,
  OnOffSensor,
}

pub struct Device<T = DeviceKind> {
  id: String,
  kind: T,
}

pub struct DeviceSceneState {
  scene_name: String,
  activation_time: SystemTime,
}

pub struct DeviceWishState<T = DeviceKind> {
  device: Device<T>,
  scene: Option<DeviceSceneState>,
}
