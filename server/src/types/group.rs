use super::device::{DeviceKey, DeviceRef};

use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, convert::Infallible};
use ts_rs::TS;

macro_attr! {
    #[derive(TS, Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash, Ord, PartialOrd, NewtypeDisplay!)]
    #[ts(export)]
    pub struct GroupId(pub String);
}

impl std::str::FromStr for GroupId {
    type Err = Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(GroupId(s.to_string()))
    }
}

pub type GroupDevicesConfig = Vec<DeviceRef>;

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Hash)]
pub struct GroupLink {
    pub group_id: GroupId,
}

pub type GroupLinksConfig = Vec<GroupLink>;

#[derive(Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Hash)]
pub struct GroupConfig {
    pub name: String,
    pub devices: Option<GroupDevicesConfig>,
    pub groups: Option<GroupLinksConfig>,
    pub hidden: Option<bool>,
}

pub type GroupsConfig = BTreeMap<GroupId, GroupConfig>;

#[derive(TS, Clone, Deserialize, Serialize, Debug, Eq, PartialEq, Hash)]
#[ts(export)]
pub struct FlattenedGroupConfig {
    pub name: String,
    pub device_keys: Vec<DeviceKey>,
    pub hidden: Option<bool>,
}

#[derive(TS, Clone, Deserialize, Serialize, Debug, PartialEq, Eq, Default, Hash)]
#[ts(export)]
pub struct FlattenedGroupsConfig(pub BTreeMap<GroupId, FlattenedGroupConfig>);
