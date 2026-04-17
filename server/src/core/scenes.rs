use crate::{
    db::{
        actions::{db_get_scene_overrides, db_store_scene_overrides},
        config_queries,
    },
    types::{
        device::{
            ControllableState, Device, DeviceData, DeviceId, DeviceKey, DeviceRef,
            DeviceStateSource, DeviceStateSourceKind, DeviceStateSourceScope, DevicesState,
            SensorDevice,
        },
        group::GroupId,
        scene::{
            ActivateSceneDescriptor, FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig,
            SceneDeviceConfig, SceneDeviceStates, SceneId, SceneOverridesConfig, ScenesConfig,
        },
    },
};
use eyre::Result;
use itertools::Itertools;
use ordered_float::OrderedFloat;

use crate::db::actions::db_get_scenes;

use super::{devices::Devices, groups::Groups, scripting::ScriptEngine};
use std::collections::{BTreeMap, HashMap, HashSet};

fn extract_bracket_string_refs(script: &str, object_name: &str) -> HashSet<String> {
    let mut refs = HashSet::new();
    let mut search_start = 0;

    while let Some(relative_index) = script[search_start..].find(object_name) {
        let object_index = search_start + relative_index;
        let after_object = &script[object_index + object_name.len()..];
        let Some(after_open_bracket) = after_object.strip_prefix('[') else {
            search_start = object_index + object_name.len();
            continue;
        };

        let mut chars = after_open_bracket.chars();
        let Some(quote) = chars.next() else {
            break;
        };

        if quote != '\'' && quote != '"' {
            search_start = object_index + object_name.len() + 1;
            continue;
        }

        let value_start = object_index + object_name.len() + 2;
        let rest = &script[value_start..];
        let Some(value_end_relative) = rest.find(quote) else {
            break;
        };
        let value_end = value_start + value_end_relative;
        let after_quote = &script[value_end + quote.len_utf8()..];

        if !after_quote.starts_with(']') {
            search_start = value_end + quote.len_utf8();
            continue;
        }

        refs.insert(script[value_start..value_end].to_string());
        search_start = value_end + quote.len_utf8() + 1;
    }

    refs
}

fn get_script_dependency_device_keys(
    script: &str,
    devices: &Devices,
    groups: &Groups,
) -> HashSet<DeviceKey> {
    let mut device_keys = extract_bracket_string_refs(script, "devices")
        .into_iter()
        .filter_map(|device_key| {
            let (integration_id, device_id) = device_key.split_once('/')?;

            Some(DeviceKey::new(
                integration_id.to_string().into(),
                device_id.to_string().into(),
            ))
        })
        .collect::<HashSet<_>>();

    for group_id in extract_bracket_string_refs(script, "groups") {
        let group_id = GroupId(group_id);
        device_keys.extend(
            groups
                .find_group_devices(devices.get_state(), &group_id)
                .into_iter()
                .map(|device| device.get_device_key()),
        );
    }

    device_keys
}

pub(crate) type ResolvedSceneDevicesConfig = HashMap<DeviceKey, ResolvedSceneDeviceConfig>;
type ResolvedSceneDevicesConfigs = HashMap<SceneId, (SceneConfig, ResolvedSceneDevicesConfig)>;

#[derive(Clone, Debug)]
pub(crate) struct ResolvedSceneDeviceConfig {
    config: SceneDeviceConfig,
    scope: DeviceStateSourceScope,
    group_id: Option<GroupId>,
}

impl ResolvedSceneDeviceConfig {
    fn new(
        config: SceneDeviceConfig,
        scope: DeviceStateSourceScope,
        group_id: Option<GroupId>,
    ) -> Self {
        Self {
            config,
            scope,
            group_id,
        }
    }

    fn to_state_source(
        &self,
        linked_scene_id: Option<SceneId>,
        linked_device_key: Option<DeviceKey>,
    ) -> DeviceStateSource {
        let kind = match self.config {
            SceneDeviceConfig::DeviceState(_) => DeviceStateSourceKind::DeviceState,
            SceneDeviceConfig::DeviceLink(_) => DeviceStateSourceKind::DeviceLink,
            SceneDeviceConfig::SceneLink(_) => DeviceStateSourceKind::SceneLink,
        };

        DeviceStateSource {
            scope: self.scope.clone(),
            kind,
            group_id: self.group_id.clone(),
            linked_scene_id,
            linked_device_key,
        }
    }
}

