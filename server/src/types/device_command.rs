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
    /// Activate this effect (preset). The preset defines the look, so the
    /// requested colors are cleared.
    #[serde(default)]
    #[ts(optional)]
    pub effect: Option<String>,
    /// Set every color slot. This customises the look, so the requested
    /// effect is cleared; slot 0 also becomes the primary color.
    #[serde(default)]
    #[ts(optional)]
    pub colors: Option<Vec<DeviceColor>>,
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
