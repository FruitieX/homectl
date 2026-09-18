//! P00 baseline characterization harness.
//!
//! This module provides a reusable, serializable replay fixture format and a
//! harness that drives the *existing* v1 routine evaluator offline. It is the
//! foundation for the differential/characterization tests required by the
//! automation v2 plan (P00, and later P02/P13).
//!
//! Guarantees:
//! - No integration publisher, MQTT client, HTTP client, database handle, or
//!   real clock is constructed. Device reports are only fed into the in-memory
//!   `Devices` state and the emitted `Event` channel.
//! - Actions produced by the legacy evaluator are recorded, never dispatched.
//!   A replay therefore cannot reach a live sink.
//! - The harness intentionally drives the v1 evaluator through
//!   `Routines::handle_internal_state_update`, which evaluates against the
//!   *current* `Devices` snapshot rather than the event's own `before`/`after`
//!   pair. That ordering hazard is captured as a named expectation in the
//!   characterization tests so P02 can change it deliberately.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::error::TryRecvError;

use crate::core::{devices::Devices, groups::Groups, routines::Routines};
use crate::types::{
    action::{Action, Actions},
    device::{Device, DevicesState},
    event::{mk_event_channel, Event, RxEventChannel},
    group::{FlattenedGroupsConfig, GroupsConfig},
    routine_status::RoutineStatuses,
    rule::{Routine, RoutineId, RoutinesConfig, Rule},
};
use crate::utils::cli::Cli;

/// Baseline commit the characterization fixtures were recorded against.
pub const BASELINE_REVISION: &str = "5aef129c";

/// A single routine in a replay fixture. Mirrors `Routine` plus an `enabled`
/// flag so disabled rows can be represented without being loaded.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplayRoutine {
    pub id: RoutineId,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub rules: Vec<Rule>,
    pub actions: Actions,
}

fn default_true() -> bool {
    true
}

/// A single replay step. Steps are applied in declaration order.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum ReplayStep {
    /// Apply a report to the in-memory device state. This queues an
    /// `InternalStateUpdate`; it does not evaluate routines yet.
    QueueReport { device: Box<Device> },

    /// Evaluate all queued internal updates against the current state. This is
    /// where the v1 evaluator runs.
    Flush,

    /// Rebuild the flattened group view from the current device state. The
    /// production actor does this as part of handling an internal update.
    ForceInvalidateGroups,
}

/// A serializable replay fixture: an offline, deterministic scenario.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplayFixture {
    pub id: String,
    pub description: String,
    #[serde(default = "baseline_revision")]
    pub baseline_revision: String,
    #[serde(default)]
    pub groups: GroupsConfig,
    #[serde(default)]
    pub routines: Vec<ReplayRoutine>,
    pub steps: Vec<ReplayStep>,
}

fn baseline_revision() -> String {
    BASELINE_REVISION.to_string()
}

/// Actions and statuses captured after a single `Flush`.
#[derive(Clone, Debug)]
pub struct StepOutcome {
    pub step_index: usize,
    pub actions: Vec<Action>,
    pub statuses: Vec<(
        RoutineId,
        crate::types::routine_status::RoutineRuntimeStatus,
    )>,
}

/// Full result of replaying a fixture.
#[derive(Clone, Debug)]
pub struct ReplayRun {
    pub fixture_id: String,
    pub steps: Vec<StepOutcome>,
    pub final_statuses: Vec<(
        RoutineId,
        crate::types::routine_status::RoutineRuntimeStatus,
    )>,
    pub final_devices: DevicesState,
    pub final_flattened_groups: FlattenedGroupsConfig,
}

impl ReplayRun {
    pub fn all_actions(&self) -> Vec<Action> {
        self.steps
            .iter()
            .flat_map(|step| step.actions.iter().cloned())
            .collect()
    }
}

/// Offline harness around the v1 evaluator.
pub struct BaselineHarness {
    pub devices: Devices,
    pub groups: Groups,
    pub routines: Routines,
    rx: RxEventChannel,
    captured_actions: Vec<Action>,
    captured_event_ids: Vec<crate::types::automation_event::EventId>,
    processed_internal: usize,
}

impl BaselineHarness {
    /// Build a harness from routines/groups configuration. Uses a dry-run CLI
    /// and a throwaway event channel; no integration is ever registered.
    pub fn new(groups: GroupsConfig, routines: RoutinesConfig) -> Self {
        let cli = test_cli();
        let (event_tx, rx) = mk_event_channel();
        let devices = Devices::new(event_tx.clone(), &cli);
        let groups = Groups::new(groups);
        let routines = Routines::new(routines, event_tx);

        Self {
            devices,
            groups,
            routines,
            rx,
            captured_actions: Vec::new(),
            captured_event_ids: Vec::new(),
            processed_internal: 0,
        }
    }

