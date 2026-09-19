use super::*;
use crate::core::automation::{self, ConfigCatalog};
use crate::core::routine_validation;
use crate::types::automation_definition::RoutineSemantics;

/// Validate a routine definition before it can be stored as enabled.
///
/// v1 rows keep the P01 validator (structural rule/action errors, non-finite
/// values, invalid spatial rollout configuration, and parsed-but-never-run v1
/// script syntax). v2 rows go through the shared pure compiler. Unknown
/// semantics versions are always rejected.
fn validate_enabled_routine(routine: &RoutineRow, catalog: &ConfigCatalog) -> Result<(), String> {
    match automation::row_semantics(routine) {
        RoutineSemantics::V1 => {
            // Validate actions (and their spatial-rollout requirements) before
            // rules so the established v1 error precedence and messages are
            // preserved.
            let actions = routine_validation::validate_actions_value(&routine.actions)
                .map_err(|report| report.summary())?;
            for action in &actions {
                validate_action_rollout(action)?;
            }

            let rules = routine_validation::validate_rules_value(&routine.rules)
                .map_err(|report| report.summary())?;

            let script_report = routine_validation::validate_script_syntax(&rules);
            if !script_report.is_valid() {
                return Err(script_report.summary());
            }

            Ok(())
        }
        RoutineSemantics::V2 => automation::compile_row(routine, catalog)
            .map(|_| ())
            .map_err(|report| report.summary()),
        RoutineSemantics::Unknown(version) => Err(unsupported_version_message(version)),
    }
}

fn unsupported_version_message(version: i32) -> String {
    format!(
        "Unsupported routine semantics version {version}; this build supports versions 1 and 2."
    )
}

/// Reject ambiguous writes before validation: a v2 body requires
/// semantics_version 2 and a v1 row must not carry a v2 body.
fn validate_write_shape(routine: &RoutineRow) -> Result<(), String> {
    match automation::row_semantics(routine) {
        RoutineSemantics::V1 => {
            if routine.definition_v2.is_some() {
                Err("definition_v2 requires semantics_version 2.".to_string())
            } else {
                Ok(())
            }
        }
        RoutineSemantics::V2 => {
            if routine.definition_v2.is_none() {
                Err("semantics_version 2 requires a definition_v2 body.".to_string())
            } else {
                Ok(())
            }
        }
        RoutineSemantics::Unknown(version) => Err(unsupported_version_message(version)),
    }
}

fn catalog_from_snapshot(snapshot: &SnapshotHandle) -> ConfigCatalog {
    let snap = snapshot.load();
    ConfigCatalog::new(snap.devices.0.keys().cloned(), &snap.runtime_config)
}

pub(super) fn routines_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("routines")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_routines);

    let get = warp::path!("routines" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_routine);

    let create = warp::path("routines")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(create_routine);

    let update = warp::path!("routines" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(update_routine);

    let delete = warp::path!("routines" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_routine);

    let schedule_preview = warp::path!("routines" / "schedule-preview")
        .and(warp::post())
        .and(warp::body::json())
        .and_then(preview_schedule);

    list.or(get)
        .or(create)
        .or(update)
        .or(delete)
        .or(schedule_preview)
}

pub(super) async fn list_routines(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(snap.runtime_config.routines.clone()))
}

pub(super) async fn get_routine(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .routines
        .iter()
        .find(|routine| routine.id == id)
        .cloned()
    {
        Some(routine) => Ok(ApiResponse::success(routine)),
        None => Ok(not_found("Routine")),
    }
}

pub(super) async fn create_routine(
    mut routine: RoutineRow,
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    routine.revision = 1;

    if let Err(error) = validate_write_shape(&routine) {
        return Ok(error_response(&error, StatusCode::BAD_REQUEST));
    }

    if routine.enabled {
        let catalog = catalog_from_snapshot(&snapshot);
        if let Err(error) = validate_enabled_routine(&routine, &catalog) {
            return Ok(error_response(&error, StatusCode::BAD_REQUEST));
        }
    }

    let routine_for_state = routine.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_routine(routine_for_state);
                state.apply_runtime_routines();
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_routine(&routine).await;
    Ok(config_write_response(
        routine,
        persistence,
        database_available,
        StatusCode::CREATED,
    ))
}

