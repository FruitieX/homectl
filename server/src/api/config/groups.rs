use super::*;

pub(super) fn groups_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("groups")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_groups);

    let get = warp::path!("groups" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_group);

    let create = warp::path("groups")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_group);

    let update = warp::path!("groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_group);

    let delete = warp::path!("groups" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_group);

    list.or(get).or(create).or(update).or(delete)
}

pub(super) async fn list_groups(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config
            .groups
            .iter()
            .cloned()
            .map(|group| group_response_row(&snap.flattened_groups, group))
            .collect::<Vec<_>>(),
    ))
}

pub(super) async fn get_group(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .groups
        .iter()
        .find(|group| group.id == id)
        .cloned()
    {
        Some(group) => Ok(ApiResponse::success(group_response_row(
            &snap.flattened_groups,
            group,
        ))),
        None => Ok(not_found("Group")),
    }
}

pub(super) async fn create_group(
    group: GroupRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let group_for_state = group.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_group(group_for_state);
                state.apply_runtime_groups();
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_group(&group).await;
    Ok(config_write_response(
        group,
        persistence,
        database_available,
        StatusCode::CREATED,
    ))
}

pub(super) async fn update_group(
    id: String,
    mut group: GroupRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    group.id = id;

    let group_for_state = group.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_group(group_for_state);
                state.apply_runtime_groups();
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_group(&group).await;
    Ok(config_write_response(
        group,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

pub(super) async fn delete_group(
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
                let deleted = state.delete_group(&id_for_state);
                if deleted {
                    state.apply_runtime_groups();
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
        return Ok(not_found("Group"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_group(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Scenes
// ============================================================================
