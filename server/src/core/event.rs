use rand::Rng;
use std::collections::{BTreeMap, HashSet, VecDeque};

use color_eyre::Result;

use crate::db::actions::{db_store_scene_overrides, db_store_ui_state};
use crate::types::{
    action::Action,
    automation_event::{
        AutomationFrame, DeviceMutation, EventCausation, EventOrigin, FrameDisposition,
        MAX_CAUSATION_DEPTH, MAX_DERIVATION_STEPS,
    },
    automation_source::LightProfile,
    automation_trace::{PlannedRunStatus, StepDisposition},
    automation_value::HelperPersistence,
    color::DeviceColor,
    device::{Device, DeviceData, DeviceKey, DevicesState},
    dim::DimDescriptor,
    event::*,
    group::GroupId,
    integration::CustomActionDescriptor,
    routine_status::RuleRuntimeStatus,
    rule::{ForceTriggerRoutineDescriptor, RoutineId},
    scene::{
        ActivateSceneActionDescriptor, ActivateSceneDescriptor, CycleScenesDescriptor, SceneConfig,
        SceneDevicesConfig, SceneId,
    },
    ui::UiActionDescriptor,
};

use crate::db::config_queries;

use super::devices::ActivateSceneRequest;
use super::snapshot::SnapshotChanges;
use super::state::{AppState, PendingWsUpdate};
use super::{
    automation::{
        guard_suppression, step_status, CompleteResult, ConditionOutcome, FrameContext,
        InvocationToken, PlanInputs, PlannedStep, PlannedStepBody, RoutinePlan,
        SceneMaterializationCompletion, ScriptOutputContract,
    },
    groups::Groups,
    integrations::Integrations,
    routines::FinalizedRuleRun,
};

use super::automation::sources;

/// Resolves the effective scene id for an action that may reference the
/// currently active scene of another group. Falls back to `fallback_scene_id`
/// when the referenced group has no unanimous active scene.
fn resolve_mirrored_scene_id(
    fallback_scene_id: &SceneId,
    mirror_from_group: Option<&GroupId>,
    groups: &Groups,
    devices: &DevicesState,
) -> SceneId {
    let Some(group_id) = mirror_from_group else {
        return fallback_scene_id.clone();
    };

    match groups.get_group_scene_id(devices, group_id) {
        Some(scene_id) => scene_id,
        None => {
            debug!(
                "mirror_from_group = {group_id} has no unanimous active scene; \
                 falling back to {fallback_scene_id}"
            );
            fallback_scene_id.clone()
        }
    }
}

