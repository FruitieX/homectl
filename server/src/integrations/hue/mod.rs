use crate::homectl_core::{
    device::Device,
    integration::{Integration, IntegrationId},
    integrations_manager::SharedIntegrationsManager,
};
use async_trait::async_trait;
use std::{collections::HashMap, error::Error};

pub struct Hue {
    id: String,
    devices: Vec<Device>,
    shared_integrations_manager: SharedIntegrationsManager,
}

#[async_trait]
impl Integration for Hue {
    fn new(
        id: &IntegrationId,
        _config: &String,
        shared_integrations_manager: SharedIntegrationsManager,
    ) -> Self {
        // test that we can call methods on integrations_manager
        // {
        //     let mut integrations_manager = shared_integrations_manager.lock().unwrap();
        //     integrations_manager.load_integration(
        //         &String::from("asd"),
        //         &String::from("asd"),
        //         shared_integrations_manager.clone(),
        //     );
        // }
        Dummy {
            id: id.clone(),
            devices: Vec::new(),
            shared_integrations_manager,
        }
    }

    async fn register(&self) -> Result<(), Box<dyn Error>> {
        let resp: HashMap<String, String> =
            reqwest::get("https://httpbin.org/ip").await?.json().await?;
        println!("{:#?}", resp);
        println!("registered dummy integration");

        Ok(())
    }

    async fn start(&self) -> Result<(), Box<dyn Error>> {
        println!("started dummy integration");

        Ok(())
    }

    fn get_devices(&self) -> Vec<Device> {
        self.devices.clone()
    }
}
