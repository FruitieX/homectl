use super::*;

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
        .and(with_handle(handle))
        .and_then(create_routine);

    let update = warp::path!("routines" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_routine);

    let delete = warp::path!("routines" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_routine);

    list.or(get).or(create).or(update).or(delete)
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
    routine: RoutineRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    if let Err(error) = validate_routine_actions(&routine.actions) {
        return Ok(error_response(&error, StatusCode::BAD_REQUEST));
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
    mut routine: RoutineRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    if let Err(error) = validate_routine_actions(&routine.actions) {
        return Ok(error_response(&error, StatusCode::BAD_REQUEST));
    }

    let requested_id = routine.id.trim().to_string();
    let next_id = if requested_id.is_empty() {
        id.clone()
    } else {
        requested_id
    };
    let renamed = next_id != id;

    enum UpdateOutcome {
        Updated(Vec<RoutineRow>),
        NotFound,
        Conflict,
    }

    let id_for_state = id.clone();
    let next_id_for_state = next_id.clone();
    let mut routine_for_state = routine.clone();
    routine_for_state.id = next_id.clone();

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

                state.runtime_config.routines[existing_index] = routine_for_state.clone();

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

    routine.id = next_id.clone();

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_replace_routines(&routines_to_persist).await;
    Ok(config_write_response(
        routine,
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

// ============================================================================
// Floorplan
// ============================================================================
