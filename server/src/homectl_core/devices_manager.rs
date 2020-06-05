use super::{
    device::Device,
    events::{Message, TxEventChannel},
};
use std::collections::HashMap;

type State = HashMap<String, Device>;

pub struct DevicesManager {
    sender: TxEventChannel,
    state: State,
}

impl DevicesManager {
    pub fn new(sender: TxEventChannel) -> Self {
        DevicesManager {
            sender,
            state: HashMap::new(),
        }
    }

    pub fn handle_device_update(&mut self, device: Device) {
        println!("handle_device_update for device {}", device.id);

        // FIXME: some of these .clone() calls may be unnecessary?
        let old_state = self.state.clone();
        let old = old_state.get(&device.id);

        if old != Some(&device) {
            self.state.insert(device.id.clone(), device.clone());

            self.sender
                .send(Message::DeviceUpdated {
                    old: old.map(|d| d.clone()),
                    new: device,
                })
                .unwrap();
        }
    }
}
