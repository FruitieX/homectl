use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use ts_rs::TS;

use super::scene::{SceneConfig, SceneId};

use super::{action::Action, device::Device, device::DevicesState};

#[allow(clippy::large_enum_variant)]
#[derive(TS, Clone, Debug, Deserialize, Serialize)]
#[ts(export)]
pub enum Event {
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

        /// Whether to skip sending [Event::SetExternalState] as a result of this state update.
        skip_external_update: Option<bool>,
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

    /// Various actions that can be triggered by rules.
    Action(Action),
}

#[derive(Clone)]
pub struct Sender<T> {
    tx: UnboundedSender<T>,
}

impl<T: std::fmt::Debug> Sender<T> {
    pub fn send(&self, event: T) {
        self.tx.send(event).expect("Receiver end of channel closed");
    }
}

pub type TxEventChannel = Sender<Event>;
pub type RxEventChannel = UnboundedReceiver<Event>;

pub fn mk_event_channel() -> (TxEventChannel, RxEventChannel) {
    let (tx, rx) = unbounded_channel::<Event>();

    let sender = Sender { tx };

    (sender, rx)
}
