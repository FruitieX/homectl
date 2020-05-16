use async_trait::async_trait;
// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use super::{
    device::{Device, DeviceKind},
    integrations_manager::SharedIntegrationsManager,
};
use std::error::Error;

pub type IntegrationId = String;

#[async_trait]
pub trait Integration {
    // rustc --explain E0038
    fn new(
        id: &IntegrationId,
        config: &config::Value,
        integrations_manager: SharedIntegrationsManager,
    ) -> Self
    where
        Self: Sized;

    async fn register(&self) -> Result<(), Box<dyn Error>>;
    async fn start(&self) -> Result<(), Box<dyn Error>>;

    fn get_devices(&self) -> Vec<Device<DeviceKind>> {
        Vec::new()
    }
}
