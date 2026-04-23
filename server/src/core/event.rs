use std::collections::BTreeMap;

use color_eyre::Result;

use crate::db::actions::{db_store_scene_overrides, db_store_ui_state};
use crate::types::{
    action::Action,
    device::{Device, DeviceKey, DevicesState},
    dim::DimDescriptor,
    event::*,
    group::GroupId,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{
        ActivateSceneActionDescriptor, ActivateSceneDescriptor, CycleScenesDescriptor, SceneConfig,
        SceneDevicesConfig, SceneId,
    },
    ui::UiActionDescriptor,
};

use crate::db::config_queries;

use super::state::AppState;
use super::{groups::Groups, integrations::Integrations};

/// Resolves the effective scene id for an action that may reference the
/// currently active scene of another group. Falls back to `fallback_scene_id`
/// when the referenced group has no unanimous active scene.
fn resolve_mirrored_scene_id(
    fallback_scene_id: &SceneId,
    mirror_from_group: Option<&GroupId>,
    groups: &Groups,
    devices: &DevicesState,
) -> SceneId {
    let Some(group_id) = mirror_from_group else {
        return fallback_scene_id.clone();
    };

    match groups.get_group_scene_id(devices, group_id) {
        Some(scene_id) => scene_id,
        None => {
            debug!(
                "mirror_from_group = {group_id} has no unanimous active scene; \
                 falling back to {fallback_scene_id}"
            );
            fallback_scene_id.clone()
        }
    }
}

