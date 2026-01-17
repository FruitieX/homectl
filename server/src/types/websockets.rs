use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    device::DevicesState, event::Event, group::FlattenedGroupsConfig,
    routine_status::RoutineStatuses, scene::FlattenedScenesConfig,
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
pub enum WebSocketResponse {
    State(StateUpdate),
}
