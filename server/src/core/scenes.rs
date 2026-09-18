use crate::{
    db::{
        actions::{db_get_scene_overrides, db_store_scene_overrides},
        config_queries,
    },
    types::{
        device::{
            ControllableState, Device, DeviceData, DeviceId, DeviceKey, DeviceRef,
            DeviceStateSource, DeviceStateSourceKind, DeviceStateSourceScope, SensorDevice,
        },
        group::GroupId,
        scene::{
            ActivateSceneDescriptor, FlattenedSceneConfig, FlattenedScenesConfig, SceneConfig,
            SceneDeviceConfig, SceneDeviceStates, SceneDevicesConfig, SceneId,
            SceneOverridesConfig, ScenesConfig,
        },
    },
};
use eyre::Result;
use itertools::Itertools;
use ordered_float::OrderedFloat;

use super::{devices::Devices, groups::Groups, scripting::legacy_rule_context};
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

/// One pending off-actor scene script materialization, built under actor
/// ownership from a coherent frame.
#[derive(Clone, Debug)]
pub struct SceneMaterializationRequest {
    pub scene_id: SceneId,
    pub revision: i64,
    pub script: String,
    pub context: serde_json::Value,
}

/// Quality of the script contribution to a scene's current materialization.
/// Script errors keep the last-good contribution and record why (SC02).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum SceneScriptQuality {
    #[default]
    Fresh,
    Refreshing,
    Error(String),
}

/// Last-good script overrides for one scene plus the current quality.
#[derive(Clone, Debug)]
struct SceneScriptState {
    revision: i64,
    /// Parsed, normalized per-device configs keyed by the raw `integration/id`
    /// string the script returned. Device existence and activation filters are
    /// still applied at merge time.
    overrides: HashMap<String, SceneDeviceConfig>,
    quality: SceneScriptQuality,
}

