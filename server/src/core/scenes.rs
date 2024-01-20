use crate::types::{
    device::{
        ControllableState, Device, DeviceData, DeviceId, DeviceKey, DeviceRef, DevicesState,
        SensorDevice,
    },
    integration::IntegrationId,
    scene::{
        FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig, SceneDescriptor,
        SceneDeviceConfig, SceneDeviceStates, SceneDevicesConfig, SceneId, ScenesConfig,
    },
};
use itertools::Itertools;
use ordered_float::OrderedFloat;

use crate::db::actions::db_get_scenes;

use super::{
    devices::find_device,
    expr::{eval_scene_expr, EvalContext},
    groups::Groups,
};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
};

#[derive(Clone)]
pub struct Scenes {
    config: ScenesConfig,
    groups: Groups,
    db_scenes: Arc<RwLock<ScenesConfig>>,
    flattened_scenes: Arc<RwLock<FlattenedScenesConfig>>,
}

/// Finds scene config of given device in its current scene
fn find_scene_device_config(
    device: &Device,
    devices: &DevicesState,
    eval_context: &EvalContext,
    groups: &Groups,
    scenes: &Scenes,
) -> Option<SceneDeviceConfig> {
    let scene_id = device.get_scene()?;
    let scene = scenes.find_scene(&scene_id)?;

    let expr_device_config = scene.clone().expr.and_then(|expr| {
        let result = eval_scene_expr(&expr, eval_context, devices);

        let devices = match result {
            Ok(devices) => Some(devices),
            Err(e) => {
                eprintln!("Error while evaluating scene {scene_id} expression: {e}");
                None
            }
        }?;

        devices.get(&device.get_device_key()).cloned()
    });

    if let Some(expr_device_config) = expr_device_config {
        return Some(expr_device_config);
    }

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
fn compute_scene_device_state(
    device: &Device,
    devices: &DevicesState,
    groups: &Groups,
    scenes: &Scenes,
    ignore_transition: bool,
    eval_context: &EvalContext,
) -> Option<ControllableState> {
    let scene_device_config =
        find_scene_device_config(device, devices, eval_context, groups, scenes)?;

    match scene_device_config {
        SceneDeviceConfig::DeviceLink(link) => {
            // Use state from another device

            // Try finding source device by integration_id, device_id, name
            let source_device = find_device(devices, &link.device_ref)?.clone();

            let mut state = match source_device.data {
                DeviceData::Controllable(controllable) => Some(controllable.state),
                DeviceData::Sensor(SensorDevice::Color(state)) => Some(state),
                _ => None,
            }?;

            // Brightness override
            if state.power {
                state.brightness = Some(
                    state.brightness.unwrap_or(OrderedFloat(1.0))
                        * link.brightness.unwrap_or(OrderedFloat(1.0)),
                );
            }

            if ignore_transition {
                // Ignore device's transition_ms value
                state.transition_ms = None;
            }

            Some(state.clone())
        }

        SceneDeviceConfig::SceneLink(link) => {
            // Use state from another scene
            let device = device.set_scene(Some(link.scene_id));
            compute_scene_device_state(
                &device,
                devices,
                groups,
                scenes,
                ignore_transition,
                eval_context,
            )
        }

        SceneDeviceConfig::DeviceState(scene_device) => {
            Some(
                // Use state from scene_device
                ControllableState {
                    brightness: scene_device.brightness,
                    color: scene_device.color.clone(),
                    power: scene_device.power.unwrap_or(true),
                    transition_ms: scene_device.transition_ms,
                },
            )
        }
    }
}

type SceneDeviceList = HashSet<(IntegrationId, DeviceId)>;
fn find_scene_device_lists(
    scene_devices_configs: &[(&SceneDescriptor, Option<SceneDevicesConfig>)],
) -> Vec<SceneDeviceList> {
    let scenes_devices = scene_devices_configs
        .iter()
        .map(|(_, scene_devices_config)| {
            let mut scene_devices: HashSet<(IntegrationId, DeviceId)> = HashSet::new();
            if let Some(integrations) = scene_devices_config {
                for (integration_id, integration) in integrations {
                    for device_id in integration.keys() {
                        scene_devices.insert((integration_id.clone(), device_id.clone()));
                    }
                }
            }

            scene_devices
        })
        .collect();

    scenes_devices
}

/// Finds devices that are common in all given scenes
fn find_scenes_common_devices(
    scene_device_lists: Vec<SceneDeviceList>,
) -> HashSet<(IntegrationId, DeviceId)> {
    let mut scenes_common_devices: HashSet<(IntegrationId, DeviceId)> = HashSet::new();

    if let Some(first_scene_devices) = scene_device_lists.first() {
        for scene_device in first_scene_devices {
            if scene_device_lists
                .iter()
                .all(|scene_devices| scene_devices.contains(scene_device))
            {
                scenes_common_devices.insert(scene_device.clone());
            }
        }
    }

    scenes_common_devices
}

/// Finds index of active scene (if any) in given list of scenes.
///
/// Arguments:
/// * `scene_devices_configs` - list of scenes with their device configs
/// * `scenes_common_devices` - list of devices that are common in all given scenes
/// * `devices` - current state of devices
fn find_active_scene_index(
    scene_devices_configs: &[(&SceneDescriptor, Option<SceneDevicesConfig>)],
    scenes_common_devices: &HashSet<(IntegrationId, DeviceId)>,
    devices: &DevicesState,
) -> Option<usize> {
    scene_devices_configs
        .iter()
        .position(|(sd, scene_devices_config)| {
            // try finding any device in scene_devices_config that has this scene active
            if let Some(integrations) = scene_devices_config {
                integrations.iter().any(|(integration_id, scene_devices)| {
                    scene_devices.iter().any(|(device_id, _)| {
                        // only consider devices which are common across all cycled scenes
                        if !scenes_common_devices
                            .contains(&(integration_id.clone(), device_id.clone()))
                        {
                            return false;
                        }

                        let device = find_device(
                            devices,
                            &DeviceRef::new_with_id(integration_id.clone(), device_id.clone()),
                        );
                        let device_scene = device.and_then(|d| d.get_scene());

                        device_scene.map_or(false, |ds| ds == sd.scene_id)
                    })
                })
            } else {
                false
            }
        })
}

/// Gets next scene from a list of scene descriptors to cycle through.
///
/// Arguments:
/// * `scene_descriptors` - list of scene descriptors to cycle through
/// * `nowrap` - whether to cycle back to first scene when last scene is reached
/// * `devices` - current state of devices
/// * `scenes` - current state of scenes
pub fn get_next_cycled_scene(
    scene_descriptors: &[SceneDescriptor],
    nowrap: bool,
    devices: &DevicesState,
    scenes: &Scenes,
    eval_context: &EvalContext,
) -> Option<SceneDescriptor> {
    let scene_devices_configs: Vec<(&SceneDescriptor, Option<SceneDevicesConfig>)> =
        scene_descriptors
            .iter()
            .map(|sd| {
                (
                    sd,
                    scenes.find_scene_devices_config(devices, sd, eval_context),
                )
            })
            .collect();

    // gather a Vec<HashSet<(IntegrationId, DeviceId)>> of all devices in cycled scenes
    let scene_device_lists = find_scene_device_lists(&scene_devices_configs);

    // gather devices which exist in all cycled scenes
    let scenes_common_devices = find_scenes_common_devices(scene_device_lists);

    let active_scene_index =
        find_active_scene_index(&scene_devices_configs, &scenes_common_devices, devices);

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

    Some(next_scene.clone())
}

impl Scenes {
    pub fn new(config: ScenesConfig, groups: Groups) -> Self {
        Scenes {
            config,
            groups,
            db_scenes: Default::default(),
            flattened_scenes: Default::default(),
        }
    }

    pub async fn refresh_db_scenes(&self) {
        let db_scenes = db_get_scenes().await.unwrap_or_default();
        let mut rw_lock = self.db_scenes.write().unwrap();
        *rw_lock = db_scenes;
    }

    pub fn get_scenes(&self) -> ScenesConfig {
        let mut db_scenes = self.db_scenes.read().unwrap().clone();
        db_scenes.extend(self.config.clone());
        db_scenes
    }

    pub fn find_scene(&self, scene_id: &SceneId) -> Option<SceneConfig> {
        Some(self.get_scenes().get(scene_id)?.clone())
    }

    pub fn find_scene_devices_config(
        &self,
        devices: &DevicesState,
        sd: &SceneDescriptor,
        eval_context: &EvalContext,
    ) -> Option<SceneDevicesConfig> {
        let scene_id = &sd.scene_id;
        let scene = self.find_scene(scene_id)?;

        let expr_device_configs = scene
            .expr
            .and_then(|expr| {
                let result = eval_scene_expr(&expr, eval_context, devices);
                result.ok()
            })
            .unwrap_or_default();

        let scene_devices_search_config = scene
            .devices
            .clone()
            .map(|devices| devices.0)
            .unwrap_or_default();

        let filter_device_by_keys = |device: &Device| -> bool {
            let device_key = &DeviceKey::new(device.integration_id.clone(), device.id.clone());

            // Skip this device if it's not in device_keys
            if let Some(device_keys) = &sd.device_keys {
                if !device_keys.contains(device_key) {
                    return false;
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
                    return false;
                }
            }

            true
        };

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

                            let device_id = match &device {
                                Some(device) => Some(device.id.clone()),
                                None => {
                                    error!(
                                        "Could not find device_id for {} device with name {}",
                                        integration_id, device_name
                                    );

                                    None
                                }
                            }?;

                            // Skip this device if it's not in device_keys or group_keys
                            if filter_device_by_keys(device?) {
                                Some((device_id, device_config.clone()))
                            } else {
                                None
                            }
                        })
                        .collect(),
                )
            })
            .collect();

        // Override scene_devices_config with entries from expr_device_configs
        for (device_key, device_config) in expr_device_configs {
            scene_devices_config
                .entry(device_key.integration_id)
                .or_default()
                .insert(device_key.device_id, device_config);
        }

        let scene_groups = scene.groups.map(|groups| groups.0).unwrap_or_default();

        // merges in devices from scene_groups
        for (group_id, scene_device_config) in scene_groups {
            let group_devices = self.groups.find_group_devices(devices, &group_id);

            for device in group_devices {
                let integration_id = &device.integration_id;
                let empty_devices_integrations = HashMap::new();
                let mut scene_devices_integrations = scene_devices_config
                    .get(integration_id)
                    .unwrap_or(&empty_devices_integrations)
                    .to_owned();

                let device_id = &device.id;

                // Skip this device if it's not in device_keys or group_keys
                if !filter_device_by_keys(device) {
                    continue;
                }

                // only insert device config if it did not exist yet
                scene_devices_integrations
                    .entry(device_id.clone())
                    .or_insert_with(|| scene_device_config.clone());
                scene_devices_config
                    .insert(integration_id.clone(), scene_devices_integrations.clone());
            }
        }

        Some(scene_devices_config)
    }

    /// Finds current state of given device in its current scene
    pub fn find_scene_device_state(&self, device: &Device) -> Option<ControllableState> {
        let scene_id = device.get_scene()?;
        let flattened_scenes = self.flattened_scenes.read().unwrap();
        let scene = flattened_scenes.0.get(&scene_id)?;
        scene.devices.0.get(&device.get_device_key()).cloned()
    }

    pub fn mk_flattened_scenes(
        &self,
        devices: &DevicesState,
        skip_scene_id: Option<&SceneId>,
        eval_context: &EvalContext,
    ) -> FlattenedScenesConfig {
        let scenes = self.get_scenes();

        FlattenedScenesConfig(
            scenes
                .into_iter()
                .filter_map(|(scene_id, config)| {
                    if let Some(skip_scene_id) = skip_scene_id {
                        if &scene_id == skip_scene_id {
                            return None;
                        }
                    }

                    let devices_config = self.find_scene_devices_config(
                        devices,
                        &SceneDescriptor {
                            scene_id: scene_id.clone(),
                            device_keys: None,
                            group_keys: None,
                        },
                        eval_context,
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

                                            let device_state = compute_scene_device_state(
                                                &device,
                                                devices,
                                                &self.groups,
                                                self,
                                                false,
                                                eval_context,
                                            )?;

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

    pub fn get_flattened_scenes(&self) -> FlattenedScenesConfig {
        self.flattened_scenes.read().unwrap().clone()
    }

    pub fn invalidate(&self, devices: &DevicesState, eval_context: &EvalContext) {
        let flattened_scenes = self.mk_flattened_scenes(devices, None, eval_context);
        let mut rw_lock = self.flattened_scenes.write().unwrap();
        *rw_lock = flattened_scenes
    }
}
