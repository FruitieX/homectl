use super::{
    device::{Device, DeviceId, DeviceState},
    events::{Message, TxEventChannel},
    groups_manager::GroupsManager,
    integration::IntegrationId,
    scenes_manager::ScenesManager,
};
use std::collections::HashMap;

pub type DeviceStateKey = (IntegrationId, DeviceId);
pub type DevicesState = HashMap<DeviceStateKey, Device>;

pub fn get_device_state_key(device: &Device) -> DeviceStateKey {
    (device.integration_id.clone(), device.id.clone())
}

pub struct DevicesManager {
    sender: TxEventChannel,
    state: DevicesState,
    scenes_manager: ScenesManager,
    groups_manager: GroupsManager,
}

impl DevicesManager {
    pub fn new(
        sender: TxEventChannel,
        scenes_manager: ScenesManager,
        groups_manager: GroupsManager,
    ) -> Self {
        DevicesManager {
            sender,
            state: HashMap::new(),
            scenes_manager,
            groups_manager,
        }
    }

    /// Checks whether device values were changed or not due to refresh
    pub fn handle_integration_device_refresh(&mut self, device: Device) {
        let expected_state = self.get_expected_state(&device);
        self.set_device_state(&device);

        // Take action if the device state has changed from stored state
        if expected_state != Some(device.clone()) {
            let kind = device.state.clone();

            self.sender
                .send(match (kind, expected_state) {
                    // Device was seen for the first time
                    (_, None) => {
                        println!("Discovered device: {:?}", device);
                        Message::DeviceUpdate {
                            old: None,
                            new: device,
                        }
                    }

                    // Sensor state has changed, defer handling of this update
                    // to other subsystems
                    (DeviceState::Sensor(_), Some(old)) => Message::DeviceUpdate {
                        old: Some(old),
                        new: device,
                    },

                    // Device state does not match expected state, maybe the
                    // device missed a state update or forgot its state? Try
                    // fixing this by emitting a SetIntegrationDeviceState
                    // message back to integration
                    (_, Some(expected_state)) => Message::SetIntegrationDeviceState {
                        device: expected_state,
                    },
                })
                .unwrap();
        }
    }

    /// Returns expected state for given device based on prev_state and possibly
    /// active scene
    fn get_expected_state(&self, device: &Device) -> Option<Device> {
        let expected_state = self.state.get(&get_device_state_key(device));

        let scene_device_state =
            self.scenes_manager
                .find_scene_device_state(device, &self.state, &self.groups_manager);

        expected_state.cloned()
    }

    pub fn get_devices(&self) -> DevicesState {
        self.state.clone()
    }

    /// Sets stored state for given device
    pub fn set_device_state(&mut self, device: &Device) {
        self.state
            .insert(get_device_state_key(device), device.clone());
    }
}
