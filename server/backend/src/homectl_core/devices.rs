use crate::db::actions::{db_find_device, db_update_device};

use super::scenes::Scenes;
use async_std::task;
use homectl_types::device::DeviceId;
use homectl_types::{
    device::{Device, DeviceColor, DeviceSceneState, DeviceState, DeviceStateKey, DevicesState},
    event::{Message, TxEventChannel},
    integration::IntegrationId,
    scene::{SceneDescriptor, SceneDevicesConfig, SceneId},
};
use palette::Hsv;
use std::sync::Arc;
use std::sync::Mutex;

#[derive(Clone)]
pub struct Devices {
    sender: TxEventChannel,
    state: Arc<Mutex<DevicesState>>,
    scenes: Scenes,
}

fn cmp_light_color(
    a: &Option<DeviceColor>,
    a_bri: &Option<f32>,
    b: &Option<DeviceColor>,
    b_bri: &Option<f32>,
) -> bool {
    let hue_delta = 1.0;
    let sat_delta = 0.01;
    let val_delta = 0.01;

    match (a, b) {
        (None, None) => true,
        (None, Some(_)) => false,
        (Some(_), None) => false,
        (Some(a), Some(b)) => {
            let mut a_hsv: Hsv = *a;
            let mut b_hsv: Hsv = *b;

            a_hsv.value *= a_bri.unwrap_or(1.0);
            b_hsv.value *= b_bri.unwrap_or(1.0);

            // Light state is equal if all components differ by less than a given delta
            (f32::abs(a_hsv.hue.to_degrees() - b_hsv.hue.to_degrees()) <= hue_delta)
                && (f32::abs(a_hsv.saturation - b_hsv.saturation) <= sat_delta)
                && (f32::abs(a_hsv.value - b_hsv.value) <= val_delta)
        }
    }
}

fn cmp_device_states(device: &DeviceState, expected: &DeviceState) -> bool {
    match (device, expected) {
        (DeviceState::OnOffDevice(a), DeviceState::OnOffDevice(b)) => a.power == b.power,
        (DeviceState::Light(device), DeviceState::Light(expected)) => {
            if device.power != expected.power {
                return false;
            }

            // If both lights are turned off, state matches
            if !device.power && !expected.power {
                return true;
            }

            // Compare colors if supported
            if device.color.is_some() {
                return cmp_light_color(
                    &device.color,
                    &device.brightness,
                    &expected.color,
                    &expected.brightness,
                );
            }
            // Else compare color temperature if supported
            else if let (Some(device_cct), Some(expected_cct)) = (&device.cct, &expected.cct) {
                // First scale expected_cct to within device's supported range
                let supported_range = device_cct.get_device_range();
                let expected = expected_cct
                    .get_cct()
                    .clamp(supported_range.start, supported_range.end);
                let actual = device_cct.get_cct();

                // Accept an error of 10 kelvin
                let epsilon = 10.0;

                return f32::abs(expected - actual) <= epsilon;
            }

            true
        }
        (DeviceState::MultiSourceLight(a), DeviceState::MultiSourceLight(b)) => {
            if a.power != b.power {
                return false;
            }
            a.lights
                .iter()
                .zip(b.lights.iter())
                .map(|(light_a, light_b)| {
                    cmp_light_color(
                        &Some(*light_a),
                        &a.brightness,
                        &Some(*light_b),
                        &b.brightness,
                    )
                })
                .all(|value| value)
        }
        _ => false,
    }
}

impl Devices {
    pub fn new(sender: TxEventChannel, scenes: Scenes) -> Self {
        Devices {
            sender,
            state: Default::default(),
            scenes,
        }
    }

    pub fn get_devices(&self) -> DevicesState {
        self.state.lock().unwrap().clone()
    }

