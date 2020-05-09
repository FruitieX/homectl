use crate::homectl_core::{
    device::{Device, DeviceKind, OnOffDevice},
    integration::Integration,
};

pub struct Dummy {
    id: String,
    devices: Vec<Device>,
}

impl Integration for Dummy {
    fn new(id: String) -> Self {
        Dummy {
            id,
            devices: Vec::new(),
        }
    }

    fn register(&self) {
        println!("registered dummy integration");
    }

    fn get_devices(&self) -> Vec<Device> {
        self.devices.clone()
    }
}
