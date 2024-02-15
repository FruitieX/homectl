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
    ExternalStateUpdate { device: Device },

    /// Internal device state update has taken place, need to take appropriate
    /// actions such as checking (and possibly triggering) routines.
    InternalStateUpdate {
        old_state: DevicesState,
        new_state: DevicesState,
        old: Option<Device>,
        new: Device,
    },

    /// Tell integration to trigger state change for a device.
    SetExternalState { device: Device },

    /// Sets internal / "expected" state for a device.
    SetInternalState {
        device: Device,

        /// Whether to skip sending [Message::SetExternalState] as a result of this state update.
        skip_external_update: bool,
    },

    /// Wait for a bit for devices to come online before starting up.
    StartupCompleted,

    /// Store new scene in DB.
    DbStoreScene {
        scene_id: SceneId,
        config: SceneConfig,
    },

    /// Edit scene in DB.
    DbEditScene { scene_id: SceneId, name: String },

    /// Delete scene from DB.
    DbDeleteScene { scene_id: SceneId },

    /// Broadcast current state to all WS peers
    WsBroadcastState,

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
