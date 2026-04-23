//! State actor task (Phase 2 of the actor-model refactor).
//!
//! The actor receives [`StateCommand`]s on an mpsc channel and processes
//! them serially. Readers bypass the actor entirely via
//! [`SnapshotHandle`] (Phase 1).
//!
//! The actor owns [`AppState`] by value: it is the sole writer, so no
//! lock is needed to mutate application state. Each command runs to
//! completion before the next one is dequeued, and a fresh runtime
//! snapshot is published afterwards.

use std::sync::{
    atomic::{AtomicU64, AtomicUsize, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use color_eyre::Result;
use tokio::sync::mpsc;

use super::{
    command::StateCommand,
    metrics::{self, ActorMetrics, KIND_LABELS},
    AppState,
};
use crate::core::{event::DeferredEventWork, snapshot::SnapshotHandle};
use crate::types::event::Event;

const SLOW_EVENT_MUTATION_WARN_MS: u64 = 250;
const WATCHDOG_STUCK_WARN_MS: u64 = 5_000;
const WATCHDOG_TICK_MS: u64 = 1_000;
const METRICS_REPORT_INTERVAL_SECS: u64 = 60;

/// Environment variable. When set to a positive integer `N`, the state
/// actor aborts the process (via `std::process::abort()`) if it has been
/// processing the same command for more than `N` milliseconds. Useful
/// for production deploys under a supervisor that can restart the
/// binary on deadlock.
pub const STUCK_ABORT_ENV_VAR: &str = "HOMECTL_STATE_ACTOR_ABORT_MS";

/// Shared handle for sending commands to the state actor and reading the
/// latest runtime snapshot.
#[derive(Clone)]
pub struct StateHandle {
    pub tx: mpsc::UnboundedSender<StateCommand>,
    pub snapshot: SnapshotHandle,
    metrics: Arc<ActorMetrics>,
}

impl StateHandle {
    /// Fire-and-forget dispatch of an event to the actor. The caller does
    /// not wait for the mutation to complete.
    pub fn send_event(&self, event: Event) {
        self.metrics.on_enqueue();
        if self
            .tx
            .send(StateCommand::HandleEvent { event, done: None })
            .is_err()
        {
            self.metrics.on_dequeue();
            warn!("State actor channel closed; dropping event");
        }
    }

    /// Run an async mutation against `AppState` inside the actor task and
    /// await its typed result. The actor publishes a fresh runtime
    /// snapshot once the closure returns, regardless of the result type.
    pub async fn mutate<F, R>(&self, f: F) -> Result<R>
    where
        F: for<'a> FnOnce(
                &'a mut AppState,
            )
                -> std::pin::Pin<Box<dyn std::future::Future<Output = R> + Send + 'a>>
            + Send
            + 'static,
        R: Send + 'static,
    {
        use color_eyre::eyre::eyre;

        let (done_tx, done_rx) = tokio::sync::oneshot::channel::<R>();
        let cmd = StateCommand::Mutate(Box::new(move |state| {
            Box::pin(async move {
                let result = f(state).await;
                let _ = done_tx.send(result);
            })
        }));
        self.metrics.on_enqueue();
        self.tx.send(cmd).map_err(|_| {
            self.metrics.on_dequeue();
            eyre!("State actor channel closed")
        })?;
        done_rx
            .await
            .map_err(|_| eyre!("State actor dropped mutation without a reply"))
    }
}

/// Spawn the state actor on a tokio task and return its handle.
pub fn spawn_state_actor(
    app_state: AppState,
    snapshot: SnapshotHandle,
    deferred_work_tx: mpsc::UnboundedSender<DeferredEventWork>,
) -> StateHandle {
    let (tx, rx) = mpsc::unbounded_channel::<StateCommand>();
    let metrics = ActorMetrics::new();
    let handle = StateHandle {
        tx,
        snapshot,
        metrics: metrics.clone(),
    };

    // Watchdog: the actor updates `watchdog_start` on each command; a
    // background task warns (and optionally aborts) if processing stays
    // stalled for too long.
    let watchdog_epoch = Instant::now();
    let watchdog_start = Arc::new(AtomicU64::new(0));
    let watchdog_kind = Arc::new(AtomicUsize::new(0));
    let abort_after_ms = std::env::var(STUCK_ABORT_ENV_VAR)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0);
    spawn_watchdog(
        watchdog_epoch,
        watchdog_start.clone(),
        watchdog_kind.clone(),
        abort_after_ms,
    );

    metrics::spawn_reporter(
        metrics.clone(),
        Duration::from_secs(METRICS_REPORT_INTERVAL_SECS),
    );

    tokio::spawn(run_actor(
        app_state,
        rx,
        deferred_work_tx,
        watchdog_epoch,
        watchdog_start,
        watchdog_kind,
        metrics,
    ));
    handle
}

