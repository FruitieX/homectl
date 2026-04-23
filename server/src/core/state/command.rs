//! Command types for the state actor (Phase 2 of the actor-model refactor).
//!
//! Writes to `AppState` go through a single actor task that receives
//! `StateCommand`s on an mpsc channel and processes them serially. Each
//! command carries its payload and an optional `oneshot::Sender<Reply>`
//! so callers can await confirmation and receive responses.
//!
//! This module only defines the command surface. The actor loop lives in
//! [`super::actor`].

use std::future::Future;
use std::pin::Pin;

use tokio::sync::oneshot;

use super::AppState;
use crate::types::event::Event;

/// Boxed async closure that mutates `AppState` inside the actor task.
///
/// Admin handlers construct one of these, send it to the actor via
/// [`StateCommand::Mutate`], and await a oneshot for their own typed
/// result. The helper [`super::StateHandle::mutate`] hides this
/// boilerplate.
pub type MutateFn = Box<
    dyn for<'a> FnOnce(&'a mut AppState) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>>
        + Send,
>;

/// Top-level command routed to the state actor.
pub enum StateCommand {
    /// Forward an integration/user event to the actor. The actor runs the
    /// existing `handle_event` logic against its owned `AppState` and
    /// optionally notifies the sender when the mutation has completed so
    /// that the event loop can enforce ordering / emit deferred work.
    HandleEvent {
        event: Event,
        done: Option<oneshot::Sender<()>>,
    },
    /// Run an arbitrary async mutation against `AppState`. The actor
    /// publishes a fresh snapshot once the closure returns.
    Mutate(MutateFn),
}

impl std::fmt::Debug for StateCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StateCommand::HandleEvent { event, done } => f
                .debug_struct("HandleEvent")
                .field("event", event)
                .field("done", &done.is_some())
                .finish(),
            StateCommand::Mutate(_) => f.debug_tuple("Mutate").finish(),
        }
    }
}

