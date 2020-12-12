use crate::db::actions::db_update_device;

use super::{device::{Device, DeviceColor, DeviceId, DeviceSceneState, DeviceState}, events::{Message, TxEventChannel}, integration::IntegrationId, scene::{SceneDescriptor, SceneDevicesConfig, SceneId}, scenes::Scenes};
use palette::Hsv;
use std::{collections::HashMap, sync::{Arc, Mutex}, time::Instant};

pub type DeviceStateKey = (IntegrationId, DeviceId);
pub type DevicesState = HashMap<DeviceStateKey, Device>;

pub fn get_device_state_key(device: &Device) -> DeviceStateKey {
    (device.integration_id.clone(), device.id.clone())
}

pub fn mk_device_state_key(integration_id: &IntegrationId, device_id: &DeviceId) -> DeviceStateKey {
    (integration_id.clone(), device_id.clone())
}

pub struct Devices {
    sender: TxEventChannel,
    state: DevicesState,
    scenes: Arc<Mutex<Scenes>>,
}

fn cmp_light_state(
    a: &Option<DeviceColor>,
    a_bri: &Option<f64>,
    b: &Option<DeviceColor>,
    b_bri: &Option<f64>,
) -> bool {
    let hue_delta = 0.5;
    let sat_delta = 0.005;
    let val_delta = 0.005;

    match (a, b) {
        (None, None) => true,
        (None, Some(_)) => false,
        (Some(_), None) => false,
        (Some(a), Some(b)) => {
            let mut a_hsv: Hsv = a.clone().into();
            let mut b_hsv: Hsv = b.clone().into();

            a_hsv.value = a_hsv.value * (a_bri.unwrap_or(1.0) as f32);
            b_hsv.value = b_hsv.value * (b_bri.unwrap_or(1.0) as f32);

            if f32::abs(a_hsv.hue.to_degrees() - b_hsv.hue.to_degrees()) > hue_delta {
                false
            } else if f32::abs(a_hsv.saturation - b_hsv.saturation) > sat_delta {
                false
            } else if f32::abs(a_hsv.value - b_hsv.value) > val_delta {
                false
            } else {
                true
            }
        }
    }
}

fn cmp_device_states(a: &DeviceState, b: &DeviceState) -> bool {
    match (a, b) {
        (DeviceState::OnOffDevice(a), DeviceState::OnOffDevice(b)) => a.power == b.power,
        (DeviceState::Light(a), DeviceState::Light(b)) => {
            if a.power != b.power {
                return false;
            }
            // If both lights are turned off, state matches
            if a.power == false && b.power == false {
                return true;
            }
            return cmp_light_state(&a.color, &a.brightness, &b.color, &b.brightness);
        }
        (DeviceState::MultiSourceLight(a), DeviceState::MultiSourceLight(b)) => {
            if a.power != b.power {
                return false;
            }
            a.lights
                .iter()
                .zip(b.lights.iter())
                .map(|(light_a, light_b)| {
                    cmp_light_state(
                        &Some(light_a.clone()),
                        &a.brightness,
                        &Some(light_b.clone()),
                        &b.brightness,
                    )
                })
                .all(|value| value)
        }
        _ => false,
    }
}

impl Devices {
    pub fn new(
        sender: TxEventChannel,
        scenes: Arc<Mutex<Scenes>>,
    ) -> Self {
        Devices {
            sender,
            state: HashMap::new(),
            scenes,
        }
    }

    /// Checks whether device values were changed or not due to refresh
    pub async fn handle_integration_device_refresh(&mut self, device: &Device) {
        // println!("handle_integration_device_refresh {:?}", device);
        let state_device = self.get_device(&device.integration_id, &device.id);

        // recompute expected_state here as it may have changed since we last
        // computed it
        let expected_state = state_device.map(|d| self.get_expected_state(&d, false));

        // Take action if the device state has changed from stored state
        if Some(device) != state_device || expected_state != Some(device.state.clone()) {
            let kind = device.state.clone();

            match (kind, state_device, expected_state) {
                // Device was seen for the first time
                (_, None, _) => {
                    println!("Discovered device: {:?}", device);
                    self.set_device_state(&device, false).await;
                    db_update_device(&device).ok();
                }

                // Sensor state has changed, defer handling of this update
                // to other subsystems
                (DeviceState::Sensor(_), Some(_), _) => {
                    self.set_device_state(&device, false).await;
                }

                // Device state does not match expected state, maybe the
                // device missed a state update or forgot its state? Try
                // fixing this by emitting a SetIntegrationDeviceState
                // message back to integration
                (_, _, Some(expected_state)) => {
                    if cmp_device_states(&device.state, &expected_state) {
                        return;
                    }

                    println!(
                        "Device state mismatch detected ({}/{}): (was: {:?}, expected: {:?})",
                        device.integration_id, device.id, device.state, expected_state
                    );

                    let mut device = device.clone();
                    device.state = expected_state;

                    self.sender
                        .send(Message::SetIntegrationDeviceState { device })
                        .await;
                }

                // Expected device state was not found
                (_, _, None) => {
                    self.set_device_state(&device, false).await;
                }
            }
        }
    }

    /// Returns expected state for given device based on possible active scene.
    /// If no scene active and set_state is false, previous device state is returned.
    /// If no scene active and set_state is true, passed device state is returned.
    fn get_expected_state(&self, device: &Device, set_state: bool) -> DeviceState {
        match device.state {
            // Sensors should always use the most recent sensor reading
            DeviceState::Sensor(_) => device.state.clone(),

            _ => {
                let scenes = self.scenes.lock().unwrap();
                let scene_device_state = scenes
                    .find_scene_device_state(&device, &self.state);

                scene_device_state.unwrap_or_else(|| {
                    // TODO: why would we ever want to do this
                    if set_state {
                        device.state.clone()
                    } else {
                        let device = self
                            .state
                            .get(&get_device_state_key(device))
                            .unwrap_or(device)
                            .clone();

                        device.state
                    }
                })
            }
        }
    }

