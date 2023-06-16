use crate::db::actions::{db_find_device, db_update_device};
use crate::types::color::{Capabilities, DeviceColor};

use super::scenes::Scenes;
use crate::types::device::{DeviceId, ManagedDevice, ManagedDeviceState, SensorDevice};
use crate::types::group::GroupId;
use crate::types::{
    device::{Device, DeviceData, DeviceKey, DevicesState},
    event::{Message, TxEventChannel},
    integration::IntegrationId,
    scene::{SceneDescriptor, SceneDevicesConfig, SceneId},
};
use std::sync::Arc;
use std::sync::Mutex;

#[derive(Clone)]
pub struct Devices {
    sender: TxEventChannel,
    state: Arc<Mutex<DevicesState>>,
    scenes: Scenes,
}

fn cmp_light_color(
    capabilities: &Capabilities,
    incoming: &Option<DeviceColor>,
    incoming_bri: &Option<f32>,
    expected: &Option<DeviceColor>,
    expected_bri: &Option<f32>,
) -> bool {
    // If brightness mismatches, the light state is not equal
    let bri_delta = 0.01;
    if f32::abs(incoming_bri.unwrap_or(1.0) - expected_bri.unwrap_or(1.0)) > bri_delta {
        return false;
    }

    // Convert expected color to supported color mode before performing comparison
    let expected_converted = expected
        .as_ref()
        .and_then(|c| c.to_device_preferred_mode(capabilities));

    // If colors are equal by PartialEq, the light state is equal
    if incoming.as_ref() == expected_converted.as_ref() {
        return true;
    }

    // Otherwise compare colors by components, allow slight deltas to account
    // for rounding errors
    let hue_delta = 1;
    let sat_delta = 0.01;
    let xy_delta = 0.01;
    let cct_delta = 10;

    match (incoming, expected_converted) {
        (Some(DeviceColor::Xy(a)), Some(DeviceColor::Xy(b))) => {
            // Light state is equal if all components differ by less than a given delta
            (f32::abs(a.x - b.x) <= xy_delta) && (f32::abs(a.y - b.y) <= xy_delta)
        }
        (Some(DeviceColor::Hs(a)), Some(DeviceColor::Hs(b))) => {
            // Light state is equal if all components differ by less than a given delta
            (u16::abs_diff(a.h, b.h) <= hue_delta) && (f32::abs(a.s - b.s) <= sat_delta)
        }
        (Some(DeviceColor::Ct(a)), Some(DeviceColor::Ct(b))) => {
            u16::abs_diff(a.ct, b.ct) <= cct_delta
        }
        (_, _) => false,
    }
}

fn cmp_device_states(device: &ManagedDevice, expected: &ManagedDeviceState) -> bool {
    if device.state.power != expected.power {
        return false;
    }

    // If both lights are turned off, state matches
    if !device.state.power && !expected.power {
        return true;
    }

    // Compare colors if supported
    if device.state.color.is_some() {
        return cmp_light_color(
            &device.capabilities,
            &device.state.color,
            &device.state.brightness,
            &expected.color,
            &expected.brightness,
        );
    }

    true
}

