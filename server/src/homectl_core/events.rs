use futures::channel::mpsc::{self, UnboundedReceiver, UnboundedSender};

use super::{
    device::Device,
    devices::DevicesState,
    integration::IntegrationActionDescriptor,
    scene::{CycleScenesDescriptor, SceneDescriptor},
};

#[derive(Clone, Debug)]
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
    SetDeviceState { device: Device, set_scene: bool },

    /// Tell integration to trigger state change for the device.
    SetIntegrationDeviceState { device: Device },

    /// Request to activate given scene.
    ActivateScene(SceneDescriptor),

    /// Request to cycle between given scenes.
    CycleScenes(CycleScenesDescriptor),

    /// Runs an integration action
    RunIntegrationAction(IntegrationActionDescriptor),
}

#[derive(Clone)]
pub struct Sender<T> {
    sender: UnboundedSender<T>,
}

impl<T> Sender<T> {
    pub fn send(&self, msg: T) {
        self.sender
            .unbounded_send(msg)
            .expect("Receiver end of channel closed");
    }
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = UnboundedReceiver<Message>;

pub fn mk_channel() -> (TxEventChannel, RxEventChannel) {
    let (tx, rx) = mpsc::unbounded::<Message>();

    let sender = Sender { sender: tx };

    (sender, rx)
}
