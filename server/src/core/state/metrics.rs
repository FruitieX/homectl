//! Per-command metrics for the state actor.
//!
//! The actor increments these counters on every command. A background
//! task periodically logs the accumulated counters and resets them so
//! the log line shows the rate over the last reporting window.
//!
//! Queue depth is tracked via an `AtomicUsize` that senders increment
//! before dispatching and the actor decrements when it dequeues. This
//! avoids needing `mpsc::UnboundedReceiver::len` (unstable on stable
//! tokio) and keeps the send path lock-free.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::command::StateCommand;

/// Labels for each actor command kind. The index into this array is
/// stored in atomic counters so we can avoid hashmap overhead on the
/// hot path.
pub const KIND_LABELS: &[&str] = &[
    "HandleEvent:ExternalStateUpdate",
    "HandleEvent:InternalStateUpdate",
    "HandleEvent:SetExternalState",
    "HandleEvent:SetInternalState",
    "HandleEvent:ApplyDeviceState",
    "HandleEvent:StartupCompleted",
    "HandleEvent:DbStoreScene",
    "HandleEvent:DbEditScene",
    "HandleEvent:DbDeleteScene",
    "HandleEvent:Action",
    "Mutate",
];

pub const KIND_MUTATE: usize = 10;

/// Aggregated counters for the state actor. One entry per
/// [`KIND_LABELS`] slot.
pub struct ActorMetrics {
    pub count: Vec<AtomicU64>,
    pub total_ms: Vec<AtomicU64>,
    pub slow_count: Vec<AtomicU64>,
    pub max_ms: Vec<AtomicU64>,
    /// Current channel depth. Senders increment, the actor decrements.
    pub queue_depth: AtomicUsize,
    /// Peak channel depth observed since the last report.
    pub peak_depth: AtomicUsize,
}

impl ActorMetrics {
    pub fn new() -> Arc<Self> {
        let n = KIND_LABELS.len();
        Arc::new(Self {
            count: (0..n).map(|_| AtomicU64::new(0)).collect(),
            total_ms: (0..n).map(|_| AtomicU64::new(0)).collect(),
            slow_count: (0..n).map(|_| AtomicU64::new(0)).collect(),
            max_ms: (0..n).map(|_| AtomicU64::new(0)).collect(),
            queue_depth: AtomicUsize::new(0),
            peak_depth: AtomicUsize::new(0),
        })
    }

    /// Called by senders before enqueuing a command. Updates the peak
    /// watermark.
    pub fn on_enqueue(&self) {
        let depth = self.queue_depth.fetch_add(1, Ordering::Relaxed) + 1;
        let mut current = self.peak_depth.load(Ordering::Relaxed);
        while depth > current {
            match self.peak_depth.compare_exchange_weak(
                current,
                depth,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(observed) => current = observed,
            }
        }
    }

    /// Called by the actor after dequeuing a command.
    pub fn on_dequeue(&self) {
        self.queue_depth.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn record(&self, kind_idx: usize, elapsed_ms: u64, slow: bool) {
        self.count[kind_idx].fetch_add(1, Ordering::Relaxed);
        self.total_ms[kind_idx].fetch_add(elapsed_ms, Ordering::Relaxed);
        if slow {
            self.slow_count[kind_idx].fetch_add(1, Ordering::Relaxed);
        }
        let mut current = self.max_ms[kind_idx].load(Ordering::Relaxed);
        while elapsed_ms > current {
            match self.max_ms[kind_idx].compare_exchange_weak(
                current,
                elapsed_ms,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(observed) => current = observed,
            }
        }
    }
}

/// Spawn a periodic reporter that logs the per-kind counters at
/// `interval` and resets them.
pub fn spawn_reporter(metrics: Arc<ActorMetrics>, interval: Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // Skip the first immediate tick.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let peak_depth = metrics.peak_depth.swap(0, Ordering::Relaxed);
            let current_depth = metrics.queue_depth.load(Ordering::Relaxed);

            let mut lines: Vec<String> = Vec::new();
            for (idx, label) in KIND_LABELS.iter().enumerate() {
                let count = metrics.count[idx].swap(0, Ordering::Relaxed);
                if count == 0 {
                    metrics.total_ms[idx].store(0, Ordering::Relaxed);
                    metrics.slow_count[idx].store(0, Ordering::Relaxed);
                    metrics.max_ms[idx].store(0, Ordering::Relaxed);
                    continue;
                }
                let total_ms = metrics.total_ms[idx].swap(0, Ordering::Relaxed);
                let slow = metrics.slow_count[idx].swap(0, Ordering::Relaxed);
                let max_ms = metrics.max_ms[idx].swap(0, Ordering::Relaxed);
                let avg_ms = total_ms as f64 / count as f64;
                lines.push(format!(
                    "{label}: count={count} avg_ms={avg_ms:.1} max_ms={max_ms} slow={slow}"
                ));
            }

            if lines.is_empty() && peak_depth == 0 && current_depth == 0 {
                continue;
            }

            debug!(
                "state actor metrics (window={:?}, queue: current={current_depth} peak={peak_depth}): {}",
                interval,
                lines.join(" | ")
            );
        }
    });
}

/// Map a [`StateCommand`] variant to a metrics kind index.
pub fn kind_index_for_command(cmd: &StateCommand) -> usize {
    match cmd {
        StateCommand::HandleEvent { event, .. } => event_kind_index(event),
        StateCommand::Mutate(_) => KIND_MUTATE,
    }
}

fn event_kind_index(event: &crate::types::event::Event) -> usize {
    use crate::types::event::Event;
    match event {
        Event::ExternalStateUpdate { .. } => 0,
        Event::InternalStateUpdate { .. } => 1,
        Event::SetExternalState { .. } => 2,
        Event::SetInternalState { .. } => 3,
        Event::ApplyDeviceState { .. } => 4,
        Event::StartupCompleted => 5,
        Event::DbStoreScene { .. } => 6,
        Event::DbEditScene { .. } => 7,
        Event::DbDeleteScene { .. } => 8,
        Event::Action(_) => 9,
    }
}
