use serde::{Deserialize, Serialize};

use crate::{event::Message, device::{DevicesState, Device}, scene::ScenesConfig};

#[derive(Deserialize, Serialize, Debug)]
pub enum WebSocketRequest {
	Message(Message)
}

#[derive(Deserialize, Serialize, Debug)]
pub struct StateUpdate {
    pub devices: DevicesState,
    pub scenes: ScenesConfig,
}

#[derive(Deserialize, Serialize, Debug)]
pub enum WebSocketResponse {
  State(StateUpdate),
  Device(Device)
}

