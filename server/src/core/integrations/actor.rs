//! Per-integration actor (Phase 3 of the actor-model refactor).
//!
//! Each integration instance lives inside a dedicated tokio task that
//! owns `Box<dyn Integration>` by value. Callers send
//! [`IntegrationCmd`]s through an mpsc channel instead of acquiring a
//! mutex, which removes the last `Arc<Mutex<_>>` on a non-`Sync` trait
//! object and lets independent integrations make progress concurrently
//! (e.g. during hot-reload or event storms).

use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::{Arc, atomic::{AtomicUsize, Ordering}},
    time::Duration,
};

use color_eyre::{eyre::eyre, Result};
use tokio::{
    sync::{mpsc, oneshot},
    time::{sleep_until, timeout, Instant},
};

use super::command::IntegrationCmd;
use crate::core::snapshot::{RuntimeSnapshot, SnapshotChanges};
use crate::types::{
    device::{Device, DeviceKey},
    integration::{
        Integration, IntegrationActionPayload, IntegrationId, OutboundDeviceUpdatePolicy,
    },
};

const LIFECYCLE_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const DATA_PLANE_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const INTEGRATION_QUEUE_WARNING_LIMIT: usize = 64;

/// Cheaply cloneable handle for talking to a per-integration actor. The
/// `module_name` and `config` fields mirror what `LoadedIntegration`
/// previously carried so `reload_config_rows` can diff desired vs.
/// current state without consulting the actor.
#[derive(Clone)]
pub struct IntegrationHandle {
    tx: mpsc::UnboundedSender<IntegrationCmd>,
    pending: Arc<AtomicUsize>,
    wants_runtime_state_changes: bool,
    pub module_name: String,
    pub config: serde_json::Value,
}

impl IntegrationHandle {
    pub fn new(
        integration: Box<dyn Integration>,
        integration_id: IntegrationId,
        module_name: String,
        config: serde_json::Value,
        device_update_policy: OutboundDeviceUpdatePolicy,
    ) -> Self {
        let wants_runtime_state_changes = integration.wants_runtime_state_changes();
        let pending = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = mpsc::unbounded_channel::<IntegrationCmd>();
        tokio::spawn(run_integration_actor(
            integration_id,
            integration,
            device_update_policy,
            rx,
            pending.clone(),
        ));
        IntegrationHandle {
            tx,
            pending,
            wants_runtime_state_changes,
            module_name,
            config,
        }
    }

    pub fn wants_runtime_state_changes(&self) -> bool {
        self.wants_runtime_state_changes
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
        self.pending.fetch_add(1, Ordering::SeqCst);
        if self.tx.send(make_cmd(done_tx)).is_err() {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            return Err(eyre!("Integration actor channel closed"));
        }

        let curr = self.pending.load(Ordering::SeqCst);
        if curr >= INTEGRATION_QUEUE_WARNING_LIMIT {
            warn!(
                "Integration actor queue for {} has {curr} messages",
                self.module_name
            );
        }

        let result = done_rx
            .await
            .map_err(|_| eyre!("Integration actor dropped lifecycle command"))?;
        result
    }

    pub fn set_device_state(&self, device: Device) {
        self.pending.fetch_add(1, Ordering::SeqCst);
        if self
            .tx
            .send(IntegrationCmd::SetDeviceState {
                device: Box::new(device),
            })
            .is_err()
        {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            warn!("Integration actor channel closed; dropping SetDeviceState");
            return;
        }

        let curr = self.pending.load(Ordering::SeqCst);
        if curr >= INTEGRATION_QUEUE_WARNING_LIMIT {
            warn!(
                "Integration actor queue for {} has {curr} messages",
                self.module_name
            );
        }
    }

    pub fn run_action(&self, payload: IntegrationActionPayload) {
        self.pending.fetch_add(1, Ordering::SeqCst);
        if self.tx.send(IntegrationCmd::RunAction { payload }).is_err() {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            warn!("Integration actor channel closed; dropping RunAction");
            return;
        }

        let curr = self.pending.load(Ordering::SeqCst);
        if curr >= INTEGRATION_QUEUE_WARNING_LIMIT {
            warn!(
                "Integration actor queue for {} has {curr} messages",
                self.module_name
            );
        }
    }

    pub fn runtime_state_changed(
        &self,
        previous: RuntimeSnapshot,
        current: RuntimeSnapshot,
        changes: SnapshotChanges,
    ) {
        self.pending.fetch_add(1, Ordering::SeqCst);
        if self
            .tx
            .send(IntegrationCmd::RuntimeStateChanged {
                previous: Box::new(previous),
                current: Box::new(current),
                changes,
            })
            .is_err()
        {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            warn!("Integration actor channel closed; dropping RuntimeStateChanged");
            return;
        }

        let curr = self.pending.load(Ordering::SeqCst);
        if curr >= INTEGRATION_QUEUE_WARNING_LIMIT {
            warn!(
                "Integration actor queue for {} has {curr} messages",
                self.module_name
            );
        }
    }
}


