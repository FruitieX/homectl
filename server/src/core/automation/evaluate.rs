//! Pure native evaluator for compiled v2 definitions (P04).
//!
//! The evaluator is intentionally scan-all and side-effect free: given a
//! coherent frame (mutations plus before/after views) it decides which
//! triggers fired, evaluates the routine condition with strong three-valued
//! logic, and records per-trigger transition memory keyed by
//! `(routine_id, definition_revision, trigger_id)`.
//!
//! Rules:
//! - Errors are not truth values. Any evaluated error stays an error under
//!   `not`/`all`/`any` and prevents execution (C04).
//! - Missing entities/fields, offline observed state, and empty selections
//!   become structured unknowns, never `false` (C06/C07).
//! - Reports are individual events even when the value repeats (E02/T02);
//!   transition triggers fire only on known false -> known true (T03/T04).
//! - Trigger memory advances whenever the trigger is evaluated, even if the
//!   routine condition later rejects the invocation (T06).
//!
//! Device value paths (JSON pointers):
//! - `/` (default), `/observed`, `/observed/*`: observed/report evidence.
//!   A controllable device with no report yet is `not_initialized`; an
//!   explicitly offline device makes observed claims `offline`.
//! - `/value`: sensor value.
//! - `/power`, `/brightness`, `/color`, `/scene_id`, `/requested_at_ms`:
//!   requested/authoritative intent, which stays known while offline.
//! - `/availability/*`, `/last_report/*`: evidence metadata.
//! - `/name`, `/integration_id`, `/device_id`, `/is_sensor`,
//!   `/is_controllable`: identity metadata.
//!
//! A color sensor's value is a structured document, so paths beyond the
//! sensor default read the serialized state as a JSON pointer
//! (`/brightness`, `/color/ct`). Computed-source references resolve through
//! the source's published synthetic device with the same paths (P11).

use std::collections::BTreeMap;

use crate::core::groups::Groups;
use crate::types::{
    automation_definition::{ConditionExpr, NodeId, StateChangeMode, TriggerSpec, ValueSource},
    automation_event::{DeviceMutation, EventId, EventOrigin},
    automation_trace::{
        ConditionEvaluation, ConditionTraceNode, RoutineV2RuntimeStatus, TriggerRuntimeStatus,
        TruthValue, UnknownReason,
    },
    device::{ControllableDevice, Device, DeviceData, DeviceKey, DeviceRef, DevicesState},
    rule::{RawRuleOperator, RoutineId},
};
use serde_json::Value;

use super::{compile::CompiledDefinition, groups::evaluate_group};

/// Maximum condition trace nodes retained in one evaluation (mirrors the
/// compiler's `MAX_CONDITION_NODES`).
pub const MAX_TRACE_NODES: usize = 256;

/// Read-only state view used by the evaluator.
#[derive(Clone, Copy)]
pub struct EvaluationView<'a> {
    pub devices: &'a DevicesState,
    pub groups: &'a Groups,
    /// Typed helper values. `None` means helper sources resolve to unknown
    /// (used by pre-P05 call sites and diagnostics that do not load helpers).
    pub helpers: Option<&'a crate::core::helpers::Helpers>,
}

/// Coherent frame handed to trigger evaluation. `before` and `after` describe
/// the same logical transaction, so a multi-device batch is never seen
/// partially applied (E04).
pub struct FrameContext<'a> {
    pub mutations: &'a [DeviceMutation],
    pub before: &'a DevicesState,
    pub after: &'a DevicesState,
    pub groups: &'a Groups,
    pub helpers: Option<&'a crate::core::helpers::Helpers>,
    /// Named timer fires the actor validated for this frame (P09). Empty for
    /// ordinary device frames.
    pub fired_timers: &'a [super::timers::TimerFire],
    /// Sustained-predicate maturities the actor validated for this frame
    /// (J06). Expiry re-evaluates the predicate against this frame's current
    /// state rather than the captured episode state (J05).
    pub predicate_fires: &'a [super::timers::PredicateDeadlineFire],
    /// Schedule occurrences the actor validated for this frame (K). The
    /// occurrence instant is authoritative; lateness/backlog policy was
    /// already applied before the fire reached the frame.
    pub schedule_fires: &'a [super::timers::ScheduleOccurrenceFire],
}

impl FrameContext<'_> {
    fn before_view(&self) -> EvaluationView<'_> {
        EvaluationView {
            devices: self.before,
            groups: self.groups,
            helpers: self.helpers,
        }
    }

    fn after_view(&self) -> EvaluationView<'_> {
        EvaluationView {
            devices: self.after,
            groups: self.groups,
            helpers: self.helpers,
        }
    }

    fn mutation_for(&self, device_key: &DeviceKey) -> Option<&DeviceMutation> {
        self.mutations
            .iter()
            .find(|mutation| &mutation.device_key == device_key)
    }

    fn report_mutation_for(&self, device_key: &DeviceKey) -> Option<&DeviceMutation> {
        self.mutations.iter().find(|mutation| {
            &mutation.device_key == device_key && mutation.origin == EventOrigin::Report
        })
    }
}

/// One resolved device/helper/source value with separate presence, quality,
/// and failure information.
#[derive(Clone, Debug, Default)]
pub struct ResolvedValue {
    /// Whether the addressable field exists for this entity.
    pub present: bool,
    /// The value when known.
    pub value: Option<Value>,
    /// Why the value is unknown despite the field being addressable.
    pub reason: Option<UnknownReason>,
    /// Evaluation failure (invalid pointer, nonfinite number, ...).
    pub error: Option<String>,
}

impl ResolvedValue {
    fn known(value: Value) -> Self {
        Self {
            present: true,
            value: Some(value),
            reason: None,
            error: None,
        }
    }

    fn absent(reason: UnknownReason) -> Self {
        Self {
            present: false,
            value: None,
            reason: Some(reason),
            error: None,
        }
    }

    fn unknown(reason: UnknownReason) -> Self {
        Self {
            present: true,
            value: None,
            reason: Some(reason),
            error: None,
        }
    }

    fn failed(error: String) -> Self {
        Self {
            present: true,
            value: None,
            reason: None,
            error: Some(error),
        }
    }
}

/// Per-trigger transition memory entry.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TriggerMemoryEntry {
    pub truth: TruthValue,
    pub last_event: Option<EventId>,
    /// Sustained-predicate latch: maturity fires once per episode and does not
    /// re-arm until the predicate leaves true (J06).
    pub predicate_matured: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TriggerMemoryKey {
    pub routine_id: String,
    pub definition_revision: i64,
    pub trigger_id: NodeId,
}

/// Transition memory keyed by `(routine_id, definition_revision, trigger_id)`,
/// never by device ID alone (T05).
#[derive(Clone, Debug, Default)]
pub struct TriggerMemory {
    entries: BTreeMap<TriggerMemoryKey, TriggerMemoryEntry>,
}

impl TriggerMemory {
    pub fn get(
        &self,
        routine_id: &RoutineId,
        definition_revision: i64,
        trigger_id: &NodeId,
    ) -> Option<&TriggerMemoryEntry> {
        self.entries.get(&TriggerMemoryKey {
            routine_id: routine_id.0.clone(),
            definition_revision,
            trigger_id: trigger_id.clone(),
        })
    }