    /// Sets stored state for given device and dispatches DeviceUpdate
    pub async fn set_device_state(&mut self, device: &Device, set_scene: bool) -> Device {
        let old: Option<Device> = self.get_device(&device.integration_id, &device.id).cloned();
        let old_state = self.state.clone();

        let mut device = device.clone();

        // Restore scene if set_scene is false
        match (set_scene, old.clone()) {
            (false, Some(old)) => {
                device.scene = old.scene;
            }
            _ => {}
        }

        // Allow active scene to override device state
        let expected_state = self.get_expected_state(&device, true);
        device.state = expected_state;

        self.state
            .insert(get_device_state_key(&device), device.clone());

        self.sender
            .send(Message::DeviceUpdate {
                old_state,
                new_state: self.state.clone(),
                old,
                new: device.clone(),
            })
            .await;

        device
    }

    pub fn get_device(
        &self,
        integration_id: &IntegrationId,
        device_id: &DeviceId,
    ) -> Option<&Device> {
        self.state
            .get(&mk_device_state_key(&integration_id, &device_id))
    }

    fn find_scene_devices_config(&self, scene_id: &SceneId) -> Option<SceneDevicesConfig> {
        let scenes = self.scenes.lock().unwrap();
        scenes.find_scene_devices_config(&self.state, scene_id)
    }

    pub async fn activate_scene(&mut self, scene_id: &SceneId) -> Option<bool> {
        println!("Activating scene {:?}", scene_id);

        let scene_devices_config = self.find_scene_devices_config(scene_id)?;

        let device_scene_state = Some(DeviceSceneState {
            scene_id: scene_id.to_owned(),
            activation_time: Instant::now(),
        });

        for (integration_id, devices) in scene_devices_config {
            for (device_id, _) in devices {
                let device = self.get_device(&integration_id, &device_id);

                match device {
                    Some(device) => {
                        let mut device = device.clone();
                        device.scene = device_scene_state.clone();
                        let device = self.set_device_state(&device, true).await;

                        db_update_device(&device).ok();

                        self.sender
                            .clone()
                            .send(Message::SetIntegrationDeviceState { device })
                            .await;
                    }
                    None => {}
                }
            }
        }

        Some(true)
    }

    pub async fn cycle_scenes(&mut self, scene_descriptors: &Vec<SceneDescriptor>) -> Option<bool> {
        let mut scenes_common_devices: Vec<(IntegrationId, DeviceId)> = Vec::new();

        // gather a Vec<Vec(IntegrationId, DeviceId)>> of all devices in cycled scenes
        let scenes_devices: Vec<Vec<(IntegrationId, DeviceId)>> = scene_descriptors
            .iter()
            .map(|sd| {
                let scene_devices_config = self.find_scene_devices_config(&sd.scene_id);

                let mut scene_devices: Vec<(IntegrationId, DeviceId)> = Vec::new();
                match scene_devices_config {
                    Some(integrations) => {
                        for (integration_id, integration) in integrations {
                            for (device_id, _) in integration {
                                scene_devices.push((integration_id.clone(), device_id));
                            }
                        }
                    }
                    None => {}
                }

                scene_devices
            })
            .collect();

        // gather devices which exist in all cycled scenes into scenes_common_devices
        scenes_devices.first().map(|first_scene_devices| {
            for scene_device in first_scene_devices {
                if scenes_devices
                    .iter()
                    .all(|scene_devices| scene_devices.contains(scene_device))
                {
                    scenes_common_devices.push(scene_device.clone());
                }
            }
        });

        let active_scene_index = scene_descriptors.iter().position(|sd| {
            let scene_devices_config = self.find_scene_devices_config(&sd.scene_id);

            // try finding any device in scene_devices_config that has this scene active
            match scene_devices_config {
                Some(integrations) => integrations
                    .iter()
                    .find(|(integration_id, devices)| {
                        devices
                            .iter()
                            .find(|(device_id, _)| {
                                // only consider devices which are common across all cycled scenes
                                if !scenes_common_devices
                                    .contains(&(integration_id.to_string(), device_id.to_string()))
                                {
                                    return false;
                                }

                                let device =
                                    find_device(&self.state, integration_id, Some(device_id), None);
                                let device_scene = device.map(|d| d.scene).flatten();

                                device_scene.map_or(false, |ds| ds.scene_id == sd.scene_id)
                            })
                            .is_some()
                    })
                    .is_some(),
                None => false,
            }
        });

        let next_scene = match active_scene_index {
            Some(index) => {
                let next_scene_index = (index + 1) % scene_descriptors.len();
                scene_descriptors.iter().nth(next_scene_index)
            }
            None => scene_descriptors.first(),
        }?;

        self.activate_scene(&next_scene.scene_id).await;

        Some(true)
    }
}

pub fn find_device(
    devices: &DevicesState,
    integration_id: &IntegrationId,
    device_id: Option<&DeviceId>,
    name: Option<&String>,
) -> Option<Device> {
    let (_, device) = devices.iter().find(
        |((candidate_integration_id, candidate_device_id), candidate_device)| {
            if integration_id != candidate_integration_id {
                return false;
            }
            if device_id.is_some() && device_id != Some(candidate_device_id) {
                return false;
            }

            // TODO: regex matches
            if name.is_some() && name != Some(&candidate_device.name) {
                return false;
            }

            true
        },
    )?;

    Some(device.clone())
}
