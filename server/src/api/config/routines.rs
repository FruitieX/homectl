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

    let convert = warp::path!("routines" / "convert")
        .and(warp::post())
        .and(warp::body::content_length_limit(256 * 1024))
        .and(warp::body::json())
        .and(with_snapshot(snapshot))
        .and_then(preview_conversion);

    list.or(get)
        .or(create)
        .or(update)
        .or(delete)
        .or(schedule_preview)
        .or(convert)
}

#[derive(Deserialize)]
struct RoutineConversionRequest {
    routine: RoutineRow,
    timezone: Option<String>,
}

/// Pure conversion proposal. Applying it still requires a normal expected-value
/// routine write; this endpoint never saves or enables the proposed definition.
async fn preview_conversion(
    request: RoutineConversionRequest,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    let catalog = ConfigCatalog::new(snap.devices.0.keys().cloned(), &snap.runtime_config);
    let options = automation::convert::ConvertOptions {
        timer_integrations: snap
            .runtime_config
            .integrations
            .iter()
            .filter(|row| row.plugin == "timer")
            .map(|row| row.id.clone())
            .collect(),
        cron_timezone: request.timezone,
    };
    Ok(ApiResponse::success(automation::convert::convert_routine(
        &request.routine,
        &catalog,
        &options,
    )))
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

#[derive(Deserialize)]
pub(super) struct RoutineUpdate {
    #[serde(flatten)]
    routine: RoutineRow,
    expected: Option<RoutineRow>,
}

pub(super) async fn create_routine(
    routine: RoutineRow,
    _snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    write_routine(None, routine, None, handle).await
}

pub(super) async fn update_routine(
    id: String,
    request: RoutineUpdate,
    _snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    write_routine(Some(id), request.routine, request.expected, handle).await
}

async fn write_routine(
    id: Option<String>,
    routine: RoutineRow,
    expected: Option<RoutineRow>,
    handle: StateHandle,
) -> Result<warp::reply::WithStatus<warp::reply::Json>, warp::Rejection> {
    let _guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };
    if routine.name.trim().is_empty() || routine.id.trim().is_empty() {
        return Ok(error_response(
            "Give the routine a name and an ID",
            StatusCode::BAD_REQUEST,
        ));
    }
    let creating = id.is_none();
    // Comparison, validation and application share one actor command. A second
    // writer cannot slip between the precondition and the revision increment.
    let outcome = handle.mutate(move |state| Box::pin(async move {
        let error = |status, message: &str, current: Option<&RoutineRow>| (status, serde_json::json!({ "success": false, "error": message, "current": current }));
        let old_id = id.as_deref().unwrap_or(&routine.id).to_string();
        let current = state.runtime_config.routines.iter().find(|row| row.id == old_id).cloned();
        if creating && current.is_some() { return Err(error(StatusCode::CONFLICT, "This routine ID is already in use.", current.as_ref())); }
        if !creating && current.is_none() { return Err(error(StatusCode::NOT_FOUND, "This routine was deleted. Your draft has not been saved.", None)); }
        if let (Some(expected), Some(current)) = (expected.as_ref(), current.as_ref()) {
            if serde_json::to_value(expected).ok() != serde_json::to_value(current).ok() {
                return Err(error(StatusCode::CONFLICT, "This routine changed elsewhere.", Some(current)));
            }
        }
        let next_id = routine.id.trim().to_string();
        let renamed = next_id != old_id;
        if renamed && state.runtime_config.routines.iter().any(|row| row.id == next_id) {
            return Err(error(StatusCode::CONFLICT, "Routine ID already exists.", None));
        }
        let mut next = automation::prepare_write(current.as_ref(), routine).map_err(|message| error(StatusCode::BAD_REQUEST, &message, None))?;
        next.id = next_id.clone();
        next.revision = automation::next_revision(current.as_ref());
        validate_write_shape(&next).map_err(|message| error(StatusCode::BAD_REQUEST, &message, None))?;
        if next.enabled {
            let catalog = ConfigCatalog::new(state.devices.get_state().0.keys().cloned(), &state.runtime_config);
            validate_enabled_routine(&next, &catalog).map_err(|message| error(StatusCode::BAD_REQUEST, &message, None))?;
        }
        state.runtime_config.routines.retain(|row| row.id != old_id);
        state.upsert_routine(next.clone());
        if renamed {
            for row in &mut state.runtime_config.routines {
                if row.id == next_id { continue; }
                rewrite_force_trigger_routine_references(&mut row.actions, &old_id, &next_id);
                if let Some(definition) = &mut row.definition_v2 { automation::rewrite_invoked_routine_references(definition, &old_id, &next_id); }
            }
        }
        state.apply_runtime_routines();
        Ok((next, state.runtime_config.routines.clone()))
    })).await;
    let (saved, rows) = match outcome {
        Ok(Ok(value)) => value,
        Ok(Err((status, body))) => {
            return Ok(warp::reply::with_status(warp::reply::json(&body), status))
        }
        Err(_) => return Ok(actor_unavailable()),
    };
    let available = db::is_db_connected();
    let persistence = config_queries::db_replace_routines(&rows).await;
    Ok(config_write_response(
        saved,
        persistence,
        available,
        if creating {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::actor::spawn_state_actor;
    fn fixture() -> (RoutineRow, StateHandle) {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let row: RoutineRow = serde_json::from_value(serde_json::json!({
            "id": "draft_test", "name": "Draft test", "enabled": false, "semantics_version": 2,
            "rules": [], "actions": [], "definition_v2": { "triggers": [{ "kind": "manual", "id": "start_stable" }], "program": { "kind": "native", "steps": [{ "action": "cancel_timer", "id": "step_stable", "timer": "test" }] }, "future_field": { "keep": true } }
        })).unwrap();
        state.upsert_routine(row.clone());
        state.apply_runtime_routines();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        (row, spawn_state_actor(state, snapshot, tx))
    }
    async fn body(reply: impl Reply) -> serde_json::Value {
        serde_json::from_slice(
            &warp::hyper::body::to_bytes(reply.into_response().into_body())
                .await
                .unwrap(),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn conversion_preview_reuses_converter_without_changing_saved_routine() {
        let (mut state, _events) = crate::core::event::tests::test_state();
        let legacy: RoutineRow = serde_json::from_value(serde_json::json!({
            "id": "legacy", "name": "Legacy", "enabled": false,
            "semantics_version": 1, "rules": [], "actions": []
        }))
        .unwrap();
        state.upsert_routine(legacy.clone());
        state.apply_runtime_routines();
        let snapshot = state.snapshot.clone();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let _handle = spawn_state_actor(state, snapshot.clone(), tx);
        let before = serde_json::to_value(&snapshot.load().runtime_config.routines).unwrap();
        let snap = snapshot.load();
        let catalog = ConfigCatalog::new(snap.devices.0.keys().cloned(), &snap.runtime_config);
        let expected = serde_json::to_value(automation::convert::convert_routine(
            &legacy,
            &catalog,
            &automation::convert::ConvertOptions::default(),
        ))
        .unwrap();
        drop(snap);
        let result = body(
            preview_conversion(
                RoutineConversionRequest {
                    routine: legacy,
                    timezone: None,
                },
                snapshot.clone(),
            )
            .await
            .unwrap(),
        )
        .await;
        assert_eq!(result["data"], expected);
        assert_eq!(
            serde_json::to_value(&snapshot.load().runtime_config.routines).unwrap(),
            before
        );
    }
    #[tokio::test]
    async fn stale_routine_write_returns_current_without_losing_raw_definition() {
        let (expected, handle) = fixture();
        handle
            .mutate(|state| {
                Box::pin(async move {
                    state.runtime_config.routines[0].name = "Changed elsewhere".into();
                })
            })
            .await
            .unwrap();
        let mut draft = expected.clone();
        draft.name = "My draft".into();
        let reply = write_routine(
            Some(expected.id.clone()),
            draft,
            Some(expected),
            handle.clone(),
        )
        .await
        .unwrap()
        .into_response();
        assert_eq!(reply.status(), StatusCode::CONFLICT);
        let data = body(reply).await;
        assert_eq!(data["current"]["name"], "Changed elsewhere");
        assert_eq!(
            data["current"]["definition_v2"]["future_field"]["keep"],
            true
        );
        assert_eq!(
            data["current"]["definition_v2"]["program"]["steps"][0]["id"],
            "step_stable"
        );
    }
    #[tokio::test]
    async fn routine_creation_cannot_overwrite_an_existing_id() {
        let (row, handle) = fixture();
        let reply = write_routine(None, row, None, handle)
            .await
            .unwrap()
            .into_response();
        assert_eq!(reply.status(), StatusCode::CONFLICT);
    }
    #[tokio::test]
    async fn racing_routine_saves_only_accept_one_baseline_and_increment_revision() {
        let (expected, handle) = fixture();
        let mut first = expected.clone();
        first.name = "First".into();
        let mut second = expected.clone();
        second.name = "Second".into();
        let (a, b) = tokio::join!(
            write_routine(
                Some(expected.id.clone()),
                first,
                Some(expected.clone()),
                handle.clone()
            ),
            write_routine(Some(expected.id.clone()), second, Some(expected), handle)
        );
        let a = a.unwrap().into_response();
        let b = b.unwrap().into_response();
        assert!(
            (a.status() == StatusCode::OK && b.status() == StatusCode::CONFLICT)
                || (b.status() == StatusCode::OK && a.status() == StatusCode::CONFLICT)
        );
        let a = body(if a.status() == StatusCode::OK { a } else { b }).await;
        assert_eq!(a["data"]["revision"], 2);
        assert_eq!(a["data"]["definition_v2"]["future_field"]["keep"], true);
    }
}
