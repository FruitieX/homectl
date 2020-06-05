#![feature(try_blocks)]

#[macro_use]
extern crate diesel;

mod db;
mod homectl_core;
mod integrations;

use db::{actions::find_floorplans, establish_connection};
use homectl_core::{
    devices_manager::DevicesManager, events::*, integrations_manager::IntegrationsManager,
    rules_engine::RulesEngine,
};
use std::{
    error::Error,
    sync::{Arc, Mutex},
};

// https://github.com/actix/examples/blob/master/diesel/src/main.rs
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let (config, opaque_integrations_configs) = homectl_core::config::read_config();

    println!("Using config:");
    println!("{:#?}", config);

    let (sender, receiver) = mk_channel();

    let integrations_manager = IntegrationsManager::new(sender.clone());
    let mut devices_manager = DevicesManager::new(sender.clone());
    let rules_engine = RulesEngine::new(sender.clone());

    for (id, integration_config) in &config.integrations {
        // let integrations_manager = shared_integrations_manager.lock().unwrap();

        let opaque_integration_config: &config::Value =
            opaque_integrations_configs.get(id).unwrap();

        integrations_manager
            .load_integration(&integration_config.plugin, id, opaque_integration_config)
            .unwrap();
    }

    let connection = establish_connection();
    let results = find_floorplans(&connection);
    println!("Floorplans in DB: {:?}", results);

    let result: Result<(), ()> = {
        integrations_manager.run_register_pass().await?;
        integrations_manager.run_start_pass().await?;

        Ok(())
    };

    // TODO :)
    // find some other way to keep the main thread alive
    // thread::sleep(std::time::Duration::new(10000, 0));

    loop {
        let msg = receiver.recv()?;

        println!("got msg: {:?}", msg);

        match msg {
            Message::HandleDeviceUpdate(device) => devices_manager.handle_device_update(device),
            Message::DeviceUpdated { old, new } => rules_engine.device_updated(old, new),
            Message::SetDeviceState(device) => integrations_manager.set_device_state(device),
        }
    }
}