#[derive(Clone, Default, Debug)]
pub struct Scenes {
    db_scenes: ScenesConfig,
    db_scene_overrides: SceneOverridesConfig,
    flattened_scenes: FlattenedScenesConfig,
    scene_devices_configs: ResolvedSceneDevicesConfigs,
    device_invalidation_map: HashMap<DeviceKey, HashSet<SceneId>>,
}

/// Evaluates current state of given device in some given scene
fn compute_scene_device_state(
    scene_id: &SceneId,
    device: &Device,
    devices: &Devices,
    scene_devices_configs: &ResolvedSceneDevicesConfigs,
    ignore_transition: bool,
) -> Option<(ControllableState, DeviceStateSource)> {
    let (_scene_config, scene_devices_config) = scene_devices_configs.get(scene_id)?;
    let scene_device_config = scene_devices_config.get(&device.get_device_key())?;

    match &scene_device_config.config {
        SceneDeviceConfig::DeviceLink(link) => {
            // Use state from another device

            // Try finding source device by integration_id, device_id, name
            let source_device = devices.get_device_by_ref(&link.device_ref)?.clone();
            let linked_device_key = source_device.get_device_key();

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

            Some((
                state,
                scene_device_config.to_state_source(None, Some(linked_device_key)),
            ))
        }

        SceneDeviceConfig::SceneLink(link) => {
            // Use state from another scene
            let (mut state, _nested_source) = compute_scene_device_state(
                &link.scene_id,
                device,
                devices,
                scene_devices_configs,
                ignore_transition,
            )?;

            if let Some(transition) = link.transition {
                state.transition = Some(transition);
            }

            Some((
                state,
                scene_device_config.to_state_source(Some(link.scene_id.clone()), None),
            ))
        }

        SceneDeviceConfig::DeviceState(scene_device) => {
            Some((
                // Use state from scene_device
                ControllableState {
                    brightness: scene_device.brightness,
                    color: scene_device.color.clone(),
                    power: scene_device.power.unwrap_or(true),
                    transition: scene_device.transition,
                },
                scene_device_config.to_state_source(None, None),
            ))
        }
    }
}

