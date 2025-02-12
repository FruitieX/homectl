use super::color::DeviceColor;
use super::device::{ControllableState, DeviceKey};

use super::{group::GroupId, integration::IntegrationId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct DimDeviceLink {
    pub device_key: Option<DeviceKey>,
    pub name: Option<String>,
    pub brightness: Option<f32>, // allow overriding brightness
}

#[derive(TS, Clone, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct DimDescriptor {
    /// Optionally only apply dimming to these devices
    pub device_keys: Option<Vec<DeviceKey>>,

    /// Optionally only apply dimming to these groups
    pub group_keys: Option<Vec<GroupId>>,

    // The amount to dim
    pub step: Option<f32>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct DimDeviceState {
    pub power: bool,
    pub color: Option<DeviceColor>,
    pub brightness: Option<f32>,
    #[ts(type = "number | null")]
    pub transition: Option<f32>,
}

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[serde(untagged)]
#[ts(export)]
pub enum DimDeviceConfig {
    /// Link to another device, means the dim should read current state from
    /// another device
    DeviceLink(DimDeviceLink),

    /// Link to another dim, means the dim should merge all state from another
    /// dim
    DimLink(DimDescriptor),

    /// State to be applied to a device
    DeviceState(DimDeviceState),
}

// pub type DimDevicesConfig = HashMap<IntegrationId, HashMap<DeviceId, DimDeviceConfig>>;

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct DimGroupsConfig(pub HashMap<GroupId, DimDeviceConfig>);

/// Device "search" config as used directly in the configuration file. We use device names instead of device id as key.
#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct DimDevicesSearchConfig(pub HashMap<IntegrationId, HashMap<String, DimDeviceConfig>>);

#[derive(TS, Clone, Deserialize, Debug, Serialize)]
#[ts(export)]
pub struct DimConfig {
    pub name: String,
    pub devices: Option<DimDevicesSearchConfig>,
    pub groups: Option<DimGroupsConfig>,
    pub hidden: Option<bool>,
}

// pub type DimsConfig = HashMap<SceneId, DimConfig>;

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq)]
#[ts(export)]
pub struct DimDeviceStates(pub HashMap<DeviceKey, ControllableState>);

#[derive(TS, Clone, Deserialize, Debug, Serialize, PartialEq)]
#[ts(export)]
pub struct FlattenedDimConfig {
    pub name: String,
    pub devices: DimDeviceStates,
    pub hidden: Option<bool>,
}

// #[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Default)]
// #[ts(export)]
// pub struct FlattenedDimsConfig(pub HashMap<SceneId, FlattenedDimConfig>);
