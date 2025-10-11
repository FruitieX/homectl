use std::collections::BTreeMap;

use color_eyre::Result;

use crate::types::{
    action::Action,
    device::{Device, DeviceKey},
    dim::DimDescriptor,
    event::*,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{ActivateSceneDescriptor, CycleScenesDescriptor},
    ui::UiActionDescriptor,
};

use crate::db::actions::{db_delete_scene, db_edit_scene, db_store_scene};

use super::{expr::eval_action_expr, state::AppState};

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

            state
                .expr
                .invalidate(state.devices.get_state(), &state.groups, &state.scenes);

            state
                .scenes
                .force_invalidate(&state.devices, &state.groups, state.expr.get_context());

            state
                .expr
                .invalidate(state.devices.get_state(), &state.groups, &state.scenes);

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

            // TODO: only invalidate changed devices/groups/scenes in expr context
            state
                .expr
                .invalidate(new_state, &state.groups, &state.scenes);

            let invalidated_scenes = state.scenes.invalidate(
                old_state,
                new_state,
                invalidated_device,
                &state.devices,
                &state.groups,
                state.expr.get_context(),
            );

            state.devices.invalidate(&invalidated_scenes, &state.scenes);

            // TODO: only invalidate changed devices/groups/scenes in expr context
            state
                .expr
                .invalidate(new_state, &state.groups, &state.scenes);

            state
                .rules
                .handle_internal_state_update(
                    old_state,
                    new_state,
                    old,
                    &state.devices,
                    &state.groups,
                    &state.expr,
                )
                .await;

            state.schedule_ws_broadcast();
        }
        Event::SetInternalState {
            device,
            skip_external_update,
        } => {
            let has_scene_override = state.scenes.has_override(device);
            if has_scene_override {
                state.scenes.store_scene_override(device, true).await?;
                state.scenes.force_invalidate(
                    &state.devices,
                    &state.groups,
                    state.expr.get_context(),
                );
            }

            let device = device.set_scene(device.get_scene_id().as_ref(), &state.scenes);

            state
                .devices
                .set_state(&device, skip_external_update.unwrap_or_default(), true);
        }
        Event::SetExternalState { device } => {
            let device = device.color_to_preferred_mode();

            state
                .integrations
                .set_integration_device_state(device)
                .await?;
        }
        Event::DbStoreScene { scene_id, config } => {
            if let Err(e) = db_store_scene(scene_id, config).await {
                warn!(
                    "DB not available when storing scene {scene}: {e}",
                    scene = scene_id
                );
            }
            state.scenes.refresh_db_scenes().await;
            state
                .scenes
                .force_invalidate(&state.devices, &state.groups, state.expr.get_context());
            state.schedule_ws_broadcast();
        }
        Event::DbDeleteScene { scene_id } => {
            if let Err(e) = db_delete_scene(scene_id).await {
                warn!(
                    "DB not available when deleting scene {scene}: {e}",
                    scene = scene_id
                );
            }
            state.scenes.refresh_db_scenes().await;
            state
                .scenes
                .force_invalidate(&state.devices, &state.groups, state.expr.get_context());
            state.schedule_ws_broadcast();
        }
        Event::DbEditScene { scene_id, name } => {
            if let Err(e) = db_edit_scene(scene_id, name).await {
                warn!(
                    "DB not available when editing scene {scene}: {e}",
                    scene = scene_id
                );
            }
            state.scenes.refresh_db_scenes().await;
            state
                .scenes
                .force_invalidate(&state.devices, &state.groups, state.expr.get_context());
            state.schedule_ws_broadcast();
        }
        Event::Action(Action::ActivateScene(ActivateSceneDescriptor {
            scene_id,
            device_keys,
            group_keys,
        })) => {
            let eval_context = state.expr.get_context();
            state
                .devices
                .activate_scene(
                    scene_id,
                    device_keys,
                    group_keys,
                    &state.groups,
                    &state.scenes,
                    eval_context,
                )
                .await;
        }
        Event::Action(Action::CycleScenes(CycleScenesDescriptor {
            scenes,
            nowrap,
            group_keys,
            device_keys,
        })) => {
            let eval_context = state.expr.get_context();
            state
                .devices
                .cycle_scenes(
                    scenes,
                    nowrap.unwrap_or(false),
                    &state.groups,
                    device_keys,
                    group_keys,
                    &state.scenes,
                    eval_context,
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
            state
                .scenes
                .force_invalidate(&state.devices, &state.groups, state.expr.get_context());
            state.schedule_ws_broadcast();
        }
        Event::Action(Action::EvalExpr(expr)) => {
            let eval_context = state.expr.get_context();
            eval_action_expr(
                expr,
                eval_context,
                state.devices.get_state(),
                &state.event_tx,
            )?;
        }
        Event::Action(Action::Ui(action)) => {
            let UiActionDescriptor::StoreUIState { key, value } = action;
            state.ui.store_state(key.clone(), value.clone()).await?;
            state.schedule_ws_broadcast();
        }
    }

    Ok(())
}
