mod api;
mod db;
mod homectl_core;
mod integrations;
mod utils;

// use db::{actions::find_floorplans, establish_connection};
use anyhow::{Context, Result};
use api::init_api;
use async_std::{prelude::*, task};
use db::init_db;
use homectl_core::{
    devices::Devices, groups::Groups, integrations::Integrations, message::handle_message,
    rules::Rules, scenes::Scenes, state::AppState,
};
use homectl_types::event::mk_channel;
use std::{error::Error, sync::Arc};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();

    // Attempt connecting to Postgres
    init_db().await;

    let (config, opaque_integrations_configs) = homectl_core::config::read_config()?;

    // println!("Using config:");
    // println!("{:#?}", config);

    let (sender, mut receiver) = mk_channel();

    let mut integrations = Integrations::new(sender.clone());
    let groups = Groups::new(config.groups.unwrap_or_default());
    let scenes = Scenes::new(config.scenes.unwrap_or_default(), groups.clone());
    let devices = Devices::new(sender.clone(), scenes.clone());
    let rules = Rules::new(
        config.routines.unwrap_or_default(),
        groups.clone(),
        sender.clone(),
    );

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

        let state = Arc::clone(&state);

        task::spawn(async move {
            handle_message(state, msg).await;
        });
    }
}
