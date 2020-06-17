pub type GroupId = String;

use super::{
    device::DeviceId,
    integration::IntegrationId,
};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Deserialize, Debug)]
pub struct GroupDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: DeviceId,
}

pub type GroupDevicesConfig = Vec<GroupDeviceLink>;

#[derive(Clone, Deserialize, Debug)]
pub struct GroupLink {
    pub group_id: GroupId,
}

pub type GroupLinksConfig = Vec<GroupLink>;

#[derive(Clone, Deserialize, Debug)]
pub struct GroupConfig {
    pub name: String,
    pub devices: Option<GroupDevicesConfig>,
    pub groups: Option<GroupLinksConfig>,
}

pub type GroupsConfig = HashMap<GroupId, GroupConfig>;
