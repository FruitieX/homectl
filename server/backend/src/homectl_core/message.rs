use anyhow::Result;
use std::sync::Arc;

use homectl_types::{
    action::Action,
    event::*,
    integration::IntegrationActionDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};

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
            devices.set_device_state(device, *set_scene, false).await;

            Ok(())
        }
        Message::SetIntegrationDeviceState { device } => {
            let mut integrations = state.integrations.clone();
            integrations.set_integration_device_state(device).await
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
