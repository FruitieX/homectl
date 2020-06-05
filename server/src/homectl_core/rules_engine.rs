use super::{device::Device, events::TxEventChannel};

pub struct RulesEngine {
    sender: TxEventChannel,
}

impl RulesEngine {
    pub fn new(sender: TxEventChannel) -> Self {
        RulesEngine { sender }
    }

    pub fn device_updated(&self, old: Option<Device>, new: Device) {
        println!("device_updated {:?} (was: {:?})", new, old);
    }
}
