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

use super::state::AppState;

pub async fn handle_message(state: Arc<AppState>, msg: Message) {
    let result: Result<()> = match &msg {
        Message::RecvDeviceState { device } => {
            let mut devices = state.devices.clone();
            devices.handle_recv_device_state(device).await
        }
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
            let mut devices = state.devices.clone();
            devices
                .set_device_state(device, *set_scene, false, *skip_send)
                .await;

            Ok(())
        }
        Message::SendDeviceState { device } => {
            let mut integrations = state.integrations.clone();
            integrations.set_integration_device_state(device).await
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
            let mut devices = state.devices.clone();
            devices
                .activate_scene(scene_id, device_keys, group_keys)
                .await;

            Ok(())
        }
        Message::Action(Action::CycleScenes(CycleScenesDescriptor { scenes, nowrap })) => {
            let mut devices = state.devices.clone();
            devices.cycle_scenes(scenes, nowrap.unwrap_or(false)).await;

            Ok(())
        }
        Message::Action(Action::DimAction(DimDescriptor {
            device_keys,
            group_keys,
            step,
        })) => {
            let mut devices = state.devices.clone();
            devices.dim(device_keys, group_keys, step).await;

            Ok(())
        }
        Message::Action(Action::Custom(CustomActionDescriptor {
            integration_id,
            payload,
        })) => {
            let mut integrations = state.integrations.clone();
            integrations
                .run_integration_action(integration_id, payload)
                .await
        }
        Message::Action(Action::ForceTriggerRoutine(ForceTriggerRoutineDescriptor {
            routine_id,
        })) => {
            let rules = state.rules.clone();
            rules.force_trigger_routine(routine_id)
        }
    };

    if let Err(err) = result {
        error!(
            "Error while handling message:\n    Msg:\n    {:#?}\n\n    Err:\n    {:#?}",
            msg, err
        );
    }
}
