#![feature(try_blocks)]

#[macro_use]
extern crate diesel;

mod db;
mod homectl_core;
mod integrations;

use db::{actions::find_floorplans, establish_connection};
use homectl_core::integrations_manager::IntegrationsManager;
use std::{
    error::Error,
    sync::{Arc, Mutex},
};

// https://github.com/actix/examples/blob/master/diesel/src/main.rs
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let config = homectl_core::config::read_config();

    println!("Using config:");
    println!("{:#?}", config);

    let integrations_manager = IntegrationsManager::new();
    let shared_integrations_manager = Arc::new(Mutex::new(integrations_manager));

    for (id, module_name) in &config.integrations {
        let integrations_manager = shared_integrations_manager.lock().unwrap();
        integrations_manager
            .load_integration(module_name, id, shared_integrations_manager.clone())
            .unwrap();
    }

    let connection = establish_connection();
    let results = find_floorplans(&connection);
    println!("Floorplans in DB: {:?}", results);

    {
        let integrations_manager = shared_integrations_manager.lock().unwrap();
        integrations_manager.run_register_pass().await?;
        integrations_manager.run_start_pass().await?;

        Ok(())
    }
}
