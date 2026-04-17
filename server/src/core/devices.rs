use crate::db::{
    actions::{db_get_devices, db_update_device},
    config_queries::DevicePositionRow,
};
use crate::types::integration::IntegrationId;
use crate::utils::cli::Cli;

use super::groups::Groups;
use super::scenes::{get_next_cycled_scene, Scenes};
use crate::types::device::{cmp_device_states, ControllableDevice, DeviceRef, ManageKind};
use crate::types::group::GroupId;
use crate::types::{
    device::{Device, DeviceData, DeviceKey, DevicesState},
    event::{Event, TxEventChannel},
    scene::{ActivateSceneDescriptor, RolloutStyle, SceneId},
};
use color_eyre::Result;
use ordered_float::OrderedFloat;
use std::collections::{BTreeMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

const DEVICE_DB_WRITE_DEBOUNCE_MS: u64 = 100;

#[derive(Debug, PartialEq, Eq)]
struct SpatialRolloutPlan {
    immediate_device_keys: Vec<DeviceKey>,
    delayed_device_keys: Vec<(DeviceKey, u64)>,
}

fn compute_rollout_delay_ms(distance: f32, max_distance: f32, duration_ms: u64) -> u64 {
    if duration_ms == 0 || max_distance <= f32::EPSILON {
        return 0;
    }

    ((duration_ms as f64) * (distance as f64) / (max_distance as f64)).round() as u64
}

fn compute_distance(source: &DevicePositionRow, target: &DevicePositionRow) -> f32 {
    (source.x - target.x).hypot(source.y - target.y)
}

fn build_spatial_rollout_plan(
    source_device_key: &DeviceKey,
    target_device_keys: &[DeviceKey],
    positions: &BTreeMap<String, DevicePositionRow>,
    duration_ms: u64,
) -> Option<SpatialRolloutPlan> {
    let source_position = positions.get(&source_device_key.to_string())?;

    let mut immediate_device_keys = Vec::new();
    let mut positioned_targets = Vec::new();
    let mut max_distance = 0.0_f32;

    for device_key in target_device_keys {
        let Some(target_position) = positions.get(&device_key.to_string()) else {
            immediate_device_keys.push(device_key.clone());
            continue;
        };

        let distance = compute_distance(source_position, target_position);
        max_distance = max_distance.max(distance);
        positioned_targets.push((device_key.clone(), distance));
    }

    if max_distance <= f32::EPSILON {
        immediate_device_keys.extend(
            positioned_targets
                .into_iter()
                .map(|(device_key, _)| device_key),
        );
        return Some(SpatialRolloutPlan {
            immediate_device_keys,
            delayed_device_keys: Vec::new(),
        });
    }

    let mut delayed_device_keys = Vec::new();
    for (device_key, distance) in positioned_targets {
        let delay_ms = compute_rollout_delay_ms(distance, max_distance, duration_ms);

        if delay_ms == 0 {
            immediate_device_keys.push(device_key);
        } else {
            delayed_device_keys.push((device_key, delay_ms));
        }
    }

    delayed_device_keys.sort_by(|(left_key, left_delay), (right_key, right_delay)| {
        left_delay
            .cmp(right_delay)
            .then_with(|| left_key.cmp(right_key))
    });

    Some(SpatialRolloutPlan {
        immediate_device_keys,
        delayed_device_keys,
    })
}

#[derive(Clone)]
pub struct Devices {
    event_tx: TxEventChannel,
    state: DevicesState,
    cli: Cli,
    pending_db_updates: Arc<Mutex<BTreeMap<DeviceKey, Device>>>,
    db_write_flush_pending: Arc<AtomicBool>,
}

impl Devices {
    pub fn new(event_tx: TxEventChannel, cli: &Cli) -> Self {
        Devices {
            event_tx,
            state: Default::default(),
            cli: cli.clone(),
            pending_db_updates: Default::default(),
            db_write_flush_pending: Arc::new(AtomicBool::new(false)),
        }
    }

    fn schedule_db_update(&self, device: Device) {
        if self.cli.dry_run {
            debug!("(dry run) would store device: {device}");
            return;
        }

        {
            let mut pending = self
                .pending_db_updates
                .lock()
                .expect("pending_db_updates lock poisoned");
            pending.insert(device.get_device_key(), device);
        }

        if self.db_write_flush_pending.swap(true, Ordering::SeqCst) {
            return;
        }

        let pending_db_updates = Arc::clone(&self.pending_db_updates);
        let db_write_flush_pending = Arc::clone(&self.db_write_flush_pending);

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(DEVICE_DB_WRITE_DEBOUNCE_MS)).await;

                let pending_devices = {
                    let mut pending = pending_db_updates
                        .lock()
                        .expect("pending_db_updates lock poisoned");
                    std::mem::take(&mut *pending)
                };

                for (_, device) in pending_devices {
                    if let Err(error) = db_update_device(&device).await {
                        warn!(
                            "Failed to persist device {}: {error}",
                            device.get_device_key()
                        );
                    }
                }

                let should_stop = {
                    let pending = pending_db_updates
                        .lock()
                        .expect("pending_db_updates lock poisoned");
                    if pending.is_empty() {
                        db_write_flush_pending.store(false, Ordering::SeqCst);
                        true
                    } else {
                        false
                    }
                };

                if should_stop {
                    break;
                }
            }
        });
    }

    pub fn get_state(&self) -> &DevicesState {
        &self.state
    }

    /// Remove all devices belonging to a specific integration.
    pub fn remove_devices_by_integration(&mut self, integration_id: &IntegrationId) {
        let keys_to_remove: Vec<DeviceKey> = self
            .state
            .0
            .keys()
            .filter(|k| &k.integration_id == integration_id)
            .cloned()
            .collect();

        for key in &keys_to_remove {
            self.state.0.remove(key);
        }
    }

    pub fn remove_device(&mut self, device_key: &DeviceKey) -> bool {
        let removed = self.state.0.remove(device_key).is_some();

        if removed {
            let mut pending = self
                .pending_db_updates
                .lock()
                .expect("pending_db_updates lock poisoned");
            pending.remove(device_key);
        }

        removed
    }

    pub async fn refresh_db_devices(&mut self, _scenes: &Scenes) {
        let db_devices = db_get_devices().await;

        match db_devices {
            Ok(db_devices) => {
                for (_, db_device) in db_devices {
                    debug!(
                        "Restoring device from DB: {integration_id}/{name}",
                        integration_id = db_device.integration_id,
                        name = db_device.name,
                    );

                    // Don't restore scene state at this point, because we might
                    // not have data for other devices that our scene depends on
                    // yet
                    // let scene = db_device.get_scene_id();
                    // let device = db_device.set_scene(scene.as_ref(), scenes);

                    let device = db_device;

                    self.set_state(&device, true, true);
                }
                info!("Restored devices from DB");
            }
            Err(e) => {
                error!("Failed to refresh devices from DB: {e}");
            }
        }
    }

    /// Recomputes scene state for all devices and updates both internal and
    /// external state accordingly
    pub fn invalidate(&mut self, invalidated_scenes: &HashSet<SceneId>, scenes: &Scenes) {
        for scene_id in invalidated_scenes {
            let invalidated_devices: Vec<Device> = self
                .state
                .0
                .values()
                .filter(|d| d.get_scene_id().as_ref() == Some(scene_id))
                .map(|d| d.set_scene(Some(scene_id), scenes, self))
                .collect();

            for device in invalidated_devices {
                self.set_state(&device, false, false);
            }
        }
    }

    pub async fn discover_device(&mut self, device: &Device, scenes: &Scenes) {
        info!("Discovered device: {device}");
        let device = device.set_scene(device.get_scene_id().as_ref(), scenes, self);

        self.set_state(&device, !device.is_managed(), false);
    }

    /// Handles an incoming state update for a controllable device.
    ///
    /// Depending on whether the device is managed or not, the function will
    /// either just set internal state accordingly, or try to fix possible state
    /// mismatches.
    pub async fn handle_controllable_update(
        &mut self,
        current: Device,
        incoming: &Device,
        incoming_state: &ControllableDevice,
    ) -> Result<()> {
        // If device is not managed, we set internal state and bail
        if !incoming.is_managed() {
            self.set_state(incoming, true, false);

            return Ok(());
        }

        let device_key = incoming.get_device_key();

        let expected_state = current.get_controllable_state().ok_or_else(|| {
            eyre!(
                "Could not find state for controllable device {integration_id}/{name}. Maybe there is a device key ({device_key}) collision with a sensor?",
                integration_id = incoming.integration_id,
                name = incoming.name
            )
        })?;

        if cmp_device_states(incoming_state, expected_state) {
            // If states match and device is partially managed with
            // uncommitted changes, we mark the change as committed.

            if incoming_state.has_partial_uncommitted_changes() {
                let mut incoming_state = incoming_state.clone();
                incoming_state.managed = ManageKind::Partial {
                    prev_change_committed: true,
                };

                let mut incoming = incoming.clone();
                incoming.data = DeviceData::Controllable(incoming_state);

                self.state.0.insert(device_key, incoming.clone());
            }
        } else {
            // Device state does not match internal state, maybe the device
            // missed a state update or forgot its state? We will try fixing
            // this by emitting a SetExternalState event back to integration

            let expected_converted =
                expected_state.color_to_device_preferred_mode(&incoming_state.capabilities);

            info!(
                "{integration_id}/{name} state mismatch detected:\nwas:      {}\nexpected: {}\n",
                incoming_state.state,
                expected_converted,
                integration_id = incoming.integration_id,
                name = incoming.name,
            );

            self.event_tx
                .send(Event::SetExternalState { device: current });
        }

        // Always make sure device raw state is up to date, note that set_raw
        // bails out if there are no changes.
        self.set_raw(incoming).await?;

        Ok(())
    }

    /// Checks whether external device state matches internal (expected) state
    /// and perform various tasks if it doesn't
    pub async fn handle_external_state_update(
        &mut self,
        incoming: &Device,
        scenes: &Scenes,
    ) -> Result<()> {
        trace!("handle_external_state_update {incoming:?}");

        let device_key = incoming.get_device_key();

        let current = self.get_device(&device_key);

        match (&incoming.data, current) {
            // Device was seen for the first time
            (_, None) => {
                self.discover_device(incoming, scenes).await;
            }

            // Metadata-only placeholder updates should never replace an
            // already-known device. Keep existing state and refresh raw data
            // only when the incoming message actually carries it.
            (_, Some(_)) if incoming.is_unknown_placeholder_sensor() => {
                if incoming.raw.is_some() {
                    self.set_raw(incoming).await?;
                }
            }

            // Once we receive a real device state for a placeholder entry,
            // treat it as a first-class discovery and replace the placeholder.
            (_, Some(current)) if current.is_unknown_placeholder_sensor() => {
                self.discover_device(incoming, scenes).await;
            }

            // Previously seen sensor, state is always updated
            (DeviceData::Sensor(_), _) => {
                self.set_state(incoming, false, false);
            }

            // Previously seen controllable device
            (DeviceData::Controllable(ref incoming_state), Some(current)) => {
                let current = current.clone();

                self.handle_controllable_update(current, incoming, incoming_state)
                    .await?;
            }
        }

        Ok(())
    }

    /// Sets internal (and possibly external) state for given device
    pub fn set_state(&mut self, device: &Device, skip_external_update: bool, skip_db_update: bool) {
        let device_key = device.get_device_key();

        let old = self.get_device(&device_key);

        let state_eq = old.map(|d| d.is_state_eq(device)).unwrap_or_default();

        // For sensors, we always emit the event even if state is equal.
        // This is needed for pulse mode routines that trigger on every update,
        // even when the value is the same (e.g., repeated button presses).
        // For controllable devices, we skip if state is unchanged.
        if state_eq && !device.is_sensor() {
            return;
        }

        let mut device = device.clone();

        if let DeviceData::Controllable(ref mut controllable) = device.data {
            // Make sure brightness is set when device is powered on, defaults to 100%
            if controllable.state.power {
                controllable.state.brightness =
                    Some(controllable.state.brightness.unwrap_or(OrderedFloat(1.0)));
            }
        }

        // TODO: a solution which does not require cloning the entire state each
        // time
        let old_states = { self.state.clone() };
        let old = old.cloned();
        self.state.0.insert(device_key, device.clone());

        self.event_tx.send(Event::InternalStateUpdate {
            old_state: old_states,
            new_state: self.state.clone(),
            old,
            new: device.clone(),
        });

        if !skip_external_update && !device.is_sensor() {
            let device = device.clone();
            self.event_tx.send(Event::SetExternalState { device });
        }

        if !skip_db_update {
            self.schedule_db_update(device.clone());
        }
    }

    /// Sets only the raw part of device state. Otherwise identical to
    /// [Devices::set_state].
    ///
    /// If raw state hasn't changed, do nothing.
    pub async fn set_raw(&mut self, incoming: &Device) -> Result<()> {
        let device = self.get_device(&incoming.get_device_key()).ok_or_else(|| {
            eyre!(
                "Could not find device {integration_id}/{name} while trying to set raw field",
                integration_id = incoming.integration_id,
                name = incoming.name
            )
        })?;

        // If the fields are already equal, do nothing
        if device.raw == incoming.raw {
            return Ok(());
        }

        let mut device = device.clone();
        device.raw.clone_from(&incoming.raw);

        self.set_state(&device, true, true);

        Ok(())
    }

    pub fn get_device(&self, device_key: &DeviceKey) -> Option<&Device> {
        self.state.0.get(device_key)
    }

    fn resolve_scene_devices(
        &self,
        scene_id: &SceneId,
        device_keys: &Option<Vec<DeviceKey>>,
        group_keys: &Option<Vec<GroupId>>,
        transition: &Option<OrderedFloat<f32>>,
        groups: &Groups,
        scenes: &Scenes,
    ) -> Option<Vec<Device>> {
        let scene_devices_config = scenes.find_scene_devices_config(
            self,
            groups,
            &ActivateSceneDescriptor {
                scene_id: scene_id.clone(),
                device_keys: device_keys.clone(),
                group_keys: group_keys.clone(),
                transition: None,
            },
        )?;

        let resolved_devices = scene_devices_config
            .keys()
            .filter_map(|device_key| self.get_device(device_key))
            .map(|device| {
                let scene_device = device.set_scene(Some(scene_id), scenes, self);

                if let Some(transition) = transition {
                    scene_device.set_transition(Some(transition.0))
                } else {
                    scene_device
                }
            })
            .collect();

        Some(resolved_devices)
    }

    fn apply_devices_immediately(&mut self, devices: Vec<Device>) {
        for device in devices {
            self.set_state(&device, false, false);
        }
    }

    async fn apply_devices_with_rollout(
        &mut self,
        devices: Vec<Device>,
        rollout: &Option<RolloutStyle>,
        rollout_source_device_key: &Option<DeviceKey>,
        rollout_duration_ms: &Option<u64>,
        device_positions: &[DevicePositionRow],
    ) {
        if devices.is_empty() {
            return;
        }

        if !matches!(rollout, Some(RolloutStyle::Spatial)) {
            self.apply_devices_immediately(devices);
            return;
        }

        let Some(source_device_key) = rollout_source_device_key.as_ref() else {
            warn!(
                "Spatial rollout requested without rollout_source_device_key, applying immediately"
            );
            self.apply_devices_immediately(devices);
            return;
        };

        let duration_ms = rollout_duration_ms.unwrap_or_default();
        if duration_ms == 0 {
            self.apply_devices_immediately(devices);
            return;
        }

        let mut devices_by_key = devices
            .into_iter()
            .map(|device| (device.get_device_key(), device))
            .collect::<BTreeMap<DeviceKey, Device>>();

        let positions = device_positions
            .iter()
            .cloned()
            .map(|row| (row.device_key.clone(), row))
            .collect::<BTreeMap<String, DevicePositionRow>>();

        let target_device_keys = devices_by_key.keys().cloned().collect::<Vec<_>>();
        let Some(rollout_plan) = build_spatial_rollout_plan(
            source_device_key,
            &target_device_keys,
            &positions,
            duration_ms,
        ) else {
            warn!(
                "Spatial rollout origin {source_device_key} has no saved position, applying immediately"
            );
            self.apply_devices_immediately(devices_by_key.into_values().collect());
            return;
        };

        let mut immediate_devices = Vec::new();
        for device_key in rollout_plan.immediate_device_keys {
            if let Some(device) = devices_by_key.remove(&device_key) {
                immediate_devices.push(device);
            }
        }

        let mut delayed_devices = Vec::new();
        for (device_key, delay_ms) in rollout_plan.delayed_device_keys {
            if let Some(device) = devices_by_key.remove(&device_key) {
                delayed_devices.push((delay_ms, device));
            }
        }

        self.apply_devices_immediately(immediate_devices);

        for (delay_ms, device) in delayed_devices {
            let event_tx = self.event_tx.clone();

            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                event_tx.send(Event::ApplyDeviceState {
                    device,
                    skip_external_update: Some(false),
                    skip_db_update: Some(false),
                });
            });
        }
    }

    pub async fn activate_scene(
        &mut self,
        scene_id: &SceneId,
        device_keys: &Option<Vec<DeviceKey>>,
        group_keys: &Option<Vec<GroupId>>,
        transition: &Option<OrderedFloat<f32>>,
        rollout: &Option<RolloutStyle>,
        rollout_source_device_key: &Option<DeviceKey>,
        rollout_duration_ms: &Option<u64>,
        device_positions: &[DevicePositionRow],
        groups: &Groups,
        scenes: &Scenes,
    ) -> Option<bool> {
        let group_keys_description = if let Some(group_keys) = group_keys {
            format!(
                " for groups: {}",
                group_keys
                    .iter()
                    .map(|g| g.to_string())
                    .collect::<Vec<String>>()
                    .join(", ")
            )
        } else {
            "".to_string()
        };
        let device_keys_description = if let Some(device_keys) = device_keys {
            format!(
                " for devices: {}",
                device_keys
                    .iter()
                    .map(|d| d.to_string())
                    .collect::<Vec<String>>()
                    .join(", ")
            )
        } else {
            "".to_string()
        };
        let rollout_description = rollout
            .as_ref()
            .map(|style| format!(" with {style:?} rollout"))
            .unwrap_or_default();
        let transition_description = transition
            .map(|value| format!(" with {:.1}s transition override", value.0))
            .unwrap_or_default();
        info!(
            "Activating scene {scene_id}{group_keys_description}{device_keys_description}{rollout_description}{transition_description}"
        );

        let resolved_devices = self.resolve_scene_devices(
            scene_id,
            device_keys,
            group_keys,
            transition,
            groups,
            scenes,
        )?;

        self.apply_devices_with_rollout(
            resolved_devices,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
            device_positions,
        )
        .await;

        Some(true)
    }

    pub async fn dim(
        &mut self,
        _device_keys: &Option<Vec<DeviceKey>>,
        _group_keys: &Option<Vec<GroupId>>,
        step: &Option<f32>,
        scenes: &Scenes,
    ) -> Option<bool> {
        info!("Dimming devices. Step: {}", step.unwrap_or(0.1));

        let devices = self.get_state().clone();
        for device in devices.0 {
            let mut d = device.1.clone();
            d = d.dim_device(step.unwrap_or(0.1));
            d = d.set_scene(None, scenes, self);
            self.set_state(&d, false, false);
        }

        Some(true)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn cycle_scenes(
        &mut self,
        scene_descriptors: &[ActivateSceneDescriptor],
        nowrap: bool,
        groups: &Groups,
        detection_device_keys: &Option<Vec<DeviceKey>>,
        detection_group_keys: &Option<Vec<GroupId>>,
        rollout: &Option<RolloutStyle>,
        rollout_source_device_key: &Option<DeviceKey>,
        rollout_duration_ms: &Option<u64>,
        device_positions: &[DevicePositionRow],
        scenes: &Scenes,
    ) -> Option<()> {
        let next_scene = {
            get_next_cycled_scene(
                scene_descriptors,
                nowrap,
                self,
                groups,
                detection_device_keys,
                detection_group_keys,
                scenes,
            )
        }?;

        self.activate_scene(
            &next_scene.scene_id,
            &next_scene.device_keys,
            &next_scene.group_keys,
            &next_scene.transition,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
            device_positions,
            groups,
            scenes,
        )
        .await;

        Some(())
    }

    pub fn get_device_by_ref<'a>(&'a self, device_ref: &DeviceRef) -> Option<&'a Device> {
        let device_key = match device_ref {
            DeviceRef::Id(id_ref) => id_ref.clone().into_device_key(),
        };

        self.state.0.get(&device_key)
    }
}

