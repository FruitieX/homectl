use super::{
    device::Device,
    events::{Message, TxEventChannel},
    scene::SceneId,
};
use serde::Deserialize;

pub struct RulesEngine {
    sender: TxEventChannel,
}

#[derive(Clone, Deserialize, Debug)]
pub enum ActionId {
    ActivateScene,
}

#[derive(Clone, Deserialize, Debug)]
pub struct Action {
    action: ActionId,
    scene_id: SceneId,
}

impl RulesEngine {
    pub fn new(sender: TxEventChannel) -> Self {
        RulesEngine { sender }
    }

    pub fn handle_device_update(&self, old: Option<Device>, new: Device) {
        println!("device_updated {:?} (was: {:?})", new, old);

        // TODO: decide whether to emit SetDeviceState based on rules
        if old.is_some() {
            self.sender
                .send(Message::SetDeviceState { device: new })
                .unwrap();
        }
    }
}