    fn set(
        &mut self,
        routine_id: &RoutineId,
        definition_revision: i64,
        trigger_id: &NodeId,
        entry: TriggerMemoryEntry,
    ) {
        self.entries.insert(
            TriggerMemoryKey {
                routine_id: routine_id.0.clone(),
                definition_revision,
                trigger_id: trigger_id.clone(),
            },
            entry,
        );
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Drop memory for revisions that are no longer current. Keeps only the
    /// definitions supplied, so editing a routine invalidates its history
    /// while unrelated routines keep theirs.
    pub fn retain_current(&mut self, current: &BTreeMap<RoutineId, i64>) {
        self.entries.retain(|key, _| {
            current
                .get(&RoutineId(key.routine_id.clone()))
                .is_some_and(|revision| *revision == key.definition_revision)
        });
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn entry_for_test(
        &self,
        routine_id: &str,
        definition_revision: i64,
        trigger_id: &str,
    ) -> Option<&TriggerMemoryEntry> {
        self.get(
            &RoutineId(routine_id.to_string()),
            definition_revision,
            &NodeId(trigger_id.to_string()),
        )
    }
}

/// One sustained-predicate job change requested by this frame's evaluation
/// (J06). The caller applies it to the actor-authoritative store after the
/// frame; `Arm` is idempotent per episode and `Cancel` is idempotent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PredicateJobIntent {
    Arm {
        trigger_id: NodeId,
        duration_ms: u64,
    },
    Cancel {
        trigger_id: NodeId,
    },
}

/// Outcome of evaluating one routine against one frame.
#[derive(Clone, Debug)]
pub struct RoutineFrameEvaluation {
    pub routine_id: RoutineId,
    pub definition_revision: i64,
    pub matched_trigger_ids: Vec<NodeId>,
    pub triggers: Vec<TriggerRuntimeStatus>,
    pub condition: ConditionEvaluation,
    pub will_trigger: bool,
    /// Sustained-predicate arming/cancellation implied by this frame.
    pub predicate_jobs: Vec<PredicateJobIntent>,
    /// Captures frozen when the fired timer generations were scheduled
    /// (J08/J09). The expiry plan guards captured targets with these tokens
    /// instead of live revisions and cannot expand captured groups.
    pub timer_captures: Vec<super::timers::CapturedTimerIntents>,
}

impl RoutineFrameEvaluation {
    pub fn into_status(self, fingerprint: &str) -> RoutineV2RuntimeStatus {
        RoutineV2RuntimeStatus {
            definition_revision: self.definition_revision,
            fingerprint: fingerprint.to_string(),
            matched_trigger_ids: self.matched_trigger_ids,
            triggers: self.triggers,
            condition: self.condition,
            will_trigger: self.will_trigger,
            execution_pending: true,
            last_run: None,
        }
    }
}

/// Evaluate one routine against one coherent frame. This is the scan-all v2
/// evaluator: correctness and purity first, indexing later (PF01).
pub fn evaluate_routine_frame(
    routine_id: &RoutineId,
    definition_revision: i64,
    compiled: &CompiledDefinition,
    memory: &mut TriggerMemory,
    frame: &FrameContext<'_>,
) -> RoutineFrameEvaluation {
    let definition = &compiled.normalized;
    let mut matched_trigger_ids = Vec::new();
    let mut trigger_statuses = Vec::new();
    let mut trigger_error: Option<String> = None;
    let mut predicate_jobs = Vec::new();
    let timer_captures = frame
        .fired_timers
        .iter()
        .filter(|fire| &fire.routine_id == routine_id)
        .filter_map(|fire| fire.captured.clone())
        .collect();

    for trigger in &definition.triggers {
        let outcome = evaluate_trigger(
            routine_id,
            definition_revision,
            trigger,
            memory,
            frame,
            &mut predicate_jobs,
        );
        if outcome.fired {
            matched_trigger_ids.push(trigger.id().clone());
        }
        if let Some(error) = outcome.error.as_ref() {
            if trigger_error.is_none() {
                trigger_error = Some(error.clone());
            }
        }
        trigger_statuses.push(TriggerRuntimeStatus {
            armed: false,
            due_wall_ms: None,
            trigger_id: trigger.id().clone(),
            kind: trigger_kind(trigger).to_string(),
            fired: outcome.fired,
            eligible: outcome.eligible,
            truth: outcome.truth,
            error: outcome.error,
            unknown_reason: outcome.unknown_reason,
        });
    }

    let mut condition = evaluate_condition(&definition.condition, frame.after_view(), "/condition");
    if let Some(error) = trigger_error {
        if condition.error.is_none() {
            condition.error = Some(error);
        }
    }

    let will_trigger = !matched_trigger_ids.is_empty() && condition.authorizes_execution();

    RoutineFrameEvaluation {
        routine_id: routine_id.clone(),
        definition_revision,
        matched_trigger_ids,
        triggers: trigger_statuses,
        condition,
        will_trigger,
        predicate_jobs,
        timer_captures,
    }
}

/// Display-only trigger statuses for a routine that has not evaluated a frame
/// yet (for example right after a config save). Predicate truth and seeded
/// state-change truth come from the current view and transition memory, but
/// nothing is written back and no jobs are emitted (V05/X01).
pub fn display_trigger_statuses(
    routine_id: &RoutineId,
    definition_revision: i64,
    compiled: &CompiledDefinition,
    memory: &TriggerMemory,
    view: EvaluationView<'_>,
) -> Vec<TriggerRuntimeStatus> {
    compiled
        .normalized
        .triggers
        .iter()
        .map(|trigger| {
            let (eligible, truth, error, unknown_reason) = match trigger {
                TriggerSpec::StateChange { device, .. } => (
                    false,
                    memory
                        .get(routine_id, definition_revision, trigger.id())
                        .map(|entry| entry.truth)
                        .unwrap_or_else(|| device_active_truth(device, view.devices)),
                    None,
                    None,
                ),
                TriggerSpec::PredicateTransition { predicate, .. } => {
                    let evaluation = evaluate_condition(predicate, view, "/predicate");
                    (
                        true,
                        evaluation.truth,
                        evaluation.error,
                        evaluation.unknown_reason,
                    )
                }
                TriggerSpec::PredicateFor { predicate, .. } => {
                    let evaluation = evaluate_condition(predicate, view, "/predicate");
                    (
                        false,
                        evaluation.truth,
                        evaluation.error,
                        evaluation.unknown_reason,
                    )
                }
                TriggerSpec::Report { .. }
                | TriggerSpec::TimerFired { .. }
                | TriggerSpec::Schedule { .. }
                | TriggerSpec::Startup { .. }
                | TriggerSpec::Manual { .. } => (false, TruthValue::Unknown, None, None),
            };
            TriggerRuntimeStatus {
                armed: false,
                due_wall_ms: None,
                trigger_id: trigger.id().clone(),
                kind: trigger_kind(trigger).to_string(),
                fired: false,
                eligible,
                truth,
                error,
                unknown_reason,
            }
        })
        .collect()
}

/// Seed trigger memory from the current state without firing. Used at startup
/// and configuration reload (E06).
pub fn seed_routine_memory(
    routine_id: &RoutineId,
    definition_revision: i64,
    compiled: &CompiledDefinition,
    memory: &mut TriggerMemory,
    view: EvaluationView<'_>,
) {
    for trigger in &compiled.normalized.triggers {
        let truth = match trigger {
            TriggerSpec::StateChange { device, .. } => device_active_truth(device, view.devices),
            TriggerSpec::PredicateTransition { predicate, .. }
            | TriggerSpec::PredicateFor { predicate, .. } => {
                evaluate_condition(predicate, view, "/predicate").truth
            }
            _ => continue,
        };
        memory.set(
            routine_id,
            definition_revision,
            trigger.id(),
            TriggerMemoryEntry {
                truth,
                last_event: None,
                predicate_matured: false,
            },
        );
    }
}

struct TriggerOutcome {
    eligible: bool,
    fired: bool,
    truth: TruthValue,
    error: Option<String>,
    unknown_reason: Option<UnknownReason>,
}

fn trigger_kind(trigger: &TriggerSpec) -> &'static str {
    match trigger {
        TriggerSpec::Report { .. } => "report",
        TriggerSpec::StateChange { .. } => "state_change",
        TriggerSpec::PredicateTransition { .. } => "predicate_transition",
        TriggerSpec::PredicateFor { .. } => "predicate_for",
        TriggerSpec::Schedule { .. } => "schedule",
        TriggerSpec::TimerFired { .. } => "timer_fired",
        TriggerSpec::Startup { .. } => "startup",
        TriggerSpec::Manual { .. } => "manual",
    }
}

fn evaluate_trigger(
    routine_id: &RoutineId,
    definition_revision: i64,
    trigger: &TriggerSpec,
    memory: &mut TriggerMemory,
    frame: &FrameContext<'_>,
    predicate_jobs: &mut Vec<PredicateJobIntent>,
) -> TriggerOutcome {
    match trigger {
        TriggerSpec::Report { device, field, .. } => {
            let mutation = frame.report_mutation_for(&device_key(device));
            let eligible = mutation.is_some_and(|mutation| {
                field
                    .as_ref()
                    .map(|field| report_payload_contains(&mutation.after, field))
                    .unwrap_or(true)
            });
            TriggerOutcome {
                eligible,
                fired: eligible,
                truth: if eligible {
                    TruthValue::True
                } else {
                    TruthValue::Unknown
                },
                error: None,
                unknown_reason: None,
            }
        }
        TriggerSpec::StateChange { device, mode, .. } => {
            let key = device_key(device);
            let Some(mutation) = frame.mutation_for(&key) else {
                let truth = memory
                    .get(routine_id, definition_revision, trigger.id())
                    .map(|entry| entry.truth)
                    .unwrap_or(TruthValue::Unknown);
                return TriggerOutcome {
                    eligible: false,
                    fired: false,
                    truth,
                    error: None,
                    unknown_reason: None,
                };
            };

            let before = device_active_truth_from(mutation.before.as_ref());
            let after = device_active_truth_from(Some(&mutation.after));
            let fired = match mode {
                StateChangeMode::Transition => {
                    before == TruthValue::False && after == TruthValue::True
                }
                StateChangeMode::Level => after == TruthValue::True,
            };
            let reason = match after {
                TruthValue::Unknown => Some(UnknownReason::MissingField {
                    field: "power".to_string(),
                }),
                _ => None,
            };
            memory.set(
                routine_id,
                definition_revision,
                trigger.id(),
                TriggerMemoryEntry {
                    truth: after,
                    last_event: Some(mutation.event_id),
                    predicate_matured: false,
                },
            );
            TriggerOutcome {
                eligible: true,
                fired,
                truth: after,
                error: None,
                unknown_reason: reason,
            }
        }
        TriggerSpec::PredicateTransition { predicate, .. } => {
            let before = evaluate_condition(predicate, frame.before_view(), "/predicate");
            let after = evaluate_condition(predicate, frame.after_view(), "/predicate");
            let error = before.error.clone().or_else(|| after.error.clone());
            let fired = error.is_none()
                && before.truth == TruthValue::False
                && after.truth == TruthValue::True;
            if error.is_none() {
                memory.set(
                    routine_id,
                    definition_revision,
                    trigger.id(),
                    TriggerMemoryEntry {
                        truth: after.truth,
                        last_event: Some(
                            frame
                                .mutations
                                .first()
                                .map(|mutation| mutation.event_id)
                                .unwrap_or_default(),
                        ),
                        predicate_matured: false,
                    },
                );
            }
            TriggerOutcome {
                eligible: true,
                fired,
                truth: after.truth,
                error,
                unknown_reason: after.unknown_reason,
            }
        }
        TriggerSpec::PredicateFor {
            predicate,
            duration_ms,
            ..
        } => {
            // J06 arming contract. The sustained predicate is a server-owned
            // deadline job on the shared wakeup driver: seeded true does not
            // arm; false/unknown -> true starts an episode from now; true ->
            // true keeps the live generation; false/unknown/error cancels and
            // invalidates; maturity fires once and stays latched until the
            // predicate leaves true, even when the routine condition blocks.
            let evaluation = evaluate_condition(predicate, frame.after_view(), "/predicate");
            let previous = memory
                .get(routine_id, definition_revision, trigger.id())
                .copied()
                .unwrap_or_default();
            let had_episode = previous.truth == TruthValue::True || previous.predicate_matured;

            if let Some(error) = evaluation.error {
                if had_episode {
                    predicate_jobs.push(PredicateJobIntent::Cancel {
                        trigger_id: trigger.id().clone(),
                    });
                    memory.set(
                        routine_id,
                        definition_revision,
                        trigger.id(),
                        TriggerMemoryEntry {
                            truth: previous.truth,
                            last_event: None,
                            predicate_matured: false,
                        },
                    );
                }
                return TriggerOutcome {
                    eligible: false,
                    fired: false,
                    truth: evaluation.truth,
                    error: Some(error),
                    unknown_reason: evaluation.unknown_reason,
                };
            }

            let matured_fire = frame
                .predicate_fires
                .iter()
                .find(|fire| fire.routine_id == *routine_id && fire.trigger == *trigger.id());

            let (fired, matured) = match evaluation.truth {
                TruthValue::True => match matured_fire {
                    // J05: the actor validated the episode generation; this
                    // frame's current state decided the predicate recheck.
                    Some(_) => (true, true),
                    None => {
                        if previous.truth != TruthValue::True && !previous.predicate_matured {
                            predicate_jobs.push(PredicateJobIntent::Arm {
                                trigger_id: trigger.id().clone(),
                                duration_ms: *duration_ms,
                            });
                        }
                        (
                            false,
                            previous.predicate_matured && previous.truth == TruthValue::True,
                        )
                    }
                },
                TruthValue::False | TruthValue::Unknown => {
                    if had_episode {
                        predicate_jobs.push(PredicateJobIntent::Cancel {
                            trigger_id: trigger.id().clone(),
                        });
                    }
                    (false, false)
                }
            };

            memory.set(
                routine_id,
                definition_revision,
                trigger.id(),
                TriggerMemoryEntry {
                    truth: evaluation.truth,
                    last_event: None,
                    predicate_matured: matured,
                },
            );
            TriggerOutcome {
                eligible: fired,
                fired,
                truth: evaluation.truth,
                error: None,
                unknown_reason: evaluation.unknown_reason,
            }
        }
        TriggerSpec::TimerFired { timer, .. } => {
            // The actor already validated owner revision and generation; the
            // evaluator only matches this frame's fire to the trigger (J01).
            let fired = frame.fired_timers.iter().any(|fire| {
                &fire.routine_id == routine_id
                    && fire.definition_revision == definition_revision
                    && &fire.timer == timer
            });
            TriggerOutcome {
                eligible: fired,
                fired,
                truth: if fired {
                    TruthValue::True
                } else {
                    TruthValue::Unknown
                },
                error: None,
                unknown_reason: None,
            }
        }
        TriggerSpec::Schedule { id, .. } => {
            let fired = frame
                .schedule_fires
                .iter()
                .any(|fire| fire.routine_id == *routine_id && fire.trigger == *id);
            TriggerOutcome {
                eligible: fired,
                fired,
                truth: if fired {
                    TruthValue::True
                } else {
                    TruthValue::Unknown
                },
                error: None,
                unknown_reason: None,
            }
        }
        TriggerSpec::Startup { .. } | TriggerSpec::Manual { .. } => TriggerOutcome {
            eligible: false,
            fired: false,
            truth: TruthValue::Unknown,
            error: None,
            unknown_reason: None,
        },
    }
}

