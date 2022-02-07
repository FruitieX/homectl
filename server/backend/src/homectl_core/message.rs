use anyhow::Result;
use std::sync::Arc;

use homectl_types::{
    action::Action,
    event::*,
    integration::IntegrationActionDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};

use crate::db::actions::{db_delete_scene, db_store_scene};

use super::state::AppState;

pub async fn handle_message(state: Arc<AppState>, msg: Message) {
    let result: Result<()> = match &msg {
        Message::IntegrationDeviceRefresh { device } => {
            let mut devices = state.devices.clone();
            devices.handle_integration_device_refresh(device).await;

            Ok(())
        }
        Message::DeviceUpdate {
            old_state,
            new_state,
            old,
            new,
        } => {
            state
                .rules
                .handle_device_update(old_state, new_state, old, new)
                .await;

            Ok(())
        }
        Message::SetDeviceState { device, set_scene } => {
            let mut devices = state.devices.clone();
            devices
                .set_device_state(device, *set_scene, false, false)
                .await;

            Ok(())
        }
        Message::SetIntegrationDeviceState {
            device,
            state_changed,
        } => {
            let mut integrations = state.integrations.clone();
            let res = integrations.set_integration_device_state(device).await;

            // Only send state update to WS peers if state actually changed
            if *state_changed {
                state.send_state_ws(None).await;
            }

            res
        }
        Message::StoreScene { scene_id, config } => {
            db_store_scene(scene_id, config).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;

            Ok(())
        }
        Message::DeleteScene { scene_id } => {
            db_delete_scene(scene_id).await.ok();
            state.scenes.refresh_db_scenes().await;
            state.send_state_ws(None).await;

            Ok(())
        }
        Message::Action(Action::ActivateScene(SceneDescriptor { scene_id })) => {
            let mut devices = state.devices.clone();
            devices.activate_scene(scene_id).await;

            Ok(())
        }
        Message::Action(Action::CycleScenes(CycleScenesDescriptor { scenes })) => {
            let mut devices = state.devices.clone();
            devices.cycle_scenes(scenes).await;

            Ok(())
        }
        Message::Action(Action::IntegrationAction(IntegrationActionDescriptor {
            integration_id,
            payload,
        })) => {
            let mut integrations = state.integrations.clone();
            integrations
                .run_integration_action(integration_id, payload)
                .await
        }
    };

    if let Err(err) = result {
        println!("Error while handling message:");
        println!("Msg: {:#?}", msg);
        println!("Error: {:#?}", err);
    }
}
