#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
extern crate diesel;

#[macro_use]
extern crate lazy_static;

mod db;
mod homectl_core;
mod integrations;
mod utils;

// use db::{actions::find_floorplans, establish_connection};
use anyhow::{Context, Result};
use async_std::{prelude::*, task};
use homectl_core::{
    device::Device,
    devices::Devices,
    events::*,
    groups::Groups,
    integration::IntegrationActionDescriptor,
    integrations::Integrations,
    rules::Rules,
    scene::{CycleScenesDescriptor, SceneDescriptor},
    scenes::Scenes,
};
use std::{error::Error, sync::Arc};

#[derive(Clone)]
struct AppState {
    integrations: Integrations,
    groups: Groups,
    scenes: Scenes,
    devices: Devices,
    rules: Rules,
}

#[macro_use]
extern crate rocket;
use rocket::State;
use rocket_contrib::json::Json;

#[derive(serde::Serialize)]
struct DevicesResponse {
    devices: Vec<Device>,
}

#[get("/devices")]
fn hello(state: State<Arc<AppState>>) -> Json<DevicesResponse> {
    let devices = state.devices.get_devices();
    let response = DevicesResponse {
        devices: devices.values().cloned().collect(),
    };
    Json(response)
}

#[async_std::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let (config, opaque_integrations_configs) = homectl_core::config::read_config()?;

    // println!("Using config:");
    // println!("{:#?}", config);

    let (sender, mut receiver) = mk_channel();

    let mut integrations = Integrations::new(sender.clone());
    let groups = Groups::new(config.groups);
    let scenes = Scenes::new(config.scenes, groups.clone());
    let devices = Devices::new(sender.clone(), scenes.clone());
    let rules = Rules::new(config.routines, sender.clone());

    for (id, integration_config) in &config.integrations {
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
    };

    let state = Arc::new(state);

    {
        let state = Arc::clone(&state);

        task::spawn(async move {
            rocket::ignite()
                .manage(state)
                .mount("/", routes![hello])
                .launch();
        });
    }

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
                    devices.set_device_state(&device, *set_scene).await;

                    Ok(())
                }
                Message::SetIntegrationDeviceState { device } => {
                    let mut integrations = state.integrations.clone();
                    integrations.set_integration_device_state(&device).await
                }
                Message::ActivateScene(SceneDescriptor {
                    scene_id,
                    skip_locked_devices,
                }) => {
                    let mut devices = state.devices.clone();
                    devices
                        .activate_scene(&scene_id, skip_locked_devices.unwrap_or(false))
                        .await;

                    Ok(())
                }
                Message::CycleScenes(CycleScenesDescriptor { scenes }) => {
                    let mut devices = state.devices.clone();
                    devices.cycle_scenes(&scenes).await;

                    Ok(())
                }
                Message::RunIntegrationAction(IntegrationActionDescriptor {
                    integration_id,
                    payload,
                }) => {
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
