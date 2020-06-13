use super::device::Device;
use std::sync::mpsc::{channel, Receiver, Sender};

#[derive(Debug)]
pub enum Message {
    /// An integration has gathered information about current device state
    /// through some means (usually polling). Note that state might not actually
    /// have changed.
    IntegrationDeviceRefresh { device: Device },

    /// Internal device state update was detected, need to take any appropriate
    /// actions.
    DeviceUpdate { old: Option<Device>, new: Device },

    /// Tell devices_manager to update internal device state.
    SetDeviceState { device: Device },

    /// Tell integration to trigger state change for the device.
    SetIntegrationDeviceState { device: Device },
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = Receiver<Message>;

pub fn mk_channel() -> (TxEventChannel, RxEventChannel) {
    channel::<Message>()
}