type SceneDeviceList = HashSet<DeviceKey>;
/// Gathers a Vec<HashSet<DeviceKey>> of all devices in provided scenes
fn find_scene_device_lists(
    scene_devices_configs: &[(ActivateSceneDescriptor, Option<ResolvedSceneDevicesConfig>)],
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

fn normalize_scene_script_color_value(value: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(mut object) = value else {
        return value;
    };

    for variant in ["Xy", "Hs", "Rgb", "Ct"] {
        if object.len() == 1 {
            if let Some(inner) = object.remove(variant) {
                return inner;
            }
        }
    }

    serde_json::Value::Object(object)
}

fn normalize_scene_script_config_value(value: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(mut object) = value else {
        return value;
    };

    if let Some(color) = object.remove("color") {
        object.insert(
            "color".to_string(),
            normalize_scene_script_color_value(color),
        );
    }

    if object.contains_key("integration_id")
        && object.contains_key("id")
        && !object.contains_key("device_id")
        && !object.contains_key("name")
    {
        if let Some(device_id) = object.remove("id") {
            object.insert("device_id".to_string(), device_id);
        }
    }

    serde_json::Value::Object(object)
}

/// Finds index of active scene (if any) in given list of scenes.
///
/// Arguments:
/// * `scene_devices_configs` - list of scenes with their device configs
/// * `scenes_common_devices` - list of devices that are common in all given scenes
/// * `devices` - current state of devices
fn find_active_scene_index(
    scene_devices_configs: &[(ActivateSceneDescriptor, Option<ResolvedSceneDevicesConfig>)],
    scenes_common_devices: &HashSet<DeviceKey>,
    devices: &Devices,
) -> Option<usize> {
    scene_devices_configs
        .iter()
        .position(|(sd, scene_devices_config)| {
            // try finding any device in scene_devices_config that has this scene active
            let Some(scene_devices_config) = scene_devices_config else {
                debug!("Scene {} has no device config", sd.scene_id);
                return false;
            };

            // Filter to only online devices that are common across all scenes,
            // then check if any of them have this scene active.
            // Offline devices are skipped (ignored) rather than causing detection to fail.
            let result = scene_devices_config
                .iter()
                .filter_map(|(device_key, _)| {
                    // only consider devices which are common across all cycled scenes
                    if !scenes_common_devices.contains(device_key) {
                        return None;
                    }

                    // Skip offline devices - they are ignored for scene detection
                    let device = devices.get_device_by_ref(&device_key.into())?;
                    let device_scene = device.get_scene_id();
                    let matches = device_scene.as_ref() == Some(&sd.scene_id);

                    debug!(
                        "Checking device {} for scene {}: device_scene={:?}, matches={}",
                        device_key, sd.scene_id, device_scene, matches
                    );

                    Some(matches)
                })
                .any(|matches| matches);

            debug!("Scene {} active check result: {}", sd.scene_id, result);

            result
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
) -> Option<ActivateSceneDescriptor> {
    let scene_devices_configs: Vec<(ActivateSceneDescriptor, Option<ResolvedSceneDevicesConfig>)> =
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

                let scene_devices_config = scenes.find_scene_devices_config(devices, groups, &sd);

                (sd, scene_devices_config)
            })
            .collect();

    // gather a Vec<HashSet<DeviceKey>> of all devices in cycled scenes
    let scene_device_lists = find_scene_device_lists(&scene_devices_configs);

    // Log scene device lists for debugging
    debug!(
        "Scene device lists: {:?}",
        scene_device_lists
            .iter()
            .enumerate()
            .map(|(i, devices)| format!("Scene {}: {} devices", i, devices.len()))
            .collect::<Vec<_>>()
    );

    // gather devices which exist in all cycled scenes
    let scenes_common_devices = find_scenes_common_devices(scene_device_lists);

    debug!(
        "Common devices across all scenes: {} devices: {:?}",
        scenes_common_devices.len(),
        scenes_common_devices
    );

    let active_scene_index =
        find_active_scene_index(&scene_devices_configs, &scenes_common_devices, devices);

    debug!(
        "Active scene index: {:?}, cycling to next scene",
        active_scene_index
    );

    let next_scene = match active_scene_index {
        Some(index) => {
            let next_scene_index = if nowrap {
                (index + 1).min(scene_descriptors.len() - 1)
            } else {
                (index + 1) % scene_descriptors.len()
            };
            debug!(
                "Current scene index: {}, next scene index: {}",
                index, next_scene_index
            );
            scene_descriptors.get(next_scene_index)
        }
        None => {
            debug!("No active scene detected, defaulting to first scene");
            scene_descriptors.first()
        }
    }?;

    info!(
        "Cycling scenes: detected {:?}, next scene: {}",
        active_scene_index.map(|i| scene_descriptors.get(i).map(|s| s.scene_id.to_string())),
        next_scene.scene_id
    );

    Some(next_scene.clone())
}

impl Scenes {
    pub fn new(config: ScenesConfig) -> Self {
        Scenes {
            db_scenes: config,
            ..Default::default()
        }
    }

    pub fn load_config_rows(
        &mut self,
        scenes: &[config_queries::SceneRow],
        overrides: SceneOverridesConfig,
    ) {
        let mut db_scenes = ScenesConfig::new();

        for scene in scenes {
            let devices = if scene.device_states.is_empty() {
                None
            } else {
                let mut devices_map = BTreeMap::new();

                for (device_key, config_value) in &scene.device_states {
                    if let Some((integration_id, device_name)) = device_key.split_once('/') {
                        match serde_json::from_value::<SceneDeviceConfig>(config_value.clone()) {
                            Ok(config) => {
                                devices_map
                                    .entry(integration_id.to_string().into())
                                    .or_insert_with(BTreeMap::new)
                                    .insert(device_name.to_string(), config);
                            }
                            Err(error) => {
                                warn!(
                                    "Failed to parse scene device config for {}: {error}",
                                    device_key
                                );
                            }
                        }
                    }
                }

                Some(crate::types::scene::SceneDevicesSearchConfig(devices_map))
            };

            let groups = if scene.group_states.is_empty() {
                None
            } else {
                let mut groups_map = BTreeMap::new();

                for (group_id, config_value) in &scene.group_states {
                    match serde_json::from_value::<SceneDeviceConfig>(config_value.clone()) {
                        Ok(config) => {
                            groups_map.insert(GroupId(group_id.clone()), config);
                        }
                        Err(error) => {
                            warn!(
                                "Failed to parse scene group config for {}: {error}",
                                group_id
                            );
                        }
                    }
                }

                Some(crate::types::scene::SceneGroupsConfig(groups_map))
            };

            db_scenes.insert(
                SceneId::new(scene.id.clone()),
                SceneConfig {
                    name: scene.name.clone(),
                    devices,
                    groups,
                    hidden: Some(scene.hidden),
                    script: scene.script.clone(),
                },
            );
        }

        let valid_scene_ids = db_scenes.keys().cloned().collect::<HashSet<_>>();

        self.db_scenes = db_scenes;
        self.db_scene_overrides = overrides
            .into_iter()
            .filter(|(scene_id, _)| valid_scene_ids.contains(scene_id))
            .collect();
    }

    pub async fn refresh_db_scenes(&mut self) {
        let db_scenes = db_get_scenes().await.unwrap_or_default();
        self.db_scenes = db_scenes;
        let scene_overrides = db_get_scene_overrides().await.unwrap_or_default();
        self.db_scene_overrides = scene_overrides
    }

    pub async fn store_scene_override(
        &mut self,
        device: &Device,
        store_override: bool,
    ) -> Result<()> {
        let scene_id = device.get_scene_id().ok_or_else(|| {
            eyre::eyre!(
                "Device {name} is not associated with any scene",
                name = device.name
            )
        })?;

        let overrides = self.db_scene_overrides.entry(scene_id.clone()).or_default();

        if store_override {
            if let Some(state) = device.get_controllable_state() {
                let scene_device_config = SceneDeviceConfig::DeviceState(state.clone().into());
                overrides.insert(device.get_device_key(), scene_device_config);
            }
        } else {
            overrides.remove(&device.get_device_key());
        }

        if let Err(error) = db_store_scene_overrides(&scene_id, overrides).await {
            warn!("Failed to persist scene override for {scene_id}: {error}");
        }

        Ok(())
    }

    pub fn has_override(&self, device: &Device) -> bool {
        let scene_id = device.get_scene_id();

        let Some(scene_id) = scene_id else {
            return false;
        };

        self.db_scene_overrides
            .get(&scene_id)
            .map(|overrides| overrides.contains_key(&device.get_device_key()))
            .unwrap_or_default()
    }

    pub fn get_scenes(&self) -> ScenesConfig {
        self.db_scenes.clone()
    }

    pub fn get_scene_overrides(&self) -> SceneOverridesConfig {
        self.db_scene_overrides.clone()
    }

    pub fn get_scene_ids(&self) -> Vec<SceneId> {
        self.get_scenes().keys().cloned().collect()
    }

    pub fn find_scene(&self, scene_id: &SceneId) -> Option<SceneConfig> {
        Some(self.get_scenes().get(scene_id)?.clone())
    }

    pub(crate) fn find_scene_devices_config(
        &self,
        devices: &Devices,
        groups: &Groups,
        sd: &ActivateSceneDescriptor,
    ) -> Option<ResolvedSceneDevicesConfig> {
        let mut scene_devices_config: ResolvedSceneDevicesConfig = Default::default();

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

        let script_device_configs = scene
            .script
            .as_deref()
            .map(|script| {
                let mut engine = ScriptEngine::new();
                let result = engine.eval_scene_script(
                    script,
                    devices.get_state(),
                    groups.get_flattened_groups(),
                );

                match result {
                    Ok(configs) => configs
                        .into_iter()
                        .filter_map(|(device_key, config_value)| {
                            let normalized_config_value =
                                normalize_scene_script_config_value(config_value);
                            let config = match serde_json::from_value::<SceneDeviceConfig>(
                                normalized_config_value,
                            ) {
                                Ok(config) => config,
                                Err(error) => {
                                    warn!(
                                        "Scene script for {scene_id} returned an invalid config for {device_key}: {error}",
                                    );
                                    return None;
                                }
                            };

                            let Some((integration_id, device_id)) = device_key.split_once('/') else {
                                warn!(
                                    "Scene script for {scene_id} returned an invalid device key: {device_key}",
                                );
                                return None;
                            };

                            let device_key = DeviceKey::new(
                                integration_id.to_string().into(),
                                device_id.to_string().into(),
                            );

                            if devices.get_device(&device_key).is_none() {
                                warn!(
                                    "Scene script for {scene_id} referenced an unknown device key: {device_key}",
                                );
                                return None;
                            }

                            if !filter_device_by_keys(&device_key) {
                                return None;
                            }

                            Some((
                                device_key,
                                ResolvedSceneDeviceConfig::new(
                                    config,
                                    DeviceStateSourceScope::Script,
                                    None,
                                ),
                            ))
                        })
                        .collect::<ResolvedSceneDevicesConfig>(),
                    Err(error) => {
                        warn!("Error evaluating scene script for {scene_id}: {error}");
                        ResolvedSceneDevicesConfig::new()
                    }
                }
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

                scene_devices_config.insert(
                    device_key,
                    ResolvedSceneDeviceConfig::new(
                        scene_device_config.clone(),
                        DeviceStateSourceScope::Group,
                        Some(group_id.clone()),
                    ),
                );
            }
        }

        // Insert scene devices
        let scene_devices_search_config =
            scene.devices.map(|devices| devices.0).unwrap_or_default();
        for (integration_id, scene_device_configs) in scene_devices_search_config {
            for (device_id, scene_device_config) in scene_device_configs {
                let device = devices.get_device_by_ref(&DeviceRef::new_with_id(
                    integration_id.clone(),
                    DeviceId::from(device_id.clone()),
                ));

                let Some(device) = device else {
                    // Scene configs are re-evaluated on invalidations, so missing devices
                    // would otherwise spam logs when an integration is offline.
                    debug!("Could not find device id {device_id} in integration {integration_id}",);

                    continue;
                };

                let device_key = device.get_device_key();

                // Skip this device if it's not in device_keys or group_keys
                if !filter_device_by_keys(&device_key) {
                    continue;
                }

                scene_devices_config.insert(
                    device_key,
                    ResolvedSceneDeviceConfig::new(
                        scene_device_config.clone(),
                        DeviceStateSourceScope::Device,
                        None,
                    ),
                );
            }
        }

        // Insert devices from evaluated script
        for (device_key, device_config) in script_device_configs {
            scene_devices_config.insert(device_key, device_config);
        }

        // Insert devices from scene overrides
        if let Some(overrides) = self.db_scene_overrides.get(scene_id) {
            for (device_key, device_config) in overrides {
                // Skip this device if it's not in device_keys or group_keys
                if !filter_device_by_keys(device_key) {
                    continue;
                }

                scene_devices_config.insert(
                    device_key.clone(),
                    ResolvedSceneDeviceConfig::new(
                        device_config.clone(),
                        DeviceStateSourceScope::Override,
                        None,
                    ),
                );
            }
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

                    let (device_state, _state_source) = compute_scene_device_state(
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

        let active_overrides = self
            .db_scene_overrides
            .get(scene_id)
            .map(|overrides| overrides.keys().cloned().collect())
            .unwrap_or_default();

        Some(FlattenedSceneConfig {
            name: scene_config.name.clone(),
            devices: SceneDeviceStates(devices),
            active_overrides,
            hidden: scene_config.hidden,
        })
    }

    fn mk_scene_devices_configs(
        &self,
        devices: &Devices,
        groups: &Groups,
        invalidated_scenes: &HashSet<SceneId>,
    ) -> ResolvedSceneDevicesConfigs {
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
                            transition: None,
                        },
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

    pub fn get_device_scene_state_details(
        &self,
        scene_id: &SceneId,
        device: &Device,
        devices: &Devices,
    ) -> Option<(ControllableState, DeviceStateSource)> {
        compute_scene_device_state(
            scene_id,
            device,
            devices,
            &self.scene_devices_configs,
            false,
        )
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

        if let Some(script) = scene_config.script.as_deref() {
            invalidated_devices.extend(get_script_dependency_device_keys(script, devices, groups));
        }

        for scene_device_config in scene_device_configs.values() {
            match &scene_device_config.config {
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
            self.mk_scene_devices_configs(devices, groups, &invalidated_scenes);
        self.flattened_scenes = self.mk_flattened_scenes(devices, &invalidated_scenes);

        // Recompute device_invalidation_map if device was recently discovered
        if is_new_device {
            self.device_invalidation_map = self.mk_device_invalidation_map(devices, groups);
        }

        invalidated_scenes
    }

    pub fn force_invalidate(&mut self, devices: &Devices, groups: &Groups) {
        let invalidated_scenes = self
            .get_scene_ids()
            .into_iter()
            .collect::<HashSet<SceneId>>();
        self.scene_devices_configs =
            self.mk_scene_devices_configs(devices, groups, &invalidated_scenes);
        self.flattened_scenes = self.mk_flattened_scenes(devices, &invalidated_scenes);
        self.device_invalidation_map = self.mk_device_invalidation_map(devices, groups);
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, str::FromStr};

    use ordered_float::OrderedFloat;

    use crate::{
        core::{devices::Devices, groups::Groups},
        types::{
            color::Capabilities,
            device::{
                ControllableDevice, Device, DeviceData, DeviceId, DeviceRef, DeviceStateSource,
                DeviceStateSourceKind, DeviceStateSourceScope, ManageKind,
            },
            event::{mk_event_channel, RxEventChannel},
            group::{GroupConfig, GroupId, GroupsConfig},
            integration::IntegrationId,
            scene::{
                ActivateSceneDescriptor, SceneConfig, SceneDeviceConfig, SceneDeviceLink,
                SceneDeviceState, SceneDevicesSearchConfig, SceneGroupsConfig, SceneId,
                ScenesConfig,
            },
        },
        utils::cli::Cli,
    };

    use super::{extract_bracket_string_refs, normalize_scene_script_config_value, Scenes};
    use serde_json::json;

    fn test_cli() -> Cli {
        Cli {
            dry_run: true,
            port: 45289,
            database_url: None,
            config: None,
            warmup_time: None,
            command: None,
        }
    }

    fn test_devices() -> (Devices, RxEventChannel) {
        let (event_tx, event_rx) = mk_event_channel();
        (Devices::new(event_tx, &test_cli()), event_rx)
    }

    fn create_test_device(integration_id: &str, device_id: &str) -> Device {
        Device::new(
            IntegrationId::from_str(integration_id).unwrap(),
            DeviceId::new(device_id),
            device_id.to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                false,
                Some(0.2),
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            )),
            None,
        )
    }

    fn create_scene_device_config(
        key: &str,
        config: SceneDeviceConfig,
    ) -> SceneDevicesSearchConfig {
        let (integration_id, device_id) = key.split_once('/').unwrap();
        let mut devices = BTreeMap::new();
        devices.insert(device_id.to_string(), config);

        let mut integrations = BTreeMap::new();
        integrations.insert(IntegrationId::from_str(integration_id).unwrap(), devices);

        SceneDevicesSearchConfig(integrations)
    }

    #[test]
    fn normalize_scene_script_config_flattens_wrapped_color_variants() {
        let normalized = normalize_scene_script_config_value(json!({
            "power": true,
            "color": {
                "Hs": {
                    "h": 120,
                    "s": 1.0
                }
            }
        }));

        assert_eq!(
            normalized,
            json!({
                "power": true,
                "color": {
                    "h": 120,
                    "s": 1.0
                }
            })
        );
    }

    #[test]
    fn normalize_scene_script_config_renames_legacy_id_field() {
        let normalized = normalize_scene_script_config_value(json!({
            "integration_id": "circadian",
            "id": "color",
            "brightness": 0.5
        }));

        assert_eq!(
            normalized,
            json!({
                "integration_id": "circadian",
                "device_id": "color",
                "brightness": 0.5
            })
        );
    }

    #[test]
    fn extract_bracket_string_refs_finds_static_device_and_group_refs() {
        let refs = extract_bracket_string_refs(
            "defineSceneScript(() => ({ 'zigbee2mqtt/light': deviceState({ power: devices[\"nordpool/price\"]?.data?.Sensor?.value > 0, brightness: groups['downstairs']?.power ? 1 : 0.2 }) }))",
            "devices",
        );
        let group_refs = extract_bracket_string_refs(
            "defineSceneScript(() => ({ 'zigbee2mqtt/light': deviceState({ power: devices[\"nordpool/price\"]?.data?.Sensor?.value > 0, brightness: groups['downstairs']?.power ? 1 : 0.2 }) }))",
            "groups",
        );

        assert_eq!(refs, ["nordpool/price".to_string()].into_iter().collect());
        assert_eq!(group_refs, ["downstairs".to_string()].into_iter().collect());
    }

    #[test]
    fn scene_materialization_sets_provenance_for_direct_device_state() {
        let (mut devices, _event_rx) = test_devices();
        let mut groups = Groups::new(GroupsConfig::new());
        let target = create_test_device("test", "target");
        let target_key = target.get_device_key();

        devices.set_state(&target, true, true);
        groups.force_invalidate(&devices);

        let scene_id = SceneId::from_str("direct").unwrap();
        let mut scenes_config = ScenesConfig::new();
        scenes_config.insert(
            scene_id.clone(),
            SceneConfig {
                name: "Direct".to_string(),
                devices: Some(create_scene_device_config(
                    &target_key.to_string(),
                    SceneDeviceConfig::DeviceState(SceneDeviceState {
                        power: Some(true),
                        color: None,
                        brightness: Some(OrderedFloat(0.45)),
                        transition: None,
                    }),
                )),
                groups: None,
                hidden: None,
                script: None,
            },
        );

        let mut scenes = Scenes::new(scenes_config);
        scenes.force_invalidate(&devices, &groups);

        let resolved = target.set_scene(Some(&scene_id), &scenes, &devices);
        let DeviceData::Controllable(data) = resolved.data else {
            panic!("expected controllable device");
        };

        assert_eq!(data.scene_id, Some(scene_id));
        assert_eq!(data.state.power, true);
        assert_eq!(data.state.brightness, Some(OrderedFloat(0.45)));
        assert_eq!(
            data.state_source,
            Some(DeviceStateSource {
                scope: DeviceStateSourceScope::Device,
                kind: DeviceStateSourceKind::DeviceState,
                group_id: None,
                linked_scene_id: None,
                linked_device_key: None,
            })
        );
    }

    #[test]
    fn scene_materialization_sets_provenance_for_group_device_link() {
        let (mut devices, _event_rx) = test_devices();
        let target = create_test_device("test", "target");
        let source = create_test_device("test", "source");
        let target_key = target.get_device_key();
        let source_key = source.get_device_key();
        let group_id = GroupId::from_str("living-room").unwrap();

        let mut source_on = source.clone();
        if let DeviceData::Controllable(data) = &mut source_on.data {
            data.state.power = true;
            data.state.brightness = Some(OrderedFloat(0.8));
        }

        devices.set_state(&target, true, true);
        devices.set_state(&source_on, true, true);

        let mut groups_config = GroupsConfig::new();
        groups_config.insert(
            group_id.clone(),
            GroupConfig {
                name: "Living Room".to_string(),
                devices: Some(vec![DeviceRef::from(&target_key)]),
                groups: None,
                hidden: None,
            },
        );
        let mut groups = Groups::new(groups_config);
        groups.force_invalidate(&devices);

        let scene_id = SceneId::from_str("group-link").unwrap();
        let mut scene_groups = BTreeMap::new();
        scene_groups.insert(
            group_id.clone(),
            SceneDeviceConfig::DeviceLink(SceneDeviceLink {
                brightness: Some(OrderedFloat(0.5)),
                device_ref: DeviceRef::from(&source_key),
            }),
        );

        let mut scenes_config = ScenesConfig::new();
        scenes_config.insert(
            scene_id.clone(),
            SceneConfig {
                name: "Group Link".to_string(),
                devices: None,
                groups: Some(SceneGroupsConfig(scene_groups)),
                hidden: None,
                script: None,
            },
        );

        let mut scenes = Scenes::new(scenes_config);
        scenes.force_invalidate(&devices, &groups);

        let resolved = target.set_scene(Some(&scene_id), &scenes, &devices);
        let DeviceData::Controllable(data) = resolved.data else {
            panic!("expected controllable device");
        };

        assert_eq!(data.state.power, true);
        assert_eq!(data.state.brightness, Some(OrderedFloat(0.4)));
        assert_eq!(
            data.state_source,
            Some(DeviceStateSource {
                scope: DeviceStateSourceScope::Group,
                kind: DeviceStateSourceKind::DeviceLink,
                group_id: Some(group_id),
                linked_scene_id: None,
                linked_device_key: Some(source_key),
            })
        );
    }

    #[test]
    fn scene_materialization_sets_provenance_for_scene_link() {
        let (mut devices, _event_rx) = test_devices();
        let mut groups = Groups::new(GroupsConfig::new());
        let target = create_test_device("test", "target");
        let target_key = target.get_device_key();

        devices.set_state(&target, true, true);
        groups.force_invalidate(&devices);

        let base_scene_id = SceneId::from_str("base").unwrap();
        let linked_scene_id = SceneId::from_str("linked").unwrap();
        let mut scenes_config = ScenesConfig::new();
        scenes_config.insert(
            base_scene_id.clone(),
            SceneConfig {
                name: "Base".to_string(),
                devices: Some(create_scene_device_config(
                    &target_key.to_string(),
                    SceneDeviceConfig::DeviceState(SceneDeviceState {
                        power: Some(true),
                        color: None,
                        brightness: Some(OrderedFloat(0.55)),
                        transition: None,
                    }),
                )),
                groups: None,
                hidden: None,
                script: None,
            },
        );
        scenes_config.insert(
            linked_scene_id.clone(),
            SceneConfig {
                name: "Linked".to_string(),
                devices: Some(create_scene_device_config(
                    &target_key.to_string(),
                    SceneDeviceConfig::SceneLink(ActivateSceneDescriptor {
                        scene_id: base_scene_id.clone(),
                        device_keys: None,
                        group_keys: None,
                        transition: None,
                    }),
                )),
                groups: None,
                hidden: None,
                script: None,
            },
        );

        let mut scenes = Scenes::new(scenes_config);
        scenes.force_invalidate(&devices, &groups);

        let resolved = target.set_scene(Some(&linked_scene_id), &scenes, &devices);
        let DeviceData::Controllable(data) = resolved.data else {
            panic!("expected controllable device");
        };

        assert_eq!(data.state.power, true);
        assert_eq!(data.state.brightness, Some(OrderedFloat(0.55)));
        assert_eq!(
            data.state_source,
            Some(DeviceStateSource {
                scope: DeviceStateSourceScope::Device,
                kind: DeviceStateSourceKind::SceneLink,
                group_id: None,
                linked_scene_id: Some(base_scene_id),
                linked_device_key: None,
            })
        );
    }

    #[test]
    fn scene_link_transition_override_replaces_nested_scene_transition() {
        let (mut devices, _event_rx) = test_devices();
        let mut groups = Groups::new(GroupsConfig::new());
        let target = create_test_device("test", "target");
        let target_key = target.get_device_key();

        devices.set_state(&target, true, true);
        groups.force_invalidate(&devices);

        let base_scene_id = SceneId::from_str("base").unwrap();
        let linked_scene_id = SceneId::from_str("linked").unwrap();
        let mut scenes_config = ScenesConfig::new();
        scenes_config.insert(
            base_scene_id.clone(),
            SceneConfig {
                name: "Base".to_string(),
                devices: Some(create_scene_device_config(
                    &target_key.to_string(),
                    SceneDeviceConfig::DeviceState(SceneDeviceState {
                        power: Some(true),
                        color: None,
                        brightness: Some(OrderedFloat(0.55)),
                        transition: Some(OrderedFloat(0.4)),
                    }),
                )),
                groups: None,
                hidden: None,
                script: None,
            },
        );
        scenes_config.insert(
            linked_scene_id.clone(),
            SceneConfig {
                name: "Linked".to_string(),
                devices: Some(create_scene_device_config(
                    &target_key.to_string(),
                    SceneDeviceConfig::SceneLink(ActivateSceneDescriptor {
                        scene_id: base_scene_id,
                        device_keys: None,
                        group_keys: None,
                        transition: Some(OrderedFloat(1.2)),
                    }),
                )),
                groups: None,
                hidden: None,
                script: None,
            },
        );

        let mut scenes = Scenes::new(scenes_config);
        scenes.force_invalidate(&devices, &groups);

        let resolved = target.set_scene(Some(&linked_scene_id), &scenes, &devices);
        let DeviceData::Controllable(data) = resolved.data else {
            panic!("expected controllable device");
        };

        assert_eq!(data.state.transition, Some(OrderedFloat(1.2)));
    }
}
