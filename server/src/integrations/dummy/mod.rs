use crate::homectl_core::{
    device::Device,
    integration::{Integration, IntegrationId},
    integrations_manager::SharedIntegrationsManager,
};

pub struct Dummy {
    id: String,
    devices: Vec<Device>,
    shared_integrations_manager: SharedIntegrationsManager,
}

impl Integration for Dummy {
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

    fn register(&self) {
        println!("registered dummy integration");
    }

    fn start(&self) {
        println!("started dummy integration");
    }

    fn get_devices(&self) -> Vec<Device> {
        self.devices.clone()
    }
}
