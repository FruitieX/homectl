use crate::types::{
    device::{
        ControllableState, Device, DeviceData, DeviceKey, DeviceRef, DevicesState, SensorDevice,
    },
    group::GroupId,
    scene::{
        ActivateSceneDescriptor, FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig,
        SceneDeviceConfig, SceneDeviceStates, SceneDevicesConfig, SceneDevicesConfigs, SceneId,
        ScenesConfig,
    },
};
use itertools::Itertools;
use ordered_float::OrderedFloat;

use crate::db::actions::db_get_scenes;

use super::{
    devices::Devices,
    expr::{
        eval_scene_expr, get_expr_device_deps, get_expr_group_device_deps, get_expr_scene_deps,
        EvalContext,
    },
    groups::Groups,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Default, Debug)]
pub struct Scenes {
    config: ScenesConfig,
    db_scenes: ScenesConfig,
    flattened_scenes: FlattenedScenesConfig,
    scene_devices_configs: SceneDevicesConfigs,
    device_invalidation_map: HashMap<DeviceKey, HashSet<SceneId>>,
}

/// Evaluates current state of given device in some given scene
fn compute_scene_device_state(
    scene_id: &SceneId,
    device: &Device,
    devices: &Devices,
    scene_devices_configs: &SceneDevicesConfigs,
    ignore_transition: bool,
) -> Option<ControllableState> {
    let (_scene_config, scene_devices_config) = scene_devices_configs.get(scene_id)?;
    let scene_device_config = scene_devices_config.get(&device.get_device_key())?;

    match scene_device_config {
        SceneDeviceConfig::DeviceLink(link) => {
            // Use state from another device

            // Try finding source device by integration_id, device_id, name
            let source_device = devices.get_device_by_ref(&link.device_ref)?.clone();

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
                // Ignore device's transition value
                state.transition = None;
            }

            Some(state.clone())
        }

        SceneDeviceConfig::SceneLink(link) => {
            // Use state from another scene
            compute_scene_device_state(
                &link.scene_id,
                device,
                devices,
                scene_devices_configs,
                ignore_transition,
            )
        }

        SceneDeviceConfig::DeviceState(scene_device) => {
            Some(
                // Use state from scene_device
                ControllableState {
                    brightness: scene_device.brightness,
                    color: scene_device.color.clone(),
                    power: scene_device.power.unwrap_or(true),
                    transition: scene_device.transition,
                },
            )
        }
    }
}

type SceneDeviceList = HashSet<DeviceKey>;
/// Gathers a Vec<HashSet<DeviceKey>> of all devices in provided scenes
fn find_scene_device_lists(
    scene_devices_configs: &[(ActivateSceneDescriptor, Option<SceneDevicesConfig>)],
) -> Vec<SceneDeviceList> {
    let scenes_devices = scene_devices_configs
        .iter()
        .map(|(_, scene_devices_config)| {
            scene_devices_config
                .as_ref()
                .map(|c| c.keys().cloned().collect())
                .unwrap_or_default()
        })
        .collect();

    scenes_devices
}

/// Finds devices that are common in all given scenes
fn find_scenes_common_devices(scene_device_lists: Vec<SceneDeviceList>) -> HashSet<DeviceKey> {
    let mut scenes_common_devices: HashSet<DeviceKey> = HashSet::new();

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
    scene_devices_configs: &[(ActivateSceneDescriptor, Option<SceneDevicesConfig>)],
    scenes_common_devices: &HashSet<DeviceKey>,
    devices: &Devices,
) -> Option<usize> {
    scene_devices_configs
        .iter()
        .position(|(sd, scene_devices_config)| {
            // try finding any device in scene_devices_config that has this scene active
            let Some(scene_devices_config) = scene_devices_config else {
                return false;
            };

            scene_devices_config.iter().any(|(device_key, _)| {
                // only consider devices which are common across all cycled scenes
                if !scenes_common_devices.contains(device_key) {
                    return false;
                }

                let device = devices.get_device_by_ref(&device_key.into());
                let device_scene = device.and_then(|d| d.get_scene_id());

                device_scene.as_ref() == Some(&sd.scene_id)
            })
        })
}

