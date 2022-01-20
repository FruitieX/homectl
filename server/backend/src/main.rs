#[macro_use]
extern crate diesel;

#[macro_use]
extern crate lazy_static;

mod api;
mod db;
mod homectl_core;
mod integrations;
mod utils;

// use db::{actions::find_floorplans, establish_connection};
use anyhow::{Context, Result};
use api::init_api;
use async_std::{prelude::*, task};
use homectl_core::{
    devices::Devices, groups::Groups, integrations::Integrations, rules::Rules, scenes::Scenes,
    state::AppState,
};
use homectl_types::event::mk_channel;
use homectl_types::{
    action::Action,
    event::*,
    integration::IntegrationActionDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};
use std::{error::Error, sync::Arc};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();

    let (config, opaque_integrations_configs) = homectl_core::config::read_config()?;

    // println!("Using config:");
    // println!("{:#?}", config);

    let (sender, mut receiver) = mk_channel();

    let mut integrations = Integrations::new(sender.clone());
    let groups = Groups::new(config.groups.unwrap_or_default());
    let scenes = Scenes::new(config.scenes.unwrap_or_default(), groups.clone());
    let devices = Devices::new(sender.clone(), scenes.clone());
    let rules = Rules::new(config.routines.unwrap_or_default(), groups.clone(), sender.clone());

    for (id, integration_config) in &config.integrations.unwrap_or_default() {
        let opaque_integration_config: &config::Value = opaque_integrations_configs
            .get(id)
            .with_context(|| format!("Expected to find config for integration with id {}", id))?;

        integrations
            .load_integration(&integration_config.plugin, id, opaque_integration_config)
            .await?;
    }

    let _: Result<()> = {
        integrations.run_register_pass().await?;
        integrations.run_start_pass().await?;

        Ok(())
    };

    let state = AppState {
        integrations,
        groups,
        scenes,
        devices,
        rules,
        sender: sender.clone(),
        ws: Default::default(),
    };

    let state = Arc::new(state);

    init_api(&state).expect("Expected init_api to return Ok(())");

    loop {
        let msg = receiver
            .next()
            .await
            .expect("Expected sender end of channel to never be dropped");

        // println!("got msg: {:#?}", msg);

        // TODO: Need to figure out a way of not locking such large chunks of
        // state across .await points

        // let state = state.clone();

        // Maybe instead of cloning all these structs we should pass state
        // around to functions in an Arc<Mutex<>> and only lock it when
        // necessary
        let state = Arc::clone(&state);

        task::spawn(async move {
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
                    devices.set_device_state(device, *set_scene).await;

                    Ok(())
                }
                Message::SetIntegrationDeviceState { device } => {
                    let mut integrations = state.integrations.clone();
                    integrations.set_integration_device_state(device).await
                }
                Message::Action(Action::ActivateScene(SceneDescriptor {
                    scene_id,
                    skip_locked_devices,
                })) => {
                    let mut devices = state.devices.clone();
                    devices
                        .activate_scene(scene_id, skip_locked_devices.unwrap_or(false))
                        .await;

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
        });
    }
}
