use super::{
    device::{Device, DeviceId, DeviceSceneState, DeviceState},
    events::{Message, TxEventChannel},
    integration::IntegrationId,
    scene::SceneId,
    scenes_manager::ScenesManager,
};
use std::{collections::HashMap, time::Instant};

pub type DeviceStateKey = (IntegrationId, DeviceId);
pub type DevicesState = HashMap<DeviceStateKey, Device>;

pub fn get_device_state_key(device: &Device) -> DeviceStateKey {
    (device.integration_id.clone(), device.id.clone())
}

pub fn mk_device_state_key(integration_id: &IntegrationId, device_id: &DeviceId) -> DeviceStateKey {
    (integration_id.clone(), device_id.clone())
}

pub struct DevicesManager {
    sender: TxEventChannel,
    state: DevicesState,
    scenes_manager: ScenesManager,
}

impl DevicesManager {
    pub fn new(sender: TxEventChannel, scenes_manager: ScenesManager) -> Self {
        DevicesManager {
            sender,
            state: HashMap::new(),
            scenes_manager,
        }
    }

    /// Checks whether device values were changed or not due to refresh
    pub fn handle_integration_device_refresh(&mut self, device: Device) {
        let expected_state = self.get_expected_state(&device);

        // Take action if the device state has changed from stored state
        if expected_state != Some(device.clone()) {
            let kind = device.state.clone();

            match (kind, expected_state) {
                // Device was seen for the first time
                (_, None) => {
                    println!("Discovered device: {:?}", device);
                    self.set_device_state(&device);
                }

                // Sensor state has changed, defer handling of this update
                // to other subsystems
                (DeviceState::Sensor(_), Some(_)) => {
                    self.set_device_state(&device);
                }

                // Device state does not match expected state, maybe the
                // device missed a state update or forgot its state? Try
                // fixing this by emitting a SetIntegrationDeviceState
                // message back to integration
                (_, Some(expected_state)) => {
                    println!(
                        "Device state mismatch detected: (was: {:?}, expected: {:?})",
                        device, expected_state
                    );
                    self.sender
                        .clone()
                        .send(Message::SetIntegrationDeviceState {
                            device: expected_state,
                        })
                        .unwrap();
                }
            }
        }
    }

    /// Returns expected state for given device based on prev_state and possibly
    /// active scene
    fn get_expected_state(&self, device: &Device) -> Option<Device> {
        // TODO: need to account for brightness
        let mut expected_state = self.state.get(&get_device_state_key(device))?.clone();

        let scene_device_state = self
            .scenes_manager
            .find_scene_device_state(device, &self.state);

        scene_device_state.map(|s| {
            expected_state.state = s;
        });

        Some(expected_state.clone())
    }

    /// Sets stored state for given device and dispatches DeviceUpdate
    pub fn set_device_state(&mut self, device: &Device) {
        let old: Option<Device> = self.get_device(&device.integration_id, &device.id).cloned();

        let old_state = self.state.clone();

        self.state
            .insert(get_device_state_key(device), device.clone());

        self.sender
            .send(Message::DeviceUpdate {
                old_state,
                new_state: self.state.clone(),
                old,
                new: device.clone(),
            })
            .unwrap();
    }

    pub fn get_device(
        &self,
        integration_id: &IntegrationId,
        device_id: &DeviceId,
    ) -> Option<&Device> {
        self.state
            .get(&mk_device_state_key(&integration_id, &device_id))
    }

    pub fn activate_scene(&mut self, scene_id: &SceneId) -> Option<bool> {
        let scene_devices_config = self.scenes_manager.find_scene_devices_config(scene_id)?;
        let device_scene_state = Some(DeviceSceneState {
            scene_id: scene_id.to_owned(),
            activation_time: Instant::now(),
        });

        for (integration_id, devices) in scene_devices_config {
            for (device_id, _) in devices {
                let _: Option<Device> = try {
                    let mut device = self.get_device(&integration_id, &device_id)?.clone();
                    device.scene = device_scene_state.clone();
                    self.set_device_state(&device);

                    device
                };
            }
        }

        Some(true)
    }
}
