use async_trait::async_trait;
// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use super::{device::Device, events::TxEventChannel};
use std::error::Error;

pub type IntegrationId = String;

#[async_trait]
pub trait Integration {
    // rustc --explain E0038
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Self
    where
        Self: Sized;

    async fn register(&mut self) -> Result<(), Box<dyn Error>>;
    async fn start(&mut self) -> Result<(), Box<dyn Error>>;
    fn set_device_state(&mut self, device: Device);
}
