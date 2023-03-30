use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use serde::{Deserialize, Serialize};

use crate::scene::{SceneId, SceneConfig};

use super::{action::Action, device::Device, device::DevicesState};

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum Message {
    /// An integration has gathered information about current device state
    /// through some means (usually polling). Note that state might not actually
    /// have changed.
    IntegrationDeviceRefresh {
        device: Device,
    },

    /// Internal device state update was detected, need to take any appropriate
    /// actions.
    DeviceUpdate {
        old_state: DevicesState,
        new_state: DevicesState,
        old: Option<Device>,
        new: Device,
    },

    /// Tell devices to update internal device state.
    SetDeviceState {
        device: Device,
        set_scene: bool,
    },

    /// Tell integration to trigger state change for the device.
    SetIntegrationDeviceState {
        device: Device,
        state_changed: bool,
    },

    /// Store new scene in DB
    StoreScene {
        scene_id: SceneId,
        config: SceneConfig
    },

    EditScene {
        scene_id: SceneId,
        name: String,
    },

    DeleteScene {
        scene_id: SceneId,
    },

    Action(Action),
}

#[derive(Clone)]
pub struct Sender<T> {
    sender: UnboundedSender<T>,
}

impl<T: std::fmt::Debug> Sender<T> {
    pub fn send(&self, msg: T) {
        self.sender
            .send(msg)
            .expect("Receiver end of channel closed");
    }
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = UnboundedReceiver<Message>;

pub fn mk_channel() -> (TxEventChannel, RxEventChannel) {
    let (tx, rx) = unbounded_channel::<Message>();

    let sender = Sender { sender: tx };

    (sender, rx)
}
