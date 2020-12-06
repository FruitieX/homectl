#[macro_use]
extern crate diesel;

#[macro_use]
extern crate lazy_static;

mod db;
mod homectl_core;
mod integrations;

// use db::{actions::find_floorplans, establish_connection};
use anyhow::{Context, Result};
use homectl_core::{
    devices::Devices,
    events::*,
    groups::Groups,
    integrations::Integrations,
    rules::Rules,
    scene::{CycleScenesDescriptor, SceneDescriptor},
    scenes::Scenes,
};
use std::error::Error;

// https://github.com/actix/examples/blob/master/diesel/src/main.rs
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let (config, opaque_integrations_configs) = homectl_core::config::read_config()?;

    // println!("Using config:");
    // println!("{:#?}", config);

    let (sender, receiver) = mk_channel();

    let integrations = Integrations::new(sender.clone());
    let groups = Groups::new(config.groups);
    let scenes = Scenes::new(config.scenes, groups);
    let mut devices = Devices::new(sender.clone(), scenes);
    let rules_engine = Rules::new(config.routines, sender.clone());

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

    loop {
        let msg = receiver.recv().await?;

        // println!("got msg: {:?}", msg);

        match msg {
            Message::IntegrationDeviceRefresh { device } => {
                devices.handle_integration_device_refresh(device).await
            }
            Message::DeviceUpdate {
                old_state,
                new_state,
                old,
                new,
            } => {
                rules_engine
                    .handle_device_update(old_state, new_state, old, new)
                    .await
            }
            Message::SetDeviceState { device } => {
                devices.set_device_state(&device, false).await;
            }
            Message::SetIntegrationDeviceState { device } => {
                integrations.set_integration_device_state(device).await;
            }
            Message::ActivateScene(SceneDescriptor { scene_id }) => {
                devices.activate_scene(&scene_id).await;
            }
            Message::CycleScenes(CycleScenesDescriptor { scenes }) => {
                devices.cycle_scenes(&scenes).await;
            }
        }
    }
}
