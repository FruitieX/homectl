use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use ts_rs::TS;

use super::scene::{SceneConfig, SceneId};

use super::{action::Action, device::Device, device::DevicesState};

#[allow(clippy::large_enum_variant)]
#[derive(TS, Clone, Debug, Deserialize, Serialize)]
#[ts(export)]
pub enum Message {
    /// An integration has informed us of current device state. We'll want to
    /// check if this matches with our internal "expected" state. If there's a
    /// mismatch, we'll try to correct it.
    RecvDeviceState { device: Device },

    /// Tell integration to trigger state change for the device.
    SendDeviceState { device: Device, state_changed: bool },

    /// Internal device state update has taken place, need to take appropriate
    /// actions such as checking (and possibly triggering) routines.
    InternalStateUpdate {
        old_state: DevicesState,
        new_state: DevicesState,
        old: Option<Device>,
        new: Device,
    },

    /// Sets internal expected state for the device.
    SetExpectedState {
        device: Device,

        /// Whether to honor the scene field in the device data or not.
        set_scene: bool,

        /// Whether to skip sending [Message::SendDeviceState] as a result of this state update.
        skip_send: bool,
    },

    /// Store new scene in DB.
    DbStoreScene {
        scene_id: SceneId,
        config: SceneConfig,
    },

    /// Edit scene in DB.
    DbEditScene { scene_id: SceneId, name: String },

    /// Delete scene from DB.
    DbDeleteScene { scene_id: SceneId },

    /// Various actions that can be triggered by rules.
    Action(Action),
}

#[derive(Clone)]
pub struct Sender<T> {
    tx: UnboundedSender<T>,
}

impl<T: std::fmt::Debug> Sender<T> {
    pub fn send(&self, msg: T) {
        self.tx.send(msg).expect("Receiver end of channel closed");
    }
}

pub type TxEventChannel = Sender<Message>;
pub type RxEventChannel = UnboundedReceiver<Message>;

pub fn mk_event_channel() -> (TxEventChannel, RxEventChannel) {
    let (tx, rx) = unbounded_channel::<Message>();

    let sender = Sender { tx };

    (sender, rx)
}
