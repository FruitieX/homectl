use super::{
    device::{Device, DeviceKind},
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
        // println!("handle_device_update for device {}", device.id);

        // FIXME: some of these .clone() calls may be unnecessary?

        let old_state = self.state.clone();
        let internal_state = old_state.get(&device.id);

        self.state.insert(device.id.clone(), device.clone());

        // Take action if the device state has changed from stored state
        if internal_state != Some(&device.clone()) {
            let kind = device.kind.clone();

            match (kind, internal_state) {
                // Device was seen for the first time
                (_, None) => {
                    println!("Discovered device: {:?}", device);
                    self.sender
                        .send(Message::DeviceUpdated {
                            old: None,
                            new: device,
                        })
                        .unwrap();
                }

                // Sensor state has changed, defer handling of this update to
                // other subsystems
                (DeviceKind::Sensor(_), Some(old)) => {
                    self.sender
                        .send(Message::DeviceUpdated {
                            old: Some(old.clone()),
                            new: device,
                        })
                        .unwrap();
                }

                // Device state does not match expected state, maybe the device
                // missed a state update or forgot its state? Try fixing this by
                // emitting SetDeviceState message
                (_, Some(expected_state)) => {
                    self.sender
                        .send(Message::SetDeviceState(expected_state.clone()))
                        .unwrap();
                }
            }
        }
    }
}
