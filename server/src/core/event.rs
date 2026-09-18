use rand::Rng;
use std::collections::{BTreeMap, VecDeque};

use color_eyre::Result;

use crate::db::actions::{db_store_scene_overrides, db_store_ui_state};
use crate::types::{
    action::Action,
    automation_event::{
        AutomationFrame, DeviceMutation, EventCausation, EventOrigin, FrameDisposition,
        MAX_CAUSATION_DEPTH, MAX_DERIVATION_STEPS,
    },
    automation_trace::{PlannedRunStatus, StepDisposition},
    automation_value::HelperPersistence,
    color::DeviceColor,
    device::{Device, DeviceData, DeviceKey, DevicesState},
    dim::DimDescriptor,
    event::*,
    group::GroupId,
    integration::CustomActionDescriptor,
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
        guard_suppression, step_status, CompleteResult, FrameContext, InvocationToken, PlanInputs,
        PlannedStepBody, RoutinePlan, ScriptOutputContract,
    },
    groups::Groups,
    integrations::Integrations,
};

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
        }
    }
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
            let has_scene_override = state.scenes.has_override(device);
            if has_scene_override {
                let (scene_id, overrides) =
                    state.scenes.store_scene_override_in_memory(device, true)?;
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
    }

    Ok(outcome)
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

    pub async fn flush_pending_frames(&mut self) -> SnapshotChanges {
        let pending = self.devices.take_pending_mutations();
        if pending.is_empty() {
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
            mutations.push(mutation);
        }

        if self.warming_up {
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
            let (evaluations, native_plans, prepared_scripts) = {
                let frame = FrameContext {
                    mutations: &mutations,
                    before: &before_view,
                    after: &after_view,
                    groups: &self.groups,
                    helpers: Some(&self.helpers),
                };
                let evaluations = self.rules.handle_v2_frame(&frame);
                let mut prepared_scripts: Vec<super::automation::PreparedScriptRun> = Vec::new();
                let mut native_plans: Vec<RoutinePlan> = Vec::new();
                if !evaluations.is_empty() {
                    let inputs = PlanInputs {
                        devices: &after_view,
                        groups: &self.groups,
                        helpers: &self.helpers,
                        intents: &self.intents,
                    };
                    native_plans = self.rules.plan_v2_runs(&evaluations, &inputs);

                    // P07: script programs are submitted to the supervised
                    // worker while the actor keeps running. Context building
                    // and owner admission happen against this coherent frame;
                    // the result event plans the returned actions at
                    // acceptance time.
                    for evaluation in evaluations
                        .iter()
                        .filter(|evaluation| evaluation.will_trigger)
                    {
                        let Some(spec) = self.rules.script_spec(&evaluation.routine_id) else {
                            continue;
                        };
                        match self.scripts.prepare_handler_invocation(
                            &evaluation.routine_id,
                            evaluation.definition_revision,
                            spec,
                            &frame,
                            frame_id,
                            origin,
                            frame_causation,
                        ) {
                            Ok(run) => prepared_scripts.push(run),
                            Err(reason) => self
                                .rules
                                .record_v2_script_failure(&evaluation.routine_id, reason),
                        }
                    }
                }
                (evaluations, native_plans, prepared_scripts)
            };

            for plan in native_plans {
                let routine_id = plan.routine_id.clone();
                let status = self.dispatch_v2_plan(plan, frame_causation);
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
        if self.devices.pending_mutation_count() > 0 {
            self.devices.begin_command(EventCausation::default());
            self.flush_pending_frames().await;
        }
        self.rules
            .seed_transitions(&self.devices, &self.groups, Some(&self.helpers));
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{handle_event, DeferredEventWork};
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
            intents: Default::default(),
            scripts: Default::default(),
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
        state.scripts.clock = || 777;

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
}
