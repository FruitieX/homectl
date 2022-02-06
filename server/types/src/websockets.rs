use serde::{Deserialize, Serialize};

use crate::{
    device::DevicesState, event::Message, group::FlattenedGroupsConfig, scene::ScenesConfig,
};

#[derive(Deserialize, Serialize, Debug)]
pub enum WebSocketRequest {
    Message(Message),
}

#[derive(Deserialize, Serialize, Debug)]
pub struct StateUpdate {
    pub devices: DevicesState,
    pub scenes: ScenesConfig,
    pub groups: FlattenedGroupsConfig,
}

#[derive(Deserialize, Serialize, Debug)]
pub enum WebSocketResponse {
    State(StateUpdate),
}