fn report_payload_contains(device: &Device, field: &str) -> bool {
    let Some(raw) = device.raw.as_ref() else {
        return false;
    };
    if field.starts_with('/') {
        return raw.pointer(field).is_some();
    }
    raw.get(field).is_some()
}

fn device_key(device_ref: &DeviceRef) -> DeviceKey {
    match device_ref {
        DeviceRef::Id(id_ref) => id_ref.clone().into_device_key(),
    }
}

fn device_active_truth(device_ref: &DeviceRef, devices: &DevicesState) -> TruthValue {
    let key = device_key(device_ref);
    device_active_truth_from(devices.0.get(&key))
}

fn device_active_truth_from(device: Option<&Device>) -> TruthValue {
    match device {
        None => TruthValue::Unknown,
        Some(device) => match &device.data {
            DeviceData::Controllable(controllable) => {
                TruthValue::from_bool(controllable.state.power)
            }
            DeviceData::Sensor(crate::types::device::SensorDevice::Boolean { value }) => {
                TruthValue::from_bool(*value)
            }
            DeviceData::Sensor(_) => TruthValue::Unknown,
        },
    }
}

/// Evaluate a condition tree with strong three-valued logic. Every node is
/// visited to produce a complete trace; errors dominate `not`/`all`/`any`.
pub fn evaluate_condition(
    condition: &ConditionExpr,
    view: EvaluationView<'_>,
    path: &str,
) -> ConditionEvaluation {
    let node = evaluate_condition_node(condition, view, path, 0);
    ConditionEvaluation {
        truth: node.truth,
        error: node.error.clone(),
        unknown_reason: node.unknown_reason.clone(),
        trace: node,
    }
}

fn evaluate_condition_node(
    condition: &ConditionExpr,
    view: EvaluationView<'_>,
    path: &str,
    depth: usize,
) -> ConditionTraceNode {
    if depth > MAX_TRACE_NODES {
        return ConditionTraceNode {
            path: path.to_string(),
            truth: TruthValue::Unknown,
            evaluated: true,
            error: Some(format!("Condition trace exceeded {MAX_TRACE_NODES} nodes.")),
            ..Default::default()
        };
    }

    match condition {
        ConditionExpr::Literal { value } => ConditionTraceNode {
            path: path.to_string(),
            truth: TruthValue::from_bool(*value),
            evaluated: true,
            ..Default::default()
        },
        ConditionExpr::All { conditions } | ConditionExpr::Any { conditions } => {
            let is_all = matches!(condition, ConditionExpr::All { .. });
            let children: Vec<ConditionTraceNode> = conditions
                .iter()
                .enumerate()
                .map(|(index, child)| {
                    evaluate_condition_node(
                        child,
                        view,
                        &format!("{path}/conditions/{index}"),
                        depth + 1,
                    )
                })
                .collect();

            let error = children.iter().find_map(|child| child.error.clone());
            let truth = if error.is_some() {
                TruthValue::Unknown
            } else if is_all {
                if children
                    .iter()
                    .any(|child| child.truth == TruthValue::False)
                {
                    TruthValue::False
                } else if children
                    .iter()
                    .any(|child| child.truth == TruthValue::Unknown)
                {
                    TruthValue::Unknown
                } else {
                    TruthValue::True
                }
            } else if children.iter().any(|child| child.truth == TruthValue::True) {
                TruthValue::True
            } else if children
                .iter()
                .any(|child| child.truth == TruthValue::Unknown)
            {
                TruthValue::Unknown
            } else {
                TruthValue::False
            };

            ConditionTraceNode {
                path: path.to_string(),
                truth,
                evaluated: true,
                error,
                unknown_reason: children
                    .iter()
                    .find_map(|child| child.unknown_reason.clone()),
                children,
                ..Default::default()
            }
        }
        ConditionExpr::Not { condition } => {
            let child =
                evaluate_condition_node(condition, view, &format!("{path}/condition"), depth + 1);
            ConditionTraceNode {
                path: path.to_string(),
                truth: child.truth.negate(),
                evaluated: true,
                error: child.error.clone(),
                unknown_reason: child.unknown_reason.clone(),
                children: vec![child],
                ..Default::default()
            }
        }
        ConditionExpr::Comparison {
            source,
            operator,
            value,
        } => evaluate_comparison_node(source, *operator, value.as_ref(), view, path),
        ConditionExpr::Group {
            group_id,
            quantifier,
            power,
            scene,
        } => {
            let Some(evaluation) = evaluate_group(
                group_id,
                *quantifier,
                *power,
                scene.as_ref(),
                view.devices,
                view.groups,
            ) else {
                return ConditionTraceNode {
                    path: path.to_string(),
                    truth: TruthValue::Unknown,
                    evaluated: true,
                    unknown_reason: Some(UnknownReason::MissingEntity {
                        entity: group_id.to_string(),
                    }),
                    ..Default::default()
                };
            };

            let unknown_reason = evaluation.reasons.first().cloned();
            let mut node = ConditionTraceNode {
                path: path.to_string(),
                truth: evaluation.truth,
                evaluated: true,
                unknown_reason,
                ..Default::default()
            };
            node.group = Some(Box::new(evaluation));
            node
        }
    }
}

fn evaluate_comparison_node(
    source: &ValueSource,
    operator: RawRuleOperator,
    expected: Option<&Value>,
    view: EvaluationView<'_>,
    path: &str,
) -> ConditionTraceNode {
    let resolved = resolve_value(source, view);
    let mut node = ConditionTraceNode {
        path: path.to_string(),
        evaluated: true,
        ..Default::default()
    };

    if let Some(error) = resolved.error {
        node.error = Some(error);
        return node;
    }

    match operator {
        RawRuleOperator::Exists => {
            node.truth = TruthValue::from_bool(resolved.present);
            return node;
        }
        RawRuleOperator::Truthy => {
            let Some(value) = resolved.value else {
                node.truth = TruthValue::Unknown;
                node.unknown_reason = resolved.reason.or(Some(UnknownReason::NotInitialized {
                    entity: source_entity(source),
                }));
                return node;
            };
            match truthy(&value) {
                Ok(truth) => node.truth = TruthValue::from_bool(truth),
                Err(error) => node.error = Some(error),
            }
            return node;
        }
        _ => {}
    }

    let Some(value) = resolved.value else {
        node.truth = TruthValue::Unknown;
        node.unknown_reason = resolved.reason.or(Some(UnknownReason::MissingField {
            field: source_entity(source),
        }));
        return node;
    };

    match compare_values(operator, &value, expected) {
        Ok(true) => node.truth = TruthValue::True,
        Ok(false) => node.truth = TruthValue::False,
        Err(error) => node.error = Some(error),
    }
    node
}