fn scene_row_from_config(scene_id: &SceneId, config: &SceneConfig) -> config_queries::SceneRow {
    let device_states = config
        .devices
        .as_ref()
        .map(|devices| {
            devices
                .0
                .iter()
                .flat_map(|(integration_id, devices)| {
                    devices.iter().filter_map(move |(device_name, config)| {
                        serde_json::to_value(config)
                            .ok()
                            .map(|value| (format!("{integration_id}/{device_name}"), value))
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let group_states = config
        .groups
        .as_ref()
        .map(|groups| {
            groups
                .0
                .iter()
                .filter_map(|(group_id, config)| {
                    serde_json::to_value(config)
                        .ok()
                        .map(|value| (group_id.to_string(), value))
                })
                .collect()
        })
        .unwrap_or_default();

    config_queries::SceneRow {
        id: scene_id.to_string(),
        name: config.name.clone(),
        hidden: config.hidden.unwrap_or(false),
        script: config.script.clone(),
        device_states,
        group_states,
    }
}

#[derive(Default)]
pub struct EventOutcome {
    deferred_work: Vec<DeferredEventWork>,
}

impl EventOutcome {
    fn push(&mut self, work: DeferredEventWork) {
        self.deferred_work.push(work);
    }

    pub fn into_deferred_work(self) -> Vec<DeferredEventWork> {
        self.deferred_work
    }
}

pub enum DeferredEventWork {
    PublishIntegrationState {
        integrations: Integrations,
        device: Device,
    },
    RunIntegrationAction {
        integrations: Integrations,
        descriptor: CustomActionDescriptor,
    },
    PersistSceneOverride {
        scene_id: SceneId,
        overrides: SceneDevicesConfig,
    },
    UpsertConfigScene {
        scene_id: SceneId,
        scene: config_queries::SceneRow,
    },
    DeleteConfigScene {
        scene_id: SceneId,
    },
    StoreUiState {
        key: String,
        value: serde_json::Value,
    },
}

impl DeferredEventWork {
    pub async fn execute(self) -> Result<()> {
        match self {
            DeferredEventWork::PublishIntegrationState {
                integrations,
                device,
            } => integrations.set_integration_device_state(device).await,
            DeferredEventWork::RunIntegrationAction {
                integrations,
                descriptor,
            } => {
                integrations
                    .run_integration_action(&descriptor.integration_id, &descriptor.payload)
                    .await
            }
            DeferredEventWork::PersistSceneOverride {
                scene_id,
                overrides,
            } => {
                if let Err(error) = db_store_scene_overrides(&scene_id, &overrides).await {
                    warn!("Failed to persist scene override for {scene_id}: {error}");
                }

                Ok(())
            }
            DeferredEventWork::UpsertConfigScene { scene_id, scene } => {
                if let Err(error) = config_queries::db_upsert_config_scene(&scene).await {
                    warn!("DB not available when storing scene {scene_id}: {error}");
                }

                Ok(())
            }
            DeferredEventWork::DeleteConfigScene { scene_id } => {
                if let Err(error) =
                    config_queries::db_delete_config_scene(&scene_id.to_string()).await
                {
                    warn!("DB not available when deleting scene {scene_id}: {error}");
                }

                Ok(())
            }
            DeferredEventWork::StoreUiState { key, value } => {
                if let Err(error) = db_store_ui_state(&key, &value).await {
                    warn!("DB not available when storing UI state '{key}': {error}");
                }

                Ok(())
            }
        }
    }
}

pub async fn handle_event(state: &mut AppState, event: &Event) -> Result<EventOutcome> {
    let mut outcome = EventOutcome::default();

    match event {
        Event::ExternalStateUpdate { device } => {
            state
                .devices
                .handle_external_state_update(device, &state.scenes)
                .await?;
        }
        Event::StartupCompleted => {
            state.groups.force_invalidate(&state.devices);

            state.scenes.force_invalidate(&state.devices, &state.groups);

            state.refresh_routine_statuses();
            state.schedule_ws_broadcast();

            let device_count = state.devices.get_state().0.len();
            info!("Startup completed, discovered {device_count} devices");
        }
        Event::InternalStateUpdate {
            old_state,
            new_state,
            old,
            new,
        } => {
            if state.warming_up {
                return Ok(outcome);
            }

            let invalidated_device = new;
            debug!("invalidating {name}", name = invalidated_device.name);

            let _groups_invalidated = state
                .groups
                .invalidate(old_state, new_state, &state.devices);

            let invalidated_scenes = state.scenes.invalidate(
                old_state,
                new_state,
                invalidated_device,
                &state.devices,
                &state.groups,
            );

            state.devices.invalidate(&invalidated_scenes, &state.scenes);

            state
                .rules
                .handle_internal_state_update(
                    old_state,
                    new_state,
                    old,
                    new,
                    &state.devices,
                    &state.groups,
                )
                .await;

            state.schedule_ws_broadcast();
        }
        Event::SetInternalState {
            device,
            skip_external_update,
            skip_db_update,
        } => {
            let has_scene_override = state.scenes.has_override(device);
            if has_scene_override {
                let (scene_id, overrides) =
                    state.scenes.store_scene_override_in_memory(device, true)?;
                outcome.push(DeferredEventWork::PersistSceneOverride {
                    scene_id,
                    overrides,
                });
                state.scenes.force_invalidate(&state.devices, &state.groups);
            }

            let device = device.set_scene(
                device.get_scene_id().as_ref(),
                &state.scenes,
                &state.devices,
            );

            state.devices.set_state(
                &device,
                skip_external_update.unwrap_or_default(),
                skip_db_update.unwrap_or(true),
            );
        }
        Event::SetExternalState { device } => {
            outcome.push(DeferredEventWork::PublishIntegrationState {
                integrations: state.integrations.clone(),
                device: device.color_to_preferred_mode(),
            });
        }
        Event::ApplyDeviceState {
            device,
            skip_external_update,
            skip_db_update,
        } => {
            state.devices.set_state(
                device,
                skip_external_update.unwrap_or_default(),
                skip_db_update.unwrap_or_default(),
            );
        }
        Event::DbStoreScene { scene_id, config } => {
            let scene = scene_row_from_config(scene_id, config);
            state.upsert_scene(scene.clone());
            state.apply_runtime_scenes();

            outcome.push(DeferredEventWork::UpsertConfigScene {
                scene_id: scene_id.clone(),
                scene,
            });
        }
        Event::DbDeleteScene { scene_id } => {
            let deleted = state.delete_scene(&scene_id.to_string());
            if deleted {
                state.apply_runtime_scenes();
            }

            if deleted {
                outcome.push(DeferredEventWork::DeleteConfigScene {
                    scene_id: scene_id.clone(),
                });
            }
        }
        Event::DbEditScene { scene_id, name } => {
            let updated_scene = if let Some(scene) = state
                .runtime_config
                .scenes
                .iter_mut()
                .find(|scene| scene.id == scene_id.to_string())
            {
                scene.name = name.clone();
                Some(scene.clone())
            } else {
                None
            };

            if updated_scene.is_some() {
                state.apply_runtime_scenes();
            }

            if let Some(scene) = updated_scene.as_ref() {
                outcome.push(DeferredEventWork::UpsertConfigScene {
                    scene_id: scene_id.clone(),
                    scene: scene.clone(),
                });
            }

            if updated_scene.is_none() {
                warn!(
                    "Ignoring scene rename for missing scene {scene}",
                    scene = scene_id
                );
            }
        }
        Event::Action(Action::ActivateScene(ActivateSceneActionDescriptor {
            scene_id,
            mirror_from_group,
            device_keys,
            group_keys,
            include_source_groups: _,
            use_scene_transition,
            transition,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        })) => {
            let device_positions = state.effective_device_positions();
            let resolved_scene_id = resolve_mirrored_scene_id(
                scene_id,
                mirror_from_group.as_ref(),
                &state.groups,
                state.devices.get_state(),
            );
            state
                .devices
                .activate_scene(
                    &resolved_scene_id,
                    device_keys,
                    group_keys,
                    *use_scene_transition,
                    transition,
                    rollout,
                    rollout_source_device_key,
                    rollout_duration_ms,
                    &device_positions,
                    &state.groups,
                    &state.scenes,
                )
                .await;
        }
        Event::Action(Action::CycleScenes(CycleScenesDescriptor {
            scenes,
            nowrap,
            group_keys,
            device_keys,
            include_source_groups: _,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        })) => {
            let device_positions = state.effective_device_positions();
            let resolved_scenes: Vec<ActivateSceneDescriptor> = scenes
                .iter()
                .map(|sd| {
                    let resolved_scene_id = resolve_mirrored_scene_id(
                        &sd.scene_id,
                        sd.mirror_from_group.as_ref(),
                        &state.groups,
                        state.devices.get_state(),
                    );
                    ActivateSceneDescriptor {
                        scene_id: resolved_scene_id,
                        mirror_from_group: None,
                        device_keys: sd.device_keys.clone(),
                        group_keys: sd.group_keys.clone(),
                        use_scene_transition: sd.use_scene_transition,
                        transition: sd.transition,
                    }
                })
                .collect();
            state
                .devices
                .cycle_scenes(
                    &resolved_scenes,
                    nowrap.unwrap_or(false),
                    &state.groups,
                    device_keys,
                    group_keys,
                    rollout,
                    rollout_source_device_key,
                    rollout_duration_ms,
                    &device_positions,
                    &state.scenes,
                )
                .await;
        }
        Event::Action(Action::Dim(DimDescriptor {
            device_keys,
            group_keys,
            include_source_groups: _,
            step,
        })) => {
            state
                .devices
                .dim(device_keys, group_keys, step, &state.scenes)
                .await;
        }
        Event::Action(Action::Custom(CustomActionDescriptor {
            integration_id,
            payload,
        })) => {
            outcome.push(DeferredEventWork::RunIntegrationAction {
                integrations: state.integrations.clone(),
                descriptor: CustomActionDescriptor {
                    integration_id: integration_id.clone(),
                    payload: payload.clone(),
                },
            });
        }
        Event::Action(Action::ForceTriggerRoutine(ForceTriggerRoutineDescriptor {
            routine_id,
        })) => {
            state.rules.force_trigger_routine(routine_id)?;
        }
        Event::Action(Action::SetDeviceState(device)) => {
            state.event_tx.send(Event::SetInternalState {
                device: device.clone(),
                skip_external_update: None,
                skip_db_update: None,
            });
        }
        Event::Action(Action::ToggleDeviceOverride {
            device_keys,
            override_state,
        }) => {
            let affected_devices: BTreeMap<&DeviceKey, &Device> = state
                .devices
                .get_state()
                .0
                .iter()
                .filter(|(k, _)| device_keys.iter().any(|dk| &dk == k))
                .collect();

            for device in affected_devices.values() {
                let (scene_id, overrides) = state
                    .scenes
                    .store_scene_override_in_memory(device, *override_state)?;
                outcome.push(DeferredEventWork::PersistSceneOverride {
                    scene_id,
                    overrides,
                });
            }
            state.scenes.force_invalidate(&state.devices, &state.groups);
            state.refresh_routine_statuses();
            state.schedule_ws_broadcast();
        }
        Event::Action(Action::EvalExpr(expr)) => {
            warn!("Ignoring legacy evalexpr action: {expr}");
        }
        Event::Action(Action::Ui(action)) => {
            let UiActionDescriptor::StoreUIState { key, value } = action;
            state.ui.store_state_in_memory(key.clone(), value.clone());
            state.schedule_ws_broadcast();
            outcome.push(DeferredEventWork::StoreUiState {
                key: key.clone(),
                value: value.clone(),
            });
        }
    }

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::{handle_event, DeferredEventWork};
    use crate::core::{
        devices::Devices,
        groups::Groups,
        integrations::Integrations,
        routines::Routines,
        scenes::Scenes,
        snapshot::{new_snapshot_handle, RuntimeSnapshot},
        state::AppState,
        ui::Ui,
        websockets::WebSockets,
    };
    use crate::db::config_queries::{ConfigExport, CoreConfigRow};
    use crate::types::{
        color::Capabilities,
        device::{ControllableDevice, Device, DeviceData, DeviceId, ManageKind},
        event::{mk_event_channel, Event},
        integration::IntegrationId,
        scene::{SceneConfig, SceneId},
    };
    use crate::utils::cli::Cli;
    use std::sync::{atomic::AtomicBool, Arc};
    use tokio::sync::Mutex;

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

    fn empty_runtime_config() -> ConfigExport {
        ConfigExport {
            version: 1,
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                ..CoreConfigRow::default()
            },
            integrations: Vec::new(),
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_sensor_configs: Vec::new(),
            widget_settings: Vec::new(),
            dashboard_layouts: Vec::new(),
            dashboard_widgets: Vec::new(),
        }
    }

    fn test_state() -> (AppState, crate::types::event::RxEventChannel) {
        let cli = test_cli();
        let (event_tx, event_rx) = mk_event_channel();
        let runtime_config = empty_runtime_config();
        let devices = Devices::new(event_tx.clone(), &cli);
        let snapshot = new_snapshot_handle(RuntimeSnapshot {
            runtime_config: Arc::new(runtime_config.clone()),
            devices: Arc::new(devices.get_state().clone()),
            flattened_groups: Arc::new(Default::default()),
            flattened_scenes: Arc::new(Default::default()),
            routine_statuses: Arc::new(Default::default()),
            ui_state: Arc::new(Default::default()),
            warming_up: false,
        });
        let state = AppState {
            warming_up: false,
            runtime_config,
            integrations: Integrations::new(event_tx.clone(), &cli),
            groups: Groups::new(Default::default()),
            scenes: Scenes::new(Default::default()),
            devices,
            rules: Routines::new(Default::default(), event_tx.clone()),
            event_tx,
            ws: WebSockets::default(),
            ui: Ui::new(),
            ws_broadcast_pending: Arc::new(AtomicBool::new(false)),
            runtime_apply_lock: Arc::new(Mutex::new(())),
            snapshot,
        };

        (state, event_rx)
    }

    #[tokio::test]
    async fn db_scene_events_keep_runtime_state_without_database() {
        let (mut state, _event_rx) = test_state();
        let scene_id = SceneId::new("memory_scene".to_string());

        handle_event(
            &mut state,
            &Event::DbStoreScene {
                scene_id: scene_id.clone(),
                config: SceneConfig {
                    name: "Memory Scene".to_string(),
                    devices: None,
                    groups: None,
                    hidden: Some(false),
                    script: None,
                },
            },
        )
        .await
        .expect("storing scene should succeed without a database");

        assert_eq!(state.runtime_config.scenes.len(), 1);
        assert_eq!(state.runtime_config.scenes[0].id, "memory_scene");
        assert_eq!(state.runtime_config.scenes[0].name, "Memory Scene");

        handle_event(
            &mut state,
            &Event::DbEditScene {
                scene_id: scene_id.clone(),
                name: "Renamed Scene".to_string(),
            },
        )
        .await
        .expect("renaming scene should succeed without a database");

        assert_eq!(state.runtime_config.scenes[0].name, "Renamed Scene");

        handle_event(&mut state, &Event::DbDeleteScene { scene_id })
            .await
            .expect("deleting scene should succeed without a database");

        assert!(state.runtime_config.scenes.is_empty());
    }

    #[tokio::test]
    async fn set_external_state_is_deferred() {
        let (mut state, _event_rx) = test_state();
        let device = Device::new(
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
                ManageKind::Unmanaged,
            )),
            None,
        );

        let outcome = handle_event(
            &mut state,
            &Event::SetExternalState {
                device: device.clone(),
            },
        )
        .await
        .expect("set external state should succeed");

        assert_eq!(outcome.deferred_work.len(), 1);
        match &outcome.deferred_work[0] {
            DeferredEventWork::PublishIntegrationState {
                device: deferred_device,
                ..
            } => assert_eq!(deferred_device.get_device_key(), device.get_device_key()),
            _ => panic!("expected deferred integration publish"),
        }
    }
}
