use super::device::Device;
use std::sync::mpsc::{channel, Receiver, Sender};

#[derive(Debug)]
pub enum Message {
    /// Information about current device state was gathered (usually through
    /// polling), need to determine whether values have actually changed or not
    HandleDeviceUpdate(Device),

    /// Device values have changed, need to take any appropriate actions
    DeviceUpdated { old: Option<Device>, new: Device },

    /// Triggers state update for physical device
    SetDeviceState(Device),
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = Receiver<Message>;

pub fn mk_channel() -> (TxEventChannel, RxEventChannel) {
    channel::<Message>()
}
