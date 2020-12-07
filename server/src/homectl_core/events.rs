use async_std::sync::{channel, Receiver, Sender};

use super::{
    device::Device,
    devices::DevicesState,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};

#[derive(Debug)]
pub enum Message {
    /// An integration has gathered information about current device state
    /// through some means (usually polling). Note that state might not actually
    /// have changed.
    IntegrationDeviceRefresh { device: Device },

    /// Internal device state update was detected, need to take any appropriate
    /// actions.
    DeviceUpdate {
        old_state: DevicesState,
        new_state: DevicesState,
        old: Option<Device>,
        new: Device,
    },

    /// Tell devices to update internal device state.
    SetDeviceState { device: Device },

    /// Tell integration to trigger state change for the device.
    SetIntegrationDeviceState { device: Device },

    /// Request to activate given scene.
    ActivateScene(SceneDescriptor),

    /// Request to cycle between given scenes.
    CycleScenes(CycleScenesDescriptor),
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = Receiver<Message>;

pub fn mk_channel() -> (TxEventChannel, RxEventChannel) {
    // NOTE: this might get full
    channel::<Message>(100)
}
