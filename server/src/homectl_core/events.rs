use super::device::Device;
use std::sync::mpsc::{channel, Receiver, Sender};

#[derive(Debug)]
pub enum Message {
    /// Information about current device state was gathered (usually through
    /// polling), need to determine whether values have actually changed or not
    DeviceRefresh { device: Device },

    /// Device values have changed, need to take any appropriate actions
    DeviceUpdate { old: Option<Device>, new: Device },

    /// Triggers state change for device
    SetDeviceState { device: Device },
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = Receiver<Message>;

pub fn mk_channel() -> (TxEventChannel, RxEventChannel) {
    channel::<Message>()
}
