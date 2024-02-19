use color_eyre::Result;

use crate::types::{
    action::Action,
    dim::DimDescriptor,
    event::*,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{ActivateSceneDescriptor, CycleScenesDescriptor},
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

            state.event_tx.send(Event::WsBroadcastState);
        }
        Event::SetInternalState {
            device,
            skip_external_update,
        } => {
            let device = device.set_scene(device.get_scene_id().as_ref(), &state.scenes);

            state
                .devices
                .set_state(&device, skip_external_update.unwrap_or_default());
        }
        Event::SetExternalState { device } => {
            let device = device.color_to_preferred_mode();

            state
                .integrations
                .set_integration_device_state(device)
                .await?;
        }
        Event::WsBroadcastState => {
            state.send_state_ws(None).await;
        }
        Event::DbStoreScene { scene_id, config } => {
            db_store_scene(scene_id, config).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;
        }
        Event::DbDeleteScene { scene_id } => {
            db_delete_scene(scene_id).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;
        }
        Event::DbEditScene { scene_id, name } => {
            db_edit_scene(scene_id, name).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;
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
        Event::Action(Action::CycleScenes(CycleScenesDescriptor { scenes, nowrap })) => {
            let eval_context = state.expr.get_context();
            state
                .devices
                .cycle_scenes(
                    scenes,
                    nowrap.unwrap_or(false),
                    &state.groups,
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
            state.devices.set_state(device, false);
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
    }

    Ok(())
}