fn scene_row_from_config(scene_id: &SceneId, config: &SceneConfig) -> config_queries::SceneRow {
    let device_states = config
        .devices
        .as_ref()
        .map(|devices| {
            devices
                .0
                .iter()
                .flat_map(|(integration_id, devices)| {
                    devices.iter().filter_map(move |(device_name, config)| {
                        serde_json::to_value(config)
                            .ok()
                            .map(|value| (format!("{integration_id}/{device_name}"), value))
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let group_states = config
        .groups
        .as_ref()
        .map(|groups| {
            groups
                .0
                .iter()
                .filter_map(|(group_id, config)| {
                    serde_json::to_value(config)
                        .ok()
                        .map(|value| (group_id.to_string(), value))
                })
                .collect()
        })
        .unwrap_or_default();

    let group_state_order = config
        .groups
        .as_ref()
        .map(|groups| groups.0.keys().map(ToString::to_string).collect())
        .unwrap_or_default();

    config_queries::SceneRow {
        id: scene_id.to_string(),
        name: config.name.clone(),
        hidden: config.hidden.unwrap_or(false),
        script: config.script.clone(),
        device_states,
        group_states,
        group_state_order,
    }
}

#[derive(Default)]
pub struct EventOutcome {
    deferred_work: Vec<DeferredEventWork>,
    snapshot_changes: SnapshotChanges,
}

impl EventOutcome {
    fn push(&mut self, work: DeferredEventWork) {
        self.deferred_work.push(work);
    }

    fn include(&mut self, other: EventOutcome) {
        self.deferred_work.extend(other.deferred_work);
        self.snapshot_changes.include(other.snapshot_changes);
    }

    fn mark_snapshot_changes(&mut self, changes: SnapshotChanges) {
        self.snapshot_changes.include(changes);
    }

    pub fn snapshot_changes(&self) -> SnapshotChanges {
        self.snapshot_changes
    }

    pub fn into_deferred_work(self) -> Vec<DeferredEventWork> {
        self.deferred_work
    }
}

pub enum DeferredEventWork {
    PublishIntegrationState {
        integrations: Integrations,
        device: Box<Device>,
    },
    RunIntegrationAction {
        integrations: Integrations,
        descriptor: CustomActionDescriptor,
    },
    PersistSceneOverride {
        scene_id: SceneId,
        overrides: Box<SceneDevicesConfig>,
    },
    UpsertConfigScene {
        scene_id: SceneId,
        scene: Box<config_queries::SceneRow>,
    },
    DeleteConfigScene {
        scene_id: SceneId,
    },
    StoreUiState {
        key: String,
        value: serde_json::Value,
    },
    PersistHelperValue {
        helper: crate::types::automation_definition::HelperId,
        value: serde_json::Value,
        revision: i64,
    },
    /// Best-effort write-through of one named timer job (P10).
    PersistTimerJob {
        job: Box<crate::core::automation::PersistedTimerJob>,
    },
    /// Remove a consumed or explicitly cancelled named timer job (P10).
    DeleteTimerJob {
        routine_id: crate::types::rule::RoutineId,
        timer: crate::types::automation_definition::TimerId,
    },
}

impl std::fmt::Debug for DeferredEventWork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PublishIntegrationState { device, .. } => f
                .debug_struct("PublishIntegrationState")
                .field("device", device)
                .finish(),
            Self::RunIntegrationAction { descriptor, .. } => f
                .debug_struct("RunIntegrationAction")
                .field("integration_id", &descriptor.integration_id)
                .finish(),
            Self::PersistSceneOverride { scene_id, .. } => f
                .debug_struct("PersistSceneOverride")
                .field("scene_id", scene_id)
                .finish(),
            Self::UpsertConfigScene { scene_id, .. } => f
                .debug_struct("UpsertConfigScene")
                .field("scene_id", scene_id)
                .finish(),
            Self::DeleteConfigScene { scene_id } => f
                .debug_struct("DeleteConfigScene")
                .field("scene_id", scene_id)
                .finish(),
            Self::StoreUiState { key, .. } => {
                f.debug_struct("StoreUiState").field("key", key).finish()
            }
            Self::PersistHelperValue { helper, .. } => f
                .debug_struct("PersistHelperValue")
                .field("helper", helper)
                .finish(),
            Self::PersistTimerJob { job } => f
                .debug_struct("PersistTimerJob")
                .field("routine_id", &job.routine_id)
                .field("timer", &job.timer)
                .finish(),
            Self::DeleteTimerJob { routine_id, timer } => f
                .debug_struct("DeleteTimerJob")
                .field("routine_id", routine_id)
                .field("timer", timer)
                .finish(),
        }
    }
}

impl DeferredEventWork {
    pub async fn execute(self) -> Result<()> {
        match self {
            DeferredEventWork::PublishIntegrationState {
                integrations,
                device,
            } => integrations.set_integration_device_state(*device).await,
            DeferredEventWork::RunIntegrationAction {
                integrations,
                descriptor,
            } => {
                integrations
                    .run_integration_action(&descriptor.integration_id, &descriptor.payload)
                    .await
            }
            DeferredEventWork::PersistSceneOverride {
                scene_id,
                overrides,
            } => {
                if let Err(error) = db_store_scene_overrides(&scene_id, &overrides).await {
                    warn!("Failed to persist scene override for {scene_id}: {error}");
                }

                Ok(())
            }
            DeferredEventWork::UpsertConfigScene { scene_id, scene } => {
                if let Err(error) = config_queries::db_upsert_config_scene(&scene).await {
                    warn!("DB not available when storing scene {scene_id}: {error}");
                }

                Ok(())
            }
            DeferredEventWork::DeleteConfigScene { scene_id } => {
                if let Err(error) =
                    config_queries::db_delete_config_scene(&scene_id.to_string()).await
                {
                    warn!("DB not available when deleting scene {scene_id}: {error}");
                }

                Ok(())
            }
            DeferredEventWork::StoreUiState { key, value } => {
                if let Err(error) = db_store_ui_state(&key, &value).await {
                    warn!("DB not available when storing UI state '{key}': {error}");
                }

                Ok(())
            }
            DeferredEventWork::PersistHelperValue {
                helper,
                value,
                revision,
            } => {
                if let Err(error) =
                    config_queries::db_upsert_helper_state(&helper.to_string(), &value, revision)
                        .await
                {
                    warn!("DB not available when storing helper '{helper}': {error}");
                }

                Ok(())
            }
            DeferredEventWork::PersistTimerJob { job } => {
                let row = match timer_job_row(&job) {
                    Ok(row) => row,
                    Err(error) => {
                        warn!("Failed to serialize timer job for persistence: {error}");
                        return Ok(());
                    }
                };
                if let Err(error) = config_queries::db_upsert_timer_job(&row).await {
                    warn!(
                        "DB not available when storing timer {}/{}: {error}",
                        job.routine_id, job.timer
                    );
                }

                Ok(())
            }
            DeferredEventWork::DeleteTimerJob { routine_id, timer } => {
                if let Err(error) =
                    config_queries::db_delete_timer_job(&routine_id.0, &timer.0).await
                {
                    warn!("DB not available when deleting timer {routine_id}/{timer}: {error}");
                }

                Ok(())
            }
        }
    }
}

/// Convert one named timer job into its stored row (P10). Captured intent
/// tokens stay process-local; only the capture spec is stored.
fn timer_job_row(
    job: &crate::core::automation::PersistedTimerJob,
) -> Result<config_queries::TimerJobRow> {
    Ok(config_queries::TimerJobRow {
        routine_id: job.routine_id.0.clone(),
        timer_id: job.timer.0.clone(),
        definition_revision: job.definition_revision,
        generation: i64::try_from(job.generation).map_err(|_| {
            color_eyre::eyre::eyre!("timer generation {} cannot be stored", job.generation)
        })?,
        due_wall_ms: job.due_wall_ms,
        capture: job
            .capture
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?,
    })
}

/// Origin to record on a rejected causally-derived frame.
fn causation_origin(event: &Event) -> EventOrigin {
    match event {
        Event::SetInternalState { origin, .. } | Event::ApplyDeviceState { origin, .. } => {
            origin.unwrap_or(EventOrigin::Derived)
        }
        _ => EventOrigin::Derived,
    }
}

/// Apply one internal state publication: scene-override bookkeeping, scene
/// resolution, and the device mutation. Shared by [`Event::SetInternalState`]
/// and computed-source refreshes (P11) so the two paths cannot drift.
fn apply_internal_state(
    state: &mut AppState,
    device: &Device,
    skip_external_update: Option<bool>,
    skip_db_update: Option<bool>,
    origin: Option<EventOrigin>,
) -> Result<EventOutcome> {
    let mut outcome = EventOutcome::default();

    let has_scene_override = state.scenes.has_override(device);
    if has_scene_override {
        let (scene_id, overrides) = state.scenes.store_scene_override_in_memory(device, true)?;
        outcome.push(DeferredEventWork::PersistSceneOverride {
            scene_id,
            overrides: Box::new(overrides),
        });
        state.scenes.force_invalidate(&state.devices, &state.groups);
        outcome.mark_snapshot_changes(SnapshotChanges {
            flattened_scenes: true,
            routine_statuses: true,
            ..SnapshotChanges::none()
        });
    }

    let device = device.set_scene(
        device.get_scene_id().as_ref(),
        &state.scenes,
        &state.devices,
    );

    state.devices.set_state_with_origin(
        &device,
        skip_external_update.unwrap_or_default(),
        skip_db_update.unwrap_or(true),
        origin.unwrap_or(EventOrigin::Command),
    );
    if origin.unwrap_or(EventOrigin::Command) == EventOrigin::Command {
        state.intents.bump_device(&device.get_device_key());
    }
    outcome.mark_snapshot_changes(SnapshotChanges::devices());
    Ok(outcome)
}

pub async fn handle_event(state: &mut AppState, event: &Event) -> Result<EventOutcome> {
    let mut outcome = EventOutcome::default();

    // Every actor command gets its own mutation frame context. Derived
    // commands carry the causation of the frame that spawned them.
    let causation = event.causation().unwrap_or_default();
    state.devices.begin_command(causation);

    // E08: terminate causal chains at a fixed bound. The rejected command is
    // recorded as a limited frame so the loop is visible instead of silent.
    if causation.depth > MAX_CAUSATION_DEPTH {
        let frame_id = state.devices.frame_id();
        warn!(
            "Causation bound {MAX_CAUSATION_DEPTH} reached; rejecting derived event (cause={:?}, depth={})",
            causation.cause_id, causation.depth
        );
        state.frame_log.record(AutomationFrame {
            frame_id,
            origin: causation_origin(event),
            causation,
            mutations: Vec::new(),
            evaluated: false,
            disposition: FrameDisposition::CausationLimited,
        });
        return Ok(outcome);
    }

    match event {
        Event::DeviceAvailability {
            device_key,
            online,
            observed_at_ms,
            integration_epoch,
        } => {
            if !state
                .integrations
                .accepts_integration_epoch(&device_key.integration_id, *integration_epoch)
            {
                debug!(
                    "Rejecting availability update from superseded integration instance: {device_key}"
                );
                return Ok(outcome);
            }
            if let Some(mut device) = state.devices.get_device(device_key).cloned() {
                if let crate::types::device::DeviceData::Controllable(data) = &mut device.data {
                    if *observed_at_ms == 0
                        && data
                            .availability
                            .as_ref()
                            .is_some_and(|value| value.observed_at_ms > 0)
                    {
                        return Ok(outcome);
                    }
                    data.availability = Some(crate::types::device::DeviceAvailability {
                        online: *online,
                        observed_at_ms: *observed_at_ms,
                    });
                    state
                        .devices
                        .set_state_with_origin(&device, true, true, EventOrigin::Report);
                    outcome.mark_snapshot_changes(SnapshotChanges::devices());
                }
            }
        }
        Event::ExternalStateUpdate {
            device,
            integration_epoch,
        } => {
            if !state
                .integrations
                .accepts_integration_epoch(&device.integration_id, *integration_epoch)
            {
                debug!(
                    "Rejecting state report from superseded integration instance: {}",
                    device.get_device_key()
                );
                return Ok(outcome);
            }
            let source_is_disabled = state
                .runtime_config
                .integrations
                .iter()
                .find(|integration| integration.id == device.integration_id.to_string())
                .is_some_and(|integration| {
                    crate::types::integration::device_is_disabled(
                        &integration.config,
                        &device.id.to_string(),
                    )
                });
            if source_is_disabled {
                return Ok(outcome);
            }

            if state
                .calibration_preview_device(&device.get_device_key().to_string())
                .is_some()
            {
                // A preview report must not replace normal state or trigger drift correction.
                return Ok(outcome);
            }
            let calibration = state
                .runtime_config
                .calibration_for_device(&device.get_device_key().to_string());
            state
                .devices
                .handle_external_state_update_calibrated(
                    device,
                    &state.scenes,
                    calibration.as_ref(),
                )
                .await?;
            outcome.mark_snapshot_changes(SnapshotChanges::devices());
        }
        Event::StartupCompleted => {
            state.groups.force_invalidate(&state.devices);

            state.scenes.force_invalidate(&state.devices, &state.groups);

            // E06: an already-true predicate at startup is seeded as already
            // matched rather than treated as a fresh edge.
            state
                .rules
                .seed_transitions(&state.devices, &state.groups, Some(&state.helpers));
            state.refresh_routine_statuses();
            let changes = SnapshotChanges::startup_completed();
            state.schedule_ws_broadcast(changes);
            outcome.mark_snapshot_changes(changes);

            let device_count = state.devices.get_state().0.len();
            info!("Startup completed, discovered {device_count} devices");
        }
        Event::InternalStateUpdate {
            device_key,
            old,
            new,
            event_id,
            origin,
            causation,
        } => {
            if state.warming_up {
                return Ok(outcome);
            }

            let invalidated_device = new;
            debug!("invalidating {name}", name = invalidated_device.name);
            let device_was_added = old.is_none();

            let _groups_invalidated = state.groups.invalidate(device_was_added, &state.devices);

            let invalidated_scenes = state.scenes.invalidate(
                old.as_ref(),
                invalidated_device,
                &state.devices,
                &state.groups,
            );
            let device_positions = state.effective_device_positions();

            state.devices.invalidate(
                device_key,
                &invalidated_scenes,
                &state.scenes,
                &device_positions,
            );

            // Compatibility path for the deprecated event variant. Producers
            // now collect mutations instead; this still evaluates coherently.
            let frame_id = state.devices.frame_id();
            let mutation = crate::types::automation_event::DeviceMutation {
                event_id: event_id.unwrap_or(frame_id),
                device_key: device_key.clone(),
                before: old.clone(),
                after: new.clone(),
                origin: origin.unwrap_or(EventOrigin::Derived),
            };
            state
                .rules
                .handle_internal_state_update(
                    &mutation,
                    &state.devices,
                    &state.groups,
                    mutation.origin,
                    causation.unwrap_or_default(),
                    Some(frame_id),
                )
                .await;

            // P07: legacy script leaves captured by this evaluation run
            // off-actor; results finalize the captured decision later.
            state.execute_deferred_legacy_scripts().await;

            // P04: evaluate v2 routines against the same single-mutation frame.
            if !state.rules.compiled_v2_routines().is_empty() {
                let after_view = state.devices.get_state().clone();
                let mut before_view = after_view.clone();
                match &mutation.before {
                    Some(before) => {
                        before_view
                            .0
                            .insert(mutation.device_key.clone(), before.clone());
                    }
                    None => {
                        before_view.0.remove(&mutation.device_key);
                    }
                }
                let v2_frame = FrameContext {
                    mutations: std::slice::from_ref(&mutation),
                    before: &before_view,
                    after: &after_view,
                    groups: &state.groups,
                    helpers: Some(&state.helpers),
                    fired_timers: &[],
                    predicate_fires: &[],
                    schedule_fires: &[],
                };
                let evaluations = state.rules.handle_v2_frame(&v2_frame);
                if !evaluations.is_empty() {
                    state.refresh_routine_statuses();
                }
            }

            let mut changes = SnapshotChanges {
                devices: true,
                routine_statuses: true,
                ..SnapshotChanges::none()
            };
            if device_was_added {
                changes.flattened_groups = true;
                changes.flattened_scenes = true;
            } else if !invalidated_scenes.is_empty() {
                changes.flattened_scenes = true;
            }

            state
                .schedule_ws_broadcast(PendingWsUpdate::device_upsert(device_key.clone(), changes));
            outcome.mark_snapshot_changes(changes);
        }
        Event::SetInternalState {
            device,
            skip_external_update,
            skip_db_update,
            origin,
            causation: _,
            integration_epoch,
        } => {
            if !state
                .integrations
                .accepts_integration_epoch(&device.integration_id, *integration_epoch)
            {
                debug!(
                    "Rejecting state publication from superseded integration instance: {}",
                    device.get_device_key()
                );
                return Ok(outcome);
            }
            outcome.include(apply_internal_state(
                state,
                device,
                *skip_external_update,
                *skip_db_update,
                *origin,
            )?);
        }
        Event::SourceRefreshTick => {
            outcome.mark_snapshot_changes(state.refresh_due_sources());
            outcome.mark_snapshot_changes(state.dispatch_due_source_scripts().await);
        }
        Event::SetExternalState { device } => {
            let calibration = state
                .runtime_config
                .calibration_for_device(&device.get_device_key().to_string());
            let physical = state
                .calibration_preview_device(&device.get_device_key().to_string())
                .unwrap_or_else(|| {
                    crate::core::color_calibration::calibrated_device(device, calibration.as_ref())
                });
            let physical = state.apply_default_transition(physical);
            outcome.push(DeferredEventWork::PublishIntegrationState {
                integrations: state.integrations.clone(),
                device: Box::new(physical),
            });
        }
        Event::ApplyDeviceState {
            device,
            skip_external_update,
            skip_db_update,
            origin,
            causation: _,
        } => {
            state.devices.set_state_with_origin(
                device,
                skip_external_update.unwrap_or_default(),
                skip_db_update.unwrap_or_default(),
                origin.unwrap_or(EventOrigin::Derived),
            );
            if *origin == Some(EventOrigin::Command) {
                state.intents.bump_device(&device.get_device_key());
            }
            outcome.mark_snapshot_changes(SnapshotChanges::devices());
        }
        Event::DbStoreScene { scene_id, config } => {
            let scene = scene_row_from_config(scene_id, config);
            state.upsert_scene(scene.clone());
            state.apply_runtime_scenes();

            outcome.push(DeferredEventWork::UpsertConfigScene {
                scene_id: scene_id.clone(),
                scene: Box::new(scene),
            });
            outcome.mark_snapshot_changes(SnapshotChanges::scenes());
        }
        Event::DbDeleteScene { scene_id } => {
            let deleted = state.delete_scene(&scene_id.to_string());
            if deleted {
                state.apply_runtime_scenes();
            }

            if deleted {
                outcome.push(DeferredEventWork::DeleteConfigScene {
                    scene_id: scene_id.clone(),
                });
                outcome.mark_snapshot_changes(SnapshotChanges::scenes());
            }
        }
        Event::DbEditScene { scene_id, name } => {
            let updated_scene = if let Some(scene) = state
                .runtime_config
                .scenes
                .iter_mut()
                .find(|scene| scene.id == scene_id.to_string())
            {
                scene.name = name.clone();
                Some(scene.clone())
            } else {
                None
            };

            if updated_scene.is_some() {
                state.apply_runtime_scenes();
            }

            if let Some(scene) = updated_scene.as_ref() {
                outcome.push(DeferredEventWork::UpsertConfigScene {
                    scene_id: scene_id.clone(),
                    scene: Box::new(scene.clone()),
                });
                outcome.mark_snapshot_changes(SnapshotChanges::scenes());
            }

            if updated_scene.is_none() {
                warn!(
                    "Ignoring scene rename for missing scene {scene}",
                    scene = scene_id
                );
            }
        }
        Event::Action(action) => {
            handle_action(state, action, &mut outcome, true).await?;
        }
        Event::RoutineAction { action, .. } => {
            handle_action(state, action, &mut outcome, false).await?;
        }
        Event::RoutineSetHelper { helper, value, .. } => {
            apply_helper_write(state, helper, value, &mut outcome);
        }
        Event::RoutineScriptResult {
            routine_id,
            request_id,
            owner_key,
            owner_generation,
            definition_revision,
            state_revision,
            causation,
            value,
            error,
        } => {
            let token = InvocationToken {
                request_id: *request_id,
                owner_key: owner_key.clone(),
                owner_generation: *owner_generation,
                definition_revision: *definition_revision,
                state_revision: *state_revision,
                contract: ScriptOutputContract::RoutineHandler,
            };
            apply_script_result(
                state,
                routine_id,
                &token,
                *causation,
                value.clone(),
                error.clone(),
            );
            outcome.mark_snapshot_changes(SnapshotChanges {
                routine_statuses: true,
                ..SnapshotChanges::none()
            });
        }
        Event::RuleScriptLeafResult {
            routine_id,
            request_id,
            owner_key,
            owner_generation,
            definition_revision,
            state_revision,
            value,
            error,
        } => {
            let token = InvocationToken {
                request_id: *request_id,
                owner_key: owner_key.clone(),
                owner_generation: *owner_generation,
                definition_revision: *definition_revision,
                state_revision: *state_revision,
                contract: ScriptOutputContract::Condition,
            };
            let resolution =
                legacy_leaf_resolution(state, &token, value.as_ref(), error.as_deref());
            let finalized =
                state
                    .rules
                    .resolve_deferred_leaf_result(routine_id, *request_id, resolution);
            dispatch_finalized_rule_runs(state, finalized);
            state.refresh_routine_statuses();
            outcome.mark_snapshot_changes(SnapshotChanges {
                routine_statuses: true,
                ..SnapshotChanges::none()
            });
        }

        Event::SceneMaterializedResult {
            scene_id,
            request_id,
            owner_key,
            owner_generation,
            definition_revision,
            state_revision,
            value,
            error,
        } => {
            let completion = state.scripts.complete_scene_materialization(
                *request_id,
                owner_key.clone(),
                *owner_generation,
                *definition_revision,
                *state_revision,
                value.clone(),
                error.clone(),
            );
            match completion {
                SceneMaterializationCompletion::Applied(value) => {
                    if let Some(affected) = state.scenes.apply_scene_script_result(
                        &state.devices,
                        &state.groups,
                        scene_id,
                        *definition_revision,
                        Some(&value),
                        None,
                    ) {
                        let positions = state.effective_device_positions();
                        let scene_ids: HashSet<SceneId> = [scene_id.clone()].into_iter().collect();
                        for device_key in affected {
                            state.devices.invalidate(
                                &device_key,
                                &scene_ids,
                                &state.scenes,
                                &positions,
                            );
                        }
                        outcome.mark_snapshot_changes(SnapshotChanges {
                            devices: true,
                            flattened_scenes: true,
                            ..SnapshotChanges::none()
                        });
                    }
                }
                SceneMaterializationCompletion::Failed(message) => {
                    state.scenes.record_scene_script_error(scene_id, &message);
                    outcome.mark_snapshot_changes(SnapshotChanges {
                        flattened_scenes: true,
                        ..SnapshotChanges::none()
                    });
                }
                SceneMaterializationCompletion::Stale(reason) => {
                    debug!(
                        "Ignoring stale scene materialization for {scene_id}: {}",
                        reason.as_str()
                    );
                }
            }
        }

        Event::SourceScriptResult {
            source_id,
            request_id,
            owner_key,
            owner_generation,
            definition_revision,
            state_revision,
            value,
            error,
        } => {
            let token = InvocationToken {
                request_id: *request_id,
                owner_key: owner_key.clone(),
                owner_generation: *owner_generation,
                definition_revision: *definition_revision,
                state_revision: *state_revision,
                contract: ScriptOutputContract::ComputedSource,
            };
            match (value, error) {
                (Some(value), _) => match state.scripts.complete_computed_source(&token, value) {
                    CompleteResult::Applied { value: applied, .. } => {
                        let profile = serde_json::from_value::<LightProfile>(applied.value.clone())
                            .map_err(|error| {
                                format!("source result is not a light profile: {error}")
                            })
                            .and_then(|profile| profile.validate().map(|_| profile));
                        match profile {
                            Ok(profile) => {
                                if let Some(definition) =
                                    state.sources.definitions().get(source_id).cloned()
                                {
                                    let now_wall_ms = state.clock.wall_ms();
                                    let local_time =
                                        sources::local_time_label(&definition, now_wall_ms).ok();
                                    state.sources.record_success(
                                        &definition,
                                        profile.clone(),
                                        local_time,
                                        now_wall_ms,
                                    );
                                    let device = sources::synthetic_device(&definition, &profile);
                                    let first_publish = state
                                        .devices
                                        .get_device(&device.get_device_key())
                                        .is_none();
                                    match apply_internal_state(
                                        state,
                                        &device,
                                        Some(true),
                                        Some(true),
                                        Some(EventOrigin::Derived),
                                    ) {
                                        Ok(publish) => {
                                            outcome.include(publish);
                                        }
                                        Err(error) => {
                                            warn!(
                                                "Computed source {} failed to publish: {error:#}",
                                                definition.id.0
                                            );
                                            state.sources.record_failure(
                                                &definition.id,
                                                error.to_string(),
                                                now_wall_ms,
                                            );
                                        }
                                    }
                                    // A first result makes `computed/<id>`
                                    // resolvable, so routines quarantined at
                                    // startup can compile now.
                                    if first_publish {
                                        state.apply_runtime_routines();
                                    }
                                }
                            }
                            Err(message) => {
                                warn!(
                                    "Computed source {} returned an invalid profile: {message}",
                                    source_id.0
                                );
                                state.sources.record_failure(
                                    source_id,
                                    message,
                                    state.clock.wall_ms(),
                                );
                            }
                        }
                    }
                    CompleteResult::Stale(reason) => {
                        debug!(
                            "Ignoring stale computed source result for {}: {}",
                            source_id.0,
                            reason.as_str()
                        );
                    }
                    CompleteResult::ContractError { message } => {
                        warn!("Computed source {} contract error: {message}", source_id.0);
                        state
                            .sources
                            .record_failure(source_id, message, state.clock.wall_ms());
                    }
                },
                (None, Some(message)) => {
                    if state.scripts.abandon_source(&token).is_ok() {
                        warn!("Computed source {} script failed: {message}", source_id.0);
                        state.sources.record_failure(
                            source_id,
                            message.clone(),
                            state.clock.wall_ms(),
                        );
                    }
                }
                (None, None) => {
                    if state.scripts.abandon_source(&token).is_ok() {
                        state.sources.record_failure(
                            source_id,
                            "source worker returned no result".to_string(),
                            state.clock.wall_ms(),
                        );
                    }
                }
            }
            outcome.mark_snapshot_changes(SnapshotChanges {
                devices: true,
                routine_statuses: true,
                ..SnapshotChanges::none()
            });
        }

        Event::RoutineTimerOperation {
            routine_id,
            definition_revision,
            operation,
            capture,
            causation: _,
        } => {
            let current_revision = state
                .rules
                .compiled_v2_routines()
                .get(routine_id)
                .map(|definition| definition.revision);
            match current_revision {
                Some(current) if current == *definition_revision => {
                    // A relative timer starts when the actor accepts the
                    // scheduling operation, not when its script frame was
                    // queued (P09 clock policy).
                    let now_monotonic_ms = state.clock.monotonic_ms();
                    let now_wall_ms = state.clock.wall_ms();
                    // J08: freeze intent tokens now. Earlier plan steps were
                    // queued before this command, so their manual bumps are
                    // already reflected; a later manual change can only be
                    // observed as a newer revision at expiry.
                    let captured = capture.as_ref().map(|capture| {
                        let tokens = capture
                            .targets
                            .iter()
                            .map(|target| {
                                let intent_target = match target {
                                    crate::types::automation_definition::TimerIntentTarget::Device {
                                        device,
                                    } => crate::core::automation::IntentTarget::Device(
                                        device.clone(),
                                    ),
                                    crate::types::automation_definition::TimerIntentTarget::Group {
                                        group,
                                    } => crate::core::automation::IntentTarget::Group(
                                        group.clone(),
                                    ),
                                };
                                (target.clone(), state.intents.revision(&intent_target))
                            })
                            .collect();
                        crate::core::automation::CapturedTimerIntents {
                            capture: capture.clone(),
                            tokens,
                        }
                    });
                    match state.timers.apply(
                        routine_id,
                        *definition_revision,
                        operation,
                        captured,
                        now_monotonic_ms,
                        now_wall_ms,
                    ) {
                        Ok(_) => {
                            outcome.mark_snapshot_changes(SnapshotChanges {
                                timers: true,
                                ..SnapshotChanges::none()
                            });
                            // P10: write-through best-effort. Scheduling and
                            // replacing upsert the job row; cancelling deletes
                            // it so an acknowledged cancel survives a restart.
                            match operation {
                                crate::types::automation_definition::TimerOperation::Cancel {
                                    timer,
                                } => {
                                    outcome.push(DeferredEventWork::DeleteTimerJob {
                                        routine_id: routine_id.clone(),
                                        timer: timer.clone(),
                                    });
                                }
                                operation => {
                                    let timer = match operation {
                                        crate::types::automation_definition::TimerOperation::Schedule { timer, .. }
                                        | crate::types::automation_definition::TimerOperation::Replace { timer, .. } => timer,
                                        crate::types::automation_definition::TimerOperation::Cancel { .. } => unreachable!(),
                                    };
                                    if let Some(job) =
                                        state.timers.named_job_snapshot(routine_id, timer)
                                    {
                                        outcome.push(DeferredEventWork::PersistTimerJob {
                                            job: Box::new(job),
                                        });
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            warn!(
                                "Timer operation for routine {routine_id} failed: {}",
                                error.message()
                            );
                        }
                    }
                }
                _ => debug!("Ignoring timer operation for edited or missing routine {routine_id}"),
            }
        }

        Event::TimerWakeup {
            routine_id,
            definition_revision,
            job,
            generation,
            due_wall_ms,
        } => match job {
            crate::types::event::TimerWakeupJob::NamedTimer { timer } => {
                match state
                    .timers
                    .consume(routine_id, *definition_revision, timer, *generation)
                {
                    Some(fire) => {
                        state.pending_timer_fires.push(fire);
                        // P10: a consumed generation is gone; delete the row
                        // so a restart cannot replay an already-fired timer.
                        outcome.push(DeferredEventWork::DeleteTimerJob {
                            routine_id: routine_id.clone(),
                            timer: timer.clone(),
                        });
                        outcome.mark_snapshot_changes(SnapshotChanges {
                            timers: true,
                            ..SnapshotChanges::none()
                        });
                    }
                    None => debug!(
                        "Ignoring stale timer wakeup for {routine_id}: \
                         timer={timer} generation={generation} due_at={due_wall_ms}"
                    ),
                }
            }
            crate::types::event::TimerWakeupJob::PredicateDeadline { trigger } => {
                match state.timers.consume_predicate(
                    routine_id,
                    *definition_revision,
                    trigger,
                    *generation,
                ) {
                    Some(fire) => state.pending_predicate_fires.push(fire),
                    None => debug!(
                        "Ignoring stale predicate wakeup for {routine_id}: \
                         trigger={trigger} generation={generation} due_at={due_wall_ms}"
                    ),
                }
            }
            crate::types::event::TimerWakeupJob::ScheduleOccurrence { trigger } => {
                match state.timers.consume_schedule(
                    routine_id,
                    *definition_revision,
                    trigger,
                    *generation,
                ) {
                    Some(fire) => {
                        match state.schedule_spec(routine_id, *definition_revision, trigger) {
                            // K: lateness is not backlog. A skipped occurrence
                            // still runs; a bounded catch-up that is too late
                            // is dropped, and the next occurrence is armed from
                            // the current time either way.
                            Some(spec)
                                if state.schedule_within_lateness(&spec, fire.due_wall_ms) =>
                            {
                                state.pending_schedule_fires.push(fire);
                            }
                            Some(_) => debug!(
                                "Skipping late schedule occurrence for {routine_id}: \
                                 trigger={trigger} due_at={due_wall_ms}"
                            ),
                            None => debug!(
                                "Ignoring schedule wakeup without a live trigger for \
                                 {routine_id}: trigger={trigger}"
                            ),
                        }
                        // K: arm the next occurrence from the current time so a
                        // drop never stalls the schedule; the status projection
                        // picks up the new deadline either way.
                        state.arm_schedules();
                        state.refresh_routine_statuses();
                    }
                    None => debug!(
                        "Ignoring stale schedule wakeup for {routine_id}: \
                         trigger={trigger} generation={generation} due_at={due_wall_ms}"
                    ),
                }
            }
        },
    }

    Ok(outcome)
}

/// Complete one legacy rule-script leaf against the coordinator and turn the
/// outcome into a captured leaf status. Stale, contract, and worker failures
/// stay visible in the routine status and dispatch nothing (Section 6.4).
fn legacy_leaf_resolution(
    state: &mut AppState,
    token: &InvocationToken,
    value: Option<&serde_json::Value>,
    error: Option<&str>,
) -> RuleRuntimeStatus {
    if let Some(message) = error {
        return RuleRuntimeStatus::from_error(format!(
            "script_worker_error: {}",
            super::automation::bounded_text(message)
        ));
    }
    let value = value.cloned().unwrap_or(serde_json::Value::Bool(false));
    match state
        .scripts
        .coordinator_mut()
        .complete_condition(token, &value)
    {
        CompleteResult::Applied { value, .. } => {
            let matched = matches!(value, ConditionOutcome::Known(true));
            RuleRuntimeStatus::from_match(matched, matched)
        }
        CompleteResult::Stale(reason) => {
            RuleRuntimeStatus::from_error(format!("script_result_stale: {}", reason.as_str()))
        }
        CompleteResult::ContractError { message } => RuleRuntimeStatus::from_error(format!(
            "script_contract_error: {}",
            super::automation::bounded_text(&message)
        )),
    }
}

/// Dispatch the actions of finalized legacy decisions through the same
/// `RoutineAction` path as v1 captures, with the frozen frame causation.
fn dispatch_finalized_rule_runs(state: &mut AppState, runs: Vec<FinalizedRuleRun>) {
    for run in runs {
        for action in run.actions {
            state.event_tx.send(Event::RoutineAction {
                action,
                causation: run.causation,
            });
        }
    }
}

/// Apply a validated v2 helper write and schedule durable persistence.
fn apply_helper_write(
    state: &mut AppState,
    helper: &crate::types::automation_definition::HelperId,
    value: &serde_json::Value,
    outcome: &mut EventOutcome,
) {
    match state.helpers.set_value(helper, value.clone()) {
        Ok(updated) => {
            crate::core::value_history::observe_helper(&helper.to_string(), value);
            let durable = state
                .helpers
                .definition(helper)
                .is_some_and(|definition| definition.persistence == HelperPersistence::Durable);
            if durable {
                outcome.push(DeferredEventWork::PersistHelperValue {
                    helper: helper.clone(),
                    value: value.clone(),
                    revision: updated.revision,
                });
            }
            state.refresh_routine_statuses();
            let changes = SnapshotChanges {
                helper_statuses: true,
                routine_statuses: true,
                ..SnapshotChanges::none()
            };
            state.schedule_ws_broadcast(changes);
            outcome.mark_snapshot_changes(changes);
        }
        Err(error) => {
            warn!("Rejected helper write from v2 routine: {error}");
        }
    }
}

/// Complete one supervised script handler result (P07). The result is only
/// accepted for the current owner generation and memory revision; accepted
/// actions are planned against acceptance-time state and dispatched through
/// the same path as native programs. Rejections remain visible in
/// `last_run` and dispatch nothing (S16/X03/X05).
fn apply_script_result(
    state: &mut AppState,
    routine_id: &RoutineId,
    token: &InvocationToken,
    causation: EventCausation,
    value: Option<serde_json::Value>,
    error: Option<String>,
) {
    if let Some(message) = error {
        state.rules.record_v2_script_failure(
            routine_id,
            format!(
                "script_worker_error: {}",
                super::automation::bounded_text(&message)
            ),
        );
        state.refresh_routine_statuses();
        return;
    }

    let value = value.unwrap_or(serde_json::Value::Null);
    match state
        .scripts
        .coordinator_mut()
        .complete_handler(token, &value)
    {
        CompleteResult::Applied { value: outcome, .. } => {
            let plan = {
                let inputs = PlanInputs {
                    devices: state.devices.get_state(),
                    groups: &state.groups,
                    helpers: &state.helpers,
                    intents: &state.intents,
                };
                state
                    .rules
                    .plan_v2_script_run(routine_id, &outcome.actions, &inputs)
            };
            match plan {
                Some(plan) => {
                    let status = state.dispatch_v2_plan(plan, causation);
                    state.rules.record_v2_run(routine_id, status);
                }
                None => state.rules.record_v2_script_failure(
                    routine_id,
                    "script_result_owner_missing".to_string(),
                ),
            }
        }
        CompleteResult::Stale(reason) => state.rules.record_v2_script_failure(
            routine_id,
            format!("script_result_stale: {}", reason.as_str()),
        ),
        CompleteResult::ContractError { message } => state.rules.record_v2_script_failure(
            routine_id,
            format!(
                "script_contract_error: {}",
                super::automation::bounded_text(&message)
            ),
        ),
    }
    state.refresh_routine_statuses();
}

/// Dispatch a routine or user action against the actor-owned state. Kept
/// separate so [`Event::Action`] (roots: API, cron, manual) and
/// [`Event::RoutineAction`] (causation-carrying) share one implementation.
async fn handle_action(
    state: &mut AppState,
    action: &Action,
    outcome: &mut EventOutcome,
    manual: bool,
) -> Result<()> {
    if manual {
        bump_action_intents(state, action);
    }
    match action {
        Action::ActivateScene(ActivateSceneActionDescriptor {
            scene_id,
            mirror_from_group,
            device_keys,
            group_keys,
            include_source_groups: _,
            use_scene_transition,
            transition,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        }) => {
            let device_positions = state.effective_device_positions();
            let resolved_scene_id = resolve_mirrored_scene_id(
                scene_id,
                mirror_from_group.as_ref(),
                &state.groups,
                state.devices.get_state(),
            );
            state
                .devices
                .activate_scene(ActivateSceneRequest {
                    scene_id: &resolved_scene_id,
                    device_keys,
                    group_keys,
                    use_scene_transition: *use_scene_transition,
                    transition,
                    default_transition: state
                        .runtime_config
                        .core
                        .scene_transition_ms
                        .map(|ms| ordered_float::OrderedFloat(ms as f32 / 1000.0)),
                    rollout,
                    rollout_source_device_key,
                    rollout_duration_ms,
                    device_positions: &device_positions,
                    groups: &state.groups,
                    scenes: &state.scenes,
                })
                .await;
            outcome.mark_snapshot_changes(SnapshotChanges::devices());
        }
        Action::CycleScenes(CycleScenesDescriptor {
            scenes,
            nowrap,
            group_keys,
            device_keys,
            include_source_groups: _,
            rollout,
            rollout_source_device_key,
            rollout_duration_ms,
        }) => {
            let device_positions = state.effective_device_positions();
            let resolved_scenes: Vec<ActivateSceneDescriptor> = scenes
                .iter()
                .map(|sd| {
                    let resolved_scene_id = resolve_mirrored_scene_id(
                        &sd.scene_id,
                        sd.mirror_from_group.as_ref(),
                        &state.groups,
                        state.devices.get_state(),
                    );
                    ActivateSceneDescriptor {
                        scene_id: resolved_scene_id,
                        mirror_from_group: None,
                        device_keys: sd.device_keys.clone(),
                        group_keys: sd.group_keys.clone(),
                        use_scene_transition: sd.use_scene_transition,
                        transition: sd.transition,
                    }
                })
                .collect();
            state
                .devices
                .cycle_scenes(
                    &resolved_scenes,
                    nowrap.unwrap_or(false),
                    &state.groups,
                    device_keys,
                    group_keys,
                    rollout,
                    rollout_source_device_key,
                    rollout_duration_ms,
                    &device_positions,
                    state
                        .runtime_config
                        .core
                        .scene_transition_ms
                        .map(|ms| ordered_float::OrderedFloat(ms as f32 / 1000.0)),
                    &state.scenes,
                )
                .await;
            outcome.mark_snapshot_changes(SnapshotChanges::devices());
        }
        Action::Dim(DimDescriptor {
            device_keys,
            group_keys,
            include_source_groups: _,
            step,
        }) => {
            state
                .devices
                .dim(device_keys, group_keys, step, &state.scenes)
                .await;
            outcome.mark_snapshot_changes(SnapshotChanges::devices());
        }
        Action::Custom(CustomActionDescriptor {
            integration_id,
            payload,
        }) => {
            outcome.push(DeferredEventWork::RunIntegrationAction {
                integrations: state.integrations.clone(),
                descriptor: CustomActionDescriptor {
                    integration_id: integration_id.clone(),
                    payload: payload.clone(),
                },
            });
        }
        Action::ForceTriggerRoutine(ForceTriggerRoutineDescriptor { routine_id }) => {
            let child = EventCausation::child_of(
                state.devices.frame_id(),
                state.devices.mutation_causation(),
            );
            state.rules.force_trigger_routine(routine_id, Some(child))?;
        }
        Action::SetDeviceState(device) => {
            let child = EventCausation::child_of(
                state.devices.frame_id(),
                state.devices.mutation_causation(),
            );
            state.event_tx.send(Event::SetInternalState {
                device: device.clone(),
                skip_external_update: None,
                skip_db_update: None,
                origin: Some(EventOrigin::Command),
                causation: Some(child),
                integration_epoch: None,
            });
        }
        Action::RandomizeColor(descriptor) => {
            let mut rng = rand::thread_rng();
            let min_saturation = descriptor.min_saturation.unwrap_or(0.2).clamp(0.0, 1.0);
            let max_saturation = descriptor.max_saturation.unwrap_or(1.0).clamp(0.0, 1.0);
            let (min_saturation, max_saturation) = if min_saturation <= max_saturation {
                (min_saturation, max_saturation)
            } else {
                (max_saturation, min_saturation)
            };
            let child = EventCausation::child_of(
                state.devices.frame_id(),
                state.devices.mutation_causation(),
            );

            for device_key in &descriptor.device_keys {
                let Some(current) = state.devices.get_device(device_key) else {
                    warn!("Could not randomize unknown device {device_key}");
                    continue;
                };
                let mut device = current.clone();
                let DeviceData::Controllable(controllable) = &mut device.data else {
                    warn!("Could not randomize non-controllable device {device_key}");
                    continue;
                };

                // Clear the active scene so subsequent scene cycling does not
                // treat this one-off color change as a scene activation.
                controllable.scene_id = None;
                controllable.state.color = Some(DeviceColor::new_from_hs(
                    rng.gen_range(0..360),
                    rng.gen_range(min_saturation..=max_saturation),
                ));
                if descriptor.transition.is_some() {
                    controllable.state.transition = descriptor.transition;
                }

                state.event_tx.send(Event::ApplyDeviceState {
                    device,
                    skip_external_update: None,
                    skip_db_update: None,
                    origin: Some(EventOrigin::Derived),
                    causation: Some(child),
                });
            }
        }
        Action::ToggleDeviceOverride {
            device_keys,
            override_state,
        } => {
            let affected_devices: BTreeMap<&DeviceKey, &Device> = state
                .devices
                .get_state()
                .0
                .iter()
                .filter(|(k, _)| device_keys.iter().any(|dk| &dk == k))
                .collect();

            for device in affected_devices.values() {
                let (scene_id, overrides) = state
                    .scenes
                    .store_scene_override_in_memory(device, *override_state)?;
                outcome.push(DeferredEventWork::PersistSceneOverride {
                    scene_id,
                    overrides: Box::new(overrides),
                });
            }
            state.scenes.force_invalidate(&state.devices, &state.groups);
            state.refresh_routine_statuses();
            let changes = SnapshotChanges {
                flattened_scenes: true,
                routine_statuses: true,
                ..SnapshotChanges::none()
            };
            state.schedule_ws_broadcast(changes);
            outcome.mark_snapshot_changes(changes);
        }
        Action::EvalExpr(expr) => {
            warn!("Ignoring legacy evalexpr action: {expr}");
        }
        Action::Ui(action) => {
            let UiActionDescriptor::StoreUIState { key, value } = action;
            state.ui.store_state_in_memory(key.clone(), value.clone());
            let changes = SnapshotChanges::ui_state();
            state.schedule_ws_broadcast(changes);
            outcome.mark_snapshot_changes(changes);
            outcome.push(DeferredEventWork::StoreUiState {
                key: key.clone(),
                value: value.clone(),
            });
        }
    }

    Ok(())
}

/// Record manual intent for the targets of a user-originated action. v2 plans
/// capture these revisions and are suppressed if a newer intent arrives before
/// dispatch (A03). Reports and routine-derived actions never bump.
fn bump_action_intents(state: &mut AppState, action: &Action) {
    match action {
        Action::ActivateScene(descriptor) => {
            state.intents.bump_scene(&descriptor.scene_id);
            for key in descriptor.device_keys.iter().flatten() {
                state.intents.bump_device(key);
            }
            for group in descriptor.group_keys.iter().flatten() {
                state.intents.bump_group(group);
            }
        }
        Action::CycleScenes(descriptor) => {
            for scene in &descriptor.scenes {
                state.intents.bump_scene(&scene.scene_id);
            }
            for key in descriptor.device_keys.iter().flatten() {
                state.intents.bump_device(key);
            }
            for group in descriptor.group_keys.iter().flatten() {
                state.intents.bump_group(group);
            }
        }
        Action::Dim(descriptor) => {
            for key in descriptor.device_keys.iter().flatten() {
                state.intents.bump_device(key);
            }
            for group in descriptor.group_keys.iter().flatten() {
                state.intents.bump_group(group);
            }
        }
        Action::SetDeviceState(device) => {
            state.intents.bump_device(&device.get_device_key());
        }
        _ => {}
    }
}

/// Visible status for a plan rejected before effects because it exceeds the
/// routine's `max_actions` execution policy (plan §4.2/X02).
fn rejected_policy_plan(plan: &RoutinePlan, reason: &str) -> PlannedRunStatus {
    let mut steps = Vec::with_capacity(plan.steps.len() + plan.suppressions.len());
    let mut dropped = 0u64;
    for step in &plan.steps {
        dropped += 1;
        steps.push(step_status(
            step,
            StepDisposition::Suppressed,
            Some(reason.to_string()),
        ));
    }
    for suppression in &plan.suppressions {
        dropped += 1;
        steps.push(suppression.clone());
    }
    PlannedRunStatus {
        run_id: plan.run_id,
        definition_revision: plan.definition_revision,
        accepted: false,
        steps,
        dropped,
    }
}

/// Visible status for a plan rejected before effects because a timer
/// operation conflicted with live state (P09/X02).
fn rejected_timer_plan(
    plan: &RoutinePlan,
    conflicting: &PlannedStep,
    error: &crate::core::automation::TimerOperationError,
) -> PlannedRunStatus {
    let mut steps = Vec::with_capacity(plan.steps.len() + plan.suppressions.len());
    let mut dropped = 0u64;
    for step in &plan.steps {
        dropped += 1;
        let reason = if step.action_id == conflicting.action_id {
            Some(format!(
                "{} (plan rejected before effects)",
                error.message()
            ))
        } else {
            Some(format!("plan_rejected: {}", error.code()))
        };
        steps.push(step_status(step, StepDisposition::Suppressed, reason));
    }
    for suppression in &plan.suppressions {
        dropped += 1;
        steps.push(suppression.clone());
    }
    PlannedRunStatus {
        run_id: plan.run_id,
        definition_revision: plan.definition_revision,
        accepted: false,
        steps,
        dropped,
    }
}

impl AppState {
    /// Apply native group/scene derivation for the mutations collected during
    /// the current actor command and evaluate routines per mutation against
    /// the transaction's own frame. Returns the reader-snapshot fields that
    /// changed as a result.
    /// Dispatch one accepted v2 plan: re-check intent guards, send every step
    /// to the actor's own event channel in order (A07), and return the visible
    /// run status (X03). Steps suppressed here or at plan time remain in the
    /// status so nothing drops silently (X02).
    fn dispatch_v2_plan(
        &mut self,
        plan: RoutinePlan,
        causation: EventCausation,
    ) -> PlannedRunStatus {
        // Plan §4.2: `max_actions` bounds dispatched actions per invocation.
        // A plan that would exceed it is rejected as a whole (accepted:
        // false), so an over-budget run never publishes a partial effect set.
        if let Some(policy) = self.rules.execution_policy(&plan.routine_id) {
            let would_dispatch = plan
                .steps
                .iter()
                .filter(|step| guard_suppression(step, &self.intents).is_none())
                .count();
            if would_dispatch > policy.max_actions as usize {
                return rejected_policy_plan(
                    &plan,
                    &format!(
                        "execution_policy_max_actions: {would_dispatch} steps exceed the limit of {}",
                        policy.max_actions
                    ),
                );
            }
        }

        // P09: validate the plan's timer operations against a staged view
        // before publishing any effect. A conflicting required ScheduleTimer
        // rejects the plan as a whole (accepted: false) instead of letting it
        // turn lights on and then fail to install their off timer.
        let now_monotonic_ms = self.clock.monotonic_ms();
        let now_wall_ms = self.clock.wall_ms();
        let mut staged = self.timers.clone();
        for step in &plan.steps {
            if guard_suppression(step, &self.intents).is_some() {
                continue;
            }
            if let PlannedStepBody::TimerOperation { operation } = &step.body {
                if let Err(error) = staged.apply(
                    &plan.routine_id,
                    plan.definition_revision,
                    operation,
                    // Conflict validation ignores capture bookkeeping; tokens
                    // are frozen by the acceptance handler after earlier
                    // steps have bumped intents (J08).
                    None,
                    now_monotonic_ms,
                    now_wall_ms,
                ) {
                    return rejected_timer_plan(&plan, step, &error);
                }
            }
        }

        let mut steps = Vec::with_capacity(plan.steps.len() + plan.suppressions.len());
        let mut dropped = 0u64;
        for step in &plan.steps {
            if let Some(reason) = guard_suppression(step, &self.intents) {
                dropped += 1;
                steps.push(step_status(step, StepDisposition::Suppressed, Some(reason)));
                continue;
            }
            let event = match &step.body {
                PlannedStepBody::Dispatch(action) => Event::RoutineAction {
                    action: action.as_ref().clone(),
                    causation,
                },
                PlannedStepBody::SetHelper { helper, value } => Event::RoutineSetHelper {
                    helper: helper.clone(),
                    value: value.clone(),
                    causation,
                },
                PlannedStepBody::TimerOperation { operation } => Event::RoutineTimerOperation {
                    routine_id: plan.routine_id.clone(),
                    definition_revision: plan.definition_revision,
                    operation: operation.clone(),
                    capture: step.timer_capture.clone(),
                    causation,
                },
            };
            self.event_tx.send(event);
            steps.push(step_status(step, StepDisposition::Dispatched, None));
        }
        for suppression in &plan.suppressions {
            dropped += 1;
            steps.push(suppression.clone());
        }
        PlannedRunStatus {
            run_id: plan.run_id,
            definition_revision: plan.definition_revision,
            accepted: true,
            steps,
            dropped,
        }
    }

    /// Admit and submit the legacy script leaves captured by the last frame
    /// evaluation(s). Pool creation, owner admission, and spawning happen on
    /// the actor, but no script ever runs on this thread and the actor never
    /// waits for a result (Section 6.4).
    async fn execute_deferred_legacy_scripts(&mut self) {
        let requests = self.rules.take_deferred_script_requests();
        if requests.is_empty() {
            return;
        }

        // A missing worker degrades to a visible per-leaf error instead of
        // leaving legacy decisions pending forever.
        let pool = match self.scripts.ensure_pool().await {
            Ok(pool) => pool,
            Err(message) => {
                for request in requests {
                    let finalized = self.rules.resolve_deferred_script_leaf(
                        &request.routine_id,
                        &request.path,
                        RuleRuntimeStatus::from_error(message.clone()),
                    );
                    dispatch_finalized_rule_runs(self, finalized);
                }
                warn!("{message}");
                self.refresh_routine_statuses();
                return;
            }
        };

        for request in requests {
            match self.scripts.prepare_legacy_leaf(
                &request.routine_id,
                request.script,
                request.context,
            ) {
                Ok(run) => {
                    if !self.rules.note_deferred_leaf_admitted(
                        &request.routine_id,
                        &request.path,
                        run.token.request_id,
                    ) {
                        // No captured leaf to settle (configuration changed
                        // mid-command): release the admitted slot instead of
                        // leaking a pending invocation.
                        warn!(
                            "Legacy script leaf for routine {} disappeared before submission",
                            request.routine_id.0
                        );
                        self.scripts
                            .coordinator_mut()
                            .complete_condition(&run.token, &serde_json::Value::Bool(false));
                        continue;
                    }
                    self.scripts.spawn_legacy_execution(
                        std::sync::Arc::clone(&pool),
                        self.event_tx.clone(),
                        run,
                    );
                }
                Err(reason) => {
                    let finalized = self.rules.resolve_deferred_script_leaf(
                        &request.routine_id,
                        &request.path,
                        RuleRuntimeStatus::from_error(reason),
                    );
                    dispatch_finalized_rule_runs(self, finalized);
                }
            }
        }
        self.refresh_routine_statuses();
    }

    /// Hand admitted script invocations to the supervised pool. A missing or
    /// failed pool records a visible rejected run for every admitted
    /// invocation instead of leaving them pending forever.
    async fn execute_prepared_scripts(
        &mut self,
        prepared: Vec<super::automation::PreparedScriptRun>,
    ) {
        let pool = match self.scripts.ensure_pool().await {
            Ok(pool) => pool,
            Err(message) => {
                for run in &prepared {
                    self.rules
                        .record_v2_script_failure(&run.routine_id, message.clone());
                }
                warn!("{message}");
                self.refresh_routine_statuses();
                return;
            }
        };
        for run in prepared {
            self.scripts.spawn_handler_execution(
                std::sync::Arc::clone(&pool),
                self.event_tx.clone(),
                run.routine_id,
                run.token,
                run.source_body,
                run.context,
                run.causation,
            );
        }
    }

    /// Submit queued scene script materializations off-actor. Scenes keep
    /// serving their last-good contribution while a refresh is in flight; a
    /// missing worker or a rejected admission records a visible error on the
    /// scene instead of stalling (P08/SC02).
    async fn execute_deferred_scene_materializations(&mut self) {
        let requests = self.scenes.take_scene_materialization_requests();
        if requests.is_empty() {
            return;
        }

        let pool = match self.scripts.ensure_pool().await {
            Ok(pool) => pool,
            Err(message) => {
                for request in requests {
                    self.scenes
                        .record_scene_script_error(&request.scene_id, &message);
                }
                warn!("{message}");
                return;
            }
        };

        for request in requests {
            match self.scripts.prepare_scene_materialization(
                &request.scene_id,
                request.revision,
                request.script,
                request.context,
            ) {
                Ok(run) => self.scripts.spawn_scene_materialization(
                    std::sync::Arc::clone(&pool),
                    self.event_tx.clone(),
                    run,
                ),
                Err(reason) => self
                    .scenes
                    .record_scene_script_error(&request.scene_id, &reason),
            }
        }
    }

    pub async fn flush_pending_frames(&mut self) -> SnapshotChanges {
        // P09: the coherent frame freezes the actor's wall clock once; script
        // contexts derived from it reuse this value instead of sampling live.
        let evaluation_time_ms = self.clock.wall_ms();
        let pending = self.devices.take_pending_mutations();
        let fired_timers = std::mem::take(&mut self.pending_timer_fires);
        let predicate_fires = std::mem::take(&mut self.pending_predicate_fires);
        let schedule_fires = std::mem::take(&mut self.pending_schedule_fires);
        if pending.is_empty()
            && fired_timers.is_empty()
            && predicate_fires.is_empty()
            && schedule_fires.is_empty()
        {
            // Invalidation-free commands (scene/group edits through mutate
            // closures) may still have queued materializations.
            self.execute_deferred_scene_materializations().await;
            return SnapshotChanges::none();
        }

        let frame_id = self.devices.frame_id();
        let causation = self.devices.mutation_causation();
        let origin = pending.first().map(|m| m.origin).unwrap_or_default();

        let mut mutations: Vec<DeviceMutation> = Vec::new();
        let mut queue: VecDeque<DeviceMutation> = pending.into();
        let mut derivation_limited = false;

        while let Some(mutation) = queue.pop_front() {
            if mutations.len() >= MAX_DERIVATION_STEPS {
                derivation_limited = true;
                warn!(
                    "Native derivation bound {MAX_DERIVATION_STEPS} reached; \
                     suppressing further group/scene derivation for this frame"
                );
                break;
            }

            let device_was_added = mutation.before.is_none();
            self.groups.invalidate(device_was_added, &self.devices);
            let invalidated_scenes = self.scenes.invalidate(
                mutation.before.as_ref(),
                &mutation.after,
                &self.devices,
                &self.groups,
            );

            if !invalidated_scenes.is_empty() || device_was_added {
                let positions = self.effective_device_positions();
                self.devices.invalidate(
                    &mutation.device_key,
                    &invalidated_scenes,
                    &self.scenes,
                    &positions,
                );
            }

            // Scene/source materialization adds derived mutations; keep the
            // worklist bounded instead of recursing.
            queue.extend(self.devices.take_pending_mutations());
            crate::core::value_history::observe_device(&mutation.after);
            mutations.push(mutation);
        }

        if self.warming_up {
            self.pending_timer_fires = fired_timers;
            self.pending_predicate_fires = predicate_fires;
            self.pending_schedule_fires = schedule_fires;
            self.frame_log.record(AutomationFrame {
                frame_id,
                origin,
                causation,
                mutations,
                evaluated: false,
                disposition: FrameDisposition::WarmingUp,
            });
            return SnapshotChanges::none();
        }

        let mut suppressed = 0usize;
        for mutation in &mutations {
            let summary = self
                .rules
                .handle_internal_state_update(
                    mutation,
                    &self.devices,
                    &self.groups,
                    mutation.origin,
                    causation,
                    Some(frame_id),
                )
                .await;
            suppressed += summary.suppressed;
        }

        // P07: legacy script leaves captured by this frame's v1 evaluations
        // are submitted off-actor; their results finalize the frozen decisions
        // as actor events.
        self.execute_deferred_legacy_scripts().await;

        // P08: scene script refreshes triggered by this frame's invalidations
        // are submitted off-actor; scenes keep serving last-good output.
        self.execute_deferred_scene_materializations().await;

        // P04: v2 routines evaluate once per coherent frame. The before view
        // rolls back every mutation in the transaction, so a multi-device
        // batch never presents partial group state (E04).
        if !self.rules.compiled_v2_routines().is_empty() {
            let after_view = self.devices.get_state().clone();
            let mut before_view = after_view.clone();
            for mutation in mutations.iter().rev() {
                match &mutation.before {
                    Some(before) => {
                        before_view
                            .0
                            .insert(mutation.device_key.clone(), before.clone());
                    }
                    None => {
                        before_view.0.remove(&mutation.device_key);
                    }
                }
            }
            let frame_causation = EventCausation::child_of(frame_id, causation);
            let now_monotonic_ms = self.clock.monotonic_ms();
            let (evaluations, native_plans, prepared_scripts) = {
                let frame = FrameContext {
                    mutations: &mutations,
                    before: &before_view,
                    after: &after_view,
                    groups: &self.groups,
                    helpers: Some(&self.helpers),
                    fired_timers: &fired_timers,
                    predicate_fires: &predicate_fires,
                    schedule_fires: &schedule_fires,
                };
                let evaluations = self.rules.handle_v2_frame(&frame);
                let mut prepared_scripts: Vec<super::automation::PreparedScriptRun> = Vec::new();
                let mut native_plans: Vec<RoutinePlan> = Vec::new();
                if !evaluations.is_empty() {
                    // Plan §4.2: `min_interval_ms` rejects before planning or
                    // worker submission. The mode (single/queued/restart) is
                    // enforced for script programs by the coordinator; native
                    // runs dispatch synchronously, so they have no pending
                    // invocation to serialize.
                    let mut accepted_evaluations = Vec::new();
                    for evaluation in &evaluations {
                        if !evaluation.will_trigger {
                            continue;
                        }
                        if let Some(reason) = self
                            .rules
                            .v2_rate_limit_rejection(&evaluation.routine_id, now_monotonic_ms)
                        {
                            self.rules
                                .record_v2_policy_rejection(&evaluation.routine_id, reason);
                            continue;
                        }
                        accepted_evaluations.push(evaluation.clone());
                    }

                    let inputs = PlanInputs {
                        devices: &after_view,
                        groups: &self.groups,
                        helpers: &self.helpers,
                        intents: &self.intents,
                    };
                    native_plans = self.rules.plan_v2_runs(&accepted_evaluations, &inputs);

                    // P07: script programs are submitted to the supervised
                    // worker while the actor keeps running. Context building
                    // and owner admission happen against this coherent frame;
                    // the result event plans the returned actions at
                    // acceptance time.
                    for evaluation in &accepted_evaluations {
                        let Some(spec) = self.rules.script_spec(&evaluation.routine_id) else {
                            continue;
                        };
                        let mode = self
                            .rules
                            .execution_policy(&evaluation.routine_id)
                            .map(|policy| policy.mode)
                            .unwrap_or_default();
                        match self.scripts.prepare_handler_invocation(
                            &evaluation.routine_id,
                            evaluation.definition_revision,
                            spec,
                            mode,
                            &frame,
                            frame_id,
                            origin,
                            frame_causation,
                            evaluation_time_ms,
                        ) {
                            Ok(run) => {
                                self.rules
                                    .note_v2_invocation(&evaluation.routine_id, now_monotonic_ms);
                                prepared_scripts.push(run);
                            }
                            Err(reason) => self
                                .rules
                                .record_v2_script_failure(&evaluation.routine_id, reason),
                        }
                    }
                }
                (evaluations, native_plans, prepared_scripts)
            };

            // J06: sustained-predicate arming and cancellation requested by
            // this coherent frame reach the authoritative store before any
            // plan dispatches; `Arm` keeps a live episode and `Cancel` is
            // idempotent.
            let now_wall_ms = self.clock.wall_ms();
            for evaluation in &evaluations {
                for intent in &evaluation.predicate_jobs {
                    match intent {
                        super::automation::PredicateJobIntent::Arm {
                            trigger_id,
                            duration_ms,
                        } => {
                            if let Err(error) = self.timers.ensure_predicate(
                                &evaluation.routine_id,
                                evaluation.definition_revision,
                                trigger_id,
                                *duration_ms,
                                now_monotonic_ms,
                                now_wall_ms,
                            ) {
                                warn!(
                                    "Predicate arming for routine {} failed: {}",
                                    evaluation.routine_id,
                                    error.message()
                                );
                            }
                        }
                        super::automation::PredicateJobIntent::Cancel { trigger_id } => {
                            self.timers
                                .cancel_predicate(&evaluation.routine_id, trigger_id);
                        }
                    }
                }
            }

            for plan in native_plans {
                let routine_id = plan.routine_id.clone();
                let status = self.dispatch_v2_plan(plan, frame_causation);
                if status.accepted {
                    self.rules.note_v2_invocation(&routine_id, now_monotonic_ms);
                }
                self.rules.record_v2_run(&routine_id, status);
            }
            if !evaluations.is_empty() {
                // Republish the statuses Arc with this frame's decisions and
                // run outcomes (P05/X03). Script runs stay visibly pending
                // until their result event arrives.
                self.refresh_routine_statuses();
            }

            if !prepared_scripts.is_empty() {
                self.execute_prepared_scripts(prepared_scripts).await;
            }
        }

        // K: consumed (or dropped) occurrences rearm the next one from the
        // current time, so backlog beyond the policy is skipped, not replayed.
        if !schedule_fires.is_empty() {
            self.arm_schedules();
        }

        let disposition = if suppressed > 0 {
            FrameDisposition::CausationLimited
        } else if derivation_limited {
            FrameDisposition::DerivationLimited
        } else {
            FrameDisposition::Evaluated
        };
        let frame_evaluated = matches!(disposition, FrameDisposition::Evaluated);
        if suppressed > 0 {
            debug!(
                "Frame {frame_id:?} hit the causation bound ({MAX_CAUSATION_DEPTH}); \
                 {suppressed} action(s) suppressed"
            );
        }
        self.frame_log.record(AutomationFrame {
            frame_id,
            origin,
            causation,
            mutations,
            evaluated: frame_evaluated,
            disposition,
        });

        SnapshotChanges {
            devices: true,
            routine_statuses: true,
            flattened_groups: true,
            flattened_scenes: true,
            ..SnapshotChanges::none()
        }
    }

    /// Consume device mutations collected before the actor started (database
    /// restore/initial discovery) as startup-seeded frames, then seed routine
    /// transition memory so restored state does not fire edges (E06).
    pub async fn seed_startup_state(&mut self) {
        // Register typed helpers before seeding transitions: without this the
        // registry stays empty after a restart, helper-referencing conditions
        // evaluate as unknown, and routines such as the entryway motion
        // lights can never fire.
        self.apply_runtime_helpers();
        if self.devices.pending_mutation_count() > 0 {
            self.devices.begin_command(EventCausation::default());
            self.flush_pending_frames().await;
        }
        self.rules
            .seed_transitions(&self.devices, &self.groups, Some(&self.helpers));
    }

    /// Rebuild the computed-source registry from the runtime config, drop
    /// synthetic devices for removed sources, and refresh every due source.
    /// Startup and definition changes always compute once (D04); alias keys
    /// resolve to the canonical `computed/<id>` device instead of a duplicate
    /// entity (D07).
    pub fn apply_runtime_sources(&mut self) -> SnapshotChanges {
        let removed = self.sources.load_rows(self.runtime_config.sources.clone());
        let mut changes = SnapshotChanges::none();
        for id in removed {
            if self.devices.remove_device(&sources::source_device_key(&id)) {
                changes.devices = true;
            }
        }
        self.devices.set_source_aliases(self.sources.aliases());
        // Script owners track definition revisions so an edit rejects results
        // admitted against the previous revision (S16).
        self.sync_script_owners();
        changes.include(self.refresh_due_sources());
        changes
    }

    /// Refresh every enabled source whose cadence has elapsed. Evaluation or
    /// publication failures retain the last good output as stale and publish
    /// nothing (D06).
    pub fn refresh_due_sources(&mut self) -> SnapshotChanges {
        let now_wall_ms = self.clock.wall_ms();
        let due = sources::evaluate_due_sources(&mut self.sources, now_wall_ms);
        let mut changes = SnapshotChanges::none();
        for (definition, profile) in due {
            let device = sources::synthetic_device(&definition, &profile);
            match apply_internal_state(
                self,
                &device,
                Some(true),
                Some(true),
                Some(EventOrigin::Derived),
            ) {
                Ok(outcome) => {
                    changes.include(outcome.snapshot_changes());
                    self.pending_deferred_work
                        .extend(outcome.into_deferred_work());
                }
                Err(error) => {
                    warn!(
                        "Computed source {} failed to publish: {error:#}",
                        definition.id.0
                    );
                    self.sources
                        .record_failure(&definition.id, error.to_string(), now_wall_ms);
                }
            }
        }
        changes
    }

    /// Dispatch worker invocations for due script sources. Compat sources are
    /// handled synchronously by [`Self::refresh_due_sources`]; script sources
    /// never block the actor on a worker. Results arrive as
    /// [`Event::SourceScriptResult`] and publish through the same synthetic
    /// device path.
    pub async fn dispatch_due_source_scripts(&mut self) -> SnapshotChanges {
        let now_wall_ms = self.clock.wall_ms();
        let due = self.sources.due_script_sources(now_wall_ms);
        if due.is_empty() {
            return SnapshotChanges::none();
        }
        let pool = match self.scripts.ensure_pool().await {
            Ok(pool) => pool,
            Err(message) => {
                for definition in due {
                    warn!(
                        "Computed source {} script pool unavailable: {message}",
                        definition.id.0
                    );
                    self.sources
                        .record_failure(&definition.id, message.clone(), now_wall_ms);
                }
                return SnapshotChanges::none();
            }
        };

        for definition in due {
            let body = match sources::resolve_source_body(&definition.compute) {
                Ok(body) => body,
                Err(message) => {
                    warn!(
                        "Computed source {} has no script body: {message}",
                        definition.id.0
                    );
                    self.sources
                        .record_failure(&definition.id, message, now_wall_ms);
                    continue;
                }
            };
            let (context, _local_time) = match sources::script_context(&definition, now_wall_ms) {
                Ok(context) => context,
                Err(message) => {
                    self.sources
                        .record_failure(&definition.id, message, now_wall_ms);
                    continue;
                }
            };
            match self.scripts.prepare_source_invocation(
                &definition.id,
                definition.revision,
                body,
                context,
            ) {
                Ok(run) => {
                    self.sources
                        .mark_script_dispatched(&definition.id, now_wall_ms);
                    self.scripts.spawn_source_execution(
                        std::sync::Arc::clone(&pool),
                        self.event_tx.clone(),
                        run,
                    );
                }
                Err(message) => {
                    warn!(
                        "Computed source {} script admission failed: {message}",
                        definition.id.0
                    );
                    self.sources
                        .record_failure(&definition.id, message, now_wall_ms);
                }
            }
        }

        // Publication arrives with the result event; the tick's snapshot
        // changes come from the synchronous refresh above.
        SnapshotChanges::none()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{handle_event, DeferredEventWork, PlannedStep, PlannedStepBody, RoutinePlan};
    use crate::core::{
        devices::Devices,
        groups::Groups,
        integrations::Integrations,
        routines::Routines,
        scenes::Scenes,
        snapshot::{new_snapshot_handle, RuntimeSnapshot},
        state::{actor::spawn_state_actor, AppState},
        ui::Ui,
        websockets::WebSockets,
    };
    use crate::db::config_queries::{
        ConfigExport, CoreConfigRow, FloorplanExportRow, IntegrationRow, RoutineRow, SceneRow,
    };
    use crate::types::{
        action::Action,
        automation_event::{EventCausation, EventOrigin, FrameDisposition, MAX_CAUSATION_DEPTH},
        color::Capabilities,
        device::{
            ControllableDevice, Device, DeviceData, DeviceId, DeviceKey, ManageKind, SensorDevice,
        },
        event::{mk_event_channel, Event, RxEventChannel},
        integration::IntegrationId,
        scene::{ActivateSceneActionDescriptor, SceneConfig, SceneId},
    };
    use crate::utils::cli::Cli;
    use std::collections::HashMap;
    use std::sync::{atomic::AtomicBool, Arc};
    use std::time::Duration;
    use tokio::sync::Mutex;

    fn test_cli() -> Cli {
        Cli {
            dry_run: true,
            port: 45289,
            database_url: None,
            config: None,
            warmup_time: None,
            command: None,
        }
    }

    fn empty_runtime_config() -> ConfigExport {
        ConfigExport {
            version: 1,
            core: CoreConfigRow {
                warmup_time_seconds: 1,
                default_transition_ms: None,
                scene_transition_ms: None,
            },
            integrations: Vec::new(),
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: Vec::new(),
            helpers: Vec::new(),
            helper_values: Vec::new(),
            sources: Vec::new(),
            floorplan: None,
            floorplans: Vec::new(),
            group_positions: Vec::new(),
            device_display_overrides: Vec::new(),
            device_color_calibrations: Vec::new(),
            color_calibration_profiles: Vec::new(),
            color_calibration_assignments: Vec::new(),
            device_sensor_configs: Vec::new(),
            widget_settings: Vec::new(),
            dashboard_layouts: Vec::new(),
            dashboard_widgets: Vec::new(),
        }
    }

    pub(crate) fn test_state() -> (AppState, crate::types::event::RxEventChannel) {
        let cli = test_cli();
        let (event_tx, event_rx) = mk_event_channel();
        let runtime_config = empty_runtime_config();
        let devices = Devices::new(event_tx.clone(), &cli);
        let snapshot = new_snapshot_handle(RuntimeSnapshot {
            runtime_config: Arc::new(runtime_config.clone()),
            devices: Arc::new(devices.get_state().clone()),
            flattened_groups: Arc::new(Default::default()),
            flattened_scenes: Arc::new(Default::default()),
            routine_statuses: Arc::new(Default::default()),
            helper_statuses: Arc::new(Default::default()),
            timers: Arc::new(Default::default()),
            ui_state: Arc::new(Default::default()),
            warming_up: false,
        });
        let state = AppState {
            calibration_sessions: Default::default(),
            warming_up: false,
            runtime_config,
            integrations: Integrations::new(event_tx.clone(), &cli),
            groups: Groups::new(Default::default()),
            scenes: Scenes::new(Default::default()),
            devices,
            rules: Routines::new(Default::default(), event_tx.clone()),
            helpers: Default::default(),
            sources: Default::default(),
            intents: Default::default(),
            scripts: Default::default(),
            timers: Default::default(),
            pending_timer_fires: Vec::new(),
            pending_predicate_fires: Vec::new(),
            pending_schedule_fires: Vec::new(),
            clock: Arc::new(crate::core::clock::ManualClock::new(1_000_000)),
            pending_deferred_work: Vec::new(),
            event_tx,
            ws: WebSockets::default(),
            ui: Ui::new(),
            ws_broadcast_pending: Arc::new(AtomicBool::new(false)),
            pending_ws_update: Arc::new(std::sync::Mutex::new(Default::default())),
            runtime_apply_lock: Arc::new(Mutex::new(())),
            snapshot,
            frame_log: Default::default(),
        };

        (state, event_rx)
    }

    fn lamp(integration: &str, id: &str, power: bool, brightness: f32) -> Device {
        Device::new(
            IntegrationId::from(integration.to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                power,
                Some(brightness),
                None,
                None,
                Capabilities {
                    brightness: Some(true),
                    ..Default::default()
                },
                ManageKind::Unmanaged,
            )),
            None,
        )
    }

    fn set_lamp(device: &mut Device, power: bool, brightness: f32) {
        let DeviceData::Controllable(data) = &mut device.data else {
            panic!("expected controllable device");
        };
        data.state.power = power;
        data.state.brightness = Some(brightness.into());
        data.scene_id = None;
    }

    fn sensor(id: &str, value: bool) -> Device {
        Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new(id),
            id.to_string(),
            DeviceData::Sensor(SensorDevice::Boolean { value }),
            None,
        )
    }

    fn set_sensor(device: &mut Device, value: bool) {
        device.data = DeviceData::Sensor(SensorDevice::Boolean { value });
    }

    fn routine_row(id: &str, rules: serde_json::Value, actions: serde_json::Value) -> RoutineRow {
        RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            rules,
            actions,
            ..Default::default()
        }
    }

    fn drain_actions(event_rx: &mut RxEventChannel) -> Vec<Action> {
        let mut actions = Vec::new();
        while let Ok(event) = event_rx.try_recv() {
            match event {
                Event::RoutineAction { action, .. } | Event::Action(action) => actions.push(action),
                _ => {}
            }
        }
        actions
    }

    #[tokio::test]
    async fn db_scene_events_keep_runtime_state_without_database() {
        let (mut state, _event_rx) = test_state();
        let scene_id = SceneId::new("memory_scene".to_string());

        handle_event(
            &mut state,
            &Event::DbStoreScene {
                scene_id: scene_id.clone(),
                config: SceneConfig {
                    name: "Memory Scene".to_string(),
                    devices: None,
                    groups: None,
                    hidden: Some(false),
                    script: None,
                },
            },
        )
        .await
        .expect("storing scene should succeed without a database");

        assert_eq!(state.runtime_config.scenes.len(), 1);
        assert_eq!(state.runtime_config.scenes[0].id, "memory_scene");
        assert_eq!(state.runtime_config.scenes[0].name, "Memory Scene");

        handle_event(
            &mut state,
            &Event::DbEditScene {
                scene_id: scene_id.clone(),
                name: "Renamed Scene".to_string(),
            },
        )
        .await
        .expect("renaming scene should succeed without a database");

        assert_eq!(state.runtime_config.scenes[0].name, "Renamed Scene");

        handle_event(&mut state, &Event::DbDeleteScene { scene_id })
            .await
            .expect("deleting scene should succeed without a database");

        assert!(state.runtime_config.scenes.is_empty());
    }

    /// B05: legacy dispatch-time mirroring falls back to the configured scene
    /// whenever the referenced group has no unanimous active scene (including
    /// an unknown/empty group).
    #[test]
    fn b05_mirror_from_group_falls_back_when_not_unanimous() {
        use crate::types::group::GroupId;
        use std::str::FromStr;

        let groups = Groups::new(Default::default());
        let devices = Default::default();
        let fallback = SceneId::from("fallback".to_string());
        let group_id = GroupId::from_str("missing").unwrap();

        assert_eq!(
            super::resolve_mirrored_scene_id(&fallback, Some(&group_id), &groups, &devices),
            fallback
        );
        assert_eq!(
            super::resolve_mirrored_scene_id(&fallback, None, &groups, &devices),
            fallback
        );
    }

    #[tokio::test]
    async fn set_external_state_is_deferred() {
        let (mut state, _event_rx) = test_state();
        state.runtime_config.core.default_transition_ms = Some(1000);
        let device = Device::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("lamp1"),
            "Lamp 1".to_string(),
            DeviceData::Controllable(ControllableDevice::new(
                None,
                true,
                Some(0.5),
                None,
                None,
                Capabilities::default(),
                ManageKind::Unmanaged,
            )),
            None,
        );

        let outcome = handle_event(
            &mut state,
            &Event::SetExternalState {
                device: device.clone(),
            },
        )
        .await
        .expect("set external state should succeed");

        assert_eq!(outcome.deferred_work.len(), 1);
        match &outcome.deferred_work[0] {
            DeferredEventWork::PublishIntegrationState {
                device: deferred_device,
                ..
            } => {
                assert_eq!(deferred_device.get_device_key(), device.get_device_key());
                assert_eq!(
                    deferred_device
                        .get_controllable_state()
                        .and_then(|state| state.transition),
                    Some(1.0.into())
                );
                assert_eq!(
                    device
                        .get_controllable_state()
                        .and_then(|state| state.transition),
                    None
                );
            }
            _ => panic!("expected deferred integration publish"),
        }
    }

    // ------------------------------------------------------------------
    // P02: coherent frames, origins, rollout, seeding, epochs, bounds
    // ------------------------------------------------------------------

    /// E03: report, command, and internal derivation frames are distinguishable.
    #[tokio::test]
    async fn e03_frames_distinguish_report_command_and_derived_origins() {
        let (mut state, _event_rx) = test_state();
        let key = DeviceKey::new(
            IntegrationId::from("mqtt".to_string()),
            DeviceId::new("lamp1"),
        );

        let mut reported = lamp("mqtt", "lamp1", true, 0.4);
        set_lamp(&mut reported, false, 0.4);
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: reported,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let frame = state.frame_log.recent(1)[0];
        assert_eq!(frame.origin, EventOrigin::Report);
        assert_eq!(frame.disposition, FrameDisposition::Evaluated);
        assert!(frame.changed(&key));

        let commanded = lamp("mqtt", "lamp1", true, 0.4);
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: commanded,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: None,
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let frame = state.frame_log.recent(1)[0];
        assert_eq!(frame.origin, EventOrigin::Command);
        assert!(frame.changed(&key));

        handle_event(
            &mut state,
            &Event::ApplyDeviceState {
                device: lamp("mqtt", "lamp1", false, 0.4),
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: None,
                causation: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let frame = state.frame_log.recent(1)[0];
        assert_eq!(frame.origin, EventOrigin::Derived);
        assert!(frame.changed(&key));
    }

    /// E04: a multi-device command is collected into one coherent frame whose
    /// mutations each see the pre-command state as `before`.
    #[tokio::test]
    async fn e04_scene_activation_collects_one_coherent_multi_device_frame() {
        let (mut state, _event_rx) = test_state();
        let near = lamp("mqtt", "near", false, 0.1);
        let far = lamp("mqtt", "far", false, 0.1);
        let near_key = near.get_device_key();
        let far_key = far.get_device_key();

        state.devices.set_state(&near, true, true);
        state.devices.set_state(&far, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.scenes = vec![SceneRow {
            id: "evening".to_string(),
            name: "Evening".to_string(),
            hidden: false,
            script: None,
            device_states: HashMap::from([
                (
                    "mqtt/near".to_string(),
                    serde_json::json!({ "power": true, "brightness": 0.8 }),
                ),
                (
                    "mqtt/far".to_string(),
                    serde_json::json!({ "power": true, "brightness": 0.6 }),
                ),
            ]),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        }];
        state.apply_runtime_scenes();

        handle_event(
            &mut state,
            &Event::Action(Action::ActivateScene(ActivateSceneActionDescriptor {
                scene_id: SceneId::new("evening".to_string()),
                mirror_from_group: None,
                device_keys: None,
                group_keys: None,
                include_source_groups: false,
                use_scene_transition: false,
                transition: None,
                rollout: None,
                rollout_source_device_key: None,
                rollout_duration_ms: None,
            })),
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let frame = state.frame_log.recent(1)[0];
        assert_eq!(frame.disposition, FrameDisposition::Evaluated);
        assert_eq!(frame.mutations.len(), 2);
        assert!(frame.changed(&near_key) && frame.changed(&far_key));

        for mutation in &frame.mutations {
            let before = mutation
                .before
                .as_ref()
                .and_then(|device| device.get_controllable_state())
                .expect("scene frame should carry pre-command state");
            let after = mutation
                .after
                .get_controllable_state()
                .expect("scene frame should carry post-command state");
            assert!(!before.power);
            assert!(after.power);
            // Coherence: both mutations see the pre-command snapshot, not the
            // effects of the sibling mutation applied before them.
            assert_eq!(before.brightness, Some(0.1.into()));
        }
    }

    /// E05: spatial rollout applies immediate and delayed targets as separate
    /// batches that share the originating frame's cause id.
    #[tokio::test]
    async fn e05_delayed_rollout_batches_preserve_cause_metadata() {
        let (mut state, mut event_rx) = test_state();
        let source = lamp("mqtt", "source", false, 0.1);
        let near = lamp("mqtt", "near", false, 0.1);
        let far = lamp("mqtt", "far", false, 0.1);
        let motion = sensor("motion", false);
        let near_key = near.get_device_key();
        let far_key = far.get_device_key();

        for device in [&source, &near, &far, &motion] {
            state.devices.set_state(device, true, true);
        }
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.floorplans = vec![FloorplanExportRow {
            id: "main".to_string(),
            name: "Main".to_string(),
            image_data: None,
            image_mime_type: None,
            width: None,
            height: None,
            grid_data: Some(
                serde_json::json!({
                    "tileSize": 1.0,
                    "devices": [
                        { "deviceKey": "mqtt/source", "x": -0.5, "y": -0.5 },
                        { "deviceKey": "mqtt/near", "x": 0.0, "y": -0.5 },
                        { "deviceKey": "mqtt/far", "x": 2.5, "y": -0.5 }
                    ]
                })
                .to_string(),
            ),
        }];
        state.runtime_config.scenes = vec![SceneRow {
            id: "evening".to_string(),
            name: "Evening".to_string(),
            hidden: false,
            script: None,
            device_states: HashMap::from([
                (
                    "mqtt/near".to_string(),
                    serde_json::json!({ "power": true, "brightness": 0.8 }),
                ),
                (
                    "mqtt/far".to_string(),
                    serde_json::json!({ "power": true, "brightness": 0.6 }),
                ),
            ]),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        }];
        state.apply_runtime_scenes();

        state.runtime_config.routines = vec![routine_row(
            "rollout",
            serde_json::json!([{
                "state": { "value": true },
                "integration_id": "mqtt",
                "device_id": "motion"
            }]),
            serde_json::json!([{
                "action": "ActivateScene",
                "scene_id": "evening",
                "rollout": "spatial",
                "rollout_source_device_key": "mqtt/source",
                "rollout_duration_ms": 60
            }]),
        )];
        state.apply_runtime_routines();

        let mut raised = motion.clone();
        set_sensor(&mut raised, true);
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: raised,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        let root_frame = state.frame_log.recent(1)[0].frame_id;

        let mut routine_action = None;
        while let Ok(event) = event_rx.try_recv() {
            if let Event::RoutineAction { action, causation } = event {
                routine_action = Some((action, causation));
            }
        }
        let (action, causation) = routine_action.expect("routine should dispatch a scene action");
        assert_eq!(causation.depth, 1);
        assert_eq!(causation.cause_id, Some(root_frame));

        handle_event(&mut state, &Event::RoutineAction { action, causation })
            .await
            .unwrap();
        state.flush_pending_frames().await;

        let (
            immediate_frame_id,
            immediate_changed_near,
            immediate_changed_far,
            immediate_depth,
            immediate_cause,
        ) = {
            let immediate = state.frame_log.recent(1)[0];
            (
                immediate.frame_id,
                immediate.changed(&near_key),
                immediate.changed(&far_key),
                immediate.causation.depth,
                immediate.causation.cause_id,
            )
        };
        assert!(immediate_changed_near);
        assert!(!immediate_changed_far);
        assert_eq!(immediate_depth, 1);
        assert_eq!(immediate_cause, Some(root_frame));

        // The far target is not applied before its delay elapses.
        while let Ok(event) = event_rx.try_recv() {
            assert!(
                !matches!(event, Event::ApplyDeviceState { .. }),
                "rollout target applied before its delay"
            );
        }

        tokio::time::sleep(Duration::from_millis(250)).await;

        let mut delayed = None;
        while let Ok(event) = event_rx.try_recv() {
            if let Event::ApplyDeviceState {
                device,
                causation,
                origin,
                ..
            } = event
            {
                assert_eq!(origin, Some(EventOrigin::Derived));
                delayed = Some((device, causation));
            }
        }
        let (device, delayed_causation) =
            delayed.expect("rollout should emit a delayed apply event for the far target");
        let delayed_causation = delayed_causation.expect("delayed apply keeps causation");

        handle_event(
            &mut state,
            &Event::ApplyDeviceState {
                device,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Derived),
                causation: Some(delayed_causation),
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let delayed_frame = state.frame_log.recent(1)[0];
        assert!(delayed_frame.changed(&far_key));
        assert_ne!(delayed_frame.frame_id, immediate_frame_id);
        assert_eq!(delayed_frame.causation.cause_id, Some(root_frame));
        assert_eq!(delayed_frame.causation.depth, 1);
    }

    /// E06: an already-true edge predicate at load time is seeded, so a repeat
    /// report is not mistaken for a fresh edge, while a real edge still fires.
    #[tokio::test]
    async fn e06_seeded_edge_predicates_do_not_fire_on_stale_true_state() {
        let (mut state, mut event_rx) = test_state();
        let motion = sensor("motion", true);
        state.devices.set_state(&motion, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.routines = vec![routine_row(
            "motion",
            serde_json::json!([{
                "state": { "value": true },
                "trigger_mode": "edge",
                "integration_id": "mqtt",
                "device_id": "motion"
            }]),
            serde_json::json!([{ "action": "ForceTriggerRoutine", "routine_id": "motion" }]),
        )];
        state.apply_runtime_routines();

        let mut repeat = motion.clone();
        repeat.raw = Some(serde_json::json!({ "seq": 2 }));
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: repeat,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        assert!(
            drain_actions(&mut event_rx).is_empty(),
            "already-true predicate must be seeded, not fired as a fresh edge"
        );

        let mut cleared = motion.clone();
        set_sensor(&mut cleared, false);
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: cleared,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        drain_actions(&mut event_rx);

        let mut raised = motion.clone();
        set_sensor(&mut raised, true);
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: raised,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        assert_eq!(
            drain_actions(&mut event_rx).len(),
            1,
            "a genuine false -> true edge must still fire after seeding"
        );
    }

    /// E07: discovery events from a superseded integration instance are
    /// rejected after reload via lifecycle epochs.
    #[tokio::test]
    async fn e07_superseded_integration_epoch_events_are_rejected() {
        let (mut state, mut event_rx) = test_state();
        let id = IntegrationId::from("dummy".to_string());
        let key = DeviceKey::new(id.clone(), DeviceId::new("lamp1"));

        state
            .integrations
            .load_integration(
                "dummy",
                &id,
                &serde_json::json!({ "devices": { "lamp1": { "name": "lamp1" } } }),
                &test_cli(),
            )
            .await
            .unwrap();
        let first_epoch = state
            .integrations
            .event_epoch(&id)
            .expect("loaded integration should have an epoch");
        state.integrations.run_register_pass().await.unwrap();

        let mut discovery = None;
        while let Ok(event) = event_rx.try_recv() {
            if matches!(event, Event::ExternalStateUpdate { .. }) {
                discovery = Some(event);
            }
        }
        let discovery = discovery.expect("dummy registration should report its device");
        assert_eq!(
            discovery.integration_epoch(),
            Some(first_epoch),
            "forwarder should stamp the instance epoch"
        );
        handle_event(&mut state, &discovery).await.unwrap();
        assert!(state.devices.get_device(&key).is_some());

        state
            .integrations
            .reload_config_rows(&[IntegrationRow {
                id: "dummy".to_string(),
                plugin: "dummy".to_string(),
                config: serde_json::json!({ "devices": { "lamp2": { "name": "lamp2" } } }),
                enabled: true,
            }])
            .await
            .unwrap();
        let second_epoch = state
            .integrations
            .event_epoch(&id)
            .expect("reloaded integration should have an epoch");
        assert_ne!(first_epoch, second_epoch);

        let mut stale = lamp("dummy", "lamp1", true, 0.5);
        stale.integration_id = id.clone();
        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: stale.clone(),
                integration_epoch: Some(first_epoch),
            },
        )
        .await
        .unwrap();
        assert!(
            !state
                .devices
                .get_device(&key)
                .and_then(|device| device.get_controllable_state())
                .map(|state| state.power)
                .unwrap_or(false),
            "stale instance report must not be applied"
        );

        handle_event(
            &mut state,
            &Event::ExternalStateUpdate {
                device: stale,
                integration_epoch: Some(second_epoch),
            },
        )
        .await
        .unwrap();
        assert!(
            state
                .devices
                .get_device(&key)
                .and_then(|device| device.get_controllable_state())
                .map(|state| state.power)
                .unwrap_or(false),
            "report from the live instance must be applied"
        );
    }

    /// E08: a self-triggering routine loop stops at the causation bound and
    /// leaves a visible limited frame instead of growing without limit.
    #[tokio::test]
    async fn e08_causation_bound_terminates_self_triggering_routine_loop() {
        let (mut state, mut event_rx) = test_state();
        let motion = sensor("motion", false);
        state.devices.set_state(&motion, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.routines = vec![routine_row(
            "loop",
            serde_json::json!([{
                "state": { "value": true },
                "integration_id": "mqtt",
                "device_id": "motion"
            }]),
            serde_json::json!([{ "action": "ForceTriggerRoutine", "routine_id": "loop" }]),
        )];
        state.apply_runtime_routines();

        let snapshot = state.snapshot.clone();
        let (work_tx, _work_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot.clone(), work_tx);

        let forward = handle.clone();
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                forward.send_event(event);
            }
        });

        let mut raised = motion.clone();
        set_sensor(&mut raised, true);
        handle.send_event(Event::ExternalStateUpdate {
            device: raised,
            integration_epoch: None,
        });

        let mut suppressed = 0;
        for _ in 0..500 {
            suppressed = handle
                .mutate(|state| Box::pin(async move { state.frame_log.suppressed() }))
                .await
                .unwrap();
            if suppressed > 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(
            suppressed > 0,
            "self-triggering loop must be terminated and recorded"
        );

        let frames = handle
            .mutate(|state| {
                Box::pin(async move {
                    state
                        .frame_log
                        .frames()
                        .map(|frame| (frame.disposition, frame.causation.depth))
                        .collect::<Vec<_>>()
                })
            })
            .await
            .unwrap();

        assert!(frames
            .iter()
            .any(|(disposition, _)| *disposition == FrameDisposition::CausationLimited));
        assert!(frames
            .iter()
            .all(|(_, depth)| *depth <= MAX_CAUSATION_DEPTH + 1));
        assert_eq!(
            frames
                .iter()
                .filter(|(disposition, _)| *disposition == FrameDisposition::CausationLimited)
                .count(),
            1
        );
    }

    // Regression: startup seeding must register configured helpers. A restart
    // used to leave the registry empty, so helper-referencing conditions
    // evaluated as unknown and routines like the entryway motion lights could
    // never fire.
    #[tokio::test]
    async fn startup_seeding_registers_configured_helpers() {
        use crate::types::automation_definition::HelperId;
        use crate::types::automation_value::{HelperDefinition, HelperKind, HelperPersistence};

        let (mut state, _event_rx) = test_state();
        state.runtime_config.helpers = vec![HelperDefinition {
            id: HelperId("entryway_cooldown".to_string()),
            name: "Entryway cooldown".to_string(),
            kind: HelperKind::Boolean,
            initial_value: serde_json::json!(false),
            persistence: HelperPersistence::Session,
            hidden: None,
        }];

        state.seed_startup_state().await;

        let statuses = state.helpers.statuses();
        assert!(
            statuses
                .iter()
                .any(|status| status.id.0 == "entryway_cooldown"),
            "configured helper must be registered during startup seeding: {statuses:?}"
        );
    }

    // P05 staircase vertical slice: a typed enum helper selects the scene at
    // plan time, the plan is accepted through the actor, the dispatched action
    // applies the scene, and the run status separates match/accept/dispatch.
    #[tokio::test]
    async fn p05_helper_mode_selects_scene_through_the_actor() {
        use crate::types::{
            automation_definition::{HelperId, RoutineDefinitionV2},
            automation_trace::{StepDisposition, TruthValue},
            automation_value::{HelperDefinition, HelperKind, HelperPersistence},
        };

        let (mut state, mut event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", false, 0.1);
        let bulb_key = bulb.get_device_key();
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.scenes = vec![SceneRow {
            id: "night".to_string(),
            name: "Night".to_string(),
            hidden: false,
            script: None,
            device_states: HashMap::from([(
                "mqtt/lamp".to_string(),
                serde_json::json!({ "power": true, "brightness": 0.2 }),
            )]),
            group_states: HashMap::new(),
            group_state_order: Vec::new(),
        }];
        state.runtime_config.helpers = vec![HelperDefinition {
            id: HelperId("mode".to_string()),
            name: "Mode".to_string(),
            kind: HelperKind::Enum {
                options: vec!["day".to_string(), "night".to_string()],
            },
            initial_value: serde_json::json!("night"),
            persistence: HelperPersistence::Session,
            hidden: None,
        }];
        state.apply_runtime_helpers();
        state.apply_runtime_scenes();

        let definition = serde_json::from_value::<RoutineDefinitionV2>(serde_json::json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": {
                "integration_id": "mqtt", "device_id": "lamp"
            }}],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "activate_scene", "id": "step",
                  "select": { "kind": "helper_enum", "helper": "mode",
                    "mapping": { "night": "night" }, "fallback_scene_id": "night" },
                  "targets": {} }
            ]}
        }))
        .expect("definition decodes");
        state.runtime_config.routines = vec![RoutineRow {
            id: "staircase".to_string(),
            name: "Staircase".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(serde_json::to_value(&definition).unwrap()),
            ..Default::default()
        }];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&crate::types::rule::RoutineId("staircase".to_string()))
            .cloned()
            .expect("v2 status visible");
        let v2 = status.v2.expect("v2 detail attached");
        assert!(!v2.execution_pending, "P05 completes execution");
        let run = v2.last_run.expect("run status recorded");
        assert!(run.accepted);
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].kind, "activate_scene");
        assert_eq!(run.steps[0].disposition, StepDisposition::Dispatched);
        assert!(run.steps[0].targets.contains(&"night".to_string()));
        assert_eq!(v2.condition.truth, TruthValue::True);

        // The actor normally feeds dispatched events back into itself; the
        // test drains the channel explicitly and applies them in order.
        let mut processed = 0;
        while let Ok(event) = event_rx.try_recv() {
            handle_event(&mut state, &event).await.unwrap();
            processed += 1;
            assert!(processed < 8, "dispatch loop should terminate");
        }
        state.flush_pending_frames().await;

        let applied = state.devices.get_device(&bulb_key).expect("lamp exists");
        assert_eq!(
            applied.get_scene_id(),
            Some(SceneId::new("night".to_string()))
        );
        assert!(applied
            .get_controllable_state()
            .is_some_and(|state| state.power));
    }

    // Plan §4.2: a plan that would dispatch more actions than the routine's
    // `max_actions` is rejected as a whole and publishes no effects.
    #[tokio::test]
    async fn execution_policy_max_actions_rejects_oversized_plans() {
        use crate::types::{
            automation_definition::RoutineDefinitionV2, automation_trace::StepDisposition,
            rule::RoutineId,
        };

        let (mut state, mut event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", false, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        let definition = serde_json::from_value::<RoutineDefinitionV2>(serde_json::json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": {
                "integration_id": "mqtt", "device_id": "lamp"
            }}],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "set_power", "id": "on",
                  "device": { "integration_id": "mqtt", "device_id": "lamp" },
                  "power": true },
                { "action": "set_power", "id": "off",
                  "device": { "integration_id": "mqtt", "device_id": "lamp" },
                  "power": false }
            ]},
            "execution": { "max_actions": 1 }
        }))
        .expect("definition decodes");
        state.runtime_config.routines = vec![RoutineRow {
            id: "budget".to_string(),
            name: "Budget".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(serde_json::to_value(&definition).unwrap()),
            ..Default::default()
        }];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&RoutineId("budget".to_string()))
            .cloned()
            .expect("v2 status visible");
        let run = status
            .v2
            .expect("v2 detail attached")
            .last_run
            .expect("run status recorded");
        assert!(!run.accepted);
        assert_eq!(run.steps.len(), 2);
        assert!(run
            .steps
            .iter()
            .all(|step| step.disposition == StepDisposition::Suppressed));
        assert!(run.steps[0]
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("execution_policy_max_actions")));
        assert!(
            drain_actions(&mut event_rx).is_empty(),
            "a rejected plan must not publish effects"
        );
    }

    // Plan §4.2: `min_interval_ms` rejects re-invocations that arrive before
    // the configured spacing; the rejection is visible in `last_run`.
    #[tokio::test]
    async fn execution_policy_min_interval_rejects_rapid_reinvocations() {
        use crate::types::{automation_definition::RoutineDefinitionV2, rule::RoutineId};

        let (mut state, _event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", false, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        let definition = serde_json::from_value::<RoutineDefinitionV2>(serde_json::json!({
            "triggers": [{ "kind": "state_change", "id": "trig", "device": {
                "integration_id": "mqtt", "device_id": "lamp"
            }}],
            "condition": { "kind": "literal", "value": true },
            "program": { "kind": "native", "steps": [
                { "action": "set_power", "id": "on",
                  "device": { "integration_id": "mqtt", "device_id": "lamp" },
                  "power": true }
            ]},
            "execution": { "min_interval_ms": 60000 }
        }))
        .expect("definition decodes");
        state.runtime_config.routines = vec![RoutineRow {
            id: "throttled".to_string(),
            name: "Throttled".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(serde_json::to_value(&definition).unwrap()),
            ..Default::default()
        }];
        state.apply_runtime_routines();

        async fn trigger(state: &mut AppState, mut device: Device, power: bool) {
            if let DeviceData::Controllable(controllable) = &mut device.data {
                controllable.state.power = power;
            }
            handle_event(
                state,
                &Event::SetInternalState {
                    device,
                    skip_external_update: Some(true),
                    skip_db_update: Some(true),
                    origin: Some(EventOrigin::Command),
                    causation: None,
                    integration_epoch: None,
                },
            )
            .await
            .unwrap();
            state.flush_pending_frames().await;
        }

        let routine_id = RoutineId("throttled".to_string());
        let last_run = |state: &AppState| {
            state
                .rules
                .get_runtime_statuses()
                .0
                .get(&routine_id)
                .cloned()
                .expect("v2 status visible")
                .v2
                .expect("v2 detail attached")
                .last_run
                .expect("run status recorded")
        };

        trigger(&mut state, bulb.clone(), true).await;
        assert!(last_run(&state).accepted, "first invocation is accepted");

        // The default state-change mode re-arms on true -> false; the next
        // false -> true transition fires and hits the rate limit.
        trigger(&mut state, bulb.clone(), false).await;
        trigger(&mut state, bulb.clone(), true).await;
        let run = last_run(&state);
        assert!(!run.accepted);
        assert!(run.steps[0]
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("execution_policy_min_interval")));
    }

    /// Worker binary built next to the test executable's profile directory.
    fn script_worker_binary() -> std::path::PathBuf {
        let mut directory = std::env::current_exe().expect("test executable path");
        directory.pop();
        directory.pop();
        directory.join("script-worker")
    }

    fn scripted_routine_row(source_body: &str, revision: i64) -> RoutineRow {
        RoutineRow {
            id: "scripted".to_string(),
            name: "Scripted".to_string(),
            enabled: true,
            semantics_version: 2,
            revision,
            definition_v2: Some(serde_json::json!({
                "triggers": [{ "kind": "state_change", "id": "trig", "device": {
                    "integration_id": "mqtt", "device_id": "lamp"
                }}],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "script", "spec": {
                    "api_version": 1,
                    "source_body": source_body,
                    "declarations": [{ "kind": "device", "device": {
                        "integration_id": "mqtt", "device_id": "lamp"
                    }}],
                    "limits_profile": "default"
                }}
            })),
            rules: serde_json::Value::Null,
            actions: serde_json::Value::Null,
        }
    }

    async fn next_script_result(
        state: &mut AppState,
        event_rx: &mut crate::types::event::RxEventChannel,
    ) -> Event {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let event = event_rx.recv().await.expect("event channel open");
                if matches!(event, Event::RoutineScriptResult { .. }) {
                    return event;
                }
                handle_event(state, &event).await.unwrap();
                state.flush_pending_frames().await;
            }
        })
        .await
        .expect("script result arrives within the test budget")
    }

    // P07 vertical slice: a v2 script program is submitted off-actor, its
    // typed result is planned at acceptance time, dispatched through the same
    // path as native plans, and made visible as pending until then (X03/X05).
    #[tokio::test]
    async fn p07_script_program_executes_off_actor_and_dispatches_typed_actions() {
        use crate::types::automation_trace::StepDisposition;

        let (mut state, mut event_rx) = test_state();
        state.scripts.worker_binary = Some(script_worker_binary());

        let bulb = lamp("mqtt", "lamp", false, 0.1);
        let bulb_key = bulb.get_device_key();
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        let source_body = r#"
            var step = 0;
            if (ctx.state.memory && typeof ctx.state.memory.step === 'number') {
                step = ctx.state.memory.step;
            }
            if (step >= 1) { return { actions: [] }; }
            return {
                actions: [api.actions.setPower({
                    device: { integration_id: 'mqtt', device_id: 'lamp' },
                    power: false
                })],
                next_state: { step: 1 }
            };
        "#;
        state.runtime_config.routines = vec![scripted_routine_row(source_body, 1)];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let routine_id = crate::types::rule::RoutineId("scripted".to_string());
        let pending = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&routine_id)
            .cloned()
            .expect("status visible");
        let pending_v2 = pending.v2.expect("v2 detail attached");
        assert!(pending_v2.will_trigger);
        assert!(
            pending_v2.execution_pending,
            "script runs stay visibly pending until the worker result arrives"
        );
        assert!(pending_v2.last_run.is_none());

        let result = next_script_result(&mut state, &mut event_rx).await;
        handle_event(&mut state, &result).await.unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&routine_id)
            .cloned()
            .expect("status visible");
        let v2 = status.v2.expect("v2 detail attached");
        assert!(!v2.execution_pending);
        let run = v2.last_run.expect("run status recorded");
        assert!(run.accepted, "{run:?}");
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].kind, "set_power");
        assert_eq!(run.steps[0].disposition, StepDisposition::Dispatched);
        assert!(run.steps[0].targets.contains(&"mqtt/lamp".to_string()));
        assert_eq!(
            state
                .scripts
                .coordinator()
                .memory(&crate::core::automation::ScriptOwnerId::routine("scripted")),
            Some(&serde_json::json!({"step": 1}))
        );

        // The actor normally feeds dispatched events back into itself; the
        // test drains the channel explicitly and applies them in order. The
        // change caused by the scripted action can trigger at most one more
        // invocation, which returns no actions.
        let mut processed = 0;
        while let Ok(event) = event_rx.try_recv() {
            handle_event(&mut state, &event).await.unwrap();
            processed += 1;
            assert!(processed < 32, "dispatch loop should terminate");
        }
        state.flush_pending_frames().await;

        let applied = state.devices.get_device(&bulb_key).expect("lamp exists");
        assert!(
            !applied
                .get_controllable_state()
                .is_some_and(|state| state.power),
            "the scripted action reached the device"
        );
    }

    // S16: editing a script owner after submission rejects the late worker
    // result visibly and dispatches nothing.
    #[tokio::test]
    async fn p07_edited_script_owner_rejects_late_result_visibly() {
        use crate::types::automation_trace::StepDisposition;

        let (mut state, mut event_rx) = test_state();
        state.scripts.worker_binary = Some(script_worker_binary());

        let bulb = lamp("mqtt", "lamp", false, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.routines = vec![scripted_routine_row("return { actions: [] };", 1)];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        state.runtime_config.routines = vec![scripted_routine_row("return { actions: [] };", 2)];
        state.apply_runtime_routines();

        let result = next_script_result(&mut state, &mut event_rx).await;
        handle_event(&mut state, &result).await.unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&crate::types::rule::RoutineId("scripted".to_string()))
            .cloned()
            .expect("status visible");
        let v2 = status.v2.expect("v2 detail attached");
        assert!(!v2.execution_pending);
        let run = v2.last_run.expect("rejected run is still visible");
        assert!(!run.accepted, "{run:?}");
        let reason = run.steps[0].reason.clone().unwrap_or_default();
        assert!(
            reason.contains("definition_changed"),
            "unexpected rejection reason: {reason}"
        );
        assert_eq!(run.steps[0].disposition, StepDisposition::Suppressed);
    }

    fn legacy_routine_row(id: &str, script: &str) -> RoutineRow {
        RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            semantics_version: 1,
            revision: 0,
            definition_v2: None,
            rules: serde_json::json!([
                { "script": script },
                { "power": true, "trigger_mode": "level",
                  "integration_id": "mqtt", "device_id": "lamp" }
            ]),
            actions: serde_json::json!([
                { "action": "ForceTriggerRoutine", "routine_id": "target" }
            ]),
        }
    }

    /// A loaded routine that never matches, for force-trigger targets.
    fn inert_routine_row(id: &str) -> RoutineRow {
        RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            semantics_version: 1,
            revision: 0,
            definition_v2: None,
            rules: serde_json::json!([
                { "power": true, "trigger_mode": "level",
                  "integration_id": "mqtt", "device_id": "missing" }
            ]),
            actions: serde_json::json!([]),
        }
    }

    async fn next_leaf_result(
        state: &mut AppState,
        event_rx: &mut crate::types::event::RxEventChannel,
    ) -> Event {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let event = event_rx.recv().await.expect("event channel open");
                if matches!(event, Event::RuleScriptLeafResult { .. }) {
                    return event;
                }
                handle_event(state, &event).await.unwrap();
                state.flush_pending_frames().await;
            }
        })
        .await
        .expect("legacy script leaf result arrives within the test budget")
    }

    // P07/Section 6.4 vertical slice: a v1 script rule is evaluated off-actor;
    // its boolean result is combined with the captured native leaf results and
    // the frozen actions are dispatched through the normal path.
    #[tokio::test]
    async fn p07_legacy_rule_script_executes_off_actor_and_dispatches_frozen_actions() {
        let (mut state, mut event_rx) = test_state();
        state.scripts.worker_binary = Some(script_worker_binary());

        let bulb = lamp("mqtt", "lamp", false, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        let script = "devices['mqtt/lamp'] !== undefined";
        state.runtime_config.routines = vec![
            legacy_routine_row("legacy", script),
            inert_routine_row("target"),
        ];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let routine_id = crate::types::rule::RoutineId("legacy".to_string());
        let pending = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&routine_id)
            .cloned()
            .expect("status visible");
        assert!(
            !pending.will_trigger,
            "the combined decision waits for the worker leaf"
        );
        assert!(
            !pending.rules[0].condition_match,
            "script leaf shows the pending placeholder"
        );

        let result = next_leaf_result(&mut state, &mut event_rx).await;
        let Event::RuleScriptLeafResult {
            routine_id: result_routine,
            value,
            error,
            ..
        } = &result
        else {
            unreachable!("helper filters leaf results");
        };
        assert_eq!(result_routine, &routine_id);
        assert!(error.is_none(), "unexpected worker error: {error:?}");
        assert_eq!(value, &Some(serde_json::json!(true)));
        handle_event(&mut state, &result).await.unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&routine_id)
            .cloned()
            .expect("status visible");
        assert!(status.will_trigger);
        assert!(status.rules.iter().all(|rule| rule.condition_match));
        assert!(status.rules.iter().all(|rule| rule.error.is_none()));

        // The frozen action reached the actor channel as a v1 routine action.
        let mut dispatched = 0;
        while let Ok(event) = event_rx.try_recv() {
            if matches!(event, Event::RoutineAction { .. }) {
                dispatched += 1;
            }
            handle_event(&mut state, &event).await.unwrap();
            assert!(dispatched < 8, "dispatch loop should terminate");
        }
        assert_eq!(dispatched, 1, "one frozen action dispatched");
    }

    // Section 6.4: a reload while a legacy leaf is in flight rejects the
    // result and dispatches nothing.
    #[tokio::test]
    async fn p07_legacy_leaf_result_after_reload_is_rejected() {
        let (mut state, mut event_rx) = test_state();
        state.scripts.worker_binary = Some(script_worker_binary());

        let bulb = lamp("mqtt", "lamp", false, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.routines = vec![legacy_routine_row("legacy", "true")];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        // Reload: same row, but every load invalidates in-flight v1 results.
        state.runtime_config.routines = vec![legacy_routine_row("legacy", "true")];
        state.apply_runtime_routines();

        let result = next_leaf_result(&mut state, &mut event_rx).await;
        handle_event(&mut state, &result).await.unwrap();
        state.flush_pending_frames().await;

        let mut dispatched = 0;
        while let Ok(event) = event_rx.try_recv() {
            if matches!(event, Event::RoutineAction { .. }) {
                dispatched += 1;
            }
        }
        assert_eq!(dispatched, 0, "stale legacy results must not dispatch");
        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&crate::types::rule::RoutineId("legacy".to_string()))
            .cloned()
            .expect("status visible");
        assert!(!status.will_trigger);
        assert_eq!(
            state
                .scripts
                .coordinator()
                .pending_count(&crate::core::automation::ScriptOwnerId::routine("legacy")),
            0,
            "the reload released the pending admission slot"
        );
    }

    // A missing worker binary degrades to a visible rejected run, not a
    // blocked actor or a silently pending invocation.
    #[tokio::test]
    async fn p07_missing_worker_is_visible_and_does_not_block() {
        let (mut state, mut event_rx) = test_state();
        state.scripts.worker_binary = Some(std::path::PathBuf::from("/nonexistent/script-worker"));

        let bulb = lamp("mqtt", "lamp", false, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.devices.begin_command(EventCausation::default());
        state.flush_pending_frames().await;

        state.runtime_config.routines = vec![scripted_routine_row("return { actions: [] };", 1)];
        state.apply_runtime_routines();

        let mut lit = bulb.clone();
        if let DeviceData::Controllable(controllable) = &mut lit.data {
            controllable.state.power = true;
        }
        handle_event(
            &mut state,
            &Event::SetInternalState {
                device: lit,
                skip_external_update: Some(true),
                skip_db_update: Some(true),
                origin: Some(EventOrigin::Command),
                causation: None,
                integration_epoch: None,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&crate::types::rule::RoutineId("scripted".to_string()))
            .cloned()
            .expect("status visible");
        let v2 = status.v2.expect("v2 detail attached");
        assert!(!v2.execution_pending);
        let run = v2.last_run.expect("failure recorded");
        assert!(!run.accepted);
        assert!(
            run.steps[0]
                .reason
                .as_deref()
                .is_some_and(|reason| reason.contains("worker pool unavailable")),
            "{:?}",
            run.steps[0].reason
        );
        assert!(event_rx.try_recv().is_err(), "no worker result is expected");
    }

    fn timer_routine_row(id: &str, timer: &str, power: bool, revision: i64) -> RoutineRow {
        RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            semantics_version: 2,
            revision,
            definition_v2: Some(serde_json::json!({
                "triggers": [{ "kind": "timer_fired", "id": "trig", "timer": timer }],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "native", "steps": [
                    { "action": "set_power", "id": "step",
                      "device": { "integration_id": "mqtt", "device_id": "lamp" },
                      "power": power }
                ]}
            })),
            ..Default::default()
        }
    }

    fn schedule_routine_row(id: &str, schedule: serde_json::Value, revision: i64) -> RoutineRow {
        RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            semantics_version: 2,
            revision,
            definition_v2: Some(serde_json::json!({
                "triggers": [{ "kind": "schedule", "id": "trig", "schedule": schedule }],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "native", "steps": [
                    { "action": "set_power", "id": "step",
                      "device": { "integration_id": "mqtt", "device_id": "lamp" },
                      "power": true }
                ]}
            })),
            ..Default::default()
        }
    }

    // P09/J01/J05: only the current generation of the owning routine's timer
    // fires, and the expiry frame evaluates current state.
    #[tokio::test]
    async fn p09_named_timer_fires_current_generation_against_current_state() {
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;

        let (mut state, mut event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", true, 0.1);
        let bulb_key = bulb.get_device_key();
        state.devices.set_state(&bulb, true, true);
        state.runtime_config.routines = vec![timer_routine_row("timer_routine", "off", false, 1)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        handle_event(
            &mut state,
            &Event::RoutineTimerOperation {
                routine_id: owner.clone(),
                definition_revision: 1,
                operation: TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 5_000,
                },
                capture: None,
                causation: EventCausation::default(),
            },
        )
        .await
        .unwrap();

        let first = state.timers.wakeups().pop().expect("pending wakeup");
        handle_event(
            &mut state,
            &Event::RoutineTimerOperation {
                routine_id: owner.clone(),
                definition_revision: 1,
                operation: TimerOperation::Replace {
                    timer: timer.clone(),
                    delay_ms: 10_000,
                },
                capture: None,
                causation: EventCausation::default(),
            },
        )
        .await
        .unwrap();

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: first.definition_revision,
                job: first.job.clone(),
                generation: first.generation,
                due_wall_ms: first.due_wall_ms,
            },
        )
        .await
        .unwrap();
        assert!(
            state.pending_timer_fires.is_empty(),
            "the replaced generation cannot fire"
        );

        let current = state.timers.wakeups().pop().expect("replacement wakeup");
        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: current.definition_revision,
                job: current.job,
                generation: current.generation,
                due_wall_ms: current.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&owner)
            .cloned()
            .unwrap();
        let v2 = status.v2.expect("v2 status attached");
        assert_eq!(
            v2.matched_trigger_ids,
            vec![crate::types::automation_definition::NodeId(
                "trig".to_string()
            )],
            "the validated expiry frame fires the TimerFired trigger"
        );

        let mut processed = 0;
        while let Ok(event) = event_rx.try_recv() {
            handle_event(&mut state, &event).await.unwrap();
            processed += 1;
            assert!(processed < 8, "dispatch loop should terminate");
        }
        state.flush_pending_frames().await;

        assert_eq!(
            state
                .devices
                .get_device(&bulb_key)
                .and_then(|device| device.is_powered_on()),
            Some(false),
            "the timer continuation acted on current state"
        );
    }

    // P09: a conflicting required ScheduleTimer rejects the plan before any
    // effect is published; ordered cancel-then-schedule is valid.
    #[tokio::test]
    async fn p09_timer_conflicts_reject_the_plan_before_effects() {
        use crate::types::automation_definition::{NodeId, TimerId, TimerOperation};
        use crate::types::automation_trace::StepDisposition;
        use crate::types::rule::RoutineId;

        let (mut state, mut event_rx) = test_state();
        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        state
            .timers
            .apply(
                &owner,
                1,
                &TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 1_000,
                },
                None,
                0,
                1_000_000,
            )
            .unwrap();

        let schedule_step = |delay_ms: u64| PlannedStep {
            action_id: NodeId("step".to_string()),
            kind: "schedule_timer",
            body: PlannedStepBody::TimerOperation {
                operation: TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms,
                },
            },
            intent_guard: Vec::new(),
            timer_capture: None,
        };
        let conflicting = RoutinePlan {
            routine_id: owner.clone(),
            definition_revision: 1,
            run_id: 7,
            steps: vec![schedule_step(5_000)],
            suppressions: Vec::new(),
        };
        let status = state.dispatch_v2_plan(conflicting, EventCausation::default());
        assert!(!status.accepted);
        assert_eq!(status.steps[0].disposition, StepDisposition::Suppressed);
        assert!(
            status.steps[0]
                .reason
                .as_deref()
                .is_some_and(|reason| reason.contains("timer_already_pending")),
            "{:?}",
            status.steps[0].reason
        );
        assert!(
            event_rx.try_recv().is_err(),
            "a rejected plan publishes no effects"
        );

        let cancel_then_schedule = RoutinePlan {
            routine_id: owner.clone(),
            definition_revision: 1,
            run_id: 8,
            steps: vec![
                PlannedStep {
                    action_id: NodeId("cancel".to_string()),
                    kind: "cancel_timer",
                    body: PlannedStepBody::TimerOperation {
                        operation: TimerOperation::Cancel {
                            timer: timer.clone(),
                        },
                    },
                    intent_guard: Vec::new(),
                    timer_capture: None,
                },
                schedule_step(5_000),
            ],
            suppressions: Vec::new(),
        };
        let status = state.dispatch_v2_plan(cancel_then_schedule, EventCausation::default());
        assert!(
            status.accepted,
            "cancel-then-schedule is ordered, not a conflict"
        );
        assert!(matches!(
            event_rx.try_recv(),
            Ok(Event::RoutineTimerOperation { .. })
        ));
        assert!(matches!(
            event_rx.try_recv(),
            Ok(Event::RoutineTimerOperation { .. })
        ));
    }

    // P09: explicit administrative cancellation is generation-checked and
    // idempotent; a mismatch removes nothing.
    #[tokio::test]
    async fn p09_admin_cancellation_is_generation_checked() {
        use crate::core::automation::TimerCancellation;
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        state
            .timers
            .apply(
                &owner,
                1,
                &TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 1_000,
                },
                None,
                0,
                1_000_000,
            )
            .unwrap();
        let generation = state.timers.pending_generation(&owner, &timer).unwrap();

        assert_eq!(
            state.cancel_timer(&owner, &timer, Some(generation + 1)),
            TimerCancellation::GenerationMismatch {
                current: generation,
                expected: generation + 1
            }
        );
        assert!(
            state.timers.is_pending(&owner, &timer),
            "a mismatched cancellation removes nothing"
        );
        assert_eq!(
            state.cancel_timer(&owner, &timer, Some(generation)),
            TimerCancellation::Cancelled { generation }
        );
        assert_eq!(
            state.cancel_timer(&owner, &timer, Some(generation)),
            TimerCancellation::NoOp,
            "cancelling a missing timer is idempotent"
        );
    }

    // P09: the public actor handle routes cancellation through the
    // authoritative store inside the actor task.
    #[tokio::test]
    async fn p09_actor_routed_cancellation_reaches_the_authoritative_store() {
        use crate::core::automation::TimerCancellation;
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        state
            .timers
            .apply(
                &owner,
                1,
                &TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 1_000,
                },
                None,
                0,
                1_000_000,
            )
            .unwrap();
        let generation = state.timers.pending_generation(&owner, &timer).unwrap();

        let snapshot = state.snapshot.clone();
        let (work_tx, _work_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_state_actor(state, snapshot, work_tx);

        let result = handle
            .cancel_timer(owner.clone(), timer.clone(), Some(generation))
            .await
            .unwrap();
        assert_eq!(result, TimerCancellation::Cancelled { generation });

        let pending = handle
            .mutate(|state| Box::pin(async move { state.timers.is_pending(&owner, &timer) }))
            .await
            .unwrap();
        assert!(!pending, "the actor removed the live timer");
    }

    // P09: live jobs are visible through the runtime snapshot, and lifecycle
    // changes republish the projection (remaining duration is a sample).
    #[tokio::test]
    async fn p09_timer_projection_publishes_lifecycle_changes() {
        use crate::core::snapshot::SnapshotChanges;
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;
        use crate::types::timer_status::TimerPersistence;

        let (mut state, _event_rx) = test_state();
        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        state
            .timers
            .apply(
                &owner,
                1,
                &TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 5_000,
                },
                None,
                0,
                1_000_000,
            )
            .unwrap();
        state.publish_snapshot(SnapshotChanges {
            timers: true,
            ..SnapshotChanges::none()
        });

        let published = state.snapshot.load();
        assert_eq!(published.timers.len(), 1);
        let status = &published.timers[0];
        assert_eq!(status.routine_id, owner);
        assert_eq!(status.timer, timer);
        assert_eq!(status.definition_revision, 1);
        assert_eq!(status.persistence, TimerPersistence::Session);
        assert!(status.remaining_ms > 0);
        assert_eq!(status.due_wall_ms, 1_005_000);
        drop(published);

        assert_eq!(
            state.cancel_timer(&owner, &timer, None),
            crate::core::automation::TimerCancellation::Cancelled { generation: 1 }
        );
        state.publish_snapshot(SnapshotChanges {
            timers: true,
            ..SnapshotChanges::none()
        });
        assert!(state.snapshot.load().timers.is_empty());
    }

    // P10: named timer scheduling, replacement, and cancellation each queue
    // exactly one write-through/delete for the persisted store, and an
    // acknowledged cancel removes the live job.
    #[tokio::test]
    async fn p10_named_timer_write_through_queues_persist_and_delete() {
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;

        let (mut state, mut event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", true, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.runtime_config.routines = vec![timer_routine_row("timer_routine", "off", false, 1)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        let operation = |operation| Event::RoutineTimerOperation {
            routine_id: owner.clone(),
            definition_revision: 1,
            operation,
            capture: None,
            causation: EventCausation::default(),
        };

        let outcome = handle_event(
            &mut state,
            &operation(TimerOperation::Schedule {
                timer: timer.clone(),
                delay_ms: 5_000,
            }),
        )
        .await
        .unwrap();
        match outcome.into_deferred_work().as_slice() {
            [DeferredEventWork::PersistTimerJob { job }] => {
                assert_eq!(job.routine_id, owner);
                assert_eq!(job.timer, timer);
                assert_eq!(job.due_wall_ms, 1_005_000);
            }
            other => panic!("expected one persist job, got {other:?}"),
        }

        let outcome = handle_event(
            &mut state,
            &operation(TimerOperation::Replace {
                timer: timer.clone(),
                delay_ms: 10_000,
            }),
        )
        .await
        .unwrap();
        match outcome.into_deferred_work().as_slice() {
            [DeferredEventWork::PersistTimerJob { job }] => {
                assert_eq!(job.due_wall_ms, 1_010_000, "replace upserts the new row")
            }
            other => panic!("expected one persist job, got {other:?}"),
        }

        // A directly handled timer operation applies to the authoritative
        // store without re-queueing an event.
        assert!(event_rx.try_recv().is_err());

        let wakeup = state.timers.wakeups().pop().expect("replacement wakeup");
        let outcome = handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: wakeup.definition_revision,
                job: wakeup.job.clone(),
                generation: wakeup.generation,
                due_wall_ms: wakeup.due_wall_ms,
            },
        )
        .await
        .unwrap();
        match outcome.into_deferred_work().as_slice() {
            [DeferredEventWork::DeleteTimerJob {
                routine_id,
                timer: deleted,
            }] => {
                assert_eq!(routine_id, &owner);
                assert_eq!(deleted, &timer);
            }
            other => panic!("expected one delete job, got {other:?}"),
        }
        assert!(
            !state.timers.is_pending(&owner, &timer),
            "a consumed generation is gone"
        );
    }

    // P10: administrative cancellation removes the live job and queues its
    // stored row for deletion, so an acknowledged cancel survives a restart.
    #[tokio::test]
    async fn p10_admin_cancel_queues_the_row_delete() {
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        state
            .timers
            .apply(
                &owner,
                1,
                &TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 1_000,
                },
                None,
                0,
                1_000_000,
            )
            .unwrap();

        state.cancel_timer(&owner, &timer, None);
        let queued = state.take_pending_deferred_work();
        match queued.as_slice() {
            [DeferredEventWork::DeleteTimerJob {
                routine_id,
                timer: deleted,
            }] => {
                assert_eq!(routine_id, &owner);
                assert_eq!(deleted, &timer);
            }
            other => panic!("expected one delete job, got {other:?}"),
        }
        assert!(
            state.take_pending_deferred_work().is_empty(),
            "drained once"
        );

        state
            .timers
            .apply(
                &owner,
                1,
                &TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 1_000,
                },
                None,
                0,
                1_000_000,
            )
            .unwrap();
        state.cancel_timer(&owner, &timer, Some(99));
        assert!(
            state.take_pending_deferred_work().is_empty(),
            "a mismatched cancellation deletes nothing"
        );
    }

    // P10: editing a definition drops its live named jobs and queues deletes
    // for their stored rows.
    #[tokio::test]
    async fn p10_definition_edit_deletes_dropped_job_rows() {
        use crate::types::automation_definition::{TimerId, TimerOperation};
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", true, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.runtime_config.routines = vec![timer_routine_row("timer_routine", "off", false, 1)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("timer_routine".to_string());
        let timer = TimerId("off".to_string());
        handle_event(
            &mut state,
            &Event::RoutineTimerOperation {
                routine_id: owner.clone(),
                definition_revision: 1,
                operation: TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 5_000,
                },
                capture: None,
                causation: EventCausation::default(),
            },
        )
        .await
        .unwrap();
        assert!(state.timers.is_pending(&owner, &timer));
        state.take_pending_deferred_work();

        state.runtime_config.routines = vec![timer_routine_row("timer_routine", "off", false, 2)];
        state.apply_runtime_routines();
        let queued = state.take_pending_deferred_work();
        match queued.as_slice() {
            [DeferredEventWork::DeleteTimerJob {
                routine_id,
                timer: deleted,
            }] => {
                assert_eq!(routine_id, &owner);
                assert_eq!(deleted, &timer);
            }
            other => panic!("expected one delete job, got {other:?}"),
        }
        assert!(!state.timers.is_pending(&owner, &timer));
    }

    // P10: startup restoration keeps future jobs, drops past-due and
    // stale-revision rows with a log, and re-freezes the capture spec against
    // the live intent tracker.
    #[tokio::test]
    async fn p10_startup_restore_keeps_future_jobs_and_drops_past_due() {
        use crate::db::config_queries::TimerJobRow;
        use crate::types::automation_definition::{TimerId, TimerIntentTarget};
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", true, 0.1);
        state.devices.set_state(&bulb, true, true);
        state.runtime_config.routines = vec![timer_routine_row("timer_routine", "off", false, 1)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        // The manual clock reports wall time 1_000_000 and monotonic 0.
        let owner = RoutineId("timer_routine".to_string());
        let capture =
            serde_json::to_string(&crate::types::automation_definition::TimerIntentCapture {
                targets: vec![TimerIntentTarget::Device {
                    device: bulb.get_device_key(),
                }],
                frozen_members: Vec::new(),
            })
            .unwrap();
        state.restore_timer_jobs(&[
            TimerJobRow {
                routine_id: owner.0.clone(),
                timer_id: "off".into(),
                definition_revision: 1,
                generation: 12,
                due_wall_ms: 1_060_000,
                capture: Some(capture),
            },
            TimerJobRow {
                routine_id: owner.0.clone(),
                timer_id: "past".into(),
                definition_revision: 1,
                generation: 13,
                due_wall_ms: 999_000,
                capture: None,
            },
            TimerJobRow {
                routine_id: owner.0.clone(),
                timer_id: "stale".into(),
                definition_revision: 0,
                generation: 14,
                due_wall_ms: 1_060_000,
                capture: None,
            },
            TimerJobRow {
                routine_id: "missing".into(),
                timer_id: "off".into(),
                definition_revision: 1,
                generation: 15,
                due_wall_ms: 1_060_000,
                capture: None,
            },
        ]);

        assert!(state.timers.is_pending(&owner, &TimerId("off".into())));
        assert!(!state.timers.is_pending(&owner, &TimerId("past".into())));
        assert!(!state.timers.is_pending(&owner, &TimerId("stale".into())));

        let wakeup = state.timers.wakeups().pop().expect("restored wakeup");
        assert_eq!(wakeup.generation, 12, "the stored generation is reused");
        assert_eq!(wakeup.due_monotonic_ms, 60_000);
        assert_eq!(wakeup.due_wall_ms, 1_060_000);
    }

    fn predicate_for_routine_row(id: &str, revision: i64, duration_ms: u64) -> RoutineRow {
        RoutineRow {
            id: id.to_string(),
            name: id.to_string(),
            enabled: true,
            semantics_version: 2,
            revision,
            definition_v2: Some(serde_json::json!({
                "triggers": [{
                    "kind": "predicate_for",
                    "id": "trig",
                    "predicate": {
                        "kind": "comparison",
                        "source": { "kind": "device",
                            "device": { "integration_id": "mqtt", "device_id": "lamp" },
                            "path": "/power" },
                        "operator": "eq",
                        "value": true
                    },
                    "duration_ms": duration_ms
                }],
                "condition": { "kind": "literal", "value": true },
                "program": { "kind": "native", "steps": [
                    { "action": "set_power", "id": "step",
                      "device": { "integration_id": "mqtt", "device_id": "lamp" },
                      "power": true }
                ]}
            })),
            ..Default::default()
        }
    }

    // J06: false/unknown -> true arms, false cancels, true again starts a new
    // episode generation; a false predicate never arms.
    #[tokio::test]
    async fn p09_predicate_for_arms_cancels_and_rearms() {
        use crate::types::automation_definition::NodeId;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        state.runtime_config.routines = vec![predicate_for_routine_row("pred_routine", 1, 30_000)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("pred_routine".to_string());
        let trigger = NodeId("trig".to_string());
        assert!(
            state
                .timers
                .pending_predicate_generation(&owner, &trigger)
                .is_none(),
            "a false predicate never arms"
        );

        state
            .devices
            .set_state(&lamp("mqtt", "lamp", true, 0.1), true, true);
        state.flush_pending_frames().await;
        let first = state
            .timers
            .pending_predicate_generation(&owner, &trigger)
            .expect("false -> true arms the episode");

        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        state.flush_pending_frames().await;
        assert!(
            state
                .timers
                .pending_predicate_generation(&owner, &trigger)
                .is_none(),
            "false cancels the episode"
        );

        state
            .devices
            .set_state(&lamp("mqtt", "lamp", true, 0.1), true, true);
        state.flush_pending_frames().await;
        let second = state
            .timers
            .pending_predicate_generation(&owner, &trigger)
            .expect("true again re-arms");
        assert!(second > first, "a new episode starts a new generation");
    }

    // J05/J06: expiry rechecks the predicate against current state and the
    // episode generation; maturity fires once and stays latched.
    #[tokio::test]
    async fn p09_predicate_expiry_rechecks_state_and_latches() {
        use crate::types::automation_definition::NodeId;
        use crate::types::event::TimerWakeupJob;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        state.runtime_config.routines = vec![predicate_for_routine_row("pred_routine", 1, 30_000)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("pred_routine".to_string());
        let trigger = NodeId("trig".to_string());
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", true, 0.1), true, true);
        state.flush_pending_frames().await;
        let armed = state
            .timers
            .wakeups()
            .pop()
            .expect("armed predicate wakeup");
        assert!(matches!(
            &armed.job,
            TimerWakeupJob::PredicateDeadline { .. }
        ));
        let armed_generation = armed.generation;

        // The predicate drops within the expiry frame: current state wins and
        // the validated fire does not trigger (J05).
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: armed.job.clone(),
                generation: armed_generation,
                due_wall_ms: armed.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        let matched = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&owner)
            .and_then(|status| status.v2.clone())
            .map(|v2| v2.matched_trigger_ids)
            .unwrap_or_default();
        assert!(
            matched.is_empty(),
            "expiry rechecks the current predicate, not the captured episode"
        );

        // True again arms a fresh episode; the old generation is stale.
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", true, 0.1), true, true);
        state.flush_pending_frames().await;
        let generation = state
            .timers
            .pending_predicate_generation(&owner, &trigger)
            .expect("re-armed");
        assert!(generation > armed_generation);

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: armed.job.clone(),
                generation: armed_generation,
                due_wall_ms: armed.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        assert!(
            state.pending_predicate_fires.is_empty(),
            "the replaced episode's wakeup is dropped by the store"
        );

        // The current generation matures once and stays latched even though
        // the predicate remains true.
        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: armed.job,
                generation,
                due_wall_ms: armed.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        let matched = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&owner)
            .and_then(|status| status.v2.clone())
            .map(|v2| v2.matched_trigger_ids)
            .unwrap_or_default();
        assert_eq!(matched, vec![trigger.clone()], "current episode matures");

        state
            .devices
            .set_state(&lamp("mqtt", "lamp", true, 0.3), true, true);
        state.flush_pending_frames().await;
        let matched = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&owner)
            .and_then(|status| status.v2.clone())
            .map(|v2| v2.matched_trigger_ids)
            .unwrap_or_default();
        assert!(
            matched.is_empty(),
            "maturity is latched until the predicate leaves true"
        );
        assert!(
            state
                .timers
                .pending_predicate_generation(&owner, &trigger)
                .is_none(),
            "a latched maturity does not re-arm"
        );
    }

    // K: schedule wakeups are validated against the store generation and
    // queued for the next coherent frame; a stale wakeup is dropped.
    #[tokio::test]
    async fn p09_schedule_wakeups_are_validated_by_the_store() {
        use crate::types::automation_definition::NodeId;
        use crate::types::event::TimerWakeupJob;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        state.runtime_config.routines = vec![schedule_routine_row(
            "sched_routine",
            serde_json::json!({ "every_ms": 1_000 }),
            1,
        )];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("sched_routine".to_string());
        let trigger = NodeId("trig".to_string());
        let generation = state
            .timers
            .pending_schedule_generation(&owner, &trigger)
            .expect("armed by runtime apply");

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: TimerWakeupJob::ScheduleOccurrence {
                    trigger: trigger.clone(),
                },
                generation: generation + 1,
                due_wall_ms: 10_000,
            },
        )
        .await
        .unwrap();
        assert!(
            state.pending_schedule_fires.is_empty(),
            "a stale generation is dropped"
        );

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: TimerWakeupJob::ScheduleOccurrence {
                    trigger: trigger.clone(),
                },
                generation,
                due_wall_ms: 10_000,
            },
        )
        .await
        .unwrap();
        assert_eq!(state.pending_schedule_fires.len(), 1);
        assert!(
            state
                .timers
                .pending_schedule_generation(&owner, &trigger)
                .expect("rearmed after consume")
                > generation,
            "a consumed occurrence starts the next generation"
        );
    }

    // K: a due calendar occurrence fires the routine and rearms the next one
    // from the current time.
    #[tokio::test]
    async fn p09_schedule_occurrences_fire_and_rearm() {
        use crate::types::automation_definition::NodeId;
        use crate::types::event::TimerWakeupJob;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        state.runtime_config.routines = vec![schedule_routine_row(
            "sched_routine",
            serde_json::json!({ "cron": "0 0 8 * * *", "timezone": "UTC" }),
            1,
        )];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("sched_routine".to_string());
        let trigger = NodeId("trig".to_string());
        let wakeup = state.timers.wakeups().pop().expect("armed schedule");
        assert!(matches!(
            &wakeup.job,
            TimerWakeupJob::ScheduleOccurrence { .. }
        ));
        assert_eq!(
            wakeup.due_wall_ms, 28_800_000,
            "next 08:00 UTC after the manual clock's reference instant"
        );
        let status = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&owner)
            .cloned()
            .expect("routine status");
        let trigger_status = status
            .v2
            .expect("v2 status")
            .triggers
            .into_iter()
            .find(|candidate| candidate.trigger_id == trigger)
            .expect("schedule trigger status");
        assert!(
            trigger_status.armed,
            "the snapshot reports the armed schedule"
        );
        assert_eq!(trigger_status.due_wall_ms, Some(28_800_000));
        let generation = wakeup.generation;

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: wakeup.job.clone(),
                generation,
                due_wall_ms: wakeup.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;

        let matched = state
            .rules
            .get_runtime_statuses()
            .0
            .get(&owner)
            .and_then(|status| status.v2.clone())
            .map(|v2| v2.matched_trigger_ids)
            .unwrap_or_default();
        assert_eq!(matched, vec![trigger.clone()], "the occurrence fired");

        let rearmed = state
            .timers
            .pending_schedule_generation(&owner, &trigger)
            .expect("the next occurrence is armed");
        assert!(rearmed > generation, "rearm starts a new generation");
    }

    // K: lateness is not backlog — a bounded catch-up occurrence too late to
    // run is dropped and the schedule still rearms.
    #[tokio::test]
    async fn p09_late_catch_up_occurrence_is_dropped_and_rearms() {
        use crate::types::automation_definition::NodeId;
        use crate::types::event::TimerWakeupJob;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        state
            .devices
            .set_state(&lamp("mqtt", "lamp", false, 0.1), true, true);
        state.runtime_config.routines = vec![schedule_routine_row(
            "catchup_routine",
            serde_json::json!({
                "cron": "0 0 8 * * *",
                "timezone": "UTC",
                "backlog": "catch_up_once",
                "catch_up_lateness_ms": 1_000
            }),
            1,
        )];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("catchup_routine".to_string());
        let trigger = NodeId("trig".to_string());

        // The store's due time is authoritative. Replace the armed occurrence
        // with one due at epoch 0: the manual clock reads 1_000_000 ms, far
        // beyond the 1_000 ms catch-up bound.
        let armed = state.timers.cancel_schedule(&owner, &trigger);
        assert!(armed > 0);
        let generation = state
            .timers
            .ensure_schedule(&owner, 1, &trigger, 5_000, 0)
            .unwrap();
        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: TimerWakeupJob::ScheduleOccurrence {
                    trigger: trigger.clone(),
                },
                generation,
                due_wall_ms: 0,
            },
        )
        .await
        .unwrap();
        assert!(
            state.pending_schedule_fires.is_empty(),
            "a catch-up outside its bound does not fire"
        );
        assert!(
            state
                .timers
                .pending_schedule_generation(&owner, &trigger)
                .expect("rearmed")
                > generation,
            "the dropped occurrence still rearms the schedule"
        );
    }

    // J08: a timer scheduled with `capture_target_intents` freezes the
    // target's intent token at acceptance; a newer manual intent suppresses
    // the delayed action at expiry, while an untouched target still runs.
    #[tokio::test]
    async fn p09_captured_target_intents_suppress_superseded_delayed_actions() {
        use crate::types::automation_definition::{
            TimerId, TimerIntentCapture, TimerIntentTarget, TimerOperation,
        };
        use crate::types::event::Event;
        use crate::types::rule::RoutineId;

        let (mut state, mut event_rx) = test_state();
        let bulb = lamp("mqtt", "lamp", true, 0.1);
        let key = bulb.get_device_key();
        state.devices.set_state(&bulb, true, true);
        state.runtime_config.routines = vec![timer_routine_row("capture_routine", "off", false, 1)];
        state.apply_runtime_routines();
        state.flush_pending_frames().await;

        let owner = RoutineId("capture_routine".to_string());
        let timer = TimerId("off".to_string());
        let capture = || TimerIntentCapture {
            targets: vec![TimerIntentTarget::Device {
                device: key.clone(),
            }],
            frozen_members: Vec::new(),
        };

        // Untouched target: the delayed action proceeds.
        handle_event(
            &mut state,
            &Event::RoutineTimerOperation {
                routine_id: owner.clone(),
                definition_revision: 1,
                operation: TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 5_000,
                },
                capture: Some(capture()),
                causation: EventCausation::default(),
            },
        )
        .await
        .unwrap();
        let wakeup = state.timers.wakeups().pop().expect("scheduled wakeup");
        assert_eq!(
            wakeup.job,
            crate::types::event::TimerWakeupJob::NamedTimer {
                timer: timer.clone()
            }
        );
        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: wakeup.job,
                generation: wakeup.generation,
                due_wall_ms: wakeup.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        let mut proceeded = 0;
        while let Ok(event) = event_rx.try_recv() {
            if matches!(event, Event::RoutineAction { .. }) {
                proceeded += 1;
            }
        }
        assert_eq!(proceeded, 1, "an untouched capture still runs its action");

        // Superseded target: the manual intent arrives after acceptance.
        handle_event(
            &mut state,
            &Event::RoutineTimerOperation {
                routine_id: owner.clone(),
                definition_revision: 1,
                operation: TimerOperation::Schedule {
                    timer: timer.clone(),
                    delay_ms: 5_000,
                },
                capture: Some(capture()),
                causation: EventCausation::default(),
            },
        )
        .await
        .unwrap();
        state.intents.bump_device(&key);
        let wakeup = state.timers.wakeups().pop().expect("rescheduled wakeup");
        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: wakeup.job,
                generation: wakeup.generation,
                due_wall_ms: wakeup.due_wall_ms,
            },
        )
        .await
        .unwrap();
        state.flush_pending_frames().await;
        let mut dispatch_after_manual = 0;
        while let Ok(event) = event_rx.try_recv() {
            if matches!(event, Event::RoutineAction { .. }) {
                dispatch_after_manual += 1;
            }
        }
        assert_eq!(
            dispatch_after_manual, 0,
            "a newer manual intent suppresses the captured delayed action"
        );
    }

    // J06: a predicate wakeup is validated against the authoritative store
    // before it can mature an episode.
    #[tokio::test]
    async fn p09_predicate_wakeup_is_validated_against_the_store() {
        use crate::types::automation_definition::NodeId;
        use crate::types::event::TimerWakeupJob;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let owner = RoutineId("timer_routine".to_string());
        let trigger = NodeId("armed".to_string());
        state
            .timers
            .ensure_predicate(&owner, 1, &trigger, 30_000, 0, 1_000_000)
            .unwrap();
        let generation = state
            .timers
            .pending_predicate_generation(&owner, &trigger)
            .unwrap();

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner.clone(),
                definition_revision: 1,
                job: TimerWakeupJob::PredicateDeadline {
                    trigger: trigger.clone(),
                },
                generation: generation + 1,
                due_wall_ms: 1_030_000,
            },
        )
        .await
        .unwrap();
        assert!(
            state.pending_predicate_fires.is_empty(),
            "a stale generation never matures"
        );

        handle_event(
            &mut state,
            &Event::TimerWakeup {
                routine_id: owner,
                definition_revision: 1,
                job: TimerWakeupJob::PredicateDeadline { trigger },
                generation,
                due_wall_ms: 1_030_000,
            },
        )
        .await
        .unwrap();
        assert_eq!(state.pending_predicate_fires.len(), 1);
    }

    fn test_source_definition() -> crate::types::automation_source::SourceDefinition {
        use crate::types::automation_definition::SourceId;
        use crate::types::automation_source::{
            CircadianCompatParams, SourceCompute, SourceDefinition,
        };
        use crate::types::color::DeviceColor;
        use crate::types::device::{DeviceId, DeviceKey};
        use crate::types::integration::IntegrationId;

        SourceDefinition {
            id: SourceId("circadian".to_string()),
            name: "Circadian".to_string(),
            enabled: true,
            revision: 1,
            timezone: "Europe/Helsinki".to_string(),
            refresh_interval_ms: 60_000,
            aliases: vec![DeviceKey::new(
                IntegrationId::from("circadian".to_string()),
                DeviceId::new("color"),
            )],
            compute: SourceCompute::CircadianCompat {
                preset_version: crate::core::automation::sources::CIRCADIAN_COMPAT_PRESET_VERSION,
                params: CircadianCompatParams {
                    day_fade_start: "06:00".to_string(),
                    day_fade_duration_hours: 2,
                    day_color: DeviceColor::new_from_kelvin(3000),
                    day_brightness: Some(0.8),
                    night_fade_start: "20:00".to_string(),
                    night_fade_duration_hours: 2,
                    night_color: DeviceColor::new_from_kelvin(2000),
                    night_brightness: Some(0.2),
                },
            },
        }
    }

    // P11/D04/D07/D09: a refresh tick publishes the read-only synthetic
    // sensor under `computed/<id>`, the legacy alias resolves to the same
    // entity, and the cadence gate suppresses repeat work.
    #[tokio::test]
    async fn p11_source_refresh_publishes_canonical_device_and_alias() {
        use crate::types::automation_definition::SourceId;
        use crate::types::device::{DeviceData, DeviceId, DeviceKey, SensorDevice};
        use crate::types::integration::IntegrationId;

        let (mut state, _event_rx) = test_state();
        state.runtime_config.sources = vec![test_source_definition()];
        state.apply_runtime_sources();

        let canonical = DeviceKey::new(
            IntegrationId::from("computed".to_string()),
            DeviceId::new("circadian"),
        );
        let alias = DeviceKey::new(
            IntegrationId::from("circadian".to_string()),
            DeviceId::new("color"),
        );
        let source_id = SourceId("circadian".to_string());

        let device = state.devices.get_device(&canonical).expect("published");
        let DeviceData::Sensor(SensorDevice::Color(sensor)) = &device.data else {
            panic!("expected a read-only color sensor");
        };
        assert!(sensor.power);
        // ManualClock starts at 1_000_000 ms: 02:16 Helsinki, night.
        assert_eq!(sensor.brightness, Some(ordered_float::OrderedFloat(0.2)));
        assert_eq!(
            state.sources.output(&source_id).unwrap().quality,
            crate::types::automation_source::SourceQuality::Fresh
        );
        assert_eq!(
            state.devices.get_device(&alias).map(Device::get_device_key),
            Some(canonical.clone()),
            "the alias resolves to the one canonical entity"
        );

        // The tick is not due again within the cadence.
        assert!(state.refresh_due_sources().is_empty());

        // A corrupted definition (import bypassed API validation) fails
        // without inventing a healthy output; the last good device stays.
        state.runtime_config.sources[0].revision = 2;
        let crate::types::automation_source::SourceCompute::CircadianCompat { params, .. } =
            &mut state.runtime_config.sources[0].compute
        else {
            panic!("fixture is the built-in preset");
        };
        params.day_fade_duration_hours = 16;
        state.apply_runtime_sources();
        assert!(state.sources.output(&source_id).is_none());
        assert!(state.devices.get_device(&canonical).is_some());
    }

    // P11: seeding source devices before routines compile keeps device
    // references to `computed/<id>` resolvable at startup (main.rs seeds
    // before `Routines::load_config_rows`).
    #[tokio::test]
    async fn p11_source_devices_seed_before_routine_compile() {
        use crate::db::config_queries::RoutineRow;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let routine = || RoutineRow {
            id: "source_triggered".to_string(),
            name: "Source Triggered".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(serde_json::json!({
                "triggers": [{
                    "kind": "state_change",
                    "id": "trig_device",
                    "device": { "integration_id": "computed", "device_id": "circadian" }
                }],
                "condition": {
                    "kind": "comparison",
                    "source": {
                        "kind": "computed_source",
                        "source": "circadian",
                        "path": "/brightness"
                    },
                    "operator": "gt",
                    "value": 0.0
                },
                "program": { "kind": "native", "steps": [{
                    "action": "set_power",
                    "id": "step_on",
                    "device": { "integration_id": "dummy", "device_id": "lamp" },
                    "power": true
                }]}
            })),
            rules: serde_json::json!([]),
            actions: serde_json::json!([]),
        };

        state.runtime_config.routines = vec![routine()];
        let lamp = lamp("dummy", "lamp", false, 0.5);
        state
            .devices
            .set_state_with_origin(&lamp, true, true, EventOrigin::Derived);

        // Without a published source device the reference cannot resolve.
        state.apply_runtime_routines();
        assert!(!state
            .rules
            .compiled_v2_routines()
            .contains_key(&RoutineId("source_triggered".to_string())));

        // Seeding the source publishes `computed/circadian`; the same routine
        // now compiles and is live.
        state.runtime_config.sources = vec![test_source_definition()];
        state.apply_runtime_sources();
        state.apply_runtime_routines();
        assert!(state
            .rules
            .compiled_v2_routines()
            .contains_key(&RoutineId("source_triggered".to_string())));
    }

    // P11: a scripted source publishes through the same synthetic device path
    // as a built-in source; stale, invalid, and failed results never publish
    // and a failure keeps the last good value as stale (D06/S16).
    #[tokio::test]
    async fn p11_script_source_results_publish_and_reject_stale_or_invalid() {
        use crate::types::automation_definition::SourceId;
        use crate::types::automation_source::{
            SourceCompute, SourceDefinition, SourcePresetRef, SourceQuality,
        };
        use crate::types::device::{DeviceData, SensorDevice};
        use crate::types::event::Event;

        use crate::db::config_queries::RoutineRow;
        use crate::types::rule::RoutineId;

        let (mut state, _event_rx) = test_state();
        let source_id = SourceId("scripted".to_string());
        state.runtime_config.sources = vec![SourceDefinition {
            id: source_id.clone(),
            name: "Scripted".to_string(),
            enabled: true,
            revision: 1,
            timezone: "UTC".to_string(),
            refresh_interval_ms: 60_000,
            aliases: vec![],
            compute: SourceCompute::Script {
                preset: Some(SourcePresetRef {
                    id: "circadian".to_string(),
                    version: 1,
                }),
                source_body: None,
                params: serde_json::json!({}),
            },
        }];
        // A routine referencing the scripted source device cannot compile
        // before the first result; the first publish makes it resolvable.
        state.runtime_config.routines = vec![RoutineRow {
            id: "scripted_trigger".to_string(),
            name: "Scripted Trigger".to_string(),
            enabled: true,
            semantics_version: 2,
            revision: 1,
            definition_v2: Some(serde_json::json!({
                "triggers": [{
                    "kind": "state_change",
                    "id": "trig_device",
                    "device": { "integration_id": "computed", "device_id": "scripted" }
                }],
                "condition": {
                    "kind": "comparison",
                    "source": {
                        "kind": "computed_source",
                        "source": "scripted",
                        "path": "/brightness"
                    },
                    "operator": "gt",
                    "value": 0.0
                },
                "program": { "kind": "native", "steps": [{
                    "action": "set_power",
                    "id": "step_on",
                    "device": { "integration_id": "dummy", "device_id": "lamp" },
                    "power": true
                }]}
            })),
            rules: serde_json::json!([]),
            actions: serde_json::json!([]),
        }];
        let bulb = lamp("dummy", "lamp", false, 0.5);
        state
            .devices
            .set_state_with_origin(&bulb, true, true, EventOrigin::Derived);
        state.apply_runtime_sources();
        state.apply_runtime_routines();
        assert!(
            !state
                .rules
                .compiled_v2_routines()
                .contains_key(&RoutineId("scripted_trigger".to_string())),
            "the routine is quarantined until the source device exists"
        );
        let canonical = crate::core::automation::sources::source_device_key(&source_id);

        let admit = |state: &mut AppState| {
            state
                .scripts
                .prepare_source_invocation(
                    &source_id,
                    state.sources.definitions()[&source_id].revision,
                    "return { value: {} };".to_string(),
                    serde_json::json!({}),
                )
                .expect("script source is admitted")
        };
        let result_event = |prepared: &crate::core::automation::PreparedSourceRun,
                            value: Option<serde_json::Value>,
                            error: Option<String>| {
            Event::SourceScriptResult {
                source_id: source_id.clone(),
                request_id: prepared.token.request_id,
                owner_key: prepared.token.owner_key.clone(),
                owner_generation: prepared.token.owner_generation,
                definition_revision: prepared.token.definition_revision,
                state_revision: prepared.token.state_revision,
                value,
                error,
            }
        };

        // An edit bumps the owner generation: the in-flight result is stale.
        let stale = admit(&mut state);
        state.runtime_config.sources[0].revision = 2;
        state.apply_runtime_sources();
        handle_event(
            &mut state,
            &result_event(
                &stale,
                Some(serde_json::json!({"value": {"brightness": 0.4}})),
                None,
            ),
        )
        .await
        .unwrap();
        assert!(state.devices.get_device(&canonical).is_none());
        assert!(state.sources.output(&source_id).is_none());

        // A contract-valid but out-of-range profile is reported, not
        // published, and there is no last-good value to keep.
        let invalid = admit(&mut state);
        handle_event(
            &mut state,
            &result_event(
                &invalid,
                Some(serde_json::json!({"value": {"brightness": 1.5}})),
                None,
            ),
        )
        .await
        .unwrap();
        assert!(state.devices.get_device(&canonical).is_none());
        assert!(state.sources.output(&source_id).is_none());

        // A current valid result publishes the read-only synthetic sensor.
        let valid = admit(&mut state);
        handle_event(
            &mut state,
            &result_event(
                &valid,
                Some(serde_json::json!({
                    "value": {
                        "color": {"ct": 2700},
                        "brightness": 0.4,
                        "transition_ms": 60000
                    }
                })),
                None,
            ),
        )
        .await
        .unwrap();
        let device = state
            .devices
            .get_device(&canonical)
            .expect("the scripted source publishes its device");
        let DeviceData::Sensor(SensorDevice::Color(sensor)) = &device.data else {
            panic!("expected a color sensor, got {:?}", device.data);
        };
        assert!(sensor.power);
        assert_eq!(
            sensor.color,
            Some(crate::types::color::DeviceColor::new_from_kelvin(2700))
        );
        assert_eq!(sensor.brightness.map(|value| value.into_inner()), Some(0.4));
        let output = state.sources.output(&source_id).expect("output recorded");
        assert_eq!(output.quality, SourceQuality::Fresh);
        assert_eq!(output.definition_revision, 2);
        assert!(
            state
                .rules
                .compiled_v2_routines()
                .contains_key(&RoutineId("scripted_trigger".to_string())),
            "the first result lets the quarantined routine compile"
        );

        // A worker failure keeps the last good value as stale.
        let failed = admit(&mut state);
        handle_event(
            &mut state,
            &result_event(&failed, None, Some("worker exploded".to_string())),
        )
        .await
        .unwrap();
        assert!(state.devices.get_device(&canonical).is_some());
        match &state
            .sources
            .output(&source_id)
            .expect("last good output")
            .quality
        {
            SourceQuality::Stale { message } => assert!(message.contains("worker exploded")),
            other => panic!("expected a stale output, got {other:?}"),
        }
    }
}
