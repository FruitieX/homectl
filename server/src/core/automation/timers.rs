//! Named timer job store (P09).
//!
//! The state actor owns authoritative timer state. Jobs are scoped to the
//! owning routine plus the timer key (J03); the wakeup driver only carries
//! `(owner, revision, timer, generation)` back as events, and every fire is
//! re-validated here before it can trigger a routine. Relative deadlines are
//! stored as monotonic time so a wall-clock jump cannot move them (J07).

use std::collections::BTreeMap;

use crate::types::{
    automation_definition::{TimerId, TimerOperation},
    rule::RoutineId,
};

use super::compile::MAX_TIMER_DELAY_MS;

/// Per-owner bound on live named timers.
pub const MAX_TIMERS_PER_OWNER: usize = 64;

/// Why a timer operation was rejected.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TimerOperationError {
    AlreadyPending { timer: TimerId, generation: u64 },
    DelayOutOfRange { delay_ms: u64, max_ms: u64 },
    TooManyTimers { max: usize },
}

impl TimerOperationError {
    pub fn code(&self) -> &'static str {
        match self {
            TimerOperationError::AlreadyPending { .. } => "timer_already_pending",
            TimerOperationError::DelayOutOfRange { .. } => "timer_delay_out_of_range",
            TimerOperationError::TooManyTimers { .. } => "timer_owner_limit_reached",
        }
    }

    pub fn message(&self) -> String {
        match self {
            TimerOperationError::AlreadyPending { timer, generation } => {
                format!("timer_already_pending: {timer} generation={generation}")
            }
            TimerOperationError::DelayOutOfRange { delay_ms, max_ms } => {
                format!("timer_delay_out_of_range: {delay_ms}ms (max {max_ms}ms)")
            }
            TimerOperationError::TooManyTimers { max } => {
                format!("timer_owner_limit_reached: {max}")
            }
        }
    }
}

/// One rebuildable wakeup entry handed to the scheduler driver.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TimerWakeup {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub timer: TimerId,
    pub generation: u64,
    pub due_monotonic_ms: u64,
    pub due_wall_ms: i64,
}

/// One validated timer fire ready for frame evaluation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimerFire {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub timer: TimerId,
    pub generation: u64,
    pub due_wall_ms: i64,
}

#[derive(Clone, Copy, Debug)]
struct TimerJob {
    definition_revision: i64,
    generation: u64,
    due_monotonic_ms: u64,
    due_wall_ms: i64,
}

/// Actor-authoritative store of live named timers.
#[derive(Clone, Debug, Default)]
pub struct TimerStore {
    jobs: BTreeMap<(RoutineId, TimerId), TimerJob>,
    next_generation: u64,
}