async fn run_integration_actor(
    integration_id: IntegrationId,
    mut integration: Box<dyn Integration>,
    device_update_policy: OutboundDeviceUpdatePolicy,
    mut rx: mpsc::UnboundedReceiver<IntegrationCmd>,
    pending: Arc<AtomicUsize>,
) {
    let mut device_updates = DeviceUpdateQueue::new(device_update_policy);
    let mut registered = false;
    if let Some(min_interval) = device_updates.policy.min_interval() {
        info!(
            "Integration {integration_id} outbound device updates rate-limited to at most one every {:?}",
            min_interval
        );
    }

    loop {
        if let Some(device) = device_updates.pop_ready() {
            run_device_state_update(
                &integration_id,
                &mut integration,
                &mut device_updates,
                device,
            )
            .await;
            continue;
        }

        let cmd = if let Some(deadline) = device_updates.next_dispatch_deadline() {
            tokio::select! {
                cmd = rx.recv() => cmd,
                _ = sleep_until(deadline) => continue,
            }
        } else {
            rx.recv().await
        };

        let Some(cmd) = cmd else {
            let dropped = device_updates.clear_pending();
            if dropped > 0 {
                warn!(
                    "Integration actor channel closed; dropping {dropped} pending outbound device updates for {integration_id}"
                );
            }
            break;
        };

        // decrement the outstanding counter for this message now that
        // we've received it from the queue
        pending.fetch_sub(1, Ordering::SeqCst);

        handle_integration_command(
            &integration_id,
            &mut integration,
            &mut device_updates,
            &mut registered,
            cmd,
        )
        .await;
    }

    debug!("Integration actor for {integration_id} exiting (channel closed)");
}

struct DeviceUpdateQueue {
    policy: OutboundDeviceUpdatePolicy,
    pending_order: VecDeque<DeviceKey>,
    pending_devices: HashMap<DeviceKey, Device>,
    last_dispatch_at: Option<Instant>,
}

impl DeviceUpdateQueue {
    fn new(policy: OutboundDeviceUpdatePolicy) -> Self {
        Self {
            policy,
            pending_order: VecDeque::new(),
            pending_devices: HashMap::new(),
            last_dispatch_at: None,
        }
    }

    fn enqueue_or_ready(&mut self, device: Device) -> Option<Device> {
        if self.policy.min_interval().is_none() {
            return Some(device);
        }

        if self.pending_devices.is_empty() && self.can_dispatch_now() {
            Some(device)
        } else {
            self.enqueue(device);
            None
        }
    }

    fn pop_ready(&mut self) -> Option<Device> {
        if self.pending_devices.is_empty() || !self.can_dispatch_now() {
            return None;
        }

        while let Some(device_key) = self.pending_order.pop_front() {
            if let Some(device) = self.pending_devices.remove(&device_key) {
                return Some(device);
            }
        }

        None
    }

    fn next_dispatch_deadline(&self) -> Option<Instant> {
        if self.pending_devices.is_empty() {
            None
        } else {
            Some(self.next_allowed_dispatch_at())
        }
    }

    fn record_dispatch(&mut self) {
        if self.policy.min_interval().is_some() {
            self.last_dispatch_at = Some(Instant::now());
        }
    }

    fn clear_pending(&mut self) -> usize {
        let dropped = self.pending_devices.len();
        self.pending_devices.clear();
        self.pending_order.clear();
        dropped
    }

    fn can_dispatch_now(&self) -> bool {
        self.next_allowed_dispatch_at() <= Instant::now()
    }

    fn next_allowed_dispatch_at(&self) -> Instant {
        let Some(min_interval) = self.policy.min_interval() else {
            return Instant::now();
        };

        self.last_dispatch_at
            .map(|last_dispatch_at| last_dispatch_at + min_interval)
            .unwrap_or_else(Instant::now)
    }

    fn enqueue(&mut self, device: Device) {
        let device_key = device.get_device_key();
        let existing = self.pending_devices.insert(device_key.clone(), device);

        if existing.is_some() {
            debug!("Coalesced pending outbound device update for {device_key}");
        } else {
            self.pending_order.push_back(device_key.clone());
            debug!(
                "Queued outbound device update for {device_key}; pending={pending}",
                pending = self.pending_devices.len()
            );
        }
    }
}

