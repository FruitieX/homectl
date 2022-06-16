use chrono::Utc;
use homectl_types::{
    device::{Device, DeviceId, DeviceKey, DeviceSceneState, DeviceState, DevicesState, Light},
    group::GroupDeviceLink,
    scene::{
        color_config_as_device_color, FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig,
        SceneDescriptor, SceneDeviceConfig, SceneDeviceStates, SceneDevicesConfig, SceneId,
        ScenesConfig,
    },
};
use itertools::Itertools;

use crate::db::actions::db_get_scenes;

use super::{devices::find_device, groups::Groups};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

#[derive(Clone)]
pub struct Scenes {
    config: ScenesConfig,
    groups: Groups,
    db_scenes: Arc<RwLock<ScenesConfig>>,
}

impl Scenes {
    pub fn new(config: ScenesConfig, groups: Groups) -> Self {
        Scenes {
            config,
            groups,
            db_scenes: Default::default(),
        }
    }

    pub async fn refresh_db_scenes(&self) {
        let db_scenes = db_get_scenes().await.unwrap_or_default();
        let mut rw_lock = self.db_scenes.write().unwrap();
        *rw_lock = db_scenes;
    }

    pub fn get_scenes(&self) -> ScenesConfig {
        let mut db_scenes = self.db_scenes.read().unwrap().clone();
        db_scenes.extend(self.config.clone().into_iter());
        db_scenes
    }

    pub fn find_scene(&self, scene_id: &SceneId) -> Option<SceneConfig> {
        Some(self.get_scenes().get(scene_id)?.clone())
    }

    pub fn find_scene_devices_config(
        &self,
        devices: &DevicesState,
        sd: &SceneDescriptor,
    ) -> Option<SceneDevicesConfig> {
        let scene = self.find_scene(&sd.scene_id)?;

        let scene_devices_search_config = scene.devices.clone().unwrap_or_default();

        // replace device names by device_ids in device_configs
        let mut scene_devices_config: SceneDevicesConfig = scene_devices_search_config
            .iter()
            .map(|(integration_id, device_configs)| {
                (
                    integration_id.clone(),
                    device_configs
                        .iter()
                        .filter_map(|(device_name, device_config)| {
                            let device =
                                find_device(devices, integration_id, None, Some(device_name));

                            let device_id = device.map(|d| d.id).unwrap_or_else(|| {
                                println!(
                                    "Could not find device_id for {} device with name {}",
                                    integration_id, device_name
                                );
                                DeviceId::new("N/A")
                            });
                            let device_key =
                                &DeviceKey::new(integration_id.clone(), device_id.clone());

                            // Skip this device if it's not in device_keys
                            if let Some(device_keys) = &sd.device_keys {
                                if !device_keys.contains(device_key) {
                                    None?
                                }
                            }

                            // Skip this device if it's not in group_keys
                            if let Some(group_keys) = &sd.group_keys {
                                let device_keys = group_keys
                                    .iter()
                                    .flat_map(|group_id| {
                                        self.groups
                                            .find_group_devices(devices, group_id)
                                            .iter()
                                            .map(|d| d.get_device_key())
                                            .collect_vec()
                                    })
                                    .collect_vec();

                                if !device_keys.contains(device_key) {
                                    None?
                                }
                            }

                            Some((device_id, device_config.clone()))
                        })
                        .collect(),
                )
            })
            .collect();

        let scene_groups = scene.groups.unwrap_or_default();

        // merges in devices from scene_groups
        for (group_id, scene_device_config) in scene_groups {
            let group_devices = { self.groups.find_group_device_links(&group_id) };

            for GroupDeviceLink {
                integration_id,
                device_id,
                name,
            } in group_devices
            {
                let device =
                    find_device(devices, &integration_id, device_id.as_ref(), name.as_ref());

                if let Some(device) = device {
                    let empty_devices_integrations = HashMap::new();
                    let mut scene_devices_integrations = scene_devices_config
                        .get(&integration_id)
                        .unwrap_or(&empty_devices_integrations)
                        .to_owned();

                    let device_id = &device.id;
                    let device_key = &DeviceKey::new(integration_id.clone(), device_id.clone());

                    // Skip this device if it's not in device_keys
                    if let Some(device_keys) = &sd.device_keys {
                        if !device_keys.contains(device_key) {
                            continue;
                        }
                    }

                    // Skip this device if it's not in group_keys
                    if let Some(group_keys) = &sd.group_keys {
                        let device_keys = group_keys
                            .iter()
                            .flat_map(|group_id| {
                                self.groups
                                    .find_group_devices(devices, group_id)
                                    .iter()
                                    .map(|d| d.get_device_key())
                                    .collect_vec()
                            })
                            .collect_vec();

                        if !device_keys.contains(device_key) {
                            continue;
                        }
                    }

                    // only insert device config if it did not exist yet
                    scene_devices_integrations
                        .entry(device_id.clone())
                        .or_insert_with(|| scene_device_config.clone());
                    scene_devices_config.insert(integration_id, scene_devices_integrations.clone());
                }
            }
        }

        Some(scene_devices_config)
    }