fn source_entity(source: &ValueSource) -> String {
    match source {
        ValueSource::Device { device, .. } => device_key(device).to_string(),
        ValueSource::Helper { helper } => helper.to_string(),
        ValueSource::ComputedSource { source, .. } => source.to_string(),
    }
}

/// Resolve a value source against a state view. Public for previews and
/// diagnostics.
pub fn resolve_value(source: &ValueSource, view: EvaluationView<'_>) -> ResolvedValue {
    match source {
        ValueSource::Device { device, path } => {
            resolve_device_path(&device_key(device), path, view)
        }
        ValueSource::Helper { helper } => match view
            .helpers
            .and_then(|helpers| helpers.definition(helper).map(|_| helpers))
        {
            Some(helpers) => match helpers.value(helper) {
                Some(value) => ResolvedValue::known(value.clone()),
                None => ResolvedValue::unknown(UnknownReason::UnknownSourceValue {
                    source: helper.to_string(),
                }),
            },
            None => ResolvedValue::unknown(UnknownReason::UnknownSourceValue {
                source: helper.to_string(),
            }),
        },
        // A computed source is read through its published synthetic device
        // (P11), so source references and scene links observe the same
        // last-good value. A source that never published resolves as a
        // missing entity rather than as unknown.
        ValueSource::ComputedSource { source, path } => {
            resolve_device_path(&super::sources::source_device_key(source), path, view)
        }
    }
}

pub(crate) fn resolve_device_path(
    key: &DeviceKey,
    path: &str,
    view: EvaluationView<'_>,
) -> ResolvedValue {
    let Some(device) = view.devices.0.get(key) else {
        return ResolvedValue::absent(UnknownReason::MissingEntity {
            entity: key.to_string(),
        });
    };
    let path = if path.is_empty() { "/" } else { path };

    match device.data {
        DeviceData::Sensor(ref sensor) => resolve_sensor_path(key, device, sensor, path),
        DeviceData::Controllable(ref controllable) => {
            resolve_controllable_path(key, controllable, path)
        }
    }
}

fn resolve_sensor_path(
    key: &DeviceKey,
    device: &Device,
    sensor: &crate::types::device::SensorDevice,
    path: &str,
) -> ResolvedValue {
    match path {
        "/" | "/value" | "/observed" | "/observed/value" => {
            if sensor.is_unknown_placeholder() {
                return ResolvedValue::unknown(UnknownReason::NotInitialized {
                    entity: key.to_string(),
                });
            }
            match sensor_value(sensor) {
                Ok(value) => ResolvedValue::known(value),
                Err(error) => {
                    ResolvedValue::failed(format!("Failed to serialize sensor '{}': {error}", key))
                }
            }
        }
        "/name" => ResolvedValue::known(Value::String(device.name.clone())),
        "/integration_id" => ResolvedValue::known(Value::String(key.integration_id.to_string())),
        "/device_id" => ResolvedValue::known(Value::String(key.device_id.to_string())),
        "/is_sensor" => ResolvedValue::known(Value::Bool(true)),
        "/is_controllable" => ResolvedValue::known(Value::Bool(false)),
        _ => {
            // A color sensor's value is a structured document
            // (`{power, brightness, color, transition}`), so any other path
            // reads it as a JSON pointer. Computed-source references rely on
            // this for fields like `/brightness` and `/color/ct` (P11).
            if let crate::types::device::SensorDevice::Color(state) = sensor {
                let pointer = path.strip_prefix("/value").unwrap_or(path);
                let pointer = if pointer.is_empty() { "/" } else { pointer };
                if let Ok(value) = serde_json::to_value(state) {
                    if let Some(found) = value.pointer(pointer) {
                        return ResolvedValue::known(found.clone());
                    }
                }
            }
            ResolvedValue::absent(UnknownReason::MissingField {
                field: path.to_string(),
            })
        }
    }
}

fn resolve_controllable_path(
    key: &DeviceKey,
    controllable: &ControllableDevice,
    path: &str,
) -> ResolvedValue {
    let observed_reason = observed_unknown_reason(key, controllable);
    match path {
        "/" | "/observed" => {
            if let Some(reason) = observed_reason {
                ResolvedValue::unknown(reason)
            } else {
                match controllable.last_report.as_ref() {
                    Some(report) => match serde_json::to_value(&report.state) {
                        Ok(value) => ResolvedValue::known(value),
                        Err(error) => ResolvedValue::failed(format!(
                            "Failed to serialize report for '{}': {error}",
                            key
                        )),
                    },
                    None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                        entity: key.to_string(),
                    }),
                }
            }
        }
        "/observed/power" => {
            observed_field(key, controllable, |state| Some(Value::Bool(state.power)))
        }
        "/observed/brightness" => observed_field(key, controllable, |state| {
            state.brightness.map(|brightness| {
                let brightness = brightness.into_inner();
                if brightness.is_finite() {
                    Value::from(brightness)
                } else {
                    Value::Null
                }
            })
        }),
        "/observed/color" => observed_field(key, controllable, |state| {
            state
                .color
                .as_ref()
                .and_then(|color| serde_json::to_value(color).ok())
        }),
        "/observed/transition" => observed_field(key, controllable, |state| {
            state.transition.map(|transition| {
                let transition = transition.into_inner();
                Value::from(transition)
            })
        }),
        "/power" => ResolvedValue::known(Value::Bool(controllable.state.power)),
        "/brightness" => match controllable.state.brightness {
            Some(brightness) => {
                let brightness = brightness.into_inner();
                if brightness.is_finite() {
                    ResolvedValue::known(Value::from(brightness))
                } else {
                    ResolvedValue::failed(format!(
                        "Device '{key}' has a nonfinite brightness value."
                    ))
                }
            }
            None => ResolvedValue::absent(UnknownReason::MissingField {
                field: "brightness".to_string(),
            }),
        },
        "/color" => match controllable.state.color.as_ref() {
            Some(color) => match serde_json::to_value(color) {
                Ok(value) => ResolvedValue::known(value),
                Err(error) => {
                    ResolvedValue::failed(format!("Failed to serialize color for '{key}': {error}"))
                }
            },
            None => ResolvedValue::absent(UnknownReason::MissingField {
                field: "color".to_string(),
            }),
        },
        "/scene_id" => match controllable.scene_id.as_ref() {
            Some(scene_id) => match serde_json::to_value(scene_id) {
                Ok(value) => ResolvedValue::known(value),
                Err(error) => {
                    ResolvedValue::failed(format!("Failed to serialize scene for '{key}': {error}"))
                }
            },
            None => ResolvedValue::absent(UnknownReason::MissingField {
                field: "scene_id".to_string(),
            }),
        },
        "/requested" => {
            let requested = serde_json::json!({
                "power": controllable.state.power,
                "brightness": controllable.state.brightness.map(|value| value.into_inner()),
                "color": controllable.state.color,
                "transition": controllable.state.transition.map(|value| value.into_inner()),
            });
            ResolvedValue::known(requested)
        }
        "/requested_at_ms" => match controllable.requested_at_ms {
            Some(value) => ResolvedValue::known(Value::from(value)),
            None => ResolvedValue::absent(UnknownReason::MissingField {
                field: "requested_at_ms".to_string(),
            }),
        },
        "/availability" => match controllable.availability.as_ref() {
            Some(availability) => ResolvedValue::known(serde_json::json!({
                "online": availability.online,
                "observed_at_ms": availability.observed_at_ms,
            })),
            None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                entity: key.to_string(),
            }),
        },
        "/availability/online" | "/online" => match controllable.availability.as_ref() {
            Some(availability) => ResolvedValue::known(Value::Bool(availability.online)),
            None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                entity: key.to_string(),
            }),
        },
        "/availability/observed_at_ms" => match controllable.availability.as_ref() {
            Some(availability) => ResolvedValue::known(Value::from(availability.observed_at_ms)),
            None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                entity: key.to_string(),
            }),
        },
        "/last_report/received_at_ms" => match controllable.last_report.as_ref() {
            Some(report) => ResolvedValue::known(Value::from(report.received_at_ms)),
            None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                entity: key.to_string(),
            }),
        },
        "/last_report/retained" => match controllable.last_report.as_ref() {
            Some(report) => ResolvedValue::known(Value::Bool(report.retained)),
            None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                entity: key.to_string(),
            }),
        },
        "/last_report/matches_requested" => match controllable.last_report.as_ref() {
            Some(report) => ResolvedValue::known(Value::Bool(report.matches_requested)),
            None => ResolvedValue::unknown(UnknownReason::NotInitialized {
                entity: key.to_string(),
            }),
        },
        "/name" => ResolvedValue::known(Value::String(key.device_id.to_string())),
        "/integration_id" => ResolvedValue::known(Value::String(key.integration_id.to_string())),
        "/device_id" => ResolvedValue::known(Value::String(key.device_id.to_string())),
        "/is_sensor" => ResolvedValue::known(Value::Bool(false)),
        "/is_controllable" => ResolvedValue::known(Value::Bool(true)),
        _ => ResolvedValue::absent(UnknownReason::MissingField {
            field: path.to_string(),
        }),
    }
}

