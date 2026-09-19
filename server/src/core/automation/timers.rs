//! Named timer job store (P09).
//!
//! The state actor owns authoritative timer state. Jobs are scoped to the
//! owning routine plus the timer key (J03); the wakeup driver only carries
//! `(owner, revision, timer, generation)` back as events, and every fire is
//! re-validated here before it can trigger a routine. Relative deadlines are
//! stored as monotonic time so a wall-clock jump cannot move them (J07).

use std::collections::BTreeMap;

use crate::types::{
    automation_definition::{NodeId, TimerId, TimerIntentTarget, TimerOperation},
    event::TimerWakeupJob,
    rule::RoutineId,
};

use super::compile::MAX_TIMER_DELAY_MS;

/// Per-owner bound on live named timers.
pub const MAX_TIMERS_PER_OWNER: usize = 64;

/// Intent tokens frozen for one scheduled timer generation (J08).
pub type TimerIntentTokens = Vec<(TimerIntentTarget, u64)>;

/// One frozen capture riding a timer generation: what the scheduling step
/// asked to guard, the group membership resolved at plan time (J09), and the
/// tokens recorded at acceptance (J08).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapturedTimerIntents {
    pub capture: crate::types::automation_definition::TimerIntentCapture,
    pub tokens: TimerIntentTokens,
}

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
    pub job: TimerWakeupJob,
    pub generation: u64,
    pub due_monotonic_ms: u64,
    pub due_wall_ms: i64,
}

/// Outcome of an actor-routed timer cancellation (P09 admin control).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TimerCancellation {
    /// The timer was live and has been removed.
    Cancelled { generation: u64 },
    /// No live timer occupies the owner/key, or the owner was removed.
    NoOp,
    /// The caller expected a different live generation; nothing was removed.
    GenerationMismatch { current: u64, expected: u64 },
}

/// One validated timer fire ready for frame evaluation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimerFire {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub timer: TimerId,
    pub generation: u64,
    pub due_wall_ms: i64,
    /// Intent tokens frozen when this generation was scheduled (J08). The
    /// expiry plan guards captured targets with these instead of live
    /// revisions, so a newer manual intent suppresses the delayed action.
    pub captured: Option<CapturedTimerIntents>,
}

/// One validated sustained-predicate maturity ready for frame evaluation. The
/// predicate itself is re-evaluated against current state at expiry (J05);
/// this only proves the deadline and generation were current.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PredicateDeadlineFire {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub trigger: NodeId,
    pub generation: u64,
    pub due_wall_ms: i64,
}

/// One validated schedule occurrence ready for frame evaluation (K). The
/// occurrence instant is authoritative; evaluation only matches it to the
/// trigger and the actor rearms from the current time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduleOccurrenceFire {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub trigger: NodeId,
    pub generation: u64,
    pub due_wall_ms: i64,
}

#[derive(Clone, Debug)]
struct TimerJob {
    definition_revision: i64,
    generation: u64,
    due_monotonic_ms: u64,
    due_wall_ms: i64,
    captured: Option<CapturedTimerIntents>,
}

fn named_job(timer: &TimerId) -> TimerWakeupJob {
    TimerWakeupJob::NamedTimer {
        timer: timer.clone(),
    }
}

fn predicate_job(trigger: &NodeId) -> TimerWakeupJob {
    TimerWakeupJob::PredicateDeadline {
        trigger: trigger.clone(),
    }
}

fn schedule_job(trigger: &NodeId) -> TimerWakeupJob {
    TimerWakeupJob::ScheduleOccurrence {
        trigger: trigger.clone(),
    }
}

