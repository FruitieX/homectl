use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    device::{DeviceKey, DevicesState},
    event::Event,
    group::FlattenedGroupsConfig,
    routine_status::RoutineStatuses,
    scene::FlattenedScenesConfig,
};

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub enum WebSocketRequest {
    EventMessage(Event),
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct StateUpdate {
    pub devices: DevicesState,
    pub scenes: FlattenedScenesConfig,
    pub groups: FlattenedGroupsConfig,
    pub routine_statuses: RoutineStatuses,
    pub ui_state: HashMap<String, serde_json::Value>,
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct DevicesPatch {
    pub upserted: DevicesState,
    pub removed: Vec<DeviceKey>,
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub struct StatePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<DevicesPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scenes: Option<FlattenedScenesConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<FlattenedGroupsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routine_statuses: Option<RoutineStatuses>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_state: Option<HashMap<String, serde_json::Value>>,
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub enum WebSocketResponse {
    State(StateUpdate),
    Patch(StatePatch),
}
