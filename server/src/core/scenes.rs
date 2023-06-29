use crate::types::{
    device::{
        Device, DeviceData, DeviceKey, DeviceRef, DevicesState, ManagedDeviceState, SensorDevice,
    },
    scene::{
        FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig, SceneDescriptor,
        SceneDeviceConfig, SceneDeviceStates, SceneDevicesConfig, SceneId, ScenesConfig,
    },
};
use itertools::Itertools;

use crate::db::actions::db_get_scenes;

use super::{devices::find_device, groups::Groups};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

/// Finds scene config of given device in its current scene
pub fn find_scene_device_config(
    device: &Device,
    groups: &Groups,
    scenes: &ScenesConfig,
) -> Option<SceneDeviceConfig> {
    let scene_id = device.get_scene()?;
    let scene = scenes.get(&scene_id)?;

    let scene_devices_search_config = scene.devices.as_ref().map(|devices| &devices.0);

    let scene_device_config = scene_devices_search_config.and_then(|sc| {
        sc.get(&device.integration_id)
            .and_then(|device_configs| device_configs.get(&device.name))
    });

    // If a match was found by device name, it takes precedence over eventual
    // group matches
    if scene_device_config.is_some() {
        return scene_device_config.cloned();
    }

    let scene_group_configs = scene.groups.as_ref().map(|groups| &groups.0)?;
    let matching_group_config = scene_group_configs
        .iter()
        .find(|(group_id, _)| groups.is_device_in_group(group_id, device))
        .map(|(_, config)| config);

    matching_group_config.cloned()
}

/// Evaluates current state of given device in its current scene
pub fn eval_scene_device_state(
    device: &Device,
    devices: &DevicesState,
    groups: &Groups,
    scenes: &ScenesConfig,
    ignore_transition: bool,
) -> Option<ManagedDeviceState> {
    let scene_device_config = find_scene_device_config(device, groups, scenes)?;

    match scene_device_config {
        SceneDeviceConfig::DeviceLink(link) => {
            // Use state from another device

            // Try finding source device by integration_id, device_id, name
            let source_device = find_device(devices, &link.device_ref)?;

            let mut state = match source_device.data {
                DeviceData::Managed(managed) => Some(managed.state),
                DeviceData::Sensor(SensorDevice::Color(state)) => Some(state),
                _ => None,
            }?;

            // Brightness override
            if state.power {
                state.brightness =
                    Some(state.brightness.unwrap_or(1.0) * link.brightness.unwrap_or(1.0));
            }

            if ignore_transition {
                // Ignore device's transition_ms value
                state.transition_ms = None;
            }

            Some(state)
        }

        SceneDeviceConfig::SceneLink(link) => {
            // Use state from another scene
            let device = device.set_scene(Some(link.scene_id));
            eval_scene_device_state(&device, devices, groups, scenes, ignore_transition)
        }

        SceneDeviceConfig::DeviceState(scene_device) => {
            Some(
                // Use state from scene_device
                ManagedDeviceState {
                    brightness: scene_device.brightness,
                    color: scene_device.color.clone(),
                    power: scene_device.power.unwrap_or(true),
                    transition_ms: scene_device.transition_ms,
                },
            )
        }
    }
}

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

        let scene_devices_search_config = scene
            .devices
            .clone()
            .map(|devices| devices.0)
            .unwrap_or_default();

        // replace device names by device_ids in device_configs
        let mut scene_devices_config: SceneDevicesConfig = scene_devices_search_config
            .iter()
            .map(|(integration_id, device_configs)| {
                (
                    integration_id.clone(),
                    device_configs
                        .iter()
                        .filter_map(|(device_name, device_config)| {
                            let device = find_device(
                                devices,
                                &DeviceRef::new_with_name(
                                    integration_id.clone(),
                                    device_name.clone(),
                                ),
                            );

                            let device_id = match device {
                                Some(device) => Some(device.id),
                                None => {
                                    error!(
                                        "Could not find device_id for {} device with name {}",
                                        integration_id, device_name
                                    );

                                    None
                                }
                            }?;
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

        let scene_groups = scene.groups.map(|groups| groups.0).unwrap_or_default();

        // merges in devices from scene_groups
        for (group_id, scene_device_config) in scene_groups {
            let group_device_refs = { self.groups.find_group_device_refs(&group_id) };

            for device_ref in group_device_refs {
                let device = find_device(devices, &device_ref);

                if let Some(device) = device {
                    let integration_id = device_ref.integration_id();
                    let empty_devices_integrations = HashMap::new();
                    let mut scene_devices_integrations = scene_devices_config
                        .get(integration_id)
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
                    scene_devices_config
                        .insert(integration_id.clone(), scene_devices_integrations.clone());
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
    ) -> Option<ManagedDeviceState> {
        eval_scene_device_state(
            device,
            devices,
            &self.groups,
            &self.get_scenes(),
            ignore_transition,
        )
    }

    pub fn get_flattened_scenes(&self, devices: &DevicesState) -> FlattenedScenesConfig {
        let scenes = self.get_scenes();

        FlattenedScenesConfig(
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

                    let devices: SceneDeviceStates = SceneDeviceStates(
                        devices_config
                            .iter()
                            .flat_map({
                                let scene_id = scene_id.clone();

                                move |(integration_id, device_configs)| {
                                    device_configs.iter().filter_map({
                                        let scene_id = scene_id.clone();

                                        move |(device_id, _)| {
                                            let device_key = DeviceKey::new(
                                                integration_id.clone(),
                                                device_id.clone(),
                                            );

                                            let device = devices.0.get(&device_key)?;
                                            let device = device.set_scene(Some(scene_id.clone()));

                                            let device_state = self
                                                .find_scene_device_state(&device, devices, false)?;

                                            Some((device_key, device_state))
                                        }
                                    })
                                }
                            })
                            .collect(),
                    );

                    Some((
                        scene_id,
                        FlattenedSceneConfig {
                            name: config.name,
                            devices,
                            hidden: config.hidden,
                        },
                    ))
                })
                .collect(),
        )
    }
}
