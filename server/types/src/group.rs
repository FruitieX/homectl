use super::{device::DeviceId, integration::IntegrationId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

macro_attr! {
    #[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, NewtypeDisplay!)]
    pub struct GroupId(String);
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct GroupDeviceLink {
    pub integration_id: IntegrationId,
    pub device_id: Option<DeviceId>,
    pub name: Option<String>,
}

pub type GroupDeviceLinks = HashMap<GroupId, Vec<GroupDeviceLink>>;
pub type GroupDevicesConfig = Vec<GroupDeviceLink>;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct GroupLink {
    pub group_id: GroupId,
}

pub type GroupLinksConfig = Vec<GroupLink>;

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct GroupConfig {
    pub name: String,
    pub devices: Option<GroupDevicesConfig>,
    pub groups: Option<GroupLinksConfig>,
}

pub type GroupsConfig = HashMap<GroupId, GroupConfig>;
