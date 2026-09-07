use super::*;

pub(super) fn scenes_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_scenes);

    let get = warp::path!("scenes" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_scene);

    let create = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_scene);

    let update = warp::path!("scenes" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_scene);

    let delete = warp::path!("scenes" / String)
        .and(warp::delete())
        .and(with_handle(handle))
        .and_then(delete_scene);

    list.or(get).or(create).or(update).or(delete)
}

pub(super) async fn list_scenes(snapshot: SnapshotHandle) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(snap.runtime_config.scenes.clone()))
}

pub(super) async fn get_scene(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .scenes
        .iter()
        .find(|scene| scene.id == id)
        .cloned()
    {
        Some(scene) => Ok(ApiResponse::success(scene)),
        None => Ok(not_found("Scene")),
    }
}

pub(super) async fn create_scene(
    scene: SceneRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let scene_for_state = scene.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_scene(scene_for_state);
                state.apply_runtime_scenes();
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_config_scene(&scene).await;
    Ok(config_write_response(
        scene,
        persistence,
        database_available,
        StatusCode::CREATED,
    ))
}

pub(super) async fn update_scene(
    id: String,
    mut scene: SceneRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    scene.id = id;

    let scene_for_state = scene.clone();
    if handle
        .mutate(move |state| {
            Box::pin(async move {
                state.upsert_scene(scene_for_state);
                state.apply_runtime_scenes();
            })
        })
        .await
        .is_err()
    {
        return Ok(actor_unavailable());
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_config_scene(&scene).await;
    Ok(config_write_response(
        scene,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

pub(super) async fn delete_scene(
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
                let deleted = state.delete_scene(&id_for_state);
                if deleted {
                    state.apply_runtime_scenes();
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
        return Ok(not_found("Scene"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_config_scene(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Routines
// ============================================================================