    /// Build a harness from a fixture's routines and groups.
    pub fn from_fixture(fixture: &ReplayFixture) -> Self {
        let mut routines = RoutinesConfig::new();
        for routine in &fixture.routines {
            if !routine.enabled {
                continue;
            }
            routines.insert(
                routine.id.clone(),
                Routine {
                    name: routine.name.clone(),
                    rules: routine.rules.clone(),
                    actions: routine.actions.clone(),
                },
            );
        }

        Self::new(fixture.groups.clone(), routines)
    }

    /// Apply a report to the in-memory state. Queues an `InternalStateUpdate`
    /// on the event channel but does not evaluate routines.
    pub fn queue_report(&mut self, device: &Device) {
        self.devices.set_state(device, false, true);
    }

    /// Evaluate every queued internal update in order against the current
    /// device/group snapshot, recording any actions the v1 evaluator emits.
    /// Returns the number of internal updates processed.
    pub async fn flush(&mut self) -> usize {
        self.groups.force_invalidate(&self.devices);
        let processed_before = self.processed_internal;

        loop {
            match self.rx.try_recv() {
                Ok(Event::InternalStateUpdate {
                    device_key,
                    old,
                    new,
                    event_id,
                    ..
                }) => {
                    if let Some(event_id) = event_id {
                        self.captured_event_ids.push(event_id);
                    }
                    self.routines
                        .handle_internal_state_update(
                            &device_key,
                            old.as_ref(),
                            &new,
                            &self.devices,
                            &self.groups,
                        )
                        .await;
                    self.processed_internal += 1;
                }
                Ok(Event::Action(action)) => self.captured_actions.push(action),
                Ok(_) => {}
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }

        self.processed_internal - processed_before
    }

    /// Convenience: queue a report and immediately flush.
    pub async fn report(&mut self, device: &Device) {
        self.queue_report(device);
        self.flush().await;
    }

    pub fn take_actions(&mut self) -> Vec<Action> {
        std::mem::take(&mut self.captured_actions)
    }

    pub fn actions(&self) -> &[Action] {
        &self.captured_actions
    }

    /// Event IDs observed for processed internal updates, in order.
    pub fn event_ids(&self) -> &[crate::types::automation_event::EventId] {
        &self.captured_event_ids
    }

    pub fn statuses(&self) -> Arc<RoutineStatuses> {
        self.routines.get_runtime_statuses()
    }

    pub fn status_for(
        &self,
        routine_id: &RoutineId,
    ) -> Option<crate::types::routine_status::RoutineRuntimeStatus> {
        self.statuses().0.get(routine_id).cloned()
    }

    pub fn processed_internal_count(&self) -> usize {
        self.processed_internal
    }
}

/// Replay a fixture offline and collect per-flush outcomes.
pub async fn run_fixture(fixture: &ReplayFixture) -> ReplayRun {
    let mut harness = BaselineHarness::from_fixture(fixture);
    let mut steps = Vec::new();

    for (step_index, step) in fixture.steps.iter().enumerate() {
        match step {
            ReplayStep::QueueReport { device } => harness.queue_report(device),
            ReplayStep::ForceInvalidateGroups => harness.groups.force_invalidate(&harness.devices),
            ReplayStep::Flush => {
                harness.flush().await;
                let statuses = harness
                    .statuses()
                    .0
                    .iter()
                    .map(|(id, status)| (id.clone(), status.clone()))
                    .collect();
                steps.push(StepOutcome {
                    step_index,
                    actions: harness.take_actions(),
                    statuses,
                });
            }
        }
    }

    let final_statuses = harness
        .statuses()
        .0
        .iter()
        .map(|(id, status)| (id.clone(), status.clone()))
        .collect();

    ReplayRun {
        fixture_id: fixture.id.clone(),
        steps,
        final_statuses,
        final_devices: harness.devices.get_state().clone(),
        final_flattened_groups: harness.groups.get_flattened_groups().clone(),
    }
}

pub fn test_cli() -> Cli {
    Cli {
        dry_run: true,
        port: 45289,
        database_url: None,
        config: None,
        warmup_time: None,
        command: None,
    }
}

/// Total action count keyed by a stable label, useful in assertions.
pub fn action_counts(actions: &[Action]) -> HashMap<&'static str, usize> {
    let mut counts = HashMap::new();
    for action in actions {
        let label = match action {
            Action::ActivateScene(_) => "activate_scene",
            Action::CycleScenes(_) => "cycle_scenes",
            Action::Custom(_) => "custom",
            Action::Dim(_) => "dim",
            Action::ForceTriggerRoutine(_) => "force_trigger_routine",
            Action::SetDeviceState(_) => "set_device_state",
            Action::RandomizeColor(_) => "randomize_color",
            Action::ToggleDeviceOverride { .. } => "toggle_device_override",
            Action::Ui(_) => "ui",
            Action::EvalExpr(_) => "eval_expr",
        };
        *counts.entry(label).or_insert(0) += 1;
    }
    counts
}
