use super::{color::DeviceColor, device::DeviceKey};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A patch expressing user intent. Omitted fields preserve actor-owned state.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct DeviceCommand {
    pub request_id: String,
    pub device_key: DeviceKey,
    pub power: Option<bool>,
    pub brightness: Option<f32>,
    pub color: Option<DeviceColor>,
    pub transition: Option<f32>,
    #[serde(default)]
    pub preserve_scene: bool,
}

/// Acknowledges application to runtime state, not physical device delivery.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct DeviceCommandResult {
    pub request_id: String,
    pub applied: bool,
    pub error: Option<String>,
}
