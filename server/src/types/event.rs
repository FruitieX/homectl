use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use ts_rs::TS;

use super::automation_event::{EventCausation, EventId, EventOrigin};
use super::device::Device;
use super::rule::RoutineId;
use super::scene::{SceneConfig, SceneId};

use super::{action::Action, device::DeviceKey};

/// Process-unique stamp identifying the integration instance that produced an
/// event. Events from a superseded instance are rejected after reload/cutover.
pub type IntegrationEpoch = u64;

#[allow(clippy::large_enum_variant)]
#[derive(TS, Clone, Debug, Deserialize, Serialize)]
#[ts(export)]
pub enum Event {
    DeviceAvailability {
        device_key: DeviceKey,
        online: bool,
        #[ts(type = "number")]
        observed_at_ms: i64,
        /// Integration instance that observed the availability change.
        #[serde(default)]
        integration_epoch: Option<IntegrationEpoch>,
    },
    /// An integration has informed us of current device state. We'll want to
    /// check if this matches with our internal "expected" state. If there's a
    /// mismatch, we'll try to correct it.
    ExternalStateUpdate {
        device: Device,
        /// Integration instance that produced the report.
        #[serde(default)]
        integration_epoch: Option<IntegrationEpoch>,
    },

    /// Internal device state update has taken place, need to take appropriate
    /// actions such as checking (and possibly triggering) routines.
    ///
    /// Deprecated as a *producer*: mutations are collected by `Devices` and
    /// evaluated inside the actor command that performed them (P02). The
    /// variant is retained so previously queued/serialized events still decode
    /// and evaluate coherently.
    InternalStateUpdate {
        device_key: DeviceKey,
        old: Option<Device>,
        new: Device,
        /// Process-unique identity for this event. Optional for backward
        /// compatibility with older persisted/serialized events.
        #[serde(default)]
        event_id: Option<EventId>,
        /// Classification of the mutation origin.
        #[serde(default)]
        origin: Option<EventOrigin>,
        /// Causation metadata when this update was derived from a routine.
        #[serde(default)]
        causation: Option<EventCausation>,
    },

    /// Tell integration to trigger state change for a device.
    SetExternalState { device: Device },

    /// Sets internal / "expected" state for a device.
    SetInternalState {
        device: Device,

        /// Whether to skip sending [Event::SetExternalState] as a result of this state update.
        skip_external_update: Option<bool>,

        /// Whether to skip persisting the device state to DB as a result of this state update.
        skip_db_update: Option<bool>,

        /// Mutation origin. Defaults to [`EventOrigin::Derived`] when omitted.
        #[serde(default)]
        origin: Option<EventOrigin>,

        /// Causation metadata when this command was derived from a routine.
        #[serde(default)]
        causation: Option<EventCausation>,

        /// Integration instance that produced this state publication.
        #[serde(default)]
        integration_epoch: Option<IntegrationEpoch>,
    },

    /// Applies a fully resolved device state without re-evaluating scenes or
    /// creating scene overrides.
    ApplyDeviceState {
        device: Device,

        /// Whether to skip sending [Event::SetExternalState] as a result of this state update.
        skip_external_update: Option<bool>,

        /// Whether to skip persisting the device state to DB as a result of this state update.
        skip_db_update: Option<bool>,

        /// Mutation origin. Defaults to [`EventOrigin::Derived`] when omitted.
        #[serde(default)]
        origin: Option<EventOrigin>,

        /// Causation metadata when this state change was derived from a routine.
        #[serde(default)]
        causation: Option<EventCausation>,
    },

    /// A routine dispatched one of its configured actions. Distinguished from
    /// [`Event::Action`] so action provenance (root frame, causal depth) is not
    /// lost when mapping desired changes to device mutations.
    RoutineAction {
        action: Action,
        causation: EventCausation,
    },

    /// A v2 routine wrote a typed helper value (P05). Validated against the
    /// helper definition and persisted when durable.
    RoutineSetHelper {
        helper: crate::types::automation_definition::HelperId,
        value: serde_json::Value,
        causation: EventCausation,
    },

    /// A supervised worker finished a v2 script handler invocation (P07). The
    /// actor completes owner admission, plans the returned typed actions at
    /// result-acceptance time, and dispatches them through the shared path.
    RoutineScriptResult {
        routine_id: RoutineId,
        request_id: u64,
        owner_key: String,
        owner_generation: u64,
        definition_revision: i64,
        state_revision: u64,
        causation: EventCausation,
        /// Strictly serialized worker result when the invocation succeeded.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<serde_json::Value>,
        /// Bounded failure message when the worker reported an error.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Wait for a bit for devices to come online before starting up.
    StartupCompleted,

    /// Store a scene in the runtime snapshot and persist it best-effort.
    DbStoreScene {
        scene_id: SceneId,
        config: SceneConfig,
    },

    /// Edit a scene in the runtime snapshot and persist it best-effort.
    DbEditScene { scene_id: SceneId, name: String },

    /// Delete a scene from the runtime snapshot and persist it best-effort.
    DbDeleteScene { scene_id: SceneId },

    /// Various actions that can be triggered by rules.
    Action(Action),
}

impl Event {
    /// Causation stamped on the event, if any.
    pub fn causation(&self) -> Option<EventCausation> {
        match self {
            Event::InternalStateUpdate { causation, .. }
            | Event::SetInternalState { causation, .. }
            | Event::ApplyDeviceState { causation, .. } => *causation,
            Event::RoutineAction { causation, .. } => Some(*causation),
            Event::RoutineSetHelper { causation, .. } => Some(*causation),
            // Script results carry their originating frame's causation for the
            // actions they later dispatch, but the result event itself is not a
            // mutation frame: it must complete owner admission even when the
            // originating chain is already at the causal bound (the actions it
            // plans are rejected at dispatch by the same bound as native plans).
            _ => None,
        }
    }

    /// Integration instance stamp, if any.
    pub fn integration_epoch(&self) -> Option<IntegrationEpoch> {
        match self {
            Event::DeviceAvailability {
                integration_epoch, ..
            }
            | Event::ExternalStateUpdate {
                integration_epoch, ..
            }
            | Event::SetInternalState {
                integration_epoch, ..
            } => *integration_epoch,
            _ => None,
        }
    }

    /// Stamp the event with the integration instance that produced it. Events
    /// that are not integration data-plane updates are left untouched.
    pub fn stamp_integration_epoch(&mut self, epoch: IntegrationEpoch) {
        match self {
            Event::DeviceAvailability {
                integration_epoch, ..
            }
            | Event::ExternalStateUpdate {
                integration_epoch, ..
            }
            | Event::SetInternalState {
                integration_epoch, ..
            } => *integration_epoch = Some(epoch),
            _ => {}
        }
    }
}

#[derive(Clone)]
pub struct Sender<T> {
    tx: UnboundedSender<T>,
}

impl<T: std::fmt::Debug> Sender<T> {
    pub fn send(&self, event: T) {
        self.tx.send(event).expect("Receiver end of channel closed");
    }

    /// Fallible send for detached tasks that can outlive the actor (for
    /// example a supervised script worker finishing during shutdown).
    pub fn try_send(&self, event: T) -> Result<(), T> {
        self.tx.send(event).map_err(|error| error.0)
    }
}

pub type TxEventChannel = Sender<Event>;
pub type RxEventChannel = UnboundedReceiver<Event>;

pub fn mk_event_channel() -> (TxEventChannel, RxEventChannel) {
    let (tx, rx) = unbounded_channel::<Event>();

    let sender = Sender { tx };

    (sender, rx)
}