fn cmp_sensor_states(sensor: &SensorDevice, previous: &SensorDevice) -> bool {
    sensor == previous
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
    pub async fn handle_integration_device_refresh(&mut self, incoming: &Device) {
        // println!("handle_integration_device_refresh {:?}", device);
        let current = self.get_device(&incoming.get_device_key());

        // recompute expected_state here as it may have changed since we last
        // computed it
        let expected_state = current
            .as_ref()
            .and_then(|d| self.get_expected_state(d, false));

        // Take action if the device state differs from expected state
        match (&incoming.data, current, expected_state) {
            // Device was seen for the first time
            (_, None, _) => {
                let db_device = db_find_device(&incoming.get_device_key()).await.ok();

                match db_device {
                    Some(db_device) => {
                        // Note that we only restore a device from DB once it has been
                        // discovered by the integration. This way we don't end up with a lot
                        // of possibly old/stale devices.

                        // Restore device scene from DB
                        let scene = db_device.get_scene();

                        let device = incoming.set_scene(scene);

                        println!(
                            "Discovered previously seen device, restored scene from DB: {:?}",
                            device
                        );

                        self.set_device_state(&device, true, true).await;
                    }
                    None => {
                        println!("Discovered device: {:?}", incoming);
                        self.set_device_state(incoming, true, false).await;
                        db_update_device(incoming).await.ok();
                    }
                }
            }

            (DeviceData::Sensor(incoming_sensor), Some(current), _) => {
                let previous = current.get_sensor_state().unwrap_or_else(|| panic!("Previous state is not of type SensorDevice for {}. Maybe there is an ID collision with another ManagedDevice",
                    current.get_device_key()));

                // If there's no change in sensor state, ignore this update
                if cmp_sensor_states(incoming_sensor, previous) {
                    return;
                }

                // Sensor state has changed, defer handling of this update to
                // other subsystems
                self.set_device_state(incoming, false, false).await;
            }

            (DeviceData::Managed(ref incoming_managed), _, Some(expected_state)) => {
                if cmp_device_states(incoming_managed, &expected_state) {
                    return;
                }

                let expected_converted =
                    expected_state.color_to_device_preferred_mode(&incoming_managed.capabilities);

                // Device state does not match expected state, maybe the device
                // missed a state update or forgot its state? We will try fixing
                // this by emitting a SetIntegrationDeviceState message back to
                // integration
                println!(
                    "Device state mismatch detected ({}/{}):\nwas:      {}\nexpected: {}\n",
                    incoming.integration_id,
                    incoming.name,
                    incoming_managed.state,
                    expected_converted
                );

                // Replace device state with expected state, converted into a
                // supported color format
                let mut managed = incoming_managed.clone();
                managed.state = expected_state;
                managed.state.color = managed
                    .state
                    .color
                    .and_then(|c| c.to_device_preferred_mode(&incoming_managed.capabilities));

                // Disable transitions
                managed.state.transition_ms = None;

                let mut device = incoming.clone();
                device.data = DeviceData::Managed(managed);

                self.sender.send(Message::SetIntegrationDeviceState {
                    device,
                    state_changed: true,
                });
            }

            // Expected device state was not found
            (_, _, None) => {
                self.set_device_state(incoming, false, false).await;
            }
        }
    }

    /// Returns expected state for given device based on possible active scene.
    /// If no scene active and use_passed_state is false, previous device state is returned.
    /// If no scene active and use_passed_state is true, passed device state is returned.
    fn get_expected_state(
        &self,
        device: &Device,
        use_passed_state: bool,
    ) -> Option<ManagedDeviceState> {
        match device.data {
            DeviceData::Sensor(_) => None,

            DeviceData::Managed(_) => {
                let scene_device_state = {
                    let state = self.state.lock().unwrap();

                    // Ignore transition specified by scene if we're setting state
                    let ignore_transition = use_passed_state;
                    self.scenes
                        .find_scene_device_state(device, &state, ignore_transition)
                };

                let mut expected_state = match scene_device_state {
                    // Return state from active scene
                    Some(state) => Some(state),
                    None => {
                        if use_passed_state {
                            // Return passed device state
                            device.get_managed_state().cloned()
                        } else {
                            let state = self.state.lock().unwrap();

                            // Return previous device state
                            let device = state
                                .0
                                .get(&device.get_device_key())
                                .unwrap_or(device)
                                .clone();

                            device.get_managed_state().cloned()
                        }
                    }
                };

                // Make sure brightness is set, defaults to 100%
                if let Some(expected_state) = &mut expected_state {
                    expected_state.brightness = Some(expected_state.brightness.unwrap_or(1.0));
                }

                expected_state
            }
        }
    }

    /// Sets stored state for given device and dispatches DeviceUpdate
    pub async fn set_device_state(
        &mut self,
        device: &Device,
        set_scene: bool,
        skip_db: bool,
    ) -> Device {
        let old: Option<Device> = self.get_device(&device.get_device_key());
        let old_states = { self.state.lock().unwrap().clone() };

        let mut device = device.clone();

        // Restore scene if set_scene is false
        if let (false, Some(old)) = (set_scene, &old) {
            let old_device_scene = old.get_scene();
            device = device.set_scene(old_device_scene);
        }

        // Allow active scene to override device state
        let expected_state = self.get_expected_state(&device, true);
        let capabilities = device.get_supported_color_modes();

        // Replace device state with expected state, converted into a supported
        // color format
        if let (Some(mut expected_state), Some(capabilities)) = (expected_state, capabilities) {
            expected_state.color = expected_state
                .color
                .and_then(|c| c.to_device_preferred_mode(capabilities));
            device = device.set_managed_state(expected_state);
        }

        let new_state = {
            let mut states = self.state.lock().unwrap();
            states.0.insert(device.get_device_key(), device.clone());
            states.clone()
        };

        let state_changed = old.as_ref() != Some(&device);

        self.sender.send(Message::DeviceUpdate {
            old_state: old_states,
            new_state,
            old,
            new: device.clone(),
        });

        if state_changed && !skip_db {
            // FIXME: compiler error without task::spawn()
            let device = device.clone();
            tokio::spawn(async move {
                db_update_device(&device).await.ok();
            });
        }

        if !device.is_sensor() {
            self.sender.send(Message::SetIntegrationDeviceState {
                device: device.clone(),
                state_changed,
            });
        }

        device
    }

    pub fn get_device(&self, device_key: &DeviceKey) -> Option<Device> {
        self.state.lock().unwrap().0.get(device_key).cloned()
    }

    fn find_scene_devices_config(&self, sd: &SceneDescriptor) -> Option<SceneDevicesConfig> {
        self.scenes
            .find_scene_devices_config(&self.state.lock().unwrap(), sd)
    }

    pub async fn activate_scene(
        &mut self,
        scene_id: &SceneId,
        device_keys: &Option<Vec<DeviceKey>>,
        group_keys: &Option<Vec<GroupId>>,
    ) -> Option<bool> {
        println!("Activating scene {:?}", scene_id);

        let scene_devices_config = self.find_scene_devices_config(&SceneDescriptor {
            scene_id: scene_id.clone(),
            device_keys: device_keys.clone(),
            group_keys: group_keys.clone(),
        })?;

        for (integration_id, devices) in scene_devices_config {
            for (device_id, _) in devices {
                let device_key = &DeviceKey::new(integration_id.clone(), device_id);

                let device = self.get_device(device_key);

                if let Some(device) = device {
                    let device = device.set_scene(Some(scene_id.clone()));
                    self.set_device_state(&device, true, false).await;
                }
            }
        }

        Some(true)
    }

    pub async fn cycle_scenes(
        &mut self,
        scene_descriptors: &[SceneDescriptor],
        nowrap: bool,
    ) -> Option<bool> {
        let mut scenes_common_devices: Vec<(IntegrationId, DeviceId)> = Vec::new();

        let scene_devices_configs: Vec<(&SceneDescriptor, Option<SceneDevicesConfig>)> =
            scene_descriptors
                .iter()
                .map(|sd| (sd, self.find_scene_devices_config(sd)))
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
                                let device_scene = device.and_then(|d| d.get_scene());

                                device_scene.map_or(false, |ds| ds == sd.scene_id)
                            })
                        })
                    } else {
                        false
                    }
                });

        let next_scene = match active_scene_index {
            Some(index) => {
                let next_scene_index = if nowrap {
                    (index + 1).min(scene_descriptors.len() - 1)
                } else {
                    (index + 1) % scene_descriptors.len()
                };
                scene_descriptors.get(next_scene_index)
            }
            None => scene_descriptors.first(),
        }?;

        self.activate_scene(
            &next_scene.scene_id,
            &next_scene.device_keys,
            &next_scene.group_keys,
        )
        .await;

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
                DeviceKey {
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