#[derive(Clone, Default, Debug)]
pub struct Scenes {
    db_scenes: ScenesConfig,
    db_scene_overrides: SceneOverridesConfig,
    group_target_orders: HashMap<SceneId, Vec<GroupId>>,
    flattened_scenes: FlattenedScenesConfig,
    scene_devices_configs: ResolvedSceneDevicesConfigs,
    device_invalidation_map: HashMap<DeviceKey, HashSet<SceneId>>,
    /// Script source last seen per scene, used to bump the scene script
    /// revision only when the source actually changes.
    script_sources: HashMap<SceneId, String>,
    /// Per-scene script revision; script owners are re-registered when it
    /// changes so in-flight materializations are rejected (SC06).
    script_revisions: HashMap<SceneId, i64>,
    /// Last-good script materialization (and quality) per scene. Off-actor
    /// results update this cache; activation and invalidation only read it.
    scene_scripts: HashMap<SceneId, SceneScriptState>,
    /// Pending materialization requests, drained by the state actor and
    /// submitted to the worker pool off-actor.
    new_scene_requests: Vec<SceneMaterializationRequest>,
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

fn is_legacy_wrapped_color_value(value: &serde_json::Value) -> bool {
    let serde_json::Value::Object(object) = value else {
        return false;
    };

    object.len() == 1
        && ["Xy", "Hs", "Rgb", "Ct"]
            .iter()
            .any(|variant| object.contains_key(*variant))
}

fn normalize_scene_config_color_value(value: serde_json::Value) -> serde_json::Value {
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

pub(crate) fn normalize_scene_config_value(value: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(mut object) = value else {
        return value;
    };

    if let Some(color) = object.remove("color") {
        object.insert(
            "color".to_string(),
            normalize_scene_config_color_value(color),
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

fn normalize_scene_script_config_value(value: serde_json::Value) -> serde_json::Value {
    normalize_scene_config_value(value)
}

/// Parse a legacy scene script's raw JSON result into per-device configs,
/// keeping the old skip-on-invalid semantics: malformed entries are warned
/// about and dropped while the rest of the result is kept. Device existence
/// and activation filters are applied later, at merge time.
fn parse_scene_script_overrides(
    scene_id: &SceneId,
    value: &serde_json::Value,
) -> HashMap<String, SceneDeviceConfig> {
    let serde_json::Value::Object(map) = value else {
        return HashMap::new();
    };
    map.iter()
        .filter_map(|(device_key, config_value)| {
            let normalized = normalize_scene_script_config_value(config_value.clone());
            match serde_json::from_value::<SceneDeviceConfig>(normalized) {
                Ok(config) => Some((device_key.clone(), config)),
                Err(error) => {
                    warn!(
                        "Scene script for {scene_id} returned an invalid config for {device_key}: {error}",
                    );
                    None
                }
            }
        })
        .collect()
}

fn warn_scene_config_compatibility(
    scene_id: &str,
    target_kind: &str,
    target_id: &str,
    config_value: &serde_json::Value,
) {
    let serde_json::Value::Object(object) = config_value else {
        return;
    };

    if object.get("color").map(is_legacy_wrapped_color_value) == Some(true) {
        warn!(
            "Scene {scene_id} {target_kind} target {target_id} uses legacy wrapped color config; use untagged color objects like {{\"h\": 30, \"s\": 1.0}}"
        );
    }

    if object.contains_key("transition_ms") {
        warn!(
            "Scene {scene_id} {target_kind} target {target_id} uses transition_ms, which is ignored by scene configs; use transition instead"
        );
    }

    if object.contains_key("integration_id")
        && object.contains_key("id")
        && !object.contains_key("device_id")
        && !object.contains_key("name")
    {
        warn!(
            "Scene {scene_id} {target_kind} target {target_id} uses legacy id field; use device_id instead"
        );
    }
}

fn parse_scene_config_value(
    scene_id: &str,
    target_kind: &str,
    target_id: &str,
    config_value: &serde_json::Value,
) -> Option<SceneDeviceConfig> {
    warn_scene_config_compatibility(scene_id, target_kind, target_id, config_value);

    let normalized_config_value = normalize_scene_config_value(config_value.clone());
    if normalized_config_value != *config_value {
        warn!(
            "Scene {scene_id} {target_kind} target {target_id} uses legacy scene config shape; normalized it while loading"
        );
    }

    match serde_json::from_value::<SceneDeviceConfig>(normalized_config_value) {
        Ok(config) => Some(config),
        Err(error) => {
            warn!(
                "Failed to parse scene {scene_id} {target_kind} config for {target_id}: {error}; config={config_value}"
            );
            None
        }
    }
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
                .keys()
                .filter_map(|device_key| {
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
            group_target_orders: HashMap::new(),
            ..Default::default()
        }
    }

    pub fn load_config_rows(
        &mut self,
        scenes: &[config_queries::SceneRow],
        overrides: SceneOverridesConfig,
    ) {
        let mut db_scenes = ScenesConfig::new();
        let mut group_target_orders = HashMap::new();

        for scene in scenes {
            let devices = if scene.device_states.is_empty() {
                None
            } else {
                let mut devices_map = BTreeMap::new();

                for (device_key, config_value) in &scene.device_states {
                    if let Some((integration_id, device_name)) = device_key.split_once('/') {
                        if let Some(config) =
                            parse_scene_config_value(&scene.id, "device", device_key, config_value)
                        {
                            devices_map
                                .entry(integration_id.to_string().into())
                                .or_insert_with(BTreeMap::new)
                                .insert(device_name.to_string(), config);
                        }
                    } else {
                        warn!(
                            "Scene {} has invalid device target key {}; expected integration_id/device_id",
                            scene.id, device_key
                        );
                    }
                }

                if devices_map.is_empty() {
                    warn!(
                        "Scene {} has device target rows, but none could be parsed; ignoring device targets",
                        scene.id
                    );
                    None
                } else {
                    Some(crate::types::scene::SceneDevicesSearchConfig(devices_map))
                }
            };

            let groups = if scene.group_states.is_empty() {
                None
            } else {
                let mut groups_map = BTreeMap::new();

                for (group_id, config_value) in &scene.group_states {
                    if let Some(config) =
                        parse_scene_config_value(&scene.id, "group", group_id, config_value)
                    {
                        groups_map.insert(GroupId(group_id.clone()), config);
                    }
                }

                if groups_map.is_empty() {
                    warn!(
                        "Scene {} has group target rows, but none could be parsed; ignoring group targets",
                        scene.id
                    );
                    None
                } else {
                    Some(crate::types::scene::SceneGroupsConfig(groups_map))
                }
            };

            let mut unordered_group_ids = scene
                .group_states
                .keys()
                .filter(|group_id| !scene.group_state_order.contains(*group_id))
                .cloned()
                .collect::<Vec<_>>();
            unordered_group_ids.sort();

            let group_target_order = scene
                .group_state_order
                .iter()
                .filter(|group_id| scene.group_states.contains_key(*group_id))
                .map(|group_id| GroupId(group_id.clone()))
                .chain(unordered_group_ids.into_iter().map(GroupId))
                .collect::<Vec<_>>();
            if !group_target_order.is_empty() {
                group_target_orders.insert(SceneId::new(scene.id.clone()), group_target_order);
            }

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
        self.group_target_orders = group_target_orders;
        self.db_scene_overrides = overrides
            .into_iter()
            .filter(|(scene_id, _)| valid_scene_ids.contains(scene_id))
            .collect();
        self.refresh_script_revisions();
    }

    /// Bump the script revision only for scenes whose script source changed,
    /// so an edit rejects in-flight materializations while untouched scenes
    /// keep their owner generation (SC06).
    fn refresh_script_revisions(&mut self) {
        let mut sources = HashMap::new();
        let mut revisions = HashMap::new();
        for (scene_id, scene) in &self.db_scenes {
            let Some(script) = scene.script.as_deref() else {
                continue;
            };
            let revision = match self.script_sources.get(scene_id) {
                Some(previous) if previous == script => {
                    self.script_revisions.get(scene_id).copied().unwrap_or(1)
                }
                Some(_) => self.script_revisions.get(scene_id).copied().unwrap_or(0) + 1,
                None => 1,
            };
            sources.insert(scene_id.clone(), script.to_string());
            revisions.insert(scene_id.clone(), revision);
        }
        self.script_sources = sources;
        self.script_revisions = revisions;

        // Drop materializations for removed scenes and for scripts whose
        // source changed: another script's output must not be served as
        // last-good for an edited script (SC03/SC06).
        let revisions = &self.script_revisions;
        self.scene_scripts
            .retain(|scene_id, state| revisions.get(scene_id) == Some(&state.revision));
    }

    /// Current per-scene script revisions for scenes that have a script.
    pub fn script_revisions(&self) -> BTreeMap<SceneId, i64> {
        self.script_revisions
            .iter()
            .map(|(scene_id, revision)| (scene_id.clone(), *revision))
            .collect()
    }

    /// The script source currently configured for a scene, if any.
    pub fn script_for(&self, scene_id: &SceneId) -> Option<String> {
        self.db_scenes.get(scene_id)?.script.clone()
    }

    pub async fn refresh_db_scenes(&mut self) {
        let scenes = config_queries::db_get_config_scenes()
            .await
            .unwrap_or_default();
        let scene_overrides = db_get_scene_overrides().await.unwrap_or_default();
        self.load_config_rows(&scenes, scene_overrides);
    }

    pub async fn store_scene_override(
        &mut self,
        device: &Device,
        store_override: bool,
    ) -> Result<()> {
        let (scene_id, overrides) = self.store_scene_override_in_memory(device, store_override)?;

        if let Err(error) = db_store_scene_overrides(&scene_id, &overrides).await {
            warn!("Failed to persist scene override for {scene_id}: {error}");
        }

        Ok(())
    }

    pub fn store_scene_override_in_memory(
        &mut self,
        device: &Device,
        store_override: bool,
    ) -> Result<(SceneId, SceneDevicesConfig)> {
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

        Ok((scene_id, overrides.clone()))
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

    pub fn replace_scene_overrides(&mut self, overrides: SceneOverridesConfig) {
        self.db_scene_overrides = overrides;
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

        // P08: script execution is off-actor. The last-good materialization
        // cached here is used as-is; a refresh is queued by the invalidation
        // paths instead of running the engine inside the actor.
        let script_device_configs: ResolvedSceneDevicesConfig = self
            .scene_scripts
            .get(scene_id)
            .map(|state| {
                state
                    .overrides
                    .iter()
                    .filter_map(|(device_key, config)| {
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
                                config.clone(),
                                DeviceStateSourceScope::Script,
                                None,
                            ),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Inserts devices from groups. The order is significant: later group
        // targets overwrite state already contributed by earlier targets.
        let scene_groups = scene
            .groups
            .as_ref()
            .map(|groups| {
                let mut ordered = Vec::with_capacity(groups.0.len());
                let mut seen = HashSet::new();
                if let Some(order) = self.group_target_orders.get(scene_id) {
                    for group_id in order {
                        if let Some(config) = groups.0.get(group_id) {
                            if !seen.insert(group_id.clone()) {
                                continue;
                            }
                            ordered.push((group_id.clone(), config.clone()));
                        }
                    }
                }
                for (group_id, config) in &groups.0 {
                    if seen.insert(group_id.clone()) {
                        ordered.push((group_id.clone(), config.clone()));
                    }
                }
                ordered
            })
            .unwrap_or_default();
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
                            mirror_from_group: None,
                            device_keys: None,
                            group_keys: None,
                            use_scene_transition: false,
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

    /// Drain pending off-actor materialization requests. The actor admits and
    /// submits them to the worker pool; scenes keep serving their last-good
    /// contribution until a result lands.
    pub fn take_scene_materialization_requests(&mut self) -> Vec<SceneMaterializationRequest> {
        std::mem::take(&mut self.new_scene_requests)
    }

    /// Current script quality for one scene (`Fresh`, `Refreshing`, or the
    /// last error while serving stale last-good output) (SC02).
    pub fn scene_script_quality(&self, scene_id: &SceneId) -> Option<&SceneScriptQuality> {
        self.scene_scripts.get(scene_id).map(|state| &state.quality)
    }

    /// Record a materialization failure that never reached the coordinator
    /// (missing worker, admission rejection). Last-good output is kept (SC02).
    pub fn record_scene_script_error(&mut self, scene_id: &SceneId, message: &str) {
        let revision = self.script_revisions.get(scene_id).copied().unwrap_or(0);
        let state = self
            .scene_scripts
            .entry(scene_id.clone())
            .or_insert_with(|| SceneScriptState {
                revision,
                overrides: HashMap::new(),
                quality: SceneScriptQuality::Fresh,
            });
        state.quality = SceneScriptQuality::Error(message.to_string());
    }

    /// Queue refresh requests for scripted scenes. Called from the
    /// invalidation paths when a scene's dependencies changed; duplicates are
    /// coalesced by the coordinator's latest-wins policy.
    fn queue_scene_script_refreshes(
        &mut self,
        scene_ids: &HashSet<SceneId>,
        devices: &Devices,
        groups: &Groups,
    ) {
        for scene_id in scene_ids {
            let Some(script) = self.script_for(scene_id) else {
                continue;
            };
            let revision = self.script_revisions.get(scene_id).copied().unwrap_or(1);
            let context =
                match legacy_rule_context(devices.get_state(), groups.get_flattened_groups()) {
                    Ok(context) => context,
                    Err(error) => {
                        warn!("Scene script context for {scene_id} could not be built: {error}");
                        continue;
                    }
                };
            self.scene_scripts
                .entry(scene_id.clone())
                .and_modify(|state| state.quality = SceneScriptQuality::Refreshing)
                .or_insert_with(|| SceneScriptState {
                    revision,
                    overrides: HashMap::new(),
                    quality: SceneScriptQuality::Refreshing,
                });
            self.new_scene_requests.push(SceneMaterializationRequest {
                scene_id: scene_id.clone(),
                revision,
                script,
                context,
            });
        }
    }

    /// Apply one off-actor materialization result. Returns the scene's target
    /// device keys so the actor can refresh active devices in that scene; an
    /// outdated revision is rejected without touching the cache (SC03/SC06).
    pub fn apply_scene_script_result(
        &mut self,
        devices: &Devices,
        groups: &Groups,
        scene_id: &SceneId,
        revision: i64,
        value: Option<&serde_json::Value>,
        error: Option<&str>,
    ) -> Option<HashSet<DeviceKey>> {
        let current_revision = self.script_revisions.get(scene_id).copied()?;
        if revision != current_revision {
            return None;
        }

        match (value, error) {
            (Some(value), _) => {
                let overrides = parse_scene_script_overrides(scene_id, value);
                self.scene_scripts.insert(
                    scene_id.clone(),
                    SceneScriptState {
                        revision,
                        overrides,
                        quality: SceneScriptQuality::Fresh,
                    },
                );
            }
            (None, Some(message)) => {
                warn!("Scene script for {scene_id} failed: {message}");
                let state = self
                    .scene_scripts
                    .entry(scene_id.clone())
                    .or_insert_with(|| SceneScriptState {
                        revision,
                        overrides: HashMap::new(),
                        quality: SceneScriptQuality::Fresh,
                    });
                state.quality = SceneScriptQuality::Error(message.to_string());
                return Some(HashSet::new());
            }
            (None, None) => return None,
        }

        let invalidated: HashSet<SceneId> = [scene_id.clone()].into_iter().collect();
        self.scene_devices_configs = self.mk_scene_devices_configs(devices, groups, &invalidated);
        self.flattened_scenes = self.mk_flattened_scenes(devices, &invalidated);
        Some(
            self.scene_devices_configs
                .get(scene_id)
                .map(|(_, config)| config.keys().cloned().collect())
                .unwrap_or_default(),
        )
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
        old_device: Option<&Device>,
        invalidated_device: &Device,
        devices: &Devices,
        groups: &Groups,
    ) -> HashSet<SceneId> {
        let is_new_device = old_device.is_none();

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

        self.queue_scene_script_refreshes(&invalidated_scenes, devices, groups);
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
        self.queue_scene_script_refreshes(&invalidated_scenes, devices, groups);
        self.scene_devices_configs =
            self.mk_scene_devices_configs(devices, groups, &invalidated_scenes);
        self.flattened_scenes = self.mk_flattened_scenes(devices, &invalidated_scenes);
        self.device_invalidation_map = self.mk_device_invalidation_map(devices, groups);
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, HashMap},
        str::FromStr,
    };

    use ordered_float::OrderedFloat;

    use crate::{
        core::{devices::Devices, groups::Groups},
        db::config_queries,
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

    use super::{
        extract_bracket_string_refs, normalize_scene_script_config_value, SceneScriptQuality,
        Scenes,
    };
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
    fn load_config_rows_accepts_legacy_scene_target_shapes() {
        let scene_id = SceneId::from_str("legacy").unwrap();
        let mut device_states = HashMap::new();
        device_states.insert(
            "test/target".to_string(),
            json!({
                "power": true,
                "brightness": 0.6,
                "color": {
                    "Hs": {
                        "h": 267,
                        "s": 1.0
                    }
                }
            }),
        );
        let mut group_states = HashMap::new();
        group_states.insert(
            "all".to_string(),
            json!({
                "integration_id": "test",
                "id": "source",
                "brightness": 0.5
            }),
        );

        let mut scenes = Scenes::new(ScenesConfig::new());
        scenes.load_config_rows(
            &[config_queries::SceneRow {
                id: scene_id.to_string(),
                name: "Legacy".to_string(),
                hidden: false,
                script: None,
                device_states,
                group_states,
                group_state_order: Vec::new(),
            }],
            Default::default(),
        );

        let scene = scenes.find_scene(&scene_id).unwrap();
        let device_config = scene
            .devices
            .as_ref()
            .unwrap()
            .0
            .get(&IntegrationId::from_str("test").unwrap())
            .unwrap()
            .get("target")
            .unwrap();
        let group_config = scene
            .groups
            .as_ref()
            .unwrap()
            .0
            .get(&GroupId("all".into()))
            .unwrap();

        let SceneDeviceConfig::DeviceState(state) = device_config else {
            panic!("expected device state config");
        };
        let SceneDeviceConfig::DeviceLink(link) = group_config else {
            panic!("expected device link config");
        };

        assert!(state.color.is_some());
        assert_eq!(
            link.device_ref,
            DeviceRef::new_with_id(
                IntegrationId::from_str("test").unwrap(),
                DeviceId::new("source"),
            )
        );
    }

    // SC06: the revision only changes when the script source changes, so an
    // edit rejects in-flight materializations while untouched scenes keep
    // their owner generation.
    #[test]
    fn script_revisions_bump_only_when_the_script_changes() {
        let scene_row = |script: Option<&str>| config_queries::SceneRow {
            id: "evening".to_string(),
            name: "Evening".to_string(),
            hidden: false,
            script: script.map(str::to_string),
            device_states: HashMap::new(),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        };
        let scene_id = SceneId::new("evening".to_string());

        let mut scenes = Scenes::new(ScenesConfig::new());
        scenes.load_config_rows(
            &[scene_row(Some(
                "defineSceneScript(function () { return {}; })",
            ))],
            Default::default(),
        );
        assert_eq!(scenes.script_revisions().get(&scene_id), Some(&1));

        scenes.load_config_rows(
            &[scene_row(Some(
                "defineSceneScript(function () { return {}; })",
            ))],
            Default::default(),
        );
        assert_eq!(
            scenes.script_revisions().get(&scene_id),
            Some(&1),
            "an unchanged script source keeps its revision"
        );

        scenes.load_config_rows(
            &[scene_row(Some(
                "defineSceneScript(function () { return { 'test/target': {} }; })",
            ))],
            Default::default(),
        );
        assert_eq!(scenes.script_revisions().get(&scene_id), Some(&2));

        scenes.load_config_rows(&[scene_row(None)], Default::default());
        assert!(scenes.script_revisions().is_empty());
        assert!(scenes.script_for(&scene_id).is_none());
    }

    // SC01/SC03: results populate last-good output, refresh the affected
    // target devices, and stale revisions never touch the cache.
    #[test]
    fn scene_script_materialization_populates_last_good_and_rejects_stale_revisions() {
        let (mut devices, _event_rx) = test_devices();
        let target = create_test_device("test", "target");
        let target_key = target.get_device_key();
        devices.set_state(&target, true, true);

        let mut groups = Groups::new(GroupsConfig::new());
        groups.force_invalidate(&devices);

        let scene_id = SceneId::new("scripted".to_string());
        let scene_row = config_queries::SceneRow {
            id: scene_id.to_string(),
            name: "Scripted".to_string(),
            hidden: false,
            script: Some("defineSceneScript(function () { return {}; })".to_string()),
            device_states: HashMap::new(),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        };

        let mut scenes = Scenes::new(ScenesConfig::new());
        scenes.load_config_rows(&[scene_row], Default::default());
        scenes.force_invalidate(&devices, &groups);

        let requests = scenes.take_scene_materialization_requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].scene_id, scene_id);
        assert_eq!(requests[0].revision, 1);
        assert_eq!(
            scenes.scene_script_quality(&scene_id),
            Some(&SceneScriptQuality::Refreshing)
        );

        let result = json!({ "test/target": { "power": false } });
        let affected = scenes
            .apply_scene_script_result(&devices, &groups, &scene_id, 1, Some(&result), None)
            .expect("current revision applies");
        assert!(affected.contains(&target_key));
        assert_eq!(
            scenes.scene_script_quality(&scene_id),
            Some(&SceneScriptQuality::Fresh)
        );
        let state = scenes
            .get_device_scene_state(&scene_id, &target_key)
            .expect("script override lands in the flattened scene");
        assert!(!state.power);

        assert!(
            scenes
                .apply_scene_script_result(&devices, &groups, &scene_id, 0, Some(&result), None)
                .is_none(),
            "stale revisions are rejected"
        );
        assert_eq!(
            scenes.scene_script_quality(&scene_id),
            Some(&SceneScriptQuality::Fresh),
            "a stale result never changes quality"
        );
    }

    // SC02/SC06: failures keep serving last-good output with an error quality,
    // and editing the script drops last-good plus any in-flight result.
    #[test]
    fn scene_script_failures_keep_last_good_and_edits_drop_it() {
        let (mut devices, _event_rx) = test_devices();
        let target = create_test_device("test", "target");
        let target_key = target.get_device_key();
        devices.set_state(&target, true, true);

        let mut groups = Groups::new(GroupsConfig::new());
        groups.force_invalidate(&devices);

        let scene_id = SceneId::new("scripted".to_string());
        let scene_row = |script: &str| config_queries::SceneRow {
            id: scene_id.to_string(),
            name: "Scripted".to_string(),
            hidden: false,
            script: Some(script.to_string()),
            device_states: HashMap::new(),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        };
        let result = json!({ "test/target": { "power": false } });

        let mut scenes = Scenes::new(ScenesConfig::new());
        scenes.load_config_rows(
            &[scene_row("defineSceneScript(function () { return {}; })")],
            Default::default(),
        );
        scenes.force_invalidate(&devices, &groups);
        scenes.take_scene_materialization_requests();
        scenes
            .apply_scene_script_result(&devices, &groups, &scene_id, 1, Some(&result), None)
            .expect("current revision applies");

        let affected = scenes
            .apply_scene_script_result(&devices, &groups, &scene_id, 1, None, Some("boom"))
            .expect("current revision still completes");
        assert!(affected.is_empty());
        assert_eq!(
            scenes.scene_script_quality(&scene_id),
            Some(&SceneScriptQuality::Error("boom".to_string()))
        );
        assert!(
            scenes
                .get_device_scene_state(&scene_id, &target_key)
                .is_some(),
            "last-good output survives a failed refresh"
        );

        scenes.load_config_rows(
            &[scene_row(
                "defineSceneScript(function () { return { 'test/target': { 'power': true } }; })",
            )],
            Default::default(),
        );
        assert_eq!(scenes.script_revisions().get(&scene_id), Some(&2));
        assert!(
            scenes.scene_script_quality(&scene_id).is_none(),
            "an edited script drops last-good and its quality"
        );
        assert!(
            scenes
                .apply_scene_script_result(&devices, &groups, &scene_id, 1, Some(&result), None)
                .is_none(),
            "the in-flight result of the replaced script is rejected"
        );
    }

    #[test]
    fn later_group_targets_override_earlier_targets_in_saved_order() {
        let (mut devices, _event_rx) = test_devices();
        let target = create_test_device("test", "target");
        let target_key = target.get_device_key();
        devices.set_state(&target, true, true);

        let mut groups_config = GroupsConfig::new();
        for group_id in ["first", "second"] {
            groups_config.insert(
                GroupId::from_str(group_id).unwrap(),
                GroupConfig {
                    name: group_id.to_string(),
                    devices: Some(vec![DeviceRef::from(&target_key)]),
                    groups: None,
                    hidden: None,
                },
            );
        }
        let mut groups = Groups::new(groups_config);
        groups.force_invalidate(&devices);

        let scene_id = SceneId::from_str("ordered-groups").unwrap();
        let scene = config_queries::SceneRow {
            id: scene_id.to_string(),
            name: "Ordered groups".to_string(),
            hidden: false,
            script: None,
            device_states: HashMap::new(),
            group_states: HashMap::from([
                (
                    "first".to_string(),
                    json!({"power": true, "brightness": 0.2}),
                ),
                (
                    "second".to_string(),
                    json!({"power": true, "brightness": 0.8}),
                ),
            ]),
            group_state_order: vec!["second".to_string(), "first".to_string()],
        };
        let mut scenes = Scenes::new(ScenesConfig::new());
        scenes.load_config_rows(&[scene], Default::default());
        scenes.force_invalidate(&devices, &groups);

        let resolved = scenes
            .find_scene_devices_config(
                &devices,
                &groups,
                &ActivateSceneDescriptor {
                    scene_id,
                    mirror_from_group: None,
                    device_keys: None,
                    group_keys: None,
                    use_scene_transition: false,
                    transition: None,
                },
            )
            .unwrap();
        let resolved_config = &resolved[&target_key].config;
        let SceneDeviceConfig::DeviceState(state) = resolved_config else {
            panic!("expected a device state");
        };
        assert_eq!(state.brightness, Some(OrderedFloat(0.2)));
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
        assert!(data.state.power);
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

        assert!(data.state.power);
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
                        mirror_from_group: None,
                        device_keys: None,
                        group_keys: None,
                        use_scene_transition: false,
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

        assert!(data.state.power);
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
                        mirror_from_group: None,
                        device_keys: None,
                        group_keys: None,
                        use_scene_transition: false,
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
