pub mod bridge;

use crate::homectl_core::{
    device::Device,
    integration::{Integration, IntegrationId},
    integrations_manager::SharedIntegrationsManager,
};
use async_trait::async_trait;
use bridge::BridgeState;
use serde::Deserialize;
use std::{collections::HashMap, error::Error, thread, time::Duration};
use tokio::time::{interval_at, Instant};

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
    bridge_state: Option<BridgeState>,
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
            bridge_state: None,
        }
    }

    async fn register(&mut self) -> Result<(), Box<dyn Error>> {
        let bridge_state: BridgeState = reqwest::get(&format!(
            "http://{}/api/{}",
            self.config.addr, self.config.username
        ))
        .await?
        .json()
        .await?;

        self.bridge_state = Some(bridge_state);

        println!("{:#?}", self.bridge_state);
        println!("registered hue integration");

        Ok(())
    }

    async fn start(&mut self) -> Result<(), Box<dyn Error>> {
        println!("started hue integration");

        let cloned = self.shared_integrations_manager.clone();

        tokio::spawn(async move { poll_sensors(cloned).await });

        Ok(())
    }
}

async fn poll_sensors(shared_integrations_manager: SharedIntegrationsManager) {
    let poll_rate = Duration::from_millis(500);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    loop {
        interval.tick().await;
        println!("would poll");
    }
}
