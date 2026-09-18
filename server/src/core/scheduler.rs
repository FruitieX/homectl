//! Wakeup driver for the v2 timer store (P09).
//!
//! The driver owns only a rebuildable min-heap of pending wakeups and a clock
//! wait. It emits `Event::TimerWakeup` and never dispatches actions; the state
//! actor re-validates every fire against the authoritative [`TimerStore`] and
//! drops stale generations. The actor pushes the full pending set after every
//! command, so lost or duplicated wakeups cannot bypass those checks.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use crate::core::{automation::TimerWakeup, clock::Clock};
use crate::types::{
    automation_definition::TimerId,
    event::{Event, TxEventChannel},
    rule::RoutineId,
};

/// Actor-side handle used to publish the current pending wakeup set.
#[derive(Clone)]
pub struct SchedulerHandle {
    tx: watch::Sender<Vec<TimerWakeup>>,
}

impl SchedulerHandle {
    /// Spawn the driver task. The returned handle is used by the state actor;
    /// dropping every handle ends the task.
    pub fn spawn(clock: Arc<dyn Clock>, event_tx: TxEventChannel) -> Self {
        let (tx, mut rx) = watch::channel(Vec::new());
        tokio::spawn(async move {
            let mut heap: BinaryHeap<Reverse<TimerWakeup>> = BinaryHeap::new();
            let mut emitted: HashMap<(RoutineId, TimerId), u64> = HashMap::new();

            loop {
                let next_due = heap.peek().map(|Reverse(wakeup)| wakeup.due_monotonic_ms);
                let next_delay = next_due
                    .map(|due| Duration::from_millis(due.saturating_sub(clock.monotonic_ms())));

                tokio::select! {
                    changed = rx.changed() => {
                        if changed.is_err() {
                            break;
                        }
                        let pending = rx.borrow_and_update().clone();
                        emitted.retain(|key, generation| {
                            pending.iter().any(|wakeup: &TimerWakeup| {
                                key.0 == wakeup.routine_id
                                    && key.1 == wakeup.timer
                                    && wakeup.generation == *generation
                            })
                        });
                        heap = pending
                            .into_iter()
                            .filter(|wakeup| {
                                emitted
                                    .get(&(wakeup.routine_id.clone(), wakeup.timer.clone()))
                                    != Some(&wakeup.generation)
                            })
                            .map(Reverse)
                            .collect();
                    }
                    _ = async {
                        match next_delay {
                            Some(delay) => tokio::time::sleep(delay).await,
                            None => std::future::pending::<()>().await,
                        }
                    } => {
                        // The sleep was constructed for exactly this deadline, so
                        // completing it means the deadline is reached even when an
                        // injected test clock has not been advanced in lockstep.
                        let now = match next_due {
                            Some(next_due) => clock.monotonic_ms().max(next_due),
                            None => clock.monotonic_ms(),
                        };
                        while heap
                            .peek()
                            .is_some_and(|Reverse(wakeup)| wakeup.due_monotonic_ms <= now)
                        {
                            let Some(Reverse(wakeup)) = heap.pop() else {
                                break;
                            };
                            emitted.insert(
                                (wakeup.routine_id.clone(), wakeup.timer.clone()),
                                wakeup.generation,
                            );
                            event_tx.send(Event::TimerWakeup {
                                routine_id: wakeup.routine_id,
                                definition_revision: wakeup.definition_revision,
                                timer: wakeup.timer,
                                generation: wakeup.generation,
                                due_wall_ms: wakeup.due_wall_ms,
                            });
                        }
                    }
                }
            }
        });
        Self { tx }
    }

    /// Publish the current authoritative pending wakeups. The driver rebuilds
    /// its heap from this set, so this is safe to call after every command.
    pub fn update(&self, wakeups: Vec<TimerWakeup>) {
        let _ = self.tx.send(wakeups);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::clock::ManualClock;
    use crate::types::event::mk_event_channel;

    #[tokio::test(start_paused = true)]
    async fn due_wakeups_are_emitted_once_per_generation() {
        let clock = Arc::new(ManualClock::new(1_000));
        let (event_tx, mut event_rx) = mk_event_channel();
        let scheduler = SchedulerHandle::spawn(clock, event_tx);

        let wakeup = TimerWakeup {
            routine_id: crate::types::rule::RoutineId("routine".to_string()),
            definition_revision: 1,
            timer: TimerId("off".to_string()),
            generation: 7,
            due_monotonic_ms: 500,
            due_wall_ms: 2_000,
        };
        scheduler.update(vec![wakeup.clone()]);
        scheduler.update(vec![wakeup.clone()]);

        let event = event_rx.recv().await.expect("wakeup event");
        match event {
            Event::TimerWakeup {
                routine_id,
                timer,
                generation,
                ..
            } => {
                assert_eq!(routine_id.0, "routine");
                assert_eq!(timer.0, "off");
                assert_eq!(generation, 7);
            }
            other => panic!("unexpected event: {other:?}"),
        }

        scheduler.update(Vec::new());
        scheduler.update(Vec::new());
        assert!(event_rx.try_recv().is_err());
    }
}