    /// Checks whether device values were changed or not due to refresh
    pub async fn handle_integration_device_refresh(&mut self, device: &Device) {
        // println!("handle_integration_device_refresh {:?}", device);
        let state_device = self.get_device(&device.get_state_key());

        // recompute expected_state here as it may have changed since we last
        // computed it
        let expected_state = state_device
            .as_ref()
            .map(|d| self.get_expected_state(d, false));

        // Take action if the device state has changed from stored state
        if Some(device) != state_device.as_ref() || expected_state != Some(device.state.clone()) {
            let kind = device.state.clone();

            match (kind, state_device, expected_state) {
                // Device was seen for the first time
                (_, None, _) => {
                    let db_device = db_find_device(&device.get_state_key()).await.ok();

                    match db_device {
                        Some(db_device) => {
                            println!("Restored device from DB: {:?}", device);
                            let device = Device {
                                // Don't restore name from DB as this prevents us from changing it
                                name: device.name.clone(),

                                ..db_device
                            };

                            self.set_device_state(&device, true, true).await;
                        }
                        None => {
                            println!("Discovered device: {:?}", device);
                            self.set_device_state(device, true, false).await;
                            db_update_device(device).await.ok();
                        }
                    }
                }

                // Sensor state has changed, defer handling of this update
                // to other subsystems
                (DeviceState::Sensor(_), Some(_), _) => {
                    self.set_device_state(device, false, false).await;
                }

                // Device state does not match expected state, maybe the
                // device missed a state update or forgot its state? Try
                // fixing this by emitting a SetIntegrationDeviceState
                // message back to integration
                (_, _, Some(expected_state)) => {
                    if cmp_device_states(&device.state, &expected_state) {
                        return;
                    }

                    // println!(
                    //     "Device state mismatch detected ({}/{}): (was: {:?}, expected: {:?})",
                    //     device.integration_id, device.id, device.state, expected_state
                    // );

                    let mut device = device.clone();
                    device.state = expected_state;

                    self.sender
                        .send(Message::SetIntegrationDeviceState { device });
                }

                // Expected device state was not found
                (_, _, None) => {
                    self.set_device_state(device, false, false).await;
                }
            }
        }
    }

    /// Returns expected state for given device based on possible active scene.
    /// If no scene active and use_passed_state is false, previous device state is returned.
    /// If no scene active and use_passed_state is true, passed device state is returned.
    fn get_expected_state(&self, device: &Device, use_passed_state: bool) -> DeviceState {
        match device.state {
            // Sensors should always use the most recent sensor reading
            DeviceState::Sensor(_) => device.state.clone(),

            _ => {
                let state = self.state.lock().unwrap();

                // Ignore transition specified by scene if we're setting state
                let ignore_transition = use_passed_state;
                let scene_device_state =
                    self.scenes
                        .find_scene_device_state(device, &state, ignore_transition);

                scene_device_state.unwrap_or_else(|| {
                    // TODO: why would we ever want to do this
                    if use_passed_state {
                        device.state.clone()
                    } else {
                        let device = state
                            .0
                            .get(&device.get_state_key())
                            .unwrap_or(device)
                            .clone();

                        device.state
                    }
                })
            }
        }
    }

    /// Sets stored state for given device and dispatches DeviceUpdate
    pub async fn set_device_state(&mut self, device: &Device, set_scene: bool, skip_db: bool) -> Device {
        let old: Option<Device> = self.get_device(&device.get_state_key());
        let old_state = { self.state.lock().unwrap().clone() };

        let mut device = device.clone();

        // Restore scene if set_scene is false
        if let (false, Some(old)) = (set_scene, old.clone()) {
            device.scene = old.scene;
        }

        // Allow active scene to override device state
        let expected_state = self.get_expected_state(&device, true);
        device.state = expected_state;

        let mut state = self.state.lock().unwrap();

        state.0.insert(device.get_state_key(), device.clone());

        let state_changed = old_state != *state;

        self.sender.send(Message::DeviceUpdate {
            old_state,
            new_state: state.clone(),
            old,
            new: device.clone(),
        });

        if state_changed && !skip_db {
            // FIXME: compiler error without task::spawn()
            let device = device.clone();
            task::spawn(async move {
                db_update_device(&device).await.ok();
            });
        }

        device
    }

    pub fn get_device(&self, state_key: &DeviceStateKey) -> Option<Device> {
        self.state.lock().unwrap().0.get(state_key).cloned()
    }

