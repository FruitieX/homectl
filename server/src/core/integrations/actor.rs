//! Per-integration actor (Phase 3 of the actor-model refactor).
//!
//! Each integration instance lives inside a dedicated tokio task that
//! owns `Box<dyn Integration>` by value. Callers send
//! [`IntegrationCmd`]s through an mpsc channel instead of acquiring a
//! mutex, which removes the last `Arc<Mutex<_>>` on a non-`Sync` trait
//! object and lets independent integrations make progress concurrently
//! (e.g. during hot-reload or event storms).

use tokio::sync::{mpsc, oneshot};

use super::command::IntegrationCmd;
use crate::types::{
    device::Device,
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};

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

    pub async fn register(&self) -> color_eyre::Result<()> {
        self.lifecycle(|done| IntegrationCmd::Register { done })
            .await
    }

    pub async fn start(&self) -> color_eyre::Result<()> {
        self.lifecycle(|done| IntegrationCmd::Start { done }).await
    }

    pub async fn stop(&self) -> color_eyre::Result<()> {
        self.lifecycle(|done| IntegrationCmd::Stop { done }).await
    }

    async fn lifecycle<F>(&self, make_cmd: F) -> color_eyre::Result<()>
    where
        F: FnOnce(oneshot::Sender<color_eyre::Result<()>>) -> IntegrationCmd,
    {
        use color_eyre::eyre::eyre;
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
                let _ = done.send(integration.register().await);
            }
            IntegrationCmd::Start { done } => {
                let _ = done.send(integration.start().await);
            }
            IntegrationCmd::Stop { done } => {
                let _ = done.send(integration.stop().await);
            }
            IntegrationCmd::SetDeviceState { device } => {
                if let Err(err) = integration.set_integration_device_state(&device).await {
                    warn!(
                        "Integration {integration_id} set_integration_device_state failed: {err:#}"
                    );
                }
            }
            IntegrationCmd::RunAction { payload } => {
                if let Err(err) = integration.run_integration_action(&payload).await {
                    warn!("Integration {integration_id} run_integration_action failed: {err:#}");
                }
            }
        }
    }

    debug!("Integration actor for {integration_id} exiting (channel closed)");
}