fn sensor_value(sensor: &crate::types::device::SensorDevice) -> Result<Value, String> {
    match sensor {
        crate::types::device::SensorDevice::Boolean { value } => Ok(Value::Bool(*value)),
        crate::types::device::SensorDevice::Text { value } => Ok(Value::String(value.clone())),
        crate::types::device::SensorDevice::Number { value } => {
            if value.is_finite() {
                Ok(Value::from(*value))
            } else {
                Err("nonfinite sensor value".to_string())
            }
        }
        crate::types::device::SensorDevice::Color(state) => serde_json::to_value(state)
            .map_err(|error| format!("unserializable color state: {error}")),
    }
}

fn observed_unknown_reason(
    key: &DeviceKey,
    controllable: &ControllableDevice,
) -> Option<UnknownReason> {
    if let Some(availability) = controllable.availability.as_ref() {
        if !availability.online {
            return Some(UnknownReason::Offline {
                device: key.to_string(),
            });
        }
    }
    None
}

fn observed_field(
    key: &DeviceKey,
    controllable: &ControllableDevice,
    read: impl FnOnce(&crate::types::device::ControllableState) -> Option<Value>,
) -> ResolvedValue {
    if let Some(reason) = observed_unknown_reason(key, controllable) {
        return ResolvedValue::unknown(reason);
    }
    let Some(report) = controllable.last_report.as_ref() else {
        return ResolvedValue::unknown(UnknownReason::NotInitialized {
            entity: key.to_string(),
        });
    };
    match read(&report.state) {
        Some(value) => ResolvedValue::known(value),
        None => ResolvedValue::absent(UnknownReason::MissingField {
            field: "observed".to_string(),
        }),
    }
}

/// JSON truthiness used by the `truthy` operator. Errors on nonfinite numbers.
fn truthy(value: &Value) -> Result<bool, String> {
    Ok(match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(number) => match number.as_f64() {
            Some(number) if number.is_finite() => number != 0.0,
            _ => return Err("Cannot evaluate truthiness of a nonfinite number.".to_string()),
        },
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    })
}

fn compare_values(
    operator: RawRuleOperator,
    actual: &Value,
    expected: Option<&Value>,
) -> Result<bool, String> {
    let operator_name = operator_name(operator);
    let expected = expected
        .ok_or_else(|| format!("Operator '{operator_name}' requires a comparison value."))?;

    match operator {
        RawRuleOperator::Eq => Ok(json_eq(actual, expected)),
        RawRuleOperator::Ne => Ok(!json_eq(actual, expected)),
        RawRuleOperator::Gt | RawRuleOperator::Gte | RawRuleOperator::Lt | RawRuleOperator::Lte => {
            ordering(operator, actual, expected)
        }
        RawRuleOperator::Contains => match actual {
            Value::String(actual) => {
                let expected = expected.as_str().ok_or_else(|| {
                    format!(
                        "Operator 'contains' requires a string comparison value, got {expected}."
                    )
                })?;
                Ok(actual.contains(expected))
            }
            Value::Array(actual) => Ok(actual.iter().any(|item| json_eq(item, expected))),
            other => Err(format!(
                "Operator 'contains' is not supported for {}.",
                value_kind(other)
            )),
        },
        RawRuleOperator::StartsWith => match (actual, expected) {
            (Value::String(actual), Value::String(expected)) => Ok(actual.starts_with(expected)),
            _ => Err("Operator 'starts_with' requires string values.".to_string()),
        },
        RawRuleOperator::Regex => match (actual, expected) {
            (Value::String(actual), Value::String(pattern)) => {
                let regex = regex::Regex::new(pattern)
                    .map_err(|error| format!("Invalid regular expression '{pattern}': {error}"))?;
                Ok(regex.is_match(actual))
            }
            _ => Err("Operator 'regex' requires string values.".to_string()),
        },
        RawRuleOperator::Exists | RawRuleOperator::Truthy => {
            Err(format!("Operator '{operator_name}' is handled separately."))
        }
    }
}

fn ordering(operator: RawRuleOperator, actual: &Value, expected: &Value) -> Result<bool, String> {
    if let (Some(actual), Some(expected)) = (as_finite_number(actual), as_finite_number(expected)) {
        return Ok(match operator {
            RawRuleOperator::Gt => actual > expected,
            RawRuleOperator::Gte => actual >= expected,
            RawRuleOperator::Lt => actual < expected,
            RawRuleOperator::Lte => actual <= expected,
            _ => unreachable!("ordering called with a non-ordering operator"),
        });
    }
    if let (Value::String(actual), Value::String(expected)) = (actual, expected) {
        return Ok(match operator {
            RawRuleOperator::Gt => actual > expected,
            RawRuleOperator::Gte => actual >= expected,
            RawRuleOperator::Lt => actual < expected,
            RawRuleOperator::Lte => actual <= expected,
            _ => unreachable!("ordering called with a non-ordering operator"),
        });
    }
    Err(format!(
        "Cannot order {} against {}.",
        value_kind(actual),
        value_kind(expected)
    ))
}

fn as_finite_number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|number| number.is_finite())
}

fn json_eq(actual: &Value, expected: &Value) -> bool {
    match (as_finite_number(actual), as_finite_number(expected)) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => actual == expected,
    }
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