    /// Finds current state of given device in its current scene
    pub fn find_scene_device_state(
        &self,
        device: &Device,
        devices: &DevicesState,
        ignore_transition: bool,
    ) -> Option<DeviceState> {
        let scene_id = &device.scene.as_ref()?.scene_id;

        let scene_devices = self.find_scene_devices_config(
            devices,
            &SceneDescriptor {
                scene_id: scene_id.clone(),
                device_keys: None,
                group_keys: None,
            },
        )?;
        let integration_devices = scene_devices.get(&device.integration_id)?;
        let scene_device = integration_devices.get(&device.id)?;

        match scene_device {
            SceneDeviceConfig::SceneDeviceLink(link) => {
                // Use state from another device

                // Try finding device by integration_id, device_id, name
                let device = find_device(
                    devices,
                    &link.integration_id,
                    link.device_id.as_ref(),
                    link.name.as_ref(),
                )?;

                let state = device.state;

                // Brightness override
                let state = match state {
                    DeviceState::Light(mut state) => {
                        state.brightness = link.brightness.or(state.brightness);
                        DeviceState::Light(state)
                    }
                    DeviceState::MultiSourceLight(mut state) => {
                        state.brightness = link.brightness.or(state.brightness);
                        DeviceState::MultiSourceLight(state)
                    }
                    DeviceState::OnOffDevice(state) => DeviceState::OnOffDevice(state),
                    DeviceState::Sensor(state) => DeviceState::Sensor(state),
                };

                // Ignore device's transition_ms value
                let state = match (ignore_transition, state.clone()) {
                    (true, DeviceState::Light(mut state)) => {
                        state.transition_ms = None;
                        DeviceState::Light(state)
                    }
                    _ => state,
                };

                Some(state)
            }

            SceneDeviceConfig::SceneLink(link) => {
                // Use state from another scene
                let device = Device {
                    scene: Some(DeviceSceneState {
                        scene_id: link.scene_id.clone(),
                        ..device.scene.clone()?
                    }),
                    ..device.clone()
                };

                self.find_scene_device_state(&device, devices, ignore_transition)
            }

            SceneDeviceConfig::SceneDeviceState(scene_device) => Some(DeviceState::Light(Light {
                // Use state from scene_device
                brightness: scene_device.brightness,
                color: scene_device.color.clone().map(color_config_as_device_color),
                power: scene_device.power,
                transition_ms: scene_device.transition_ms,
            })),
        }
    }

    pub fn get_flattened_scenes(&self, devices: &DevicesState) -> FlattenedScenesConfig {
        let scenes = self.get_scenes();

        scenes
            .into_iter()
            .filter_map(|(scene_id, config)| {
                let devices_config = self.find_scene_devices_config(
                    devices,
                    &SceneDescriptor {
                        scene_id: scene_id.clone(),
                        device_keys: None,
                        group_keys: None,
                    },
                )?;

                let devices: SceneDeviceStates = devices_config
                    .iter()
                    .flat_map({
                        let scene_id = scene_id.clone();

                        move |(integration_id, device_configs)| {
                            device_configs.iter().filter_map({
                                let scene_id = scene_id.clone();

                                move |(device_id, _)| {
                                    let device_key =
                                        DeviceKey::new(integration_id.clone(), device_id.clone());

                                    let device = devices.0.get(&device_key)?;
                                    let device = Device {
                                        scene: Some(DeviceSceneState {
                                            scene_id: scene_id.clone(),
                                            activation_time: device
                                                .scene
                                                .clone()
                                                .map(|s| s.activation_time)
                                                .unwrap_or_else(Utc::now),
                                        }),
                                        ..device.clone()
                                    };

                                    let device_state =
                                        self.find_scene_device_state(&device, devices, false)?;

                                    Some((device_key, device_state))
                                }
                            })
                        }
                    })
                    .collect();

                Some((
                    scene_id,
                    FlattenedSceneConfig {
                        name: config.name,
                        devices,
                        hidden: config.hidden,
                    },
                ))
            })
            .collect()
    }
}
