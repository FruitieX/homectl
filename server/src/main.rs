#[macro_use]
extern crate macro_attr;

#[macro_use]
extern crate newtype_derive;

#[macro_use]
extern crate log;

#[macro_use]
extern crate eyre;

mod api;
mod core;
mod db;
mod integrations;
mod types;
mod utils;

// use db::{actions::find_floorplans, establish_connection};
use crate::core::{
    devices::Devices, groups::Groups, integrations::Integrations, message::handle_message,
    rules::Rules, scenes::Scenes, state::AppState,
};
use crate::types::event::mk_event_channel;
use api::init_api;
use color_eyre::Result;
use db::init_db;
use eyre::eyre;
use std::{error::Error, sync::Arc};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    color_eyre::install()?;
    pretty_env_logger::init();

    // Attempt connecting to Postgres
    init_db().await;

    let (config, opaque_integrations_configs) = core::config::read_config()?;

    trace!("Using config:\n    {:#?}", config);

    let (event_tx, mut event_rx) = mk_event_channel();

    let mut integrations = Integrations::new(event_tx.clone());
    let groups = Groups::new(config.groups.unwrap_or_default());
    let scenes = Scenes::new(config.scenes.unwrap_or_default(), groups.clone());
    scenes.refresh_db_scenes().await;
    let devices = Devices::new(event_tx.clone(), scenes.clone());
    let rules = Rules::new(
        config.routines.unwrap_or_default(),
        groups.clone(),
        event_tx.clone(),
    );

    for (id, integration_config) in &config.integrations.unwrap_or_default() {
        let opaque_integration_config: &config::Value = opaque_integrations_configs
            .get(id)
            .ok_or_else(|| eyre!("Expected to find config for integration with id {}", id))?;

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
        event_tx,
        ws: Default::default(),
    };

    let state = Arc::new(state);

    init_api(&state).expect("Expected init_api to return Ok(())");

    loop {
        let msg = event_rx
            .recv()
            .await
            .expect("Expected sender end of channel to never be dropped");

        let state = Arc::clone(&state);

        tokio::spawn(async move {
            handle_message(state, msg).await;
        });
    }
}