/// Gets next scene from a list of scene descriptors to cycle through.
///
/// Arguments:
/// * `scene_descriptors` - list of scene descriptors to cycle through
/// * `nowrap` - whether to cycle back to first scene when last scene is reached
/// * `devices` - current state of devices
/// * `scenes` - current state of scenes
/// * `detection_device_keys` - optionally only consider these devices for detecting current scene
/// * `detection_group_keys` - optionally only consider these groups for detecting current scene
#[allow(clippy::too_many_arguments)]
pub fn get_next_cycled_scene(
    scene_descriptors: &[ActivateSceneDescriptor],
    nowrap: bool,
    devices: &Devices,
    groups: &Groups,
    detection_device_keys: &Option<Vec<DeviceKey>>,
    detection_group_keys: &Option<Vec<GroupId>>,
    scenes: &Scenes,
    eval_context: &EvalContext,
) -> Option<ActivateSceneDescriptor> {
    let scene_devices_configs: Vec<(ActivateSceneDescriptor, Option<SceneDevicesConfig>)> =
        scene_descriptors
            .iter()
            .map(|sd| {
                let mut sd = sd.clone();

                if detection_device_keys.is_some() {
                    sd.device_keys = detection_device_keys.clone();
                }
                if detection_group_keys.is_some() {
                    sd.group_keys = detection_group_keys.clone();
                }

                let scene_devices_config =
                    scenes.find_scene_devices_config(devices, groups, &sd, eval_context);

                (sd, scene_devices_config)
            })
            .collect();

    // gather a Vec<HashSet<DeviceKey>> of all devices in cycled scenes
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
    pub fn new(config: ScenesConfig) -> Self {
        Scenes {
            config,
            ..Default::default()
        }
    }

    pub async fn refresh_db_scenes(&mut self) {
        let db_scenes = db_get_scenes().await.unwrap_or_default();
        self.db_scenes = db_scenes;
    }

    pub fn get_scenes(&self) -> ScenesConfig {
        let mut db_scenes = self.db_scenes.clone();
        db_scenes.extend(self.config.clone());
        db_scenes
    }

    pub fn get_scene_ids(&self) -> Vec<SceneId> {
        self.get_scenes().keys().cloned().collect()
    }

    pub fn find_scene(&self, scene_id: &SceneId) -> Option<SceneConfig> {
        Some(self.get_scenes().get(scene_id)?.clone())
    }

    pub fn find_scene_devices_config(
        &self,
        devices: &Devices,
        groups: &Groups,
        sd: &ActivateSceneDescriptor,
        eval_context: &EvalContext,
    ) -> Option<SceneDevicesConfig> {
        let mut scene_devices_config: SceneDevicesConfig = Default::default();

        let scene_id = &sd.scene_id;
        let scene = self.find_scene(scene_id)?;

        let filter_device_by_keys = |device_key: &DeviceKey| -> bool {
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
                        groups
                            .find_group_devices(devices.get_state(), group_id)
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

        let expr_device_configs = scene
            .expr
            .and_then(|expr| {
                let result = eval_scene_expr(&expr, eval_context, devices.get_state());

                if let Err(e) = &result {
                    warn!("Error evaluating scene expression: {e:?}");
                }

                result.ok()
            })
            .map(|c| {
                c.into_iter()
                    .filter(|(device_key, _)| filter_device_by_keys(device_key))
                    .collect::<HashMap<DeviceKey, SceneDeviceConfig>>()
            })
            .unwrap_or_default();

        // Inserts devices from groups
        let scene_groups = scene.groups.map(|groups| groups.0).unwrap_or_default();
        for (group_id, scene_device_config) in scene_groups {
            let group_devices = groups.find_group_devices(devices.get_state(), &group_id);

            for device in group_devices {
                let device_key = device.get_device_key();

                // Skip this device if it's not in device_keys or group_keys
                if !filter_device_by_keys(&device_key) {
                    continue;
                }

                scene_devices_config.insert(device_key, scene_device_config.clone());
            }
        }

        // Insert scene devices
        let scene_devices_search_config =
            scene.devices.map(|devices| devices.0).unwrap_or_default();
        for (integration_id, scene_device_configs) in scene_devices_search_config {
            for (device_name, scene_device_config) in scene_device_configs {
                let device = devices.get_device_by_ref(&DeviceRef::new_with_name(
                    integration_id.clone(),
                    device_name.clone(),
                ));

                let Some(device) = device else {
                    warn!(
                        "Could not find device with name {device_name} in integration {integration_id}",
                    );

                    continue;
                };

                let device_key = device.get_device_key();

                // Skip this device if it's not in device_keys or group_keys
                if !filter_device_by_keys(&device_key) {
                    continue;
                }

                scene_devices_config.insert(device_key, scene_device_config.clone());
            }
        }

        // Insert devices from evaluated expression
        for (device_key, device_config) in expr_device_configs {
            scene_devices_config.insert(device_key, device_config);
        }

        Some(scene_devices_config)
    }

    pub fn mk_flattened_scene(
        &self,
        scene_id: &SceneId,
        devices: &Devices,
    ) -> Option<FlattenedSceneConfig> {
        let (scene_config, scene_devices_config) = self.scene_devices_configs.get(scene_id)?;

        let devices = scene_devices_config
            .keys()
            .filter_map({
                |device_key| {
                    let device = devices.get_device(device_key)?;

                    let device_state = compute_scene_device_state(
                        scene_id,
                        device,
                        devices,
                        &self.scene_devices_configs,
                        false,
                    )?;

                    Some((device_key.clone(), device_state))
                }
            })
            .collect();

        Some(FlattenedSceneConfig {
            name: scene_config.name.clone(),
            devices: SceneDeviceStates(devices),
            hidden: scene_config.hidden,
        })
    }

    pub fn mk_scene_devices_configs(
        &self,
        devices: &Devices,
        groups: &Groups,
        invalidated_scenes: &HashSet<SceneId>,
        eval_context: &EvalContext,
    ) -> SceneDevicesConfigs {
        self.get_scene_ids()
            .iter()
            .filter_map(|scene_id| {
                let scene_devices_config = if invalidated_scenes.contains(scene_id) {
                    let scene_config = self.find_scene(scene_id)?;
                    let scene_devices_config = self.find_scene_devices_config(
                        devices,
                        groups,
                        &ActivateSceneDescriptor {
                            scene_id: scene_id.clone(),
                            device_keys: None,
                            group_keys: None,
                        },
                        eval_context,
                    )?;

                    Some((scene_config, scene_devices_config))
                } else {
                    self.scene_devices_configs.get(scene_id).cloned()
                }?;

                Some((scene_id.clone(), scene_devices_config))
            })
            .collect()
    }

    pub fn mk_flattened_scenes(
        &self,
        devices: &Devices,
        invalidated_scenes: &HashSet<SceneId>,
    ) -> FlattenedScenesConfig {
        FlattenedScenesConfig(
            self.get_scene_ids()
                .iter()
                .filter_map(|scene_id| {
                    let flattened_scene = if invalidated_scenes.contains(scene_id) {
                        self.mk_flattened_scene(scene_id, devices)?
                    } else {
                        self.flattened_scenes.0.get(scene_id)?.clone()
                    };

                    Some((scene_id.clone(), flattened_scene))
                })
                .collect(),
        )
    }

    pub fn get_flattened_scenes(&self) -> &FlattenedScenesConfig {
        &self.flattened_scenes
    }

    pub fn get_device_scene_state(
        &self,
        scene_id: &SceneId,
        device_key: &DeviceKey,
    ) -> Option<&ControllableState> {
        self.flattened_scenes
            .0
            .get(scene_id)?
            .devices
            .0
            .get(device_key)
    }

    fn get_invalidated_devices_for_scene(
        &self,
        devices: &Devices,
        groups: &Groups,
        scene_id: &SceneId,
    ) -> HashSet<DeviceKey> {
        let scene_device_configs = self.scene_devices_configs.get(scene_id).cloned();

        let mut invalidated_devices = HashSet::new();

        let Some((scene_config, scene_device_configs)) = &scene_device_configs else {
            return invalidated_devices;
        };

        // Invalidate any devices that the scene expression refers to directly,
        // via groups or via other scenes
        if let Some(expr) = &scene_config.expr {
            invalidated_devices.extend(get_expr_device_deps(expr, devices.get_state()));
            invalidated_devices.extend(get_expr_group_device_deps(
                expr,
                groups.get_flattened_groups(),
            ));

            let scene_deps = get_expr_scene_deps(expr);
            for scene_id in scene_deps {
                invalidated_devices
                    .extend(self.get_invalidated_devices_for_scene(devices, groups, &scene_id))
            }
        }

        for scene_device_config in scene_device_configs.values() {
            match scene_device_config {
                SceneDeviceConfig::DeviceLink(d) => {
                    let device = devices.get_device_by_ref(&d.device_ref);
                    if let Some(device) = device {
                        invalidated_devices.insert(device.get_device_key());
                    }
                }
                SceneDeviceConfig::SceneLink(s) => invalidated_devices
                    .extend(self.get_invalidated_devices_for_scene(devices, groups, &s.scene_id)),
                SceneDeviceConfig::DeviceState(_) => {}
            };
        }

        invalidated_devices
    }

    pub fn mk_device_invalidation_map(
        &self,
        devices: &Devices,
        groups: &Groups,
    ) -> HashMap<DeviceKey, HashSet<SceneId>> {
        let devices_by_scene: HashMap<SceneId, HashSet<DeviceKey>> = self
            .get_scene_ids()
            .into_iter()
            .map(|scene_id| {
                let invalidated_devices =
                    self.get_invalidated_devices_for_scene(devices, groups, &scene_id);
                (scene_id, invalidated_devices)
            })
            .collect();

        let mut scenes_by_device: HashMap<DeviceKey, HashSet<SceneId>> = Default::default();
        for (scene_id, device_keys) in devices_by_scene {
            for device_key in device_keys {
                let scene_ids = scenes_by_device.entry(device_key).or_default();
                scene_ids.insert(scene_id.clone());
            }
        }

        scenes_by_device
    }

    pub fn invalidate(
        &mut self,
        old_state: &DevicesState,
        _new_state: &DevicesState,
        invalidated_device: &Device,
        devices: &Devices,
        groups: &Groups,
        eval_context: &EvalContext,
    ) -> HashSet<SceneId> {
        let is_new_device = !old_state
            .0
            .contains_key(&invalidated_device.get_device_key());

        let invalidated_scenes = self
            .device_invalidation_map
            .get(&invalidated_device.get_device_key())
            .cloned()
            .unwrap_or_else(|| {
                if is_new_device {
                    // Invalidate all scenes if device was recently discovered
                    self.get_scene_ids()
                        .into_iter()
                        .collect::<HashSet<SceneId>>()
                } else {
                    Default::default()
                }
            });

        self.scene_devices_configs =
            self.mk_scene_devices_configs(devices, groups, &invalidated_scenes, eval_context);
        self.flattened_scenes = self.mk_flattened_scenes(devices, &invalidated_scenes);

        // Recompute device_invalidation_map if device was recently discovered
        if is_new_device {
            self.device_invalidation_map = self.mk_device_invalidation_map(devices, groups);
        }

        invalidated_scenes
    }

    pub fn force_invalidate(
        &mut self,
        devices: &Devices,
        groups: &Groups,
        eval_context: &EvalContext,
    ) {
        let invalidated_scenes = self
            .get_scene_ids()
            .into_iter()
            .collect::<HashSet<SceneId>>();
        self.scene_devices_configs =
            self.mk_scene_devices_configs(devices, groups, &invalidated_scenes, eval_context);
        self.flattened_scenes = self.mk_flattened_scenes(devices, &invalidated_scenes);
        self.device_invalidation_map = self.mk_device_invalidation_map(devices, groups);
    }
}