async fn handle_integration_command(
    integration_id: &IntegrationId,
    integration: &mut Box<dyn Integration>,
    device_updates: &mut DeviceUpdateQueue,
    registered: &mut bool,
    cmd: IntegrationCmd,
) {
    match cmd {
        IntegrationCmd::Register { done } => {
            let result =
                run_lifecycle_command(integration_id, "register", integration.register()).await;
            if result.is_ok() {
                *registered = true;
            }
            let _ = done.send(result);
        }
        IntegrationCmd::Start { done } => {
            let result = run_lifecycle_command(integration_id, "start", integration.start()).await;
            let _ = done.send(result);
        }
        IntegrationCmd::Stop { done } => {
            let dropped = device_updates.clear_pending();
            if dropped > 0 {
                warn!(
                    "Dropping {dropped} pending outbound device updates while stopping integration {integration_id}"
                );
            }

            let result = run_lifecycle_command(integration_id, "stop", integration.stop()).await;
            if result.is_ok() {
                *registered = false;
            }
            let _ = done.send(result);
        }
        IntegrationCmd::SetDeviceState { device } => {
            if let Some(device) = device_updates.enqueue_or_ready(*device) {
                run_device_state_update(integration_id, integration, device_updates, device).await;
            }
        }
        IntegrationCmd::RunAction { payload } => {
            run_data_plane_command(
                integration_id,
                "run_integration_action",
                integration.run_integration_action(&payload),
            )
            .await;
        }
        IntegrationCmd::RuntimeStateChanged {
            previous,
            current,
            changes,
        } => {
            if !*registered {
                debug!(
                    "Ignoring runtime-state change for {integration_id} until register completes",
                );
                return;
            }

            run_data_plane_command(
                integration_id,
                "on_runtime_state_change",
                integration.on_runtime_state_change(&previous, &current, changes),
            )
            .await;
        }
    }
}

async fn run_device_state_update(
    integration_id: &IntegrationId,
    integration: &mut Box<dyn Integration>,
    device_updates: &mut DeviceUpdateQueue,
    device: Device,
) {
    run_data_plane_command(
        integration_id,
        "set_integration_device_state",
        integration.set_integration_device_state(&device),
    )
    .await;
    device_updates.record_dispatch();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::integrations::PLUGIN_MQTT;
    use crate::types::{
        color::Capabilities,
        device::{ControllableDevice, DeviceData, DeviceId, ManageKind},
    };

    fn policy(min_interval_ms: u64) -> OutboundDeviceUpdatePolicy {
        OutboundDeviceUpdatePolicy { min_interval_ms }
    }

    fn test_device(device_id: &str, power: bool) -> Device {
        Device {
            id: DeviceId::new(device_id),
            name: device_id.to_string(),
            integration_id: IntegrationId::from(PLUGIN_MQTT.to_string()),
            data: DeviceData::Controllable(ControllableDevice::new(
                None,
                power,
                None,
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            )),
            raw: None,
        }
    }

    fn device_power(device: &Device) -> bool {
        match &device.data {
            DeviceData::Controllable(controllable) => controllable.state.power,
            DeviceData::Sensor(_) => panic!("expected controllable test device"),
        }
    }

    #[test]
    fn first_rate_limited_update_is_ready_immediately() {
        let mut queue = DeviceUpdateQueue::new(policy(200));

        let ready = queue.enqueue_or_ready(test_device("lamp", true));

        assert!(ready.is_some());
        assert!(queue.pending_devices.is_empty());
    }

    #[test]
    fn rate_limited_updates_are_coalesced_by_device_with_latest_state_winning() {
        let mut queue = DeviceUpdateQueue::new(policy(200));
        assert!(queue.enqueue_or_ready(test_device("lamp", true)).is_some());
        queue.record_dispatch();

        assert!(queue.enqueue_or_ready(test_device("lamp", false)).is_none());
        assert!(queue.enqueue_or_ready(test_device("lamp", true)).is_none());
        assert_eq!(queue.pending_devices.len(), 1);

        queue.last_dispatch_at = Some(Instant::now() - Duration::from_millis(200));
        let Some(next) = queue.pop_ready() else {
            panic!("expected queued update to be ready");
        };

        assert!(device_power(&next));
        assert!(queue.pending_devices.is_empty());
    }

    #[test]
    fn updates_stay_immediate_when_rate_limit_is_disabled() {
        let mut queue = DeviceUpdateQueue::new(policy(0));

        assert!(queue.enqueue_or_ready(test_device("lamp", true)).is_some());
        queue.record_dispatch();
        assert!(queue.enqueue_or_ready(test_device("lamp", false)).is_some());
        assert!(queue.pending_devices.is_empty());
    }
}
