use std::collections::BTreeMap;

use color_eyre::Result;

use crate::types::{
    action::Action,
    device::{Device, DeviceKey},
    dim::DimDescriptor,
    event::*,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{ActivateSceneActionDescriptor, CycleScenesDescriptor, SceneConfig, SceneId},
    ui::UiActionDescriptor,
};

use crate::db::config_queries;

use super::state::AppState;

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

pub async fn handle_event(state: &mut AppState, event: &Event) -> Result<()> {
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
                return Ok(());
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
                state.scenes.store_scene_override(device, true).await?;
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
            let device = device.color_to_preferred_mode();

            state
                .integrations
                .set_integration_device_state(device)
                .await?;
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

            if let Err(e) = config_queries::db_upsert_config_scene(&scene).await {
                warn!(
                    "DB not available when storing scene {scene}: {e}",
                    scene = scene_id
                );
            }
        }
        Event::DbDeleteScene { scene_id } => {
            let deleted = state.delete_scene(&scene_id.to_string());
            if deleted {
                state.apply_runtime_scenes();
            }

            if let Err(e) = config_queries::db_delete_config_scene(&scene_id.to_string()).await {
                warn!(
                    "DB not available when deleting scene {scene}: {e}",
                    scene = scene_id
                );
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
                if let Err(e) = config_queries::db_upsert_config_scene(scene).await {
                    warn!(
                        "DB not available when editing scene {scene}: {e}",
                        scene = scene_id
                    );
                }
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
            device_keys,
            group_keys,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        })) => {
            state
                .devices
                .activate_scene(
                    scene_id,
                    device_keys,
                    group_keys,
                    rollout,
                    rollout_source_device_key,
                    rollout_duration_ms,
                    &state.runtime_config.device_positions,
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
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        })) => {
            state
                .devices
                .cycle_scenes(
                    scenes,
                    nowrap.unwrap_or(false),
                    &state.groups,
                    device_keys,
                    group_keys,
                    rollout,
                    rollout_source_device_key,
                    rollout_duration_ms,
                    &state.runtime_config.device_positions,
                    &state.scenes,
                )
                .await;
        }
        Event::Action(Action::Dim(DimDescriptor {
            device_keys,
            group_keys,
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
            state
                .integrations
                .run_integration_action(integration_id, payload)
                .await?;
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
                state
                    .scenes
                    .store_scene_override(device, *override_state)
                    .await?;
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
            state.ui.store_state(key.clone(), value.clone()).await?;
            state.schedule_ws_broadcast();
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::handle_event;
    use crate::core::{
        devices::Devices, groups::Groups, integrations::Integrations, routines::Routines,
        scenes::Scenes, state::AppState, ui::Ui, websockets::WebSockets,
    };
    use crate::db::config_queries::{ConfigExport, CoreConfigRow};
    use crate::types::{
        event::{mk_event_channel, Event},
        scene::{SceneConfig, SceneId},
    };
    use crate::utils::cli::Cli;
    use std::sync::{atomic::AtomicBool, Arc};

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
            },
            integrations: Vec::new(),
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            device_positions: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_sensor_configs: Vec::new(),
            dashboard_layouts: Vec::new(),
            dashboard_widgets: Vec::new(),
        }
    }

    fn test_state() -> (AppState, crate::types::event::RxEventChannel) {
        let cli = test_cli();
        let (event_tx, event_rx) = mk_event_channel();
        let state = AppState {
            warming_up: false,
            runtime_config: empty_runtime_config(),
            integrations: Integrations::new(event_tx.clone(), &cli),
            groups: Groups::new(Default::default()),
            scenes: Scenes::new(Default::default()),
            devices: Devices::new(event_tx.clone(), &cli),
            rules: Routines::new(Default::default(), event_tx.clone()),
            event_tx,
            ws: WebSockets::default(),
            ui: Ui::new(),
            ws_broadcast_pending: Arc::new(AtomicBool::new(false)),
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
}