pub(super) async fn update_routine(
    id: String,
    routine: RoutineRow,
    snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let existing = {
        let snap = snapshot.load();
        snap.runtime_config
            .routines
            .iter()
            .find(|existing| existing.id == id)
            .cloned()
    };
    let Some(existing) = existing else {
        return Ok(not_found("Routine"));
    };

    let requested_id = routine.id.trim().to_string();
    let next_id = if requested_id.is_empty() {
        id.clone()
    } else {
        requested_id
    };
    let renamed = next_id != id;

    let mut routine_for_state = match automation::prepare_write(Some(&existing), routine) {
        Ok(routine) => routine,
        Err(error) => return Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    };
    // V08: a legacy (v1) write to a v2 row keeps the stored v2 body; the
    // revision still advances so consumers can detect the write.
    routine_for_state.id = next_id.clone();
    routine_for_state.revision = automation::next_revision(Some(&existing));

    if let Err(error) = validate_write_shape(&routine_for_state) {
        return Ok(error_response(&error, StatusCode::BAD_REQUEST));
    }

    if routine_for_state.enabled {
        let catalog = catalog_from_snapshot(&snapshot);
        if let Err(error) = validate_enabled_routine(&routine_for_state, &catalog) {
            return Ok(error_response(&error, StatusCode::BAD_REQUEST));
        }
    }

    enum UpdateOutcome {
        Updated(Vec<RoutineRow>),
        NotFound,
        Conflict,
    }

    let id_for_state = id.clone();
    let next_id_for_state = next_id.clone();
    let routine_for_state_in = routine_for_state.clone();

    let outcome = handle
        .mutate(move |state| {
            Box::pin(async move {
                let Some(existing_index) = state
                    .runtime_config
                    .routines
                    .iter()
                    .position(|existing| existing.id == id_for_state)
                else {
                    return UpdateOutcome::NotFound;
                };

                if renamed
                    && state
                        .runtime_config
                        .routines
                        .iter()
                        .any(|existing| existing.id == next_id_for_state)
                {
                    return UpdateOutcome::Conflict;
                }

                state.runtime_config.routines[existing_index] = routine_for_state_in.clone();

                if renamed {
                    for existing in &mut state.runtime_config.routines {
                        if existing.id == next_id_for_state {
                            continue;
                        }

                        rewrite_force_trigger_routine_references(
                            &mut existing.actions,
                            &id_for_state,
                            &next_id_for_state,
                        );

                        if let Some(definition) = &mut existing.definition_v2 {
                            automation::rewrite_invoked_routine_references(
                                definition,
                                &id_for_state,
                                &next_id_for_state,
                            );
                        }
                    }
                }

                state
                    .runtime_config
                    .routines
                    .sort_by(|left, right| left.id.cmp(&right.id));
                state.apply_runtime_routines();

                UpdateOutcome::Updated(state.runtime_config.routines.clone())
            })
        })
        .await;

    let routines_to_persist = match outcome {
        Ok(UpdateOutcome::Updated(routines)) => routines,
        Ok(UpdateOutcome::NotFound) => return Ok(not_found("Routine")),
        Ok(UpdateOutcome::Conflict) => {
            return Ok(error_response(
                "Routine ID already exists.",
                StatusCode::BAD_REQUEST,
            ));
        }
        Err(_) => {
            return Ok(error_response(
                "State actor unavailable",
                StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    let response_routine = routine_for_state;

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_replace_routines(&routines_to_persist).await;
    Ok(config_write_response(
        response_routine,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

pub(super) async fn delete_routine(
    id: String,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let id_for_state = id.clone();
    let deleted = handle
        .mutate(move |state| {
            Box::pin(async move {
                let deleted = state.delete_routine(&id_for_state);
                if deleted {
                    state.apply_runtime_routines();
                }
                deleted
            })
        })
        .await;
    let deleted = match deleted {
        Ok(deleted) => deleted,
        Err(_) => return Ok(actor_unavailable()),
    };

    if !deleted {
        return Ok(not_found("Routine"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_routine(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

/// Request body for `POST /config/routines/schedule-preview`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulePreviewRequest {
    pub schedule: crate::types::automation_definition::ScheduleSpec,
    /// Number of occurrences to return (default 5, clamped by the core).
    #[serde(default)]
    pub count: Option<usize>,
    /// Reference wall-clock instant in ms; defaults to the server clock.
    #[serde(default)]
    pub from_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulePreviewData {
    pub occurrences: Vec<i64>,
}

/// Preview the next occurrences of a schedule while it is being edited. The
/// schedule does not have to be stored; the answer comes from the same
/// calendar rules the runtime uses.
pub(super) async fn preview_schedule(
    request: SchedulePreviewRequest,
) -> Result<impl Reply, warp::Rejection> {
    let from_ms = request
        .from_ms
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let count = request.count.unwrap_or(5);
    match automation::schedules::preview_occurrences(&request.schedule, from_ms, count) {
        Ok(occurrences) => Ok(ApiResponse::success(SchedulePreviewData { occurrences })),
        Err(error) => Ok(error_response(&error, StatusCode::BAD_REQUEST)),
    }
}

// ============================================================================
// Floorplan
// ============================================================================
