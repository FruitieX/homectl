//! Commands dispatched to a per-integration actor task.
//!
//! Lifecycle commands (`Register`, `Start`, `Stop`) carry a oneshot
//! sender so callers can await completion and surface errors. Data-plane
//! commands (`SetDeviceState`, `RunAction`) are fire-and-forget to match
//! today's `DeferredEventWork` semantics where the state actor dispatches
//! outbound device state without awaiting.

use color_eyre::Result;
use tokio::sync::oneshot;

use crate::types::{device::Device, integration::IntegrationActionPayload};

pub enum IntegrationCmd {
    Register { done: oneshot::Sender<Result<()>> },
    Start { done: oneshot::Sender<Result<()>> },
    Stop { done: oneshot::Sender<Result<()>> },
    SetDeviceState { device: Box<Device> },
    RunAction { payload: IntegrationActionPayload },
}