/// Actor-authoritative store of live timer jobs (named timers and
/// sustained-predicate deadlines share the wakeup pipeline with distinct job
/// kinds).
#[derive(Clone, Debug, Default)]
pub struct TimerStore {
    jobs: BTreeMap<(RoutineId, TimerWakeupJob), TimerJob>,
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
        self.jobs.contains_key(&(owner.clone(), named_job(timer)))
    }

    /// Current generation of a live owner/key, if any.
    pub fn pending_generation(&self, owner: &RoutineId, timer: &TimerId) -> Option<u64> {
        self.jobs
            .get(&(owner.clone(), named_job(timer)))
            .map(|job| job.generation)
    }

    /// Actor-routed administrative cancellation with optional generation
    /// checking. Missing timers are a `NoOp` (idempotent cancellation).
    pub fn cancel_checked(
        &mut self,
        owner: &RoutineId,
        timer: &TimerId,
        expected_generation: Option<u64>,
    ) -> TimerCancellation {
        match self.pending_generation(owner, timer) {
            Some(current) => match expected_generation {
                Some(expected) if expected != current => {
                    TimerCancellation::GenerationMismatch { current, expected }
                }
                _ => {
                    self.jobs.remove(&(owner.clone(), named_job(timer)));
                    TimerCancellation::Cancelled {
                        generation: current,
                    }
                }
            },
            None => TimerCancellation::NoOp,
        }
    }

    /// Current generation of a live sustained-predicate deadline, if any.
    pub fn pending_predicate_generation(&self, owner: &RoutineId, trigger: &NodeId) -> Option<u64> {
        self.jobs
            .get(&(owner.clone(), predicate_job(trigger)))
            .map(|job| job.generation)
    }

    /// Idempotently arm a sustained-predicate deadline: a live deadline for
    /// the same owner revision is kept (no generation churn), otherwise a new
    /// episode generation starts at `now` (J06 arming contract).
    pub fn ensure_predicate(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        trigger: &NodeId,
        delay_ms: u64,
        now_monotonic_ms: u64,
        now_wall_ms: i64,
    ) -> Result<u64, TimerOperationError> {
        let key = (owner.clone(), predicate_job(trigger));
        if let Some(job) = self.jobs.get(&key) {
            if job.definition_revision == definition_revision {
                return Ok(job.generation);
            }
            self.jobs.remove(&key);
        }
        self.insert(
            owner,
            predicate_job(trigger),
            definition_revision,
            delay_ms,
            None,
            now_monotonic_ms,
            now_wall_ms,
        )
    }

    /// Cancel a live sustained-predicate deadline. Returns its generation, or
    /// zero when nothing was live (idempotent).
    pub fn cancel_predicate(&mut self, owner: &RoutineId, trigger: &NodeId) -> u64 {
        self.jobs
            .remove(&(owner.clone(), predicate_job(trigger)))
            .map(|job| job.generation)
            .unwrap_or(0)
    }

    /// Validate and consume one predicate wakeup (revision + generation), so a
    /// deadline that was canceled, replaced, or edited never matures.
    pub fn consume_predicate(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        trigger: &NodeId,
        generation: u64,
    ) -> Option<PredicateDeadlineFire> {
        let key = (owner.clone(), predicate_job(trigger));
        let job = self.jobs.get(&key)?;
        if job.generation != generation || job.definition_revision != definition_revision {
            return None;
        }
        let job = self.jobs.remove(&key)?;
        Some(PredicateDeadlineFire {
            routine_id: owner.clone(),
            definition_revision: job.definition_revision,
            trigger: trigger.clone(),
            generation: job.generation,
            due_wall_ms: job.due_wall_ms,
        })
    }

    /// Current generation of a live schedule occurrence, if any.
    pub fn pending_schedule_generation(&self, owner: &RoutineId, trigger: &NodeId) -> Option<u64> {
        self.jobs
            .get(&(owner.clone(), schedule_job(trigger)))
            .map(|job| job.generation)
    }

    /// Idempotently arm a schedule occurrence: a live occurrence for the same
    /// owner revision is kept (no generation churn), otherwise `due` is
    /// inserted as given. Calendar occurrences may legitimately exceed the
    /// named-timer delay bound (K).
    pub fn ensure_schedule(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        trigger: &NodeId,
        due_monotonic_ms: u64,
        due_wall_ms: i64,
    ) -> Result<u64, TimerOperationError> {
        let key = (owner.clone(), schedule_job(trigger));
        if let Some(job) = self.jobs.get(&key) {
            if job.definition_revision == definition_revision {
                return Ok(job.generation);
            }
            self.jobs.remove(&key);
        }
        self.insert_job(
            owner,
            schedule_job(trigger),
            definition_revision,
            due_monotonic_ms,
            due_wall_ms,
            None,
        )
    }

    /// Cancel a live schedule occurrence. Returns its generation, or zero when
    /// nothing was live (idempotent).
    pub fn cancel_schedule(&mut self, owner: &RoutineId, trigger: &NodeId) -> u64 {
        self.jobs
            .remove(&(owner.clone(), schedule_job(trigger)))
            .map(|job| job.generation)
            .unwrap_or(0)
    }

    /// Validate and consume one schedule wakeup (revision + generation), so a
    /// replaced or edited schedule never fires a stale occurrence.
    pub fn consume_schedule(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        trigger: &NodeId,
        generation: u64,
    ) -> Option<ScheduleOccurrenceFire> {
        let key = (owner.clone(), schedule_job(trigger));
        let job = self.jobs.get(&key)?;
        if job.generation != generation || job.definition_revision != definition_revision {
            return None;
        }
        let job = self.jobs.remove(&key)?;
        Some(ScheduleOccurrenceFire {
            routine_id: owner.clone(),
            definition_revision: job.definition_revision,
            trigger: trigger.clone(),
            generation: job.generation,
            due_wall_ms: job.due_wall_ms,
        })
    }

    /// Apply one timer operation. Returns the affected generation (zero for a
    /// cancel that matched no live timer).
    pub fn apply(
        &mut self,
        owner: &RoutineId,
        definition_revision: i64,
        operation: &TimerOperation,
        captured: Option<CapturedTimerIntents>,
        now_monotonic_ms: u64,
        now_wall_ms: i64,
    ) -> Result<u64, TimerOperationError> {
        match operation {
            TimerOperation::Schedule { timer, delay_ms } => {
                if let Some(job) = self.jobs.get(&(owner.clone(), named_job(timer))) {
                    return Err(TimerOperationError::AlreadyPending {
                        timer: timer.clone(),
                        generation: job.generation,
                    });
                }
                self.insert(
                    owner,
                    named_job(timer),
                    definition_revision,
                    *delay_ms,
                    captured,
                    now_monotonic_ms,
                    now_wall_ms,
                )
            }
            TimerOperation::Replace { timer, delay_ms } => self.insert(
                owner,
                named_job(timer),
                definition_revision,
                *delay_ms,
                captured,
                now_monotonic_ms,
                now_wall_ms,
            ),
            TimerOperation::Cancel { timer } => {
                let generation = self
                    .jobs
                    .remove(&(owner.clone(), named_job(timer)))
                    .map(|job| job.generation)
                    .unwrap_or(0);
                Ok(generation)
            }
        }
    }

    fn insert(
        &mut self,
        owner: &RoutineId,
        job: TimerWakeupJob,
        definition_revision: i64,
        delay_ms: u64,
        captured: Option<CapturedTimerIntents>,
        now_monotonic_ms: u64,
        now_wall_ms: i64,
    ) -> Result<u64, TimerOperationError> {
        if delay_ms > MAX_TIMER_DELAY_MS {
            return Err(TimerOperationError::DelayOutOfRange {
                delay_ms,
                max_ms: MAX_TIMER_DELAY_MS,
            });
        }
        self.insert_job(
            owner,
            job,
            definition_revision,
            now_monotonic_ms.saturating_add(delay_ms),
            now_wall_ms.saturating_add(delay_ms as i64),
            captured,
        )
    }

    fn insert_job(
        &mut self,
        owner: &RoutineId,
        job: TimerWakeupJob,
        definition_revision: i64,
        due_monotonic_ms: u64,
        due_wall_ms: i64,
        captured: Option<CapturedTimerIntents>,
    ) -> Result<u64, TimerOperationError> {
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
            (owner.clone(), job),
            TimerJob {
                definition_revision,
                generation,
                due_monotonic_ms,
                due_wall_ms,
                captured,
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
        let job = self.jobs.get(&(owner.clone(), named_job(timer)))?;
        if job.generation != generation || job.definition_revision != definition_revision {
            return None;
        }
        let job = self.jobs.remove(&(owner.clone(), named_job(timer)))?;
        Some(TimerFire {
            routine_id: owner.clone(),
            definition_revision: job.definition_revision,
            timer: timer.clone(),
            generation: job.generation,
            due_wall_ms: job.due_wall_ms,
            captured: job.captured,
        })
    }

    /// Drop jobs whose owner definition was edited or removed so an old
    /// generation can never fire under the new revision.
    pub fn retain_current(&mut self, current: &BTreeMap<RoutineId, i64>) {
        self.jobs
            .retain(|(owner, _), job| current.get(owner) == Some(&job.definition_revision));
    }

    /// Read-only runtime projection for the published snapshot (P09).
    pub fn runtime_statuses(
        &self,
        now_monotonic_ms: u64,
    ) -> Vec<crate::types::timer_status::TimerRuntimeStatus> {
        use crate::types::timer_status::{TimerJobStatus, TimerPersistence, TimerRuntimeStatus};

        self.jobs
            .iter()
            .filter_map(|((owner, job_ref), job)| match job_ref {
                TimerWakeupJob::NamedTimer { timer } => Some(TimerRuntimeStatus {
                    routine_id: owner.clone(),
                    definition_revision: job.definition_revision,
                    timer: timer.clone(),
                    generation: job.generation,
                    status: TimerJobStatus::Pending,
                    due_wall_ms: job.due_wall_ms,
                    remaining_ms: job.due_monotonic_ms.saturating_sub(now_monotonic_ms),
                    persistence: TimerPersistence::Session,
                }),
                TimerWakeupJob::PredicateDeadline { .. } => None,
                TimerWakeupJob::ScheduleOccurrence { .. } => None,
            })
            .collect()
    }

    /// Rebuildable wakeup index for the scheduler driver.
    pub fn wakeups(&self) -> Vec<TimerWakeup> {
        self.jobs
            .iter()
            .map(|((owner, job_ref), job)| TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: job.definition_revision,
                job: job_ref.clone(),
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
                None,
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
                None,
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
        assert!(store
            .apply(&owner("routine"), 1, &cancel, None, 0, 0)
            .is_ok());
        assert!(store
            .apply(&owner("routine"), 1, &cancel, None, 0, 0)
            .is_ok());
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
                None,
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

    // J06: arming is idempotent per episode; expiry is generation-checked.
    #[test]
    fn predicate_deadlines_are_idempotent_and_generation_checked() {
        let mut store = TimerStore::default();
        let trigger = NodeId("armed".to_string());
        let first = store
            .ensure_predicate(&owner("routine"), 1, &trigger, 30_000, 0, 1_000)
            .unwrap();
        let again = store
            .ensure_predicate(&owner("routine"), 1, &trigger, 30_000, 5_000, 2_000)
            .unwrap();
        assert_eq!(
            first, again,
            "keeping a live episode must not churn generations"
        );

        assert!(
            store
                .consume_predicate(&owner("routine"), 1, &trigger, first + 1)
                .is_none(),
            "a mismatched generation never matures"
        );
        assert!(
            store
                .consume_predicate(&owner("routine"), 2, &trigger, first)
                .is_none(),
            "an edited revision never matures"
        );
        let fire = store
            .consume_predicate(&owner("routine"), 1, &trigger, first)
            .expect("current deadline matures");
        assert_eq!(fire.trigger, trigger);
        assert_eq!(fire.due_wall_ms, 31_000);
        assert!(
            store
                .consume_predicate(&owner("routine"), 1, &trigger, first)
                .is_none(),
            "a generation matures at most once"
        );

        store
            .ensure_predicate(&owner("routine"), 1, &trigger, 30_000, 0, 1_000)
            .unwrap();
        assert!(store.cancel_predicate(&owner("routine"), &trigger) > 0);
        assert_eq!(
            store.cancel_predicate(&owner("routine"), &trigger),
            0,
            "cancel is idempotent"
        );
    }

    #[test]
    fn predicate_jobs_stay_out_of_the_named_projection() {
        let mut store = TimerStore::default();
        let trigger = NodeId("armed".to_string());
        store
            .ensure_predicate(&owner("routine"), 1, &trigger, 30_000, 0, 1_000)
            .unwrap();
        schedule(&mut store, "routine", "off", 1_000);

        assert_eq!(
            store.runtime_statuses(0).len(),
            1,
            "only named timers are user-visible"
        );
        assert_eq!(
            store.wakeups().len(),
            2,
            "both kinds still drive the scheduler"
        );

        store.retain_current(&BTreeMap::from([(owner("routine"), 2)]));
        assert!(store.is_empty(), "an edited revision drops both kinds");
    }

    // K: schedule occurrences arm idempotently, consume once, rearm, and are
    // never user-visible; calendar occurrences may exceed the named bound.
    #[test]
    fn schedule_occurrences_arm_consume_and_rearm() {
        let mut store = TimerStore::default();
        let trigger = NodeId("morning".to_string());
        let first = store
            .ensure_schedule(&owner("routine"), 1, &trigger, 5_000, 10_000)
            .unwrap();
        assert_eq!(
            store
                .ensure_schedule(&owner("routine"), 1, &trigger, 6_000, 11_000)
                .unwrap(),
            first,
            "a live occurrence is kept without generation churn"
        );
        assert!(
            store.runtime_statuses(0).is_empty(),
            "schedule occurrences are not user-visible timers"
        );

        let fire = store
            .consume_schedule(&owner("routine"), 1, &trigger, first)
            .expect("current occurrence fires");
        assert_eq!(fire.trigger, trigger);
        assert_eq!(fire.due_wall_ms, 10_000);
        assert!(
            store
                .consume_schedule(&owner("routine"), 1, &trigger, first)
                .is_none(),
            "an occurrence fires at most once"
        );

        let second = store
            .ensure_schedule(&owner("routine"), 1, &trigger, 30_000, 35_000)
            .unwrap();
        assert!(second > first, "rearm starts a new generation");

        // A weekly-or-longer occurrence exceeds the named delay bound.
        let far = 30 * 24 * 60 * 60 * 1000;
        assert!(store
            .ensure_schedule(&owner("routine"), 1, &trigger, far, far as i64)
            .is_ok());
        assert!(store
            .pending_schedule_generation(&owner("routine"), &trigger)
            .is_some());

        store.retain_current(&BTreeMap::from([(owner("routine"), 2)]));
        assert!(store.is_empty(), "an edited revision drops schedules");
    }

    #[test]
    fn stale_schedule_revision_never_fires() {
        let mut store = TimerStore::default();
        let trigger = NodeId("morning".to_string());
        let generation = store
            .ensure_schedule(&owner("routine"), 1, &trigger, 5_000, 10_000)
            .unwrap();
        store.retain_current(&BTreeMap::from([(owner("routine"), 2)]));
        store
            .ensure_schedule(&owner("routine"), 2, &trigger, 7_000, 12_000)
            .unwrap();
        assert!(
            store
                .consume_schedule(&owner("routine"), 1, &trigger, generation)
                .is_none(),
            "an edited revision never consumes the old generation"
        );
    }
}
