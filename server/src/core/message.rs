use color_eyre::Result;
use std::sync::Arc;

use crate::types::{
    action::Action,
    dim::DimDescriptor,
    event::*,
    integration::CustomActionDescriptor,
    rule::ForceTriggerRoutineDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};

use crate::db::actions::{db_delete_scene, db_edit_scene, db_store_scene};

use super::{expr::eval_action_expr, state::AppState};

pub async fn handle_message(state: Arc<AppState>, msg: &Message) -> Result<()> {
    match msg {
        Message::RecvDeviceState { device } => state.devices.handle_recv_device_state(device).await,
        Message::InternalStateUpdate {
            old_state,
            new_state,
            old,
            new,
        } => {
            state
                .rules
                .handle_internal_state_update(old_state, new_state, old, new)
                .await;

            Ok(())
        }
        Message::SetExpectedState {
            device,
            set_scene,
            skip_send,
        } => {
            state
                .devices
                .set_device_state(device, *set_scene, false, *skip_send)
                .await;

            Ok(())
        }
        Message::SendDeviceState { device } => {
            state
                .integrations
                .set_integration_device_state(device)
                .await
        }
        Message::WsBroadcastState => {
            state.send_state_ws(None).await;

            Ok(())
        }
        Message::DbStoreScene { scene_id, config } => {
            db_store_scene(scene_id, config).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;

            Ok(())
        }
        Message::DbDeleteScene { scene_id } => {
            db_delete_scene(scene_id).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;

            Ok(())
        }
        Message::DbEditScene { scene_id, name } => {
            db_edit_scene(scene_id, name).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;

            Ok(())
        }
        Message::Action(Action::ActivateScene(SceneDescriptor {
            scene_id,
            device_keys,
            group_keys,
        })) => {
            state
                .devices
                .activate_scene(scene_id, device_keys, group_keys)
                .await;

            Ok(())
        }
        Message::Action(Action::CycleScenes(CycleScenesDescriptor { scenes, nowrap })) => {
            state
                .devices
                .cycle_scenes(scenes, nowrap.unwrap_or(false))
                .await;

            Ok(())
        }
        Message::Action(Action::Dim(DimDescriptor {
            device_keys,
            group_keys,
            step,
        })) => {
            state.devices.dim(device_keys, group_keys, step).await;

            Ok(())
        }
        Message::Action(Action::Custom(CustomActionDescriptor {
            integration_id,
            payload,
        })) => {
            state
                .integrations
                .run_integration_action(integration_id, payload)
                .await
        }
        Message::Action(Action::ForceTriggerRoutine(ForceTriggerRoutineDescriptor {
            routine_id,
        })) => state.rules.force_trigger_routine(routine_id),
        Message::Action(Action::SetDeviceState(device)) => {
            state
                .devices
                .set_device_state(device, false, false, false)
                .await;

            Ok(())
        }
        Message::Action(Action::EvalExpr(expr)) => {
            let devices = state.devices.get_devices();
            let scenes = state.scenes.clone();
            let groups = state.groups.clone();
            eval_action_expr(expr, devices, scenes, groups, &state.event_tx)?;

            Ok(())
        }
    }
}