    fn find_scene_devices_config(&self, scene_id: &SceneId) -> Option<SceneDevicesConfig> {
        self.scenes
            .find_scene_devices_config(&*self.state.lock().unwrap(), scene_id)
    }

    pub async fn activate_scene(&mut self, scene_id: &SceneId) -> Option<bool> {
        println!("Activating scene {:?}", scene_id);

        let scene_devices_config = self.find_scene_devices_config(scene_id)?;

        let device_scene_state = Some(DeviceSceneState::new(scene_id.to_owned()));

        for (integration_id, devices) in scene_devices_config {
            for (device_id, _) in devices {
                let device =
                    self.get_device(&DeviceStateKey::new(integration_id.clone(), device_id));

                if let Some(device) = device {
                    let mut device = device.clone();
                    device.scene = device_scene_state.clone();
                    let device = self.set_device_state(&device, true, false).await;

                    self.sender
                        .clone()
                        .send(Message::SetIntegrationDeviceState { device });
                }
            }
        }

        Some(true)
    }

    pub async fn cycle_scenes(&mut self, scene_descriptors: &[SceneDescriptor]) -> Option<bool> {
        let mut scenes_common_devices: Vec<(IntegrationId, DeviceId)> = Vec::new();

        // If using async mutexes

        // let scene_devices_configs = join_all(scene_descriptors.iter().map(|sd| {
        //     let sd = sd.clone();
        //     let scene_id = sd.scene_id.clone();
        //     let devices = self.clone();
        //     async move { (sd, devices.find_scene_devices_config(&scene_id).await) }
        // })).await;

        let scene_devices_configs: Vec<(&SceneDescriptor, Option<SceneDevicesConfig>)> =
            scene_descriptors
                .iter()
                .map(|sd| (sd, self.find_scene_devices_config(&sd.scene_id)))
                .collect();

        // gather a Vec<Vec(IntegrationId, DeviceId)>> of all devices in cycled scenes
        let scenes_devices: Vec<Vec<(IntegrationId, DeviceId)>> = scene_devices_configs
            .iter()
            .map(|(_, scene_devices_config)| {
                let mut scene_devices: Vec<(IntegrationId, DeviceId)> = Vec::new();
                if let Some(integrations) = scene_devices_config {
                    for (integration_id, integration) in integrations {
                        for device_id in integration.keys() {
                            scene_devices.push((integration_id.clone(), device_id.clone()));
                        }
                    }
                }

                scene_devices
            })
            .collect();

        // gather devices which exist in all cycled scenes into scenes_common_devices
        if let Some(first_scene_devices) = scenes_devices.first() {
            for scene_device in first_scene_devices {
                if scenes_devices
                    .iter()
                    .all(|scene_devices| scene_devices.contains(scene_device))
                {
                    scenes_common_devices.push(scene_device.clone());
                }
            }
        }

        let state = self.state.lock().unwrap().clone();

        let active_scene_index =
            scene_devices_configs
                .iter()
                .position(|(sd, scene_devices_config)| {
                    // try finding any device in scene_devices_config that has this scene active
                    if let Some(integrations) = scene_devices_config {
                        integrations.iter().any(|(integration_id, devices)| {
                            devices.iter().any(|(device_id, _)| {
                                // only consider devices which are common across all cycled scenes
                                if !scenes_common_devices
                                    .contains(&(integration_id.clone(), device_id.clone()))
                                {
                                    return false;
                                }

                                let device =
                                    find_device(&state, integration_id, Some(device_id), None);
                                let device_scene = device.map(|d| d.scene).flatten();

                                device_scene.map_or(false, |ds| ds.scene_id == sd.scene_id)
                            })
                        })
                    } else {
                        false
                    }
                });

        let next_scene = match active_scene_index {
            Some(index) => {
                let next_scene_index = (index + 1) % scene_descriptors.len();
                scene_descriptors.get(next_scene_index)
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
    let device = devices
        .0
        .iter()
        .find(
            |(
                DeviceStateKey {
                    integration_id: candidate_integration_id,
                    device_id: candidate_device_id,
                },
                candidate_device,
            )| {
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
        )
        .map(|(_, device)| device)?;

    Some(device.clone())
}
