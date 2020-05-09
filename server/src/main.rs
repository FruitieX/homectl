#[macro_use]
extern crate diesel;

mod db;
mod homectl_core;
mod integrations;

use db::{actions::find_floorplans, establish_connection};
use homectl_core::integrations_manager::IntegrationsManager;

// https://github.com/actix/examples/blob/master/diesel/src/main.rs
fn main() {
    let config = homectl_core::config::read_config();

    println!("Using config:");
    println!("{:#?}", config);

    let mut integrations_manager = IntegrationsManager::new();

    for (id, module_name) in &config.integrations {
        integrations_manager.load(module_name, id).unwrap();
    }

    integrations_manager.register();

    let connection = establish_connection();
    let results = find_floorplans(&connection);
    println!("Floorplans in DB: {:?}", results)
}
