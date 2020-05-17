pub mod bridge;

use crate::homectl_core::{
    device::Device,
    integration::{Integration, IntegrationId},
    integrations_manager::SharedIntegrationsManager,
};
use async_trait::async_trait;
use bridge::BridgeState;
use serde::Deserialize;
use std::{collections::HashMap, error::Error};

#[derive(Debug, Deserialize)]
pub struct HueConfig {
    addr: String,
    username: String,
}

pub struct Hue {
    id: String,
    devices: Vec<Device>,
    shared_integrations_manager: SharedIntegrationsManager,
    config: HueConfig,
}

#[async_trait]
impl Integration for Hue {
    fn new(
        id: &IntegrationId,
        config: &config::Value,
        shared_integrations_manager: SharedIntegrationsManager,
    ) -> Self {
        Hue {
            id: id.clone(),
            devices: Vec::new(),
            config: config.clone().try_into().unwrap(),
            shared_integrations_manager,
        }
    }

    async fn register(&self) -> Result<(), Box<dyn Error>> {
        let resp: BridgeState = reqwest::get(&format!(
            "http://{}/api/{}",
            self.config.addr, self.config.username
        ))
        .await?
        .json()
        .await?;
        println!("{:#?}", resp);
        println!("registered hue integration");

        Ok(())
    }

    async fn start(&self) -> Result<(), Box<dyn Error>> {
        println!("started hue integration");

        Ok(())
    }

    fn get_devices(&self) -> Vec<Device> {
        self.devices.clone()
    }
}