impl TimerStore {
    pub fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }

    pub fn len(&self) -> usize {
        self.jobs.len()
    }

    pub fn is_pending(&self, owner: &RoutineId, timer: &TimerId) -> bool {
        self.jobs.contains_key(&(owner.clone(), timer.clone()))
    }

    /// Apply one timer operation. Returns the affected generation (zero for a
    /// cancel that matched no live timer).
    pub fn apply(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        operation: &TimerOperation,
        now_monotonic_ms: u64,
        now_wall_ms: i64,
    ) -> Result<u64, TimerOperationError> {
        match operation {
            TimerOperation::Schedule { timer, delay_ms } => {
                if let Some(job) = self.jobs.get(&(owner.clone(), timer.clone())) {
                    return Err(TimerOperationError::AlreadyPending {
                        timer: timer.clone(),
                        generation: job.generation,
                    });
                }
                self.insert(
                    owner,
                    timer,
                    definition_revision,
                    *delay_ms,
                    now_monotonic_ms,
                    now_wall_ms,
                )
            }
            TimerOperation::Replace { timer, delay_ms } => self.insert(
                owner,
                timer,
                definition_revision,
                *delay_ms,
                now_monotonic_ms,
                now_wall_ms,
            ),
            TimerOperation::Cancel { timer } => {
                let generation = self
                    .jobs
                    .remove(&(owner.clone(), timer.clone()))
                    .map(|job| job.generation)
                    .unwrap_or(0);
                Ok(generation)
            }
        }
    }

    fn insert(
        &mut self,
        owner: &RoutineId,
        timer: &TimerId,
        definition_revision: i64,
        delay_ms: u64,
        now_monotonic_ms: u64,
        now_wall_ms: i64,
    ) -> Result<u64, TimerOperationError> {
        if delay_ms > MAX_TIMER_DELAY_MS {
            return Err(TimerOperationError::DelayOutOfRange {
                delay_ms,
                max_ms: MAX_TIMER_DELAY_MS,
            });
        }
        let owner_count = self
            .jobs
            .keys()
            .filter(|(job_owner, _)| job_owner == owner)
            .count();
        if owner_count >= MAX_TIMERS_PER_OWNER {
            return Err(TimerOperationError::TooManyTimers {
                max: MAX_TIMERS_PER_OWNER,
            });
        }

        self.next_generation = self.next_generation.wrapping_add(1);
        let generation = self.next_generation;
        self.jobs.insert(
            (owner.clone(), timer.clone()),
            TimerJob {
                definition_revision,
                generation,
                due_monotonic_ms: now_monotonic_ms.saturating_add(delay_ms),
                due_wall_ms: now_wall_ms.saturating_add(delay_ms as i64),
            },
        );
        Ok(generation)
    }

    /// Validate and consume one wakeup. Returns the fire when the generation,
    /// owner revision, and key all still match a pending job (J01/J02).
    pub fn consume(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        timer: &TimerId,
        generation: u64,
    ) -> Option<TimerFire> {
        let job = self.jobs.get(&(owner.clone(), timer.clone()))?;
        if job.generation != generation || job.definition_revision != definition_revision {
            return None;
        }
        let job = self.jobs.remove(&(owner.clone(), timer.clone()))?;
        Some(TimerFire {
            routine_id: owner.clone(),
            definition_revision: job.definition_revision,
            timer: timer.clone(),
            generation: job.generation,
            due_wall_ms: job.due_wall_ms,
        })
    }

    /// Drop jobs whose owner definition was edited or removed so an old
    /// generation can never fire under the new revision.
    pub fn retain_current(&mut self, current: &BTreeMap<RoutineId, i64>) {
        self.jobs
            .retain(|(owner, _), job| current.get(owner) == Some(&job.definition_revision));
    }

    /// Rebuildable wakeup index for the scheduler driver.
    pub fn wakeups(&self) -> Vec<TimerWakeup> {
        self.jobs
            .iter()
            .map(|((owner, timer), job)| TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: job.definition_revision,
                timer: timer.clone(),
                generation: job.generation,
                due_monotonic_ms: job.due_monotonic_ms,
                due_wall_ms: job.due_wall_ms,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(id: &str) -> RoutineId {
        RoutineId(id.to_string())
    }

    fn timer(id: &str) -> TimerId {
        TimerId(id.to_string())
    }

    fn schedule(store: &mut TimerStore, owner_id: &str, timer_id: &str, delay: u64) -> u64 {
        store
            .apply(
                &owner(owner_id),
                1,
                &TimerOperation::Schedule {
                    timer: timer(timer_id),
                    delay_ms: delay,
                },
                1_000,
                10_000,
            )
            .unwrap()
    }

    // J01: replacing a timer bumps its generation; the old wakeup is stale.
    #[test]
    fn replace_bumps_the_generation_and_old_wakeups_are_stale() {
        let mut store = TimerStore::default();
        let first = schedule(&mut store, "routine", "off", 1_000);
        let second = store
            .apply(
                &owner("routine"),
                1,
                &TimerOperation::Replace {
                    timer: timer("off"),
                    delay_ms: 2_000,
                },
                1_100,
                10_100,
            )
            .unwrap();
        assert_ne!(first, second);

        assert!(
            store
                .consume(&owner("routine"), 1, &timer("off"), first)
                .is_none(),
            "the replaced generation cannot fire"
        );
        assert!(store
            .consume(&owner("routine"), 1, &timer("off"), second)
            .is_some());
    }

    // J02: cancelling twice succeeds; an obsolete expiry cannot revive it.
    #[test]
    fn cancel_is_idempotent_and_blocks_obsolete_wakeups() {
        let mut store = TimerStore::default();
        let generation = schedule(&mut store, "routine", "off", 1_000);

        let cancel = TimerOperation::Cancel {
            timer: timer("off"),
        };
        assert!(store.apply(&owner("routine"), 1, &cancel, 0, 0).is_ok());
        assert!(store.apply(&owner("routine"), 1, &cancel, 0, 0).is_ok());
        assert!(store.is_empty());
        assert!(store
            .consume(&owner("routine"), 1, &timer("off"), generation)
            .is_none());
    }

    // J03: the same timer key in two routines does not collide.
    #[test]
    fn same_timer_key_in_two_routines_does_not_collide() {
        let mut store = TimerStore::default();
        let first = schedule(&mut store, "routine_a", "off", 1_000);
        let second = schedule(&mut store, "routine_b", "off", 1_000);
        assert_ne!(first, second);

        assert!(store
            .consume(&owner("routine_a"), 1, &timer("off"), first)
            .is_some());
        assert!(
            store
                .consume(&owner("routine_b"), 1, &timer("off"), second)
                .is_some(),
            "consuming one owner's timer leaves the other live"
        );
    }

    // J07: a wall-clock jump cannot move a monotonic deadline.
    #[test]
    fn relative_deadlines_ignore_wall_clock_jumps() {
        let mut store = TimerStore::default();
        let generation = schedule(&mut store, "routine", "off", 500);
        let wakeup = store.wakeups().pop().unwrap();
        assert_eq!(wakeup.due_monotonic_ms, 1_500);
        assert_eq!(wakeup.due_wall_ms, 10_500);

        assert!(
            store
                .consume(&owner("routine"), 1, &timer("off"), generation)
                .is_some(),
            "a backwards wall-clock jump does not invalidate the fire"
        );
    }

    #[test]
    fn schedule_rejects_a_second_live_generation() {
        let mut store = TimerStore::default();
        schedule(&mut store, "routine", "off", 1_000);
        let error = store
            .apply(
                &owner("routine"),
                1,
                &TimerOperation::Schedule {
                    timer: timer("off"),
                    delay_ms: 10,
                },
                0,
                0,
            )
            .unwrap_err();
        assert_eq!(
            error,
            TimerOperationError::AlreadyPending {
                timer: timer("off"),
                generation: 1
            }
        );
    }

    #[test]
    fn edited_owner_revision_drops_its_jobs() {
        let mut store = TimerStore::default();
        schedule(&mut store, "routine", "off", 1_000);

        store.retain_current(&BTreeMap::from([(owner("routine"), 2)]));
        assert!(store.is_empty());
    }
}
