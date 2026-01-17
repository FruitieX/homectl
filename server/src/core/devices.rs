use crate::db::{
    actions::{db_get_devices, db_update_device},
    config_queries::{db_get_device_positions, DevicePositionRow},
};
use crate::types::integration::IntegrationId;
use crate::utils::cli::Cli;

use super::expr::EvalContext;
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
use std::time::Duration;

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
    keys_by_name: BTreeMap<(IntegrationId, String), DeviceKey>,
    cli: Cli,
}

impl Devices {
    pub fn new(event_tx: TxEventChannel, cli: &Cli) -> Self {
        Devices {
            event_tx,
            state: Default::default(),
            keys_by_name: Default::default(),
            cli: cli.clone(),
        }
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

        self.keys_by_name
            .retain(|(iid, _), _| iid != integration_id);
    }

    /// Registers a device in the name lookup map, allowing it to be found by
    /// DeviceRef::Name references in routine rules.
    pub fn register_device_name(&mut self, device: &Device) {
        let device_key = device.get_device_key();
        self.keys_by_name.insert(
            (device.integration_id.clone(), device.name.clone()),
            device_key,
        );
    }

    pub async fn refresh_db_devices(&mut self, _scenes: &Scenes) {
        let db_devices = db_get_devices().await;

        match db_devices {
            Ok(db_devices) => {
                for (device_key, db_device) in db_devices {
                    debug!(
                        "Restoring device from DB: {integration_id}/{name}",
                        integration_id = db_device.integration_id,
                        name = db_device.name,
                    );
                    self.keys_by_name.insert(
                        (db_device.integration_id.clone(), db_device.name.clone()),
                        device_key,
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
                .map(|d| d.set_scene(Some(scene_id), scenes))
                .collect();

            for device in invalidated_devices {
                self.set_state(&device, false, false);
            }
        }
    }

    pub async fn discover_device(&mut self, device: &Device, scenes: &Scenes) {
        info!("Discovered device: {device}");
        let device = device.set_scene(device.get_scene_id().as_ref(), scenes);

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

        self.keys_by_name.insert(
            (incoming.integration_id.clone(), incoming.name.clone()),
            device_key.clone(),
        );

        let current = self.get_device(&device_key);

        match (&incoming.data, current) {
            // Device was seen for the first time
            (_, None) => {
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

        // Register device in name lookup map for DeviceRef::Name resolution
        self.register_device_name(device);

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
            if !self.cli.dry_run {
                tokio::spawn(async move {
                    db_update_device(&device).await.ok();
                });
            } else {
                debug!("(dry run) would store device: {device}");
            }
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
        groups: &Groups,
        scenes: &Scenes,
        eval_context: &EvalContext,
    ) -> Option<Vec<Device>> {
        let scene_devices_config = scenes.find_scene_devices_config(
            self,
            groups,
            &ActivateSceneDescriptor {
                scene_id: scene_id.clone(),
                device_keys: device_keys.clone(),
                group_keys: group_keys.clone(),
            },
            eval_context,
        )?;

        let resolved_devices = scene_devices_config
            .keys()
            .filter_map(|device_key| self.get_device(device_key))
            .map(|device| {
                device
                    .set_scene(Some(scene_id), scenes)
                    .set_transition(None)
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

        let positions = match db_get_device_positions().await {
            Ok(rows) => rows
                .into_iter()
                .map(|row| (row.device_key.clone(), row))
                .collect::<BTreeMap<String, DevicePositionRow>>(),
            Err(error) => {
                warn!("Failed to load device positions for spatial rollout: {error}");
                self.apply_devices_immediately(devices_by_key.into_values().collect());
                return;
            }
        };

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
        rollout: &Option<RolloutStyle>,
        rollout_source_device_key: &Option<DeviceKey>,
        rollout_duration_ms: &Option<u64>,
        groups: &Groups,
        scenes: &Scenes,
        eval_context: &EvalContext,
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
        info!(
            "Activating scene {scene_id}{group_keys_description}{device_keys_description}{rollout_description}"
        );

        let resolved_devices = self.resolve_scene_devices(
            scene_id,
            device_keys,
            group_keys,
            groups,
            scenes,
            eval_context,
        )?;

        self.apply_devices_with_rollout(
            resolved_devices,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
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
            d = d.set_scene(None, scenes);
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
        scenes: &Scenes,
        eval_context: &EvalContext,
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
                eval_context,
            )
        }?;

        self.activate_scene(
            &next_scene.scene_id,
            &next_scene.device_keys,
            &next_scene.group_keys,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
            groups,
            scenes,
            eval_context,
        )
        .await;

        Some(())
    }

    pub fn get_device_by_ref<'a>(&'a self, device_ref: &DeviceRef) -> Option<&'a Device> {
        let device_key = match device_ref {
            DeviceRef::Id(id_ref) => Some(id_ref.clone().into_device_key()),
            DeviceRef::Name(name_ref) => self
                .keys_by_name
                .get(&(name_ref.integration_id.clone(), name_ref.name.clone()))
                .cloned(),
        }?;

        self.state.0.get(&device_key)
    }
}

#[cfg(test)]
mod tests {
    use super::{build_spatial_rollout_plan, SpatialRolloutPlan};
    use crate::db::config_queries::DevicePositionRow;
    use crate::types::device::{DeviceId, DeviceKey};
    use crate::types::integration::IntegrationId;
    use std::collections::BTreeMap;

    fn device_key(id: &str) -> DeviceKey {
        DeviceKey::new(IntegrationId::from("dummy".to_string()), DeviceId::new(id))
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
}