#[cfg(test)]
mod tests {
    use super::Devices;
    use super::{build_spatial_rollout_plan, SpatialRolloutPlan};
    use crate::core::{groups::Groups, scenes::Scenes};
    use crate::db::config_queries::DevicePositionRow;
    use crate::types::color::Capabilities;
    use crate::types::device::{
        ControllableDevice, Device, DeviceData, DeviceId, DeviceKey, ManageKind, SensorDevice,
    };
    use crate::types::event::{mk_event_channel, RxEventChannel};
    use crate::types::group::GroupsConfig;
    use crate::types::integration::IntegrationId;
    use crate::types::scene::{
        SceneConfig, SceneDeviceConfig, SceneDeviceState, SceneDevicesSearchConfig, ScenesConfig,
    };
    use crate::utils::cli::Cli;
    use ordered_float::OrderedFloat;
    use serde_json::json;
    use std::{collections::BTreeMap, str::FromStr};

    fn device_key(id: &str) -> DeviceKey {
        DeviceKey::new(IntegrationId::from("dummy".to_string()), DeviceId::new(id))
    }

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

    fn placeholder_sensor(id: &str, name: &str, raw: Option<serde_json::Value>) -> Device {
        Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new(id),
            name.to_string(),
            DeviceData::Sensor(SensorDevice::unknown_placeholder()),
            raw,
        )
    }

    fn boolean_sensor(id: &str, name: &str, value: bool, raw: Option<serde_json::Value>) -> Device {
        Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new(id),
            name.to_string(),
            DeviceData::Sensor(SensorDevice::Boolean { value }),
            raw,
        )
    }

    fn controllable_device(id: &str, name: &str, raw: Option<serde_json::Value>) -> Device {
        Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new(id),
            name.to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(0.5),
                None,
                None,
                Capabilities::default(),
                ManageKind::Unmanaged,
            )),
            raw,
        )
    }

    fn position(device_key: &DeviceKey, x: f32, y: f32) -> (String, DevicePositionRow) {
        (
            device_key.to_string(),
            DevicePositionRow {
                device_key: device_key.to_string(),
                x,
                y,
                scale: 1.0,
                rotation: 0.0,
            },
        )
    }

    #[test]
    fn spatial_rollout_plan_returns_none_when_source_has_no_position() {
        let source = device_key("source");
        let target = device_key("target");
        let positions = BTreeMap::from([position(&target, 1.0, 0.0)]);

        let plan = build_spatial_rollout_plan(&source, &[target], &positions, 600);

        assert_eq!(plan, None);
    }

    #[test]
    fn spatial_rollout_plan_scales_delays_and_keeps_unpositioned_targets_immediate() {
        let source = device_key("source");
        let near = device_key("near");
        let far = device_key("far");
        let missing = device_key("missing");
        let positions = BTreeMap::from([
            position(&source, 0.0, 0.0),
            position(&near, 1.0, 0.0),
            position(&far, 3.0, 0.0),
        ]);

        let plan = build_spatial_rollout_plan(
            &source,
            &[near.clone(), far.clone(), missing.clone()],
            &positions,
            900,
        );

        assert_eq!(
            plan,
            Some(SpatialRolloutPlan {
                immediate_device_keys: vec![missing],
                delayed_device_keys: vec![(near, 300), (far, 900)],
            })
        );
    }

    #[test]
    fn spatial_rollout_plan_makes_same_position_targets_immediate() {
        let source = device_key("source");
        let target = device_key("target");
        let positions = BTreeMap::from([position(&source, 2.0, 2.0), position(&target, 2.0, 2.0)]);

        let plan =
            build_spatial_rollout_plan(&source, std::slice::from_ref(&target), &positions, 500);

        assert_eq!(
            plan,
            Some(SpatialRolloutPlan {
                immediate_device_keys: vec![target],
                delayed_device_keys: Vec::new(),
            })
        );
    }

    #[tokio::test]
    async fn placeholder_sensor_does_not_overwrite_known_device() {
        let (mut devices, _event_rx) = test_devices();
        let scenes = Scenes::default();
        let current = boolean_sensor("device1", "Kitchen button", true, None);
        let incoming = placeholder_sensor(
            "device1",
            "device1",
            Some(json!({ "manufacturer": "Vendor" })),
        );

        devices.set_state(&current, true, true);
        devices
            .handle_external_state_update(&incoming, &scenes)
            .await
            .unwrap();

        let stored = devices.get_device(&current.get_device_key()).unwrap();
        assert_eq!(stored.data, current.data);
        assert_eq!(stored.name, current.name);
        assert_eq!(stored.raw, incoming.raw);
    }

    #[tokio::test]
    async fn controllable_update_replaces_placeholder_sensor() {
        let (mut devices, _event_rx) = test_devices();
        let scenes = Scenes::default();
        let placeholder = placeholder_sensor("device1", "device1", Some(json!({ "seen": 1 })));
        let incoming = controllable_device(
            "device1",
            "Kitchen light",
            Some(json!({ "power": true, "brightness": 127 })),
        );

        devices.set_state(&placeholder, true, true);
        devices
            .handle_external_state_update(&incoming, &scenes)
            .await
            .unwrap();

        let stored = devices.get_device(&incoming.get_device_key()).unwrap();
        assert_eq!(stored, &incoming);
    }

    #[tokio::test]
    async fn activate_scene_applies_transition_override() {
        let (mut devices, _event_rx) = test_devices();
        let groups = Groups::new(GroupsConfig::new());
        let scene_id = crate::types::scene::SceneId::from_str("focus").unwrap();
        let target = Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("lamp1"),
            "Lamp 1".to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(0.5),
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            )),
            None,
        );
        let target_key = target.get_device_key();

        devices.set_state(&target, true, true);

        let mut scenes_config = ScenesConfig::new();
        scenes_config.insert(
            scene_id.clone(),
            SceneConfig {
                name: "Focus".to_string(),
                devices: Some(create_scene_device_config(
                    &target_key.to_string(),
                    SceneDeviceConfig::DeviceState(SceneDeviceState {
                        power: Some(true),
                        color: None,
                        brightness: Some(OrderedFloat(0.7)),
                        transition: Some(OrderedFloat(0.2)),
                    }),
                )),
                groups: None,
                hidden: None,
                script: None,
            },
        );
        let mut scenes = Scenes::new(scenes_config);
        scenes.force_invalidate(&devices, &groups);

        let result = devices
            .activate_scene(
                &scene_id,
                &None,
                &None,
                &Some(OrderedFloat(1.5)),
                &None,
                &None,
                &None,
                &[],
                &groups,
                &scenes,
            )
            .await;

        assert_eq!(result, Some(true));

        let stored = devices.get_device(&target_key).unwrap();
        let DeviceData::Controllable(data) = &stored.data else {
            panic!("expected controllable device");
        };

        assert_eq!(data.state.transition, Some(OrderedFloat(1.5)));
        assert_eq!(data.state.brightness, Some(OrderedFloat(0.7)));
    }
}
