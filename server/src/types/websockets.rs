use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    device::DevicesState, event::Event, group::FlattenedGroupsConfig, scene::FlattenedScenesConfig,
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
}

#[derive(TS, Deserialize, Serialize, Debug)]
#[ts(export)]
pub enum WebSocketResponse {
    State(StateUpdate),
}
