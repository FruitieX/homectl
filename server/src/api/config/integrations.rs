use super::*;

pub(super) fn integration_schema_routes(
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("integration-schemas")
        .and(warp::path::end())
        .and(warp::get())
        .and_then(list_integration_schemas)
}

pub(super) async fn list_integration_schemas() -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(integration_config_schemas()))
}

pub(super) fn integrations_routes(
    snapshot: &SnapshotHandle,
    handle: &StateHandle,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(list_integrations);

    let get = warp::path!("integrations" / String)
        .and(warp::get())
        .and(with_snapshot(snapshot))
        .and_then(get_integration);

    let create = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(create_integration);

    let update = warp::path!("integrations" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_handle(handle))
        .and_then(update_integration);

    let delete = warp::path!("integrations" / String)
        .and(warp::delete())
        .and(with_snapshot(snapshot))
        .and(with_handle(handle))
        .and_then(delete_integration);

    list.or(get).or(create).or(update).or(delete)
}

pub(super) async fn list_integrations(
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    Ok(ApiResponse::success(
        snap.runtime_config.integrations.clone(),
    ))
}

pub(super) async fn get_integration(
    id: String,
    snapshot: SnapshotHandle,
) -> Result<impl Reply, warp::Rejection> {
    let snap = snapshot.load();
    match snap
        .runtime_config
        .integrations
        .iter()
        .find(|integration| integration.id == id)
        .cloned()
    {
        Some(integration) => Ok(ApiResponse::success(integration)),
        None => Ok(not_found("Integration")),
    }
}

pub(super) async fn create_integration(
    integration: IntegrationRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    if let Err(e) = apply_runtime_integrations_change(&handle, &_write_guard, |config| {
        if let Some(existing) = config
            .integrations
            .iter_mut()
            .find(|existing| existing.id == integration.id)
        {
            *existing = integration.clone();
        } else {
            config.integrations.push(integration.clone());
            config
                .integrations
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
        true
    })
    .await
    {
        return Ok(error_response(
            &format!("Integration change failed: {e}"),
            StatusCode::BAD_REQUEST,
        ));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_integration(&integration).await;
    Ok(config_write_response(
        integration,
        persistence,
        database_available,
        StatusCode::CREATED,
    ))
}

pub(super) async fn update_integration(
    id: String,
    mut integration: IntegrationRow,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    integration.id = id;

    if let Err(e) = apply_runtime_integrations_change(&handle, &_write_guard, |config| {
        if let Some(existing) = config
            .integrations
            .iter_mut()
            .find(|existing| existing.id == integration.id)
        {
            *existing = integration.clone();
        } else {
            config.integrations.push(integration.clone());
            config
                .integrations
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
        true
    })
    .await
    {
        return Ok(error_response(
            &format!("Integration change failed: {e}"),
            StatusCode::BAD_REQUEST,
        ));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_upsert_integration(&integration).await;
    Ok(config_write_response(
        integration,
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

pub(super) async fn delete_integration(
    id: String,
    _snapshot: SnapshotHandle,
    handle: StateHandle,
) -> Result<impl Reply, warp::Rejection> {
    let _write_guard = match config_write_lock(&handle).await {
        Ok(guard) => guard,
        Err(_) => return Ok(actor_unavailable()),
    };

    let existed = handle
        .snapshot
        .load()
        .runtime_config
        .integrations
        .iter()
        .any(|integration| integration.id == id);

    let deleted = if !existed {
        false
    } else {
        match apply_runtime_integrations_change(&handle, &_write_guard, |config| {
            let len_before = config.integrations.len();
            config
                .integrations
                .retain(|integration| integration.id != id);
            config.integrations.len() != len_before
        })
        .await
        {
            Ok(deleted) => deleted,
            Err(e) => {
                return Ok(error_response(
                    &format!("Integration change failed: {e}"),
                    StatusCode::BAD_REQUEST,
                ));
            }
        }
    };

    if !deleted {
        return Ok(not_found("Integration"));
    }

    let database_available = db::is_db_connected();
    let persistence = config_queries::db_delete_integration(&id).await;
    Ok(config_write_response(
        (),
        persistence,
        database_available,
        StatusCode::OK,
    ))
}

// ============================================================================
// Groups
// ============================================================================
