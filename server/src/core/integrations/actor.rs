//! Per-integration actor (Phase 3 of the actor-model refactor).
//!
//! Each integration instance lives inside a dedicated tokio task that
//! owns `Box<dyn Integration>` by value. Callers send
//! [`IntegrationCmd`]s through an mpsc channel instead of acquiring a
//! mutex, which removes the last `Arc<Mutex<_>>` on a non-`Sync` trait
//! object and lets independent integrations make progress concurrently
//! (e.g. during hot-reload or event storms).

use std::{future::Future, time::Duration};

use color_eyre::{eyre::eyre, Result};
use tokio::{
    sync::{mpsc, oneshot},
    time::timeout,
};

use super::command::IntegrationCmd;
use crate::types::{
    device::Device,
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};

const LIFECYCLE_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const DATA_PLANE_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

/// Cheaply cloneable handle for talking to a per-integration actor. The
/// `module_name` and `config` fields mirror what `LoadedIntegration`
/// previously carried so `reload_config_rows` can diff desired vs.
/// current state without consulting the actor.
#[derive(Clone)]
pub struct IntegrationHandle {
    tx: mpsc::UnboundedSender<IntegrationCmd>,
    pub module_name: String,
    pub config: serde_json::Value,
}

impl IntegrationHandle {
    pub fn new(
        integration: Box<dyn Integration>,
        integration_id: IntegrationId,
        module_name: String,
        config: serde_json::Value,
    ) -> Self {
        let (tx, rx) = mpsc::unbounded_channel::<IntegrationCmd>();
        tokio::spawn(run_integration_actor(integration_id, integration, rx));
        IntegrationHandle {
            tx,
            module_name,
            config,
        }
    }

    pub async fn register(&self) -> Result<()> {
        self.lifecycle(|done| IntegrationCmd::Register { done })
            .await
    }

    pub async fn start(&self) -> Result<()> {
        self.lifecycle(|done| IntegrationCmd::Start { done }).await
    }

    pub async fn stop(&self) -> Result<()> {
        self.lifecycle(|done| IntegrationCmd::Stop { done }).await
    }

    async fn lifecycle<F>(&self, make_cmd: F) -> Result<()>
    where
        F: FnOnce(oneshot::Sender<Result<()>>) -> IntegrationCmd,
    {
        let (done_tx, done_rx) = oneshot::channel();
        self.tx
            .send(make_cmd(done_tx))
            .map_err(|_| eyre!("Integration actor channel closed"))?;
        done_rx
            .await
            .map_err(|_| eyre!("Integration actor dropped lifecycle command"))?
    }

    pub fn set_device_state(&self, device: Device) {
        if self
            .tx
            .send(IntegrationCmd::SetDeviceState {
                device: Box::new(device),
            })
            .is_err()
        {
            warn!("Integration actor channel closed; dropping SetDeviceState");
        }
    }

    pub fn run_action(&self, payload: IntegrationActionPayload) {
        if self.tx.send(IntegrationCmd::RunAction { payload }).is_err() {
            warn!("Integration actor channel closed; dropping RunAction");
        }
    }
}

async fn run_integration_actor(
    integration_id: IntegrationId,
    mut integration: Box<dyn Integration>,
    mut rx: mpsc::UnboundedReceiver<IntegrationCmd>,
) {
    while let Some(cmd) = rx.recv().await {
        match cmd {
            IntegrationCmd::Register { done } => {
                let result =
                    run_lifecycle_command(&integration_id, "register", integration.register())
                        .await;
                let _ = done.send(result);
            }
            IntegrationCmd::Start { done } => {
                let result =
                    run_lifecycle_command(&integration_id, "start", integration.start()).await;
                let _ = done.send(result);
            }
            IntegrationCmd::Stop { done } => {
                let result =
                    run_lifecycle_command(&integration_id, "stop", integration.stop()).await;
                let _ = done.send(result);
            }
            IntegrationCmd::SetDeviceState { device } => {
                run_data_plane_command(
                    &integration_id,
                    "set_integration_device_state",
                    integration.set_integration_device_state(&device),
                )
                .await;
            }
            IntegrationCmd::RunAction { payload } => {
                run_data_plane_command(
                    &integration_id,
                    "run_integration_action",
                    integration.run_integration_action(&payload),
                )
                .await;
            }
        }
    }

    debug!("Integration actor for {integration_id} exiting (channel closed)");
}

async fn run_lifecycle_command<F>(
    integration_id: &IntegrationId,
    command_name: &'static str,
    future: F,
) -> Result<()>
where
    F: Future<Output = Result<()>>,
{
    match timeout(LIFECYCLE_COMMAND_TIMEOUT, future).await {
        Ok(result) => result,
        Err(_) => Err(eyre!(
            "Integration {integration_id} {command_name} timed out after {:?}",
            LIFECYCLE_COMMAND_TIMEOUT
        )),
    }
}

async fn run_data_plane_command<F>(
    integration_id: &IntegrationId,
    command_name: &'static str,
    future: F,
) where
    F: Future<Output = Result<()>>,
{
    match timeout(DATA_PLANE_COMMAND_TIMEOUT, future).await {
        Ok(Ok(())) => {}
        Ok(Err(err)) => warn!("Integration {integration_id} {command_name} failed: {err:#}"),
        Err(_) => warn!(
            "Integration {integration_id} {command_name} timed out after {:?}",
            DATA_PLANE_COMMAND_TIMEOUT
        ),
    }
}
