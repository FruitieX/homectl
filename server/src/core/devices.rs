use crate::db::actions::{db_get_devices, db_update_device};
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
    scene::{ActivateSceneDescriptor, SceneId},
};
use color_eyre::Result;
use ordered_float::OrderedFloat;
use std::collections::{BTreeMap, HashSet};

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

                    self.set_state(&device, !device.is_managed(), true);
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
        let old = self.get_device(&device_key);

        let state_eq = old.map(|d| d.is_state_eq(device)).unwrap_or_default();

        if state_eq {
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

    pub async fn activate_scene(
        &mut self,
        scene_id: &SceneId,
        device_keys: &Option<Vec<DeviceKey>>,
        group_keys: &Option<Vec<GroupId>>,
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
        info!("Activating scene {scene_id}{group_keys_description}{device_keys_description}");

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

        for device_key in scene_devices_config.keys() {
            let device = self.get_device(device_key);

            if let Some(device) = device {
                // Set scene state without transition when activating scene
                let device = device
                    .set_scene(Some(scene_id), scenes)
                    .set_transition(None);

                self.set_state(&device, false, false);
            }
        }

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