/// Processing loop for the state actor.
async fn run_actor(
    mut app_state: AppState,
    mut rx: mpsc::UnboundedReceiver<StateCommand>,
    deferred_work_tx: mpsc::UnboundedSender<DeferredEventWork>,
    watchdog_epoch: Instant,
    watchdog_start: Arc<AtomicU64>,
    watchdog_kind: Arc<AtomicUsize>,
    metrics: Arc<ActorMetrics>,
) -> Result<()> {
    use crate::core::event::handle_event;

    while let Some(cmd) = rx.recv().await {
        metrics.on_dequeue();
        let kind_idx = metrics::kind_index_for_command(&cmd);
        watchdog_kind.store(kind_idx, Ordering::SeqCst);
        watchdog_start.store(
            Instant::now().duration_since(watchdog_epoch).as_millis() as u64,
            Ordering::SeqCst,
        );

        let started_at = Instant::now();

        match cmd {
            StateCommand::HandleEvent { event, done } => {
                let kind = event_kind(&event);
                let outcome = handle_event(&mut app_state, &event).await;
                app_state.publish_snapshot();

                let elapsed = started_at.elapsed();
                let slow = elapsed > Duration::from_millis(SLOW_EVENT_MUTATION_WARN_MS);
                metrics.record(kind_idx, elapsed.as_millis() as u64, slow);
                if slow {
                    warn!("Slow event: elapsed={:?} kind={}", elapsed, kind);
                }

                match outcome {
                    Ok(outcome) => {
                        for work in outcome.into_deferred_work() {
                            if deferred_work_tx.send(work).is_err() {
                                warn!("Deferred event worker channel closed");
                            }
                        }
                    }
                    Err(err) => {
                        error!(
                            "Error while handling event (actor): kind={kind} err={err:#?}"
                        );
                    }
                }

                if let Some(done) = done {
                    let _ = done.send(());
                }
            }
            StateCommand::Mutate(f) => {
                f(&mut app_state).await;
                app_state.publish_snapshot();

                let elapsed = started_at.elapsed();
                let slow = elapsed > Duration::from_millis(SLOW_EVENT_MUTATION_WARN_MS);
                metrics.record(kind_idx, elapsed.as_millis() as u64, slow);
                if slow {
                    warn!("Slow mutation: elapsed={:?}", elapsed);
                }
            }
        }

        watchdog_start.store(0, Ordering::SeqCst);
    }

    Ok(())
}

fn spawn_watchdog(
    epoch: Instant,
    start: Arc<AtomicU64>,
    kind: Arc<AtomicUsize>,
    abort_after_ms: Option<u64>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(WATCHDOG_TICK_MS));
        let mut last_warned_at: u64 = 0;
        loop {
            interval.tick().await;
            let started_ms = start.load(Ordering::SeqCst);
            if started_ms == 0 {
                last_warned_at = 0;
                continue;
            }
            let now_ms = Instant::now().duration_since(epoch).as_millis() as u64;
            let running_ms = now_ms.saturating_sub(started_ms);
            if running_ms >= WATCHDOG_STUCK_WARN_MS
                && running_ms - last_warned_at >= WATCHDOG_STUCK_WARN_MS
            {
                let kind_idx = kind.load(Ordering::SeqCst);
                let kind_name = KIND_LABELS.get(kind_idx).copied().unwrap_or("?");
                warn!(
                    "State actor appears stuck: running for {}ms on kind={}",
                    running_ms, kind_name
                );
                last_warned_at = running_ms;
            }
            if let Some(limit) = abort_after_ms {
                if running_ms >= limit {
                    let kind_idx = kind.load(Ordering::SeqCst);
                    let kind_name = KIND_LABELS.get(kind_idx).copied().unwrap_or("?");
                    error!(
                        "State actor stuck for {}ms on kind={} (abort threshold {}ms exceeded, calling process::abort)",
                        running_ms, kind_name, limit
                    );
                    std::process::abort();
                }
            }
        }
    });
}

/// Compact human-readable summary of an event for log messages.
fn event_kind(event: &Event) -> &'static str {
    match event {
        Event::ExternalStateUpdate { .. } => "ExternalStateUpdate",
        Event::InternalStateUpdate { .. } => "InternalStateUpdate",
        Event::SetExternalState { .. } => "SetExternalState",
        Event::SetInternalState { .. } => "SetInternalState",
        Event::ApplyDeviceState { .. } => "ApplyDeviceState",
        Event::StartupCompleted => "StartupCompleted",
        Event::DbStoreScene { .. } => "DbStoreScene",
        Event::DbEditScene { .. } => "DbEditScene",
        Event::DbDeleteScene { .. } => "DbDeleteScene",
        Event::Action(_) => "Action",
    }
}