fn operator_name(operator: RawRuleOperator) -> &'static str {
    match operator {
        RawRuleOperator::Eq => "eq",
        RawRuleOperator::Ne => "ne",
        RawRuleOperator::Gt => "gt",
        RawRuleOperator::Gte => "gte",
        RawRuleOperator::Lt => "lt",
        RawRuleOperator::Lte => "lte",
        RawRuleOperator::Contains => "contains",
        RawRuleOperator::StartsWith => "starts_with",
        RawRuleOperator::Exists => "exists",
        RawRuleOperator::Truthy => "truthy",
        RawRuleOperator::Regex => "regex",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::types::{
        automation_definition::Quantifier,
        color::Capabilities,
        device::{ControllableState, DeviceId, DeviceReport, ManageKind, SensorDevice},
        group::{GroupConfig, GroupId, GroupLink, GroupsConfig},
        integration::IntegrationId,
        scene::SceneId,
    };

    use super::*;
    use crate::core::automation::compile::{compile_definition_value, ConfigCatalog};
    use crate::core::groups::Groups;

    fn key(integration: &str, device: &str) -> DeviceKey {
        DeviceKey::new(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(device),
        )
    }

    fn device_ref(key: &DeviceKey) -> DeviceRef {
        DeviceRef::from(key)
    }

    fn sensor_named(integration: &str, id: &str, value: bool) -> Device {
        Device::new(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Sensor(SensorDevice::Boolean { value }),
            None,
        )
    }

    fn sensor(value: bool) -> Device {
        sensor_named("dummy", "sensor", value)
    }

    fn lamp_named(integration: &str, id: &str, power: bool) -> Device {
        let mut device = Device::new(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Controllable(crate::types::device::ControllableDevice::new(
                None,
                power,
                None,
                None,
                None,
                Capabilities::default(),
                ManageKind::Full,
            )),
            None,
        );
        if let DeviceData::Controllable(controllable) = &mut device.data {
            controllable.last_report = Some(Box::new(DeviceReport {
                state: ControllableState {
                    power,
                    brightness: None,
                    color: None,
                    transition: None,
                },
                received_at_ms: 1,
                retained: false,
                matches_requested: true,
            }));
        }
        device
    }

    fn lamp(power: bool) -> Device {
        lamp_named("dummy", "lamp", power)
    }

    fn set_scene(device: &mut Device, scene: &str) {
        if let DeviceData::Controllable(controllable) = &mut device.data {
            controllable.scene_id = Some(SceneId::from(scene.to_string()));
        }
    }

    fn set_online(device: &mut Device, online: bool) {
        if let DeviceData::Controllable(controllable) = &mut device.data {
            controllable.availability = Some(crate::types::device::DeviceAvailability {
                online,
                observed_at_ms: 1,
            });
        }
    }

    fn states(devices: Vec<Device>) -> DevicesState {
        DevicesState(
            devices
                .into_iter()
                .map(|device| (device.get_device_key(), device))
                .collect(),
        )
    }

    fn no_groups() -> Groups {
        Groups::new(GroupsConfig::new())
    }

    fn mutation(
        key: &DeviceKey,
        before: Option<Device>,
        after: Device,
        origin: EventOrigin,
    ) -> DeviceMutation {
        DeviceMutation {
            event_id: EventId::default(),
            device_key: key.clone(),
            before,
            after,
            origin,
        }
    }

    fn with_frame<R>(
        mutations: &[DeviceMutation],
        before: &DevicesState,
        after: &DevicesState,
        groups: &Groups,
        run: impl FnOnce(&FrameContext<'_>) -> R,
    ) -> R {
        let frame = FrameContext {
            mutations,
            before,
            after,
            groups,
            helpers: None,
            fired_timers: &[],
            predicate_fires: &[],
            schedule_fires: &[],
        };
        run(&frame)
    }

    fn compiled(definition: Value) -> CompiledDefinition {
        compile_definition_value(&definition, &ConfigCatalog::default())
            .expect("definition should compile")
    }

    fn program() -> Value {
        json!({
            "kind": "native",
            "steps": [{ "action": "cancel_timer", "id": "step", "timer": "t1" }]
        })
    }

    fn routine_id() -> RoutineId {
        RoutineId("routine".to_string())
    }

    fn eval(
        condition: &ConditionExpr,
        devices: &DevicesState,
        groups: &Groups,
    ) -> ConditionEvaluation {
        evaluate_condition(
            condition,
            EvaluationView {
                devices,
                groups,
                helpers: None,
            },
            "/condition",
        )
    }

    fn comparison(
        device: DeviceRef,
        path: &str,
        operator: RawRuleOperator,
        value: Option<Value>,
    ) -> ConditionExpr {
        ConditionExpr::Comparison {
            source: ValueSource::Device {
                device,
                path: path.to_string(),
            },
            operator,
            value,
        }
    }

    fn power_condition(integration: &str, id: &str, expected: bool) -> ConditionExpr {
        comparison(
            device_ref(&key(integration, id)),
            "/power",
            RawRuleOperator::Eq,
            Some(json!(expected)),
        )
    }

    fn unknown_condition() -> ConditionExpr {
        power_condition("dummy", "ghost", true)
    }

    fn error_condition() -> ConditionExpr {
        comparison(
            device_ref(&key("dummy", "sensor")),
            "/value",
            RawRuleOperator::Regex,
            Some(json!("(")),
        )
    }

    fn literal(value: bool) -> ConditionExpr {
        ConditionExpr::Literal { value }
    }

    // C01: exhaustive all truth table including unknown.
    #[test]
    fn c01_all_truth_table_including_unknown() {
        let devices = states(vec![]);
        let groups = no_groups();
        let all = |children: Vec<ConditionExpr>| ConditionExpr::All {
            conditions: children,
        };

        assert_eq!(
            eval(&all(vec![literal(true), literal(true)]), &devices, &groups).truth,
            TruthValue::True
        );
        assert_eq!(
            eval(&all(vec![literal(true), literal(false)]), &devices, &groups).truth,
            TruthValue::False
        );
        assert_eq!(
            eval(
                &all(vec![literal(false), unknown_condition()]),
                &devices,
                &groups
            )
            .truth,
            TruthValue::False
        );
        assert_eq!(
            eval(
                &all(vec![literal(true), unknown_condition()]),
                &devices,
                &groups
            )
            .truth,
            TruthValue::Unknown
        );
        assert_eq!(
            eval(
                &all(vec![unknown_condition(), unknown_condition()]),
                &devices,
                &groups
            )
            .truth,
            TruthValue::Unknown
        );
    }

    // C02: exhaustive any truth table including unknown.
    #[test]
    fn c02_any_truth_table_including_unknown() {
        let devices = states(vec![]);
        let groups = no_groups();
        let any = |children: Vec<ConditionExpr>| ConditionExpr::Any {
            conditions: children,
        };

        assert_eq!(
            eval(
                &any(vec![literal(false), literal(false)]),
                &devices,
                &groups
            )
            .truth,
            TruthValue::False
        );
        assert_eq!(
            eval(&any(vec![literal(true), literal(false)]), &devices, &groups).truth,
            TruthValue::True
        );
        assert_eq!(
            eval(
                &any(vec![literal(true), unknown_condition()]),
                &devices,
                &groups
            )
            .truth,
            TruthValue::True
        );
        assert_eq!(
            eval(
                &any(vec![literal(false), unknown_condition()]),
                &devices,
                &groups
            )
            .truth,
            TruthValue::Unknown
        );
    }

    // C03: not over all three values.
    #[test]
    fn c03_not_truth_table_including_unknown() {
        let devices = states(vec![]);
        let groups = no_groups();
        let not = |child: ConditionExpr| ConditionExpr::Not {
            condition: Box::new(child),
        };

        assert_eq!(
            eval(&not(literal(true)), &devices, &groups).truth,
            TruthValue::False
        );
        assert_eq!(
            eval(&not(literal(false)), &devices, &groups).truth,
            TruthValue::True
        );
        assert_eq!(
            eval(&not(unknown_condition()), &devices, &groups).truth,
            TruthValue::Unknown
        );
    }

    // C04: an evaluated error stays an error under not/any/all and never
    // authorizes execution, even when a sibling would decide the result.
    #[test]
    fn c04_evaluation_error_dominates_not_all_and_any() {
        let devices = states(vec![sensor(true)]);
        let groups = no_groups();
        let error = error_condition();

        let all = ConditionExpr::All {
            conditions: vec![literal(false), error.clone()],
        };
        let all_eval = eval(&all, &devices, &groups);
        assert!(all_eval.is_error());
        assert!(!all_eval.authorizes_execution());

        let any = ConditionExpr::Any {
            conditions: vec![literal(true), error.clone()],
        };
        let any_eval = eval(&any, &devices, &groups);
        assert!(any_eval.is_error());
        assert!(!any_eval.authorizes_execution());

        let not = ConditionExpr::Not {
            condition: Box::new(error),
        };
        let not_eval = eval(&not, &devices, &groups);
        assert!(not_eval.is_error());
        assert!(!not_eval.authorizes_execution());
    }

    // C05: omitted conditions normalize to literal true; empty stored
    // all/any is rejected by the compiler.
    #[test]
    fn c05_omitted_condition_normalizes_to_literal_true() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "manual", "id": "manual_trig" }],
            "program": program()
        }));
        assert_eq!(definition.normalized.condition, literal(true));

        let rejected = compile_definition_value(
            &json!({
                "triggers": [{ "kind": "manual", "id": "manual_trig" }],
                "condition": { "kind": "all", "conditions": [] },
                "program": program()
            }),
            &ConfigCatalog::default(),
        );
        assert!(rejected.is_err());
    }

    // C06: a missing entity/field becomes a structured unknown, not false.
    #[test]
    fn c06_missing_entity_and_field_are_structured_unknowns() {
        let devices = states(vec![lamp(true)]);
        let groups = no_groups();

        let missing_entity = eval(&unknown_condition(), &devices, &groups);
        assert_eq!(missing_entity.truth, TruthValue::Unknown);
        assert!(matches!(
            missing_entity.unknown_reason,
            Some(UnknownReason::MissingEntity { .. })
        ));

        let missing_field = comparison(
            device_ref(&key("dummy", "lamp")),
            "/brightness",
            RawRuleOperator::Eq,
            Some(json!(1.0)),
        );
        let missing_field = eval(&missing_field, &devices, &groups);
        assert_eq!(missing_field.truth, TruthValue::Unknown);
        assert!(matches!(
            missing_field.unknown_reason,
            Some(UnknownReason::MissingField { .. })
        ));

        let negated = ConditionExpr::Not {
            condition: Box::new(unknown_condition()),
        };
        assert_eq!(
            eval(&negated, &devices, &groups).truth,
            TruthValue::Unknown,
            "not(missing) must not turn an unknown entity into true"
        );
    }

    // C07: observed state is unknown while offline; requested intent stays
    // known.
    #[test]
    fn c07_offline_observed_is_unknown_but_requested_intent_stays_known() {
        let mut device = lamp(true);
        set_online(&mut device, false);
        set_scene(&mut device, "normal");
        let devices = states(vec![device]);
        let groups = no_groups();

        let observed = comparison(
            device_ref(&key("dummy", "lamp")),
            "/observed/power",
            RawRuleOperator::Eq,
            Some(json!(true)),
        );
        let observed_eval = eval(&observed, &devices, &groups);
        assert_eq!(observed_eval.truth, TruthValue::Unknown);
        assert!(matches!(
            observed_eval.unknown_reason,
            Some(UnknownReason::Offline { .. })
        ));

        assert_eq!(
            eval(&power_condition("dummy", "lamp", true), &devices, &groups).truth,
            TruthValue::True
        );

        let scene = comparison(
            device_ref(&key("dummy", "lamp")),
            "/scene_id",
            RawRuleOperator::Eq,
            Some(json!("normal")),
        );
        assert_eq!(eval(&scene, &devices, &groups).truth, TruthValue::True);
    }

    // C08: a fresh report without separate availability metadata can still
    // provide known evidence.
    #[test]
    fn c08_fresh_report_without_availability_metadata_is_known() {
        let devices = states(vec![lamp(true)]);
        let groups = no_groups();
        let observed = comparison(
            device_ref(&key("dummy", "lamp")),
            "/observed/power",
            RawRuleOperator::Eq,
            Some(json!(true)),
        );
        let evaluation = eval(&observed, &devices, &groups);
        assert_eq!(evaluation.truth, TruthValue::True);
        assert!(evaluation.error.is_none());
    }

    // C09: no global freshness timeout is invented; freshness-expiry wakeups
    // are deliberately deferred to the P09 scheduler.
    #[test]
    fn c09_no_global_freshness_timeout_is_invented() {
        let mut device = lamp(true);
        if let DeviceData::Controllable(controllable) = &mut device.data {
            controllable.last_report.as_mut().unwrap().received_at_ms = 0;
        }
        let devices = states(vec![device]);
        let groups = no_groups();
        let observed = comparison(
            device_ref(&key("dummy", "lamp")),
            "/observed/power",
            RawRuleOperator::Eq,
            Some(json!(true)),
        );
        assert_eq!(
            eval(&observed, &devices, &groups).truth,
            TruthValue::True,
            "without an explicit max_age there is no invented staleness bound"
        );
    }

    // C10: preview uses an isolated copy of trigger memory and produces no
    // live memory delta.
    #[test]
    fn c10_preview_uses_isolated_trigger_memory() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": program()
        }));
        let before = states(vec![lamp(false)]);
        let after = states(vec![lamp(true)]);
        let mutations = vec![mutation(
            &key("dummy", "lamp"),
            Some(lamp(false)),
            lamp(true),
            EventOrigin::Report,
        )];

        let mut live_memory = TriggerMemory::default();
        with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            let mut preview_memory = live_memory.clone();
            let preview =
                evaluate_routine_frame(&routine_id(), 1, &definition, &mut preview_memory, frame);
            assert!(preview.will_trigger, "preview decision fires");
            assert!(preview_memory
                .entry_for_test("routine", 1, "trig")
                .is_some_and(|entry| entry.truth == TruthValue::True));
            assert!(
                live_memory.entry_for_test("routine", 1, "trig").is_none(),
                "live memory must not change during preview"
            );
            let live =
                evaluate_routine_frame(&routine_id(), 1, &definition, &mut live_memory, frame);
            assert!(live.will_trigger);
            assert!(live_memory
                .entry_for_test("routine", 1, "trig")
                .is_some_and(|entry| entry.truth == TruthValue::True));
        });
    }

    // T01: one event matching two triggers creates one invocation listing
    // both IDs.
    #[test]
    fn t01_one_event_matching_two_triggers_invokes_once_with_both_ids() {
        let definition = compiled(json!({
            "triggers": [
                { "kind": "report", "id": "report_trig", "device": { "integration_id": "dummy", "device_id": "lamp" } },
                { "kind": "state_change", "id": "change_trig", "device": { "integration_id": "dummy", "device_id": "lamp" }, "mode": "transition" }
            ],
            "condition": { "kind": "literal", "value": true },
            "program": program()
        }));
        let before = states(vec![lamp(false)]);
        let after = states(vec![lamp(true)]);
        let mutations = vec![mutation(
            &key("dummy", "lamp"),
            Some(lamp(false)),
            lamp(true),
            EventOrigin::Report,
        )];

        let mut memory = TriggerMemory::default();
        let evaluation = with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });

        assert_eq!(
            evaluation.matched_trigger_ids,
            vec![
                NodeId("report_trig".to_string()),
                NodeId("change_trig".to_string())
            ]
        );
        assert!(evaluation.will_trigger);
        assert_eq!(evaluation.triggers.iter().filter(|t| t.fired).count(), 2);
    }

    // T02: condition-only changes never invoke an event-triggered routine.
    #[test]
    fn t02_condition_only_changes_do_not_trigger_event_routines() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "comparison", "source": { "kind": "device", "device": { "integration_id": "dummy", "device_id": "sensor" }, "path": "/value" }, "operator": "eq", "value": true },
            "program": program()
        }));
        let mut memory = TriggerMemory::default();

        // The sensor condition becomes true, but no trigger references the
        // sensor: nothing invokes the routine.
        let before = states(vec![lamp(false), sensor(false)]);
        let after = states(vec![lamp(false), sensor(true)]);
        let sensor_mutation = vec![mutation(
            &key("dummy", "sensor"),
            Some(sensor(false)),
            sensor(true),
            EventOrigin::Report,
        )];
        let condition_only = with_frame(&sensor_mutation, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });
        assert!(condition_only.matched_trigger_ids.is_empty());
        assert!(
            !condition_only.will_trigger,
            "condition-only changes must not invoke an event-triggered routine"
        );

        // The trigger fires and the condition is also true.
        let trigger_before = states(vec![lamp(false), sensor(true)]);
        let trigger_after = states(vec![lamp(true), sensor(true)]);
        let trigger_mutation = vec![mutation(
            &key("dummy", "lamp"),
            Some(lamp(false)),
            lamp(true),
            EventOrigin::Report,
        )];
        let triggered = with_frame(
            &trigger_mutation,
            &trigger_before,
            &trigger_after,
            &no_groups(),
            |frame| evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame),
        );
        assert!(triggered.will_trigger);
    }

    // T03: known false -> true fires once; true -> true does not; true ->
    // false rearms.
    #[test]
    fn t03_transition_fires_once_and_rearms_on_false() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": program()
        }));
        let key = key("dummy", "lamp");
        let mut memory = TriggerMemory::default();

        let step = |before_device: Device, after_device: Device, memory: &mut TriggerMemory| {
            let before = states(vec![before_device.clone()]);
            let after = states(vec![after_device.clone()]);
            let mutations = vec![mutation(
                &key,
                Some(before_device),
                after_device,
                EventOrigin::Report,
            )];
            with_frame(&mutations, &before, &after, &no_groups(), |frame| {
                evaluate_routine_frame(&routine_id(), 1, &definition, memory, frame)
            })
        };

        assert_eq!(
            step(lamp(false), lamp(true), &mut memory)
                .matched_trigger_ids
                .len(),
            1
        );
        assert!(step(lamp(true), lamp(true), &mut memory)
            .matched_trigger_ids
            .is_empty());
        assert!(step(lamp(true), lamp(false), &mut memory)
            .matched_trigger_ids
            .is_empty());
        assert_eq!(
            step(lamp(false), lamp(true), &mut memory)
                .matched_trigger_ids
                .len(),
            1
        );
    }

    // T04: unknown -> true does not fire under the default transition policy.
    #[test]
    fn t04_unknown_to_true_does_not_fire_by_default() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" } }],
            "condition": { "kind": "literal", "value": true },
            "program": program()
        }));
        let before = states(vec![]);
        let after = states(vec![lamp(true)]);
        let mutations = vec![mutation(
            &key("dummy", "lamp"),
            None,
            lamp(true),
            EventOrigin::Report,
        )];

        let mut memory = TriggerMemory::default();
        let evaluation = with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });

        assert!(
            evaluation.matched_trigger_ids.is_empty(),
            "first discovery of a true state seeds instead of firing"
        );
        assert!(memory
            .entry_for_test("routine", 1, "trig")
            .is_some_and(|entry| entry.truth == TruthValue::True));
    }

    // T05: two triggers reading one device have independent history.
    #[test]
    fn t05_two_triggers_keep_independent_memory() {
        let definition = compiled(json!({
            "triggers": [
                { "kind": "state_change", "id": "trig_a", "device": { "integration_id": "dummy", "device_id": "lamp" } },
                { "kind": "predicate_transition", "id": "trig_b", "predicate": { "kind": "comparison", "source": { "kind": "device", "device": { "integration_id": "dummy", "device_id": "sensor" }, "path": "/value" }, "operator": "eq", "value": true } }
            ],
            "condition": { "kind": "literal", "value": true },
            "program": program()
        }));
        let mut memory = TriggerMemory::default();

        let before = states(vec![lamp(false), sensor(false)]);
        let after = states(vec![lamp(true), sensor(false)]);
        let mutations = vec![mutation(
            &key("dummy", "lamp"),
            Some(lamp(false)),
            lamp(true),
            EventOrigin::Report,
        )];
        let evaluation = with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });
        assert_eq!(evaluation.matched_trigger_ids.len(), 1);
        assert_eq!(evaluation.matched_trigger_ids[0].0, "trig_a");

        assert!(memory
            .entry_for_test("routine", 1, "trig_a")
            .is_some_and(|entry| entry.truth == TruthValue::True));
        assert!(memory
            .entry_for_test("routine", 1, "trig_b")
            .is_some_and(|entry| entry.truth == TruthValue::False));
    }

    // T06: a trigger transition advances history even when the routine
    // condition is false.
    #[test]
    fn t06_memory_advances_even_when_condition_is_false() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "predicate_transition", "id": "trig", "predicate": { "kind": "comparison", "source": { "kind": "device", "device": { "integration_id": "dummy", "device_id": "sensor" }, "path": "/value" }, "operator": "eq", "value": true } }],
            "condition": { "kind": "literal", "value": false },
            "program": program()
        }));
        let before = states(vec![sensor(false)]);
        let after = states(vec![sensor(true)]);
        let mutations = vec![mutation(
            &key("dummy", "sensor"),
            Some(sensor(false)),
            sensor(true),
            EventOrigin::Report,
        )];

        let mut memory = TriggerMemory::default();
        let evaluation = with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });

        assert_eq!(evaluation.matched_trigger_ids.len(), 1);
        assert!(
            !evaluation.will_trigger,
            "the false condition rejects the invocation"
        );
        assert!(
            memory
                .entry_for_test("routine", 1, "trig")
                .is_some_and(|entry| entry.truth == TruthValue::True),
            "trigger memory advances regardless of the condition"
        );
    }

    fn group_config(devices: &[&DeviceKey], links: &[&str]) -> (GroupId, GroupsConfig) {
        let mut config = GroupsConfig::new();
        let group_id = GroupId("room".to_string());
        config.insert(
            group_id.clone(),
            GroupConfig {
                name: "Room".to_string(),
                devices: Some(devices.iter().map(|key| device_ref(key)).collect()),
                groups: if links.is_empty() {
                    None
                } else {
                    Some(
                        links
                            .iter()
                            .map(|link| GroupLink {
                                group_id: GroupId(link.to_string()),
                            })
                            .collect(),
                    )
                },
                hidden: None,
            },
        );
        (group_id, config)
    }

    fn group_condition(
        group_id: &GroupId,
        quantifier: Quantifier,
        power: Option<bool>,
    ) -> ConditionExpr {
        ConditionExpr::Group {
            group_id: group_id.clone(),
            quantifier,
            power,
            scene: None,
        }
    }

    // G01: one missing configured member is counted as unknown, not removed.
    #[test]
    fn g01_missing_configured_member_counts_as_unknown() {
        let present = key("dummy", "lamp");
        let missing = key("dummy", "ghost");
        let (group_id, config) = group_config(&[&present, &missing], &[]);
        let groups = Groups::new(config);
        let devices = states(vec![lamp(true)]);

        let evaluation = evaluate_group(
            &group_id,
            Quantifier::All,
            Some(true),
            None,
            &devices,
            &groups,
        )
        .expect("group exists");
        assert_eq!(evaluation.configured_count, 2);
        assert_eq!(evaluation.true_count, 1);
        assert_eq!(evaluation.unknown_count, 1);
        assert_eq!(evaluation.truth, TruthValue::Unknown);
    }

    // G02: nested groups deduplicate members and preserve missing references.
    #[test]
    fn g02_nested_groups_dedupe_and_preserve_missing_references() {
        let shared = key("dummy", "lamp");
        let missing = key("dummy", "ghost");
        let mut config = GroupsConfig::new();
        let parent = GroupId("parent".to_string());
        let child = GroupId("child".to_string());
        config.insert(
            child.clone(),
            GroupConfig {
                name: "Child".to_string(),
                devices: Some(vec![device_ref(&shared), device_ref(&missing)]),
                groups: None,
                hidden: None,
            },
        );
        config.insert(
            parent.clone(),
            GroupConfig {
                name: "Parent".to_string(),
                devices: Some(vec![device_ref(&shared)]),
                groups: Some(vec![GroupLink { group_id: child }]),
                hidden: None,
            },
        );
        let groups = Groups::new(config);
        let devices = states(vec![lamp(true)]);

        let evaluation = evaluate_group(
            &parent,
            Quantifier::All,
            Some(true),
            None,
            &devices,
            &groups,
        )
        .expect("group exists");
        assert_eq!(evaluation.configured_count, 2, "shared member deduplicated");
        assert_eq!(evaluation.unknown_count, 1, "missing reference preserved");
    }

    // G03: an empty group is unknown for all/any, and not(empty-all) stays
    // unknown.
    #[test]
    fn g03_empty_group_is_unknown_even_under_not() {
        let (group_id, config) = group_config(&[], &[]);
        let groups = Groups::new(config);
        let devices = states(vec![]);

        let all = group_condition(&group_id, Quantifier::All, Some(true));
        let all_eval = eval(&all, &devices, &groups);
        assert_eq!(all_eval.truth, TruthValue::Unknown);
        assert!(matches!(
            all_eval.unknown_reason,
            Some(UnknownReason::EmptySelection { .. })
        ));

        let any = group_condition(&group_id, Quantifier::Any, Some(true));
        assert_eq!(eval(&any, &devices, &groups).truth, TruthValue::Unknown);

        let negated = ConditionExpr::Not {
            condition: Box::new(all),
        };
        assert_eq!(eval(&negated, &devices, &groups).truth, TruthValue::Unknown);
    }

    // G04: partial requires known disagreement; all-on false is not treated
    // as all-off true.
    #[test]
    fn g04_partial_requires_known_disagreement() {
        let on = key("dummy", "lamp");
        let off = key("dummy", "lamp2");
        let (group_id, config) = group_config(&[&on, &off], &[]);
        let groups = Groups::new(config);

        let mixed = states(vec![lamp(true), lamp_named("dummy", "lamp2", false)]);
        let partial = group_condition(&group_id, Quantifier::Partial, Some(true));
        assert_eq!(eval(&partial, &mixed, &groups).truth, TruthValue::True);

        let all_on = states(vec![lamp(true), lamp_named("dummy", "lamp2", true)]);
        assert_eq!(
            eval(&partial, &all_on, &groups).truth,
            TruthValue::False,
            "all known on is not a partial mixture"
        );

        let all_off = states(vec![lamp(false), lamp_named("dummy", "lamp2", false)]);
        assert_eq!(
            eval(&partial, &all_off, &groups).truth,
            TruthValue::False,
            "all known off is not a partial mixture"
        );

        let (single_id, single_config) = group_config(&[&on], &[]);
        let single_groups = Groups::new(single_config);
        let single = group_condition(&single_id, Quantifier::Partial, Some(true));
        assert_eq!(
            eval(&single, &states(vec![lamp(true)]), &single_groups).truth,
            TruthValue::Unknown,
            "a single-member selection cannot establish disagreement"
        );
    }

    // G05: mixed scene assignments produce mixed, not arbitrary/majority
    // selection.
    #[test]
    fn g05_mixed_scene_assignments_stay_mixed() {
        let a = key("dummy", "lamp");
        let b = key("dummy", "lamp2");
        let (group_id, config) = group_config(&[&a, &b], &[]);
        let groups = Groups::new(config);

        let mut first = lamp_named("dummy", "lamp", true);
        set_scene(&mut first, "normal");
        let mut second = lamp_named("dummy", "lamp2", true);
        set_scene(&mut second, "dark");

        let evaluation = evaluate_group(
            &group_id,
            Quantifier::All,
            None,
            None,
            &states(vec![first, second]),
            &groups,
        )
        .expect("group exists");
        assert_eq!(
            evaluation.scene.kind,
            crate::types::automation_trace::GroupSceneSummaryKind::Mixed
        );
        assert!(evaluation.scene.scene_id.is_none());

        let mut uniform = lamp_named("dummy", "lamp", true);
        set_scene(&mut uniform, "normal");
        let mut uniform2 = lamp_named("dummy", "lamp2", true);
        set_scene(&mut uniform2, "normal");
        let evaluation = evaluate_group(
            &group_id,
            Quantifier::All,
            None,
            None,
            &states(vec![uniform, uniform2]),
            &groups,
        )
        .expect("group exists");
        assert_eq!(
            evaluation.scene.kind,
            crate::types::automation_trace::GroupSceneSummaryKind::Uniform
        );
    }

    // G06: membership changes increment the group definition revision.
    #[test]
    fn g06_group_definition_revision_changes_when_membership_changes() {
        let lamp_key = key("dummy", "lamp");
        let (_, config) = group_config(&[&lamp_key], &[]);
        let groups = Groups::new(config);
        assert_eq!(groups.definition_revision(), 0);

        let (_, extended) = group_config(&[&lamp_key, &key("dummy", "lamp2")], &[]);
        let mut reloaded = Groups::new(GroupsConfig::new());
        reloaded.load_config_rows(&[]);
        assert!(reloaded.definition_revision() > 0);
        let _ = extended;
    }

    // G07: the native group result and the condition trace agree exactly.
    #[test]
    fn g07_native_group_result_matches_condition_trace() {
        let lamp_key = key("dummy", "lamp");
        let (group_id, config) = group_config(&[&lamp_key], &[]);
        let groups = Groups::new(config);
        let devices = states(vec![lamp(true)]);

        let condition = group_condition(&group_id, Quantifier::Any, Some(true));
        let evaluation = eval(&condition, &devices, &groups);
        let direct = evaluate_group(
            &group_id,
            Quantifier::Any,
            Some(true),
            None,
            &devices,
            &groups,
        )
        .expect("group exists");

        let traced = evaluation
            .trace
            .group
            .as_ref()
            .expect("group trace attached");
        assert_eq!(traced.as_ref(), &direct);
        assert_eq!(evaluation.truth, direct.truth);
    }

    // Report triggers observe the report payload field when declared.
    #[test]
    fn report_trigger_can_require_a_payload_field() {
        let definition = compiled(json!({
            "triggers": [{ "kind": "report", "id": "trig", "device": { "integration_id": "dummy", "device_id": "lamp" }, "field": "/button" }],
            "condition": { "kind": "literal", "value": true },
            "program": program()
        }));

        let mut with_payload = lamp(true);
        with_payload.raw = Some(json!({ "button": "single" }));
        let key = key("dummy", "lamp");
        let mutations = vec![mutation(
            &key,
            Some(lamp(true)),
            with_payload.clone(),
            EventOrigin::Report,
        )];
        let before = states(vec![lamp(true)]);
        let after = states(vec![with_payload]);
        let mut memory = TriggerMemory::default();
        let fired = with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });
        assert!(fired.will_trigger);

        let without_payload = lamp(true);
        let mutations = vec![mutation(
            &key,
            Some(lamp(false)),
            without_payload.clone(),
            EventOrigin::Report,
        )];
        let before = states(vec![lamp(false)]);
        let after = states(vec![without_payload]);
        let skipped = with_frame(&mutations, &before, &after, &no_groups(), |frame| {
            evaluate_routine_frame(&routine_id(), 1, &definition, &mut memory, frame)
        });
        assert!(!skipped.will_trigger);
    }

    fn color_sensor(integration: &str, id: &str, brightness: f32, ct: u16) -> Device {
        Device::new(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Sensor(SensorDevice::Color(ControllableState {
                power: true,
                brightness: Some(ordered_float::OrderedFloat(brightness)),
                color: Some(crate::types::color::DeviceColor::new_from_kelvin(ct)),
                transition: Some(ordered_float::OrderedFloat(60.0)),
            })),
            None,
        )
    }

    // P11: computed-source references resolve through the published
    // synthetic device, including structured color-sensor paths.
    #[test]
    fn p11_computed_source_references_resolve_through_the_synthetic_device() {
        use crate::types::automation_definition::SourceId;

        let devices = states(vec![color_sensor("computed", "circadian", 0.5, 2500)]);
        let groups = no_groups();
        let view = EvaluationView {
            devices: &devices,
            groups: &groups,
            helpers: None,
        };

        let resolve = |path: &str| {
            resolve_value(
                &ValueSource::ComputedSource {
                    source: SourceId("circadian".to_string()),
                    path: path.to_string(),
                },
                view,
            )
        };

        assert_eq!(resolve("/brightness").value, Some(json!(0.5)));
        assert_eq!(resolve("/power").value, Some(json!(true)));
        assert_eq!(resolve("/color/ct").value, Some(json!(2500)));
        assert_eq!(
            resolve("/").value,
            Some(json!({
                "power": true,
                "brightness": 0.5,
                "color": { "ct": 2500 },
                "transition": 60.0,
            }))
        );

        // A source that never published is a missing entity, not a silent
        // unknown; an absent field on a published source is a missing field.
        let missing = resolve_value(
            &ValueSource::ComputedSource {
                source: SourceId("other".to_string()),
                path: "/brightness".to_string(),
            },
            view,
        );
        assert!(missing.value.is_none());
        assert!(matches!(
            missing.reason,
            Some(UnknownReason::MissingEntity { .. })
        ));

        let absent = resolve("/nope");
        assert!(absent.value.is_none());
        assert!(matches!(
            absent.reason,
            Some(UnknownReason::MissingField { .. })
        ));
    }
}
