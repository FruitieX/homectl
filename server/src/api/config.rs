//! REST API endpoints for configuration management
//!
//! Provides CRUD endpoints for:
//! - Integrations: GET/POST/PUT/DELETE /api/v1/config/integrations
//! - Groups: GET/POST/PUT/DELETE /api/v1/config/groups
//! - Scenes: GET/POST/PUT/DELETE /api/v1/config/scenes
//! - Routines: GET/POST/PUT/DELETE /api/v1/config/routines
//! - Import/Export: GET/POST /api/v1/config/export, /api/v1/config/import
//! - Migration: POST /api/v1/config/migrate/preview, /api/v1/config/migrate/apply

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use crate::core::logs::recent_logs;
use crate::core::state::AppState;
use crate::db::actions::db_update_device;
use crate::db::config_queries::{
    self, ConfigExport, CoreConfigRow, DashboardLayoutRow, DashboardWidgetRow,
    DeviceDisplayNameRow, DevicePositionRow, DeviceSensorConfigRow, FloorplanMetadataRow,
    FloorplanRow, GroupDeviceRow, GroupPositionRow, GroupRow, IntegrationRow, RoutineRow, SceneRow,
};
use crate::types::{
    device::{ControllableState, Device, DeviceData, DeviceId, DeviceRef, SensorDevice},
    integration::IntegrationId,
    rule::Rules,
};
use bytes::Buf;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use warp::{http::StatusCode, Filter, Reply};

use super::with_state;

// ============================================================================
// Response Types
// ============================================================================

#[derive(Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> warp::reply::WithStatus<warp::reply::Json> {
        warp::reply::with_status(
            warp::reply::json(&ApiResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
            StatusCode::OK,
        )
    }

    fn created(data: T) -> warp::reply::WithStatus<warp::reply::Json> {
        warp::reply::with_status(
            warp::reply::json(&ApiResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
            StatusCode::CREATED,
        )
    }
}

fn error_response(msg: &str, status: StatusCode) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(
        warp::reply::json(&ApiResponse::<()> {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        }),
        status,
    )
}

fn not_found(entity: &str) -> warp::reply::WithStatus<warp::reply::Json> {
    error_response(&format!("{entity} not found"), StatusCode::NOT_FOUND)
}

fn internal_error(e: impl std::fmt::Display) -> warp::reply::WithStatus<warp::reply::Json> {
    error_response(&e.to_string(), StatusCode::INTERNAL_SERVER_ERROR)
}

fn decode_path_key(raw: String) -> String {
    percent_decode_str(raw.as_str())
        .decode_utf8_lossy()
        .into_owned()
}

// ============================================================================
// Main Config Routes
// ============================================================================

pub fn config(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("config").and(
        core_routes(app_state)
            .or(logs_routes(app_state))
            .or(device_display_name_routes(app_state))
            .or(device_sensor_config_routes(app_state))
            .or(integrations_routes(app_state))
            .or(groups_routes(app_state))
            .or(scenes_routes(app_state))
            .or(routines_routes(app_state))
            .or(floorplans_routes(app_state))
            .or(floorplan_routes(app_state))
            .or(dashboard_routes(app_state))
            .or(export_import_routes(app_state))
            .or(migrate_routes(app_state)),
    )
}

// ============================================================================
// Core Config
// ============================================================================

fn logs_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("logs")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_logs)
}

async fn list_logs(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    Ok(ApiResponse::success(recent_logs()))
}

fn core_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get = warp::path("core")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_core_config);

    let update = warp::path("core")
        .and(warp::path::end())
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_core_config);

    get.or(update)
}

async fn get_core_config(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_core_config().await {
        Ok(Some(config)) => Ok(ApiResponse::success(config)),
        Ok(None) => Ok(error_response(
            "Database not available",
            StatusCode::SERVICE_UNAVAILABLE,
        )),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_core_config(
    config: config_queries::CoreConfigRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_update_core_config(&config).await {
        Ok(()) => Ok(ApiResponse::success(config)),
        Err(e) => Ok(internal_error(e)),
    }
}

fn device_display_name_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-display-names")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_device_display_names);

    let upsert = warp::path!("device-display-names" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_display_name);

    let delete = warp::path!("device-display-names" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_display_name);

    list.or(upsert).or(delete)
}

async fn list_device_display_names(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_device_display_overrides().await {
        Ok(rows) => Ok(ApiResponse::success(rows)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_device_display_name(
    device_key: String,
    mut row: DeviceDisplayNameRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    row.device_key = decode_path_key(device_key);

    match config_queries::db_upsert_device_display_override(&row).await {
        Ok(()) => Ok(ApiResponse::success(row)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_device_display_name(
    device_key: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_device_display_override(&decode_path_key(device_key)).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Device display name")),
        Err(e) => Ok(internal_error(e)),
    }
}

fn device_sensor_config_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("device-sensor-configs")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_device_sensor_configs);

    let upsert = warp::path!("device-sensor-configs" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_sensor_config);

    let delete = warp::path!("device-sensor-configs" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_sensor_config);

    list.or(upsert).or(delete)
}

async fn list_device_sensor_configs(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_device_sensor_configs().await {
        Ok(rows) => Ok(ApiResponse::success(rows)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_device_sensor_config(
    device_ref: String,
    mut row: DeviceSensorConfigRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    row.device_ref = decode_path_key(device_ref);

    match config_queries::db_upsert_device_sensor_config(&row).await {
        Ok(()) => Ok(ApiResponse::success(row)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_device_sensor_config(
    device_ref: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_device_sensor_config(&decode_path_key(device_ref)).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Device sensor config")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Integrations
// ============================================================================

fn integrations_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_integrations);

    let get = warp::path!("integrations" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_integration);

    let create = warp::path("integrations")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_integration);

    let update = warp::path!("integrations" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_integration);

    let delete = warp::path!("integrations" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_integration);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_integrations(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_integrations().await {
        Ok(integrations) => Ok(ApiResponse::success(integrations)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_integration(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_integration(&id).await {
        Ok(Some(integration)) => Ok(ApiResponse::success(integration)),
        Ok(None) => Ok(not_found("Integration")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_integration(
    integration: IntegrationRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_integration(&integration).await {
        Ok(()) => {
            // Trigger hot-reload
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_integrations().await {
                warn!("Failed to hot-reload integrations: {e}");
            }
            Ok(ApiResponse::created(integration))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_integration(
    id: String,
    mut integration: IntegrationRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    integration.id = id;
    match config_queries::db_upsert_integration(&integration).await {
        Ok(()) => {
            // Trigger hot-reload
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_integrations().await {
                warn!("Failed to hot-reload integrations: {e}");
            }
            Ok(ApiResponse::success(integration))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_integration(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_integration(&id).await {
        Ok(true) => {
            // Trigger hot-reload
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_integrations().await {
                warn!("Failed to hot-reload integrations: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Integration")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Groups
// ============================================================================

fn groups_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("groups")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_groups);

    let get = warp::path!("groups" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_group);

    let create = warp::path("groups")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_group);

    let update = warp::path!("groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_group);

    let delete = warp::path!("groups" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_group);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_groups(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_groups().await {
        Ok(groups) => Ok(ApiResponse::success(groups)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_group(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_group(&id).await {
        Ok(Some(group)) => Ok(ApiResponse::success(group)),
        Ok(None) => Ok(not_found("Group")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_group(
    group: GroupRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_group(&group).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_groups().await {
                warn!("Failed to hot-reload groups: {e}");
            }
            Ok(ApiResponse::created(group))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_group(
    id: String,
    mut group: GroupRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    group.id = id;
    match config_queries::db_upsert_group(&group).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_groups().await {
                warn!("Failed to hot-reload groups: {e}");
            }
            Ok(ApiResponse::success(group))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_group(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_group(&id).await {
        Ok(true) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_groups().await {
                warn!("Failed to hot-reload groups: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Group")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Scenes
// ============================================================================

fn scenes_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_scenes);

    let get = warp::path!("scenes" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_scene);

    let create = warp::path("scenes")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_scene);

    let update = warp::path!("scenes" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_scene);

    let delete = warp::path!("scenes" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_scene);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_scenes(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_config_scenes().await {
        Ok(scenes) => Ok(ApiResponse::success(scenes)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_scene(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_config_scene(&id).await {
        Ok(Some(scene)) => Ok(ApiResponse::success(scene)),
        Ok(None) => Ok(not_found("Scene")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_scene(
    scene: SceneRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_config_scene(&scene).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_scenes().await {
                warn!("Failed to hot-reload scenes: {e}");
            }
            Ok(ApiResponse::created(scene))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_scene(
    id: String,
    mut scene: SceneRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    scene.id = id;
    match config_queries::db_upsert_config_scene(&scene).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_scenes().await {
                warn!("Failed to hot-reload scenes: {e}");
            }
            Ok(ApiResponse::success(scene))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_scene(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_config_scene(&id).await {
        Ok(true) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_scenes().await {
                warn!("Failed to hot-reload scenes: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Scene")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Routines
// ============================================================================

fn routines_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("routines")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_routines);

    let get = warp::path!("routines" / String)
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_routine);

    let create = warp::path("routines")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_routine);

    let update = warp::path!("routines" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_routine);

    let delete = warp::path!("routines" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_routine);

    list.or(get).or(create).or(update).or(delete)
}

async fn list_routines(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_routines().await {
        Ok(routines) => Ok(ApiResponse::success(routines)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_routine(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_routine(&id).await {
        Ok(Some(routine)) => Ok(ApiResponse::success(routine)),
        Ok(None) => Ok(not_found("Routine")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_routine(
    routine: RoutineRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_routine(&routine).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_routines().await {
                warn!("Failed to hot-reload routines: {e}");
            }
            Ok(ApiResponse::created(routine))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_routine(
    id: String,
    mut routine: RoutineRow,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    routine.id = id;
    match config_queries::db_upsert_routine(&routine).await {
        Ok(()) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_routines().await {
                warn!("Failed to hot-reload routines: {e}");
            }
            Ok(ApiResponse::success(routine))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_routine(
    id: String,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_routine(&id).await {
        Ok(true) => {
            let mut state = app_state.write().await;
            if let Err(e) = state.reload_routines().await {
                warn!("Failed to hot-reload routines: {e}");
            }
            Ok(ApiResponse::success(()))
        }
        Ok(false) => Ok(not_found("Routine")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Floorplan
// ============================================================================

fn floorplans_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let list = warp::path("floorplans")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(list_floorplans);

    let create = warp::path("floorplans")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(create_floorplan);

    let update = warp::path!("floorplans" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(update_floorplan);

    let delete = warp::path!("floorplans" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_floorplan);

    list.or(create).or(update).or(delete)
}

async fn list_floorplans(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_floorplans().await {
        Ok(floorplans) => Ok(ApiResponse::success(floorplans)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn create_floorplan(
    floorplan: FloorplanMetadataRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_create_floorplan(&floorplan).await {
        Ok(()) => Ok(ApiResponse::created(floorplan)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn update_floorplan(
    id: String,
    mut floorplan: FloorplanMetadataRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    floorplan.id = id;

    match config_queries::db_update_floorplan_metadata(&floorplan).await {
        Ok(()) => Ok(ApiResponse::success(floorplan)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_floorplan(
    id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_floorplan(&id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Floorplan")),
        Err(e) => Ok(internal_error(e)),
    }
}

fn floorplan_id_query() -> impl Filter<Extract = (String,), Error = std::convert::Infallible> + Clone
{
    warp::query::raw()
        .or(warp::any().map(String::new))
        .unify()
        .map(|raw: String| {
            raw.split('&')
                .find_map(|entry| {
                    entry
                        .split_once('=')
                        .filter(|(key, _)| *key == "id")
                        .map(|(_, value)| {
                            percent_decode_str(value).decode_utf8_lossy().into_owned()
                        })
                })
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| "default".to_string())
        })
}

fn floorplan_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(get_floorplan);

    let upload_floorplan = warp::path("floorplan")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::body::bytes())
        .and(warp::header::optional::<String>("content-type"))
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(upload_floorplan);

    // Grid endpoints (JSON data for the floor grid)
    let get_grid = warp::path!("floorplan" / "grid")
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(get_floorplan_grid);

    let save_grid = warp::path!("floorplan" / "grid")
        .and(warp::post())
        .and(warp::body::json())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(save_floorplan_grid);

    // Separate image endpoints
    let get_image = warp::path!("floorplan" / "image")
        .and(warp::get())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(get_floorplan_image);

    let head_image = warp::path!("floorplan" / "image")
        .and(warp::head())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(head_floorplan_image);

    let upload_image = warp::path!("floorplan" / "image")
        .and(warp::post())
        .and(warp::multipart::form().max_length(10 * 1024 * 1024))
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(upload_floorplan_image);

    let delete_image = warp::path!("floorplan" / "image")
        .and(warp::delete())
        .and(floorplan_id_query())
        .and(with_state(app_state))
        .and_then(delete_floorplan_image);

    let get_positions = warp::path!("floorplan" / "devices")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_device_positions);

    let upsert_position = warp::path!("floorplan" / "devices" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_device_position);

    let delete_position = warp::path!("floorplan" / "devices" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_device_position);

    let get_group_positions = warp::path!("floorplan" / "groups")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_group_positions);

    let upsert_group_position = warp::path!("floorplan" / "groups" / String)
        .and(warp::put())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_group_position);

    let delete_group_position = warp::path!("floorplan" / "groups" / String)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_group_position);

    get_floorplan
        .or(upload_floorplan)
        .or(get_grid)
        .or(save_grid)
        .or(get_image)
        .or(head_image)
        .or(upload_image)
        .or(delete_image)
        .or(get_positions)
        .or(upsert_position)
        .or(delete_position)
        .or(get_group_positions)
        .or(upsert_group_position)
        .or(delete_group_position)
}

async fn get_floorplan(
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_floorplan_by_id(&floorplan_id).await {
        Ok(Some(floorplan)) => Ok(ApiResponse::success(floorplan)),
        Ok(None) => Ok(not_found("Floorplan")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upload_floorplan(
    body: bytes::Bytes,
    content_type: Option<String>,
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    // TODO: Get width/height from image metadata
    let floorplan = FloorplanRow {
        image_data: Some(body.to_vec()),
        image_mime_type: content_type,
        width: None,
        height: None,
    };

    match config_queries::db_upsert_floorplan_by_id(&floorplan_id, &floorplan).await {
        Ok(()) => Ok(ApiResponse::success(())),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_device_positions(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_device_positions().await {
        Ok(positions) => Ok(ApiResponse::success(positions)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_device_position(
    device_key: String,
    mut pos: DevicePositionRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    pos.device_key = decode_path_key(device_key);
    match config_queries::db_upsert_device_position(&pos).await {
        Ok(()) => Ok(ApiResponse::success(pos)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_device_position(
    device_key: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_device_position(&decode_path_key(device_key)).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Device position")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_group_positions(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_group_positions().await {
        Ok(positions) => Ok(ApiResponse::success(positions)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_group_position(
    group_id: String,
    mut pos: GroupPositionRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    pos.group_id = group_id;
    match config_queries::db_upsert_group_position(&pos).await {
        Ok(()) => Ok(ApiResponse::success(pos)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_group_position(
    group_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_group_position(&group_id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Group position")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_floorplan_grid(
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_floorplan_grid_by_id(&floorplan_id).await {
        Ok(Some(grid)) => Ok(ApiResponse::success(grid.grid)),
        Ok(None) => Ok(ApiResponse::success(Option::<String>::None)),
        Err(e) => Ok(internal_error(e)),
    }
}

#[derive(Deserialize)]
struct SaveGridRequest {
    grid: String,
}

async fn save_floorplan_grid(
    request: SaveGridRequest,
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_floorplan_grid_by_id(&floorplan_id, &request.grid).await {
        Ok(()) => Ok(ApiResponse::success(())),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_floorplan_image(
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    match config_queries::db_get_floorplan_by_id(&floorplan_id).await {
        Ok(Some(floorplan)) => {
            if let Some(image_data) = floorplan.image_data {
                let mime_type = floorplan
                    .image_mime_type
                    .unwrap_or_else(|| "image/png".to_string());
                Ok(Box::new(warp::reply::with_header(
                    image_data,
                    "Content-Type",
                    mime_type,
                )))
            } else {
                Ok(Box::new(not_found("Floorplan image")))
            }
        }
        Ok(None) => Ok(Box::new(not_found("Floorplan image"))),
        Err(e) => Ok(Box::new(internal_error(e))),
    }
}

async fn upload_floorplan_image(
    mut form: warp::multipart::FormData,
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    use futures::TryStreamExt;

    let mut image_data: Option<Vec<u8>> = None;
    let mut mime_type: Option<String> = None;

    while let Ok(Some(part)) = form.try_next().await {
        if part.name() == "image" {
            mime_type = part.content_type().map(|s| s.to_string());

            let mut data = Vec::new();
            let mut stream = part.stream();
            while let Ok(Some(chunk)) = stream.try_next().await {
                data.extend_from_slice(chunk.chunk());
            }

            image_data = Some(data);
        }
    }

    if let Some(data) = image_data {
        let floorplan = FloorplanRow {
            image_data: Some(data),
            image_mime_type: mime_type,
            width: None,
            height: None,
        };

        match config_queries::db_upsert_floorplan_by_id(&floorplan_id, &floorplan).await {
            Ok(()) => Ok(ApiResponse::success(())),
            Err(e) => Ok(internal_error(e)),
        }
    } else {
        Ok(error_response(
            "No image data found",
            StatusCode::BAD_REQUEST,
        ))
    }
}

async fn head_floorplan_image(
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<Box<dyn Reply>, warp::Rejection> {
    match config_queries::db_get_floorplan_by_id(&floorplan_id).await {
        Ok(Some(floorplan)) => {
            if floorplan.image_data.is_some() {
                let mime_type = floorplan
                    .image_mime_type
                    .unwrap_or_else(|| "image/png".to_string());
                Ok(Box::new(warp::reply::with_header(
                    warp::reply(),
                    "Content-Type",
                    mime_type,
                )))
            } else {
                Ok(Box::new(not_found("Floorplan image")))
            }
        }
        Ok(None) => Ok(Box::new(not_found("Floorplan image"))),
        Err(e) => Ok(Box::new(internal_error(e))),
    }
}

async fn delete_floorplan_image(
    floorplan_id: String,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_clear_floorplan_image(&floorplan_id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Floorplan image")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Dashboard
// ============================================================================

fn dashboard_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let get_layouts = warp::path!("dashboard" / "layouts")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_dashboard_layouts);

    let upsert_layout = warp::path!("dashboard" / "layouts")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_dashboard_layout);

    let delete_layout = warp::path!("dashboard" / "layouts" / i32)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_dashboard_layout);

    let get_widgets = warp::path!("dashboard" / "layouts" / i32 / "widgets")
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(get_dashboard_widgets);

    let upsert_widget = warp::path!("dashboard" / "widgets")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(upsert_dashboard_widget);

    let delete_widget = warp::path!("dashboard" / "widgets" / i32)
        .and(warp::delete())
        .and(with_state(app_state))
        .and_then(delete_dashboard_widget);

    get_layouts
        .or(upsert_layout)
        .or(delete_layout)
        .or(get_widgets)
        .or(upsert_widget)
        .or(delete_widget)
}

async fn get_dashboard_layouts(
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_dashboard_layouts().await {
        Ok(layouts) => Ok(ApiResponse::success(layouts)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_dashboard_layout(
    layout: DashboardLayoutRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_dashboard_layout(&layout).await {
        Ok(id) => Ok(ApiResponse::success(DashboardLayoutRow {
            id,
            name: layout.name,
            is_default: layout.is_default,
        })),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_dashboard_layout(
    id: i32,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_dashboard_layout(id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Dashboard layout")),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn get_dashboard_widgets(
    layout_id: i32,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_get_dashboard_widgets(layout_id).await {
        Ok(widgets) => Ok(ApiResponse::success(widgets)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn upsert_dashboard_widget(
    widget: DashboardWidgetRow,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_upsert_dashboard_widget(&widget).await {
        Ok(id) => Ok(ApiResponse::success(DashboardWidgetRow { id, ..widget })),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn delete_dashboard_widget(
    id: i32,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_delete_dashboard_widget(id).await {
        Ok(true) => Ok(ApiResponse::success(())),
        Ok(false) => Ok(not_found("Dashboard widget")),
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// Export / Import
// ============================================================================

#[derive(Deserialize)]
struct ImportQuery {
    #[serde(default)]
    save_version: bool,
}

fn export_import_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let export = warp::path("export")
        .and(warp::path::end())
        .and(warp::get())
        .and(with_state(app_state))
        .and_then(export_config);

    let import = warp::path("import")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::query::<ImportQuery>())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(import_config);

    export.or(import)
}

async fn export_config(_app_state: Arc<RwLock<AppState>>) -> Result<impl Reply, warp::Rejection> {
    match config_queries::db_export_config().await {
        Ok(config) => Ok(ApiResponse::success(config)),
        Err(e) => Ok(internal_error(e)),
    }
}

async fn import_config(
    query: ImportQuery,
    config: ConfigExport,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    // Optionally save version before import
    if query.save_version {
        if let Err(e) = config_queries::db_save_config_version(&config, Some("Before import")).await
        {
            warn!("Failed to save config version before import: {e}");
        }
    }

    match config_queries::db_import_config(&config).await {
        Ok(()) => {
            // Hot-reload all config
            let mut state = app_state.write().await;
            let _ = state.reload_integrations().await;
            let _ = state.reload_groups().await;
            let _ = state.reload_scenes().await;
            let _ = state.reload_routines().await;
            Ok(ApiResponse::success(()))
        }
        Err(e) => Ok(internal_error(e)),
    }
}

// ============================================================================
// TOML Migration
// ============================================================================

/// Intermediate types for TOML parsing that mirror the Config structure

#[derive(Deserialize)]
struct TomlConfig {
    core: Option<TomlCoreConfig>,
    integrations: Option<HashMap<String, toml::Value>>,
    groups: Option<HashMap<String, TomlGroupConfig>>,
    scenes: Option<HashMap<String, TomlSceneConfig>>,
    routines: Option<HashMap<String, TomlRoutineConfig>>,
}

#[derive(Deserialize)]
struct TomlCoreConfig {
    warmup_time_seconds: Option<u64>,
}

#[derive(Deserialize)]
struct TomlGroupConfig {
    name: String,
    #[serde(default)]
    hidden: Option<bool>,
    devices: Option<Vec<TomlGroupDevice>>,
    groups: Option<Vec<TomlGroupLink>>,
}

#[derive(Deserialize)]
struct TomlGroupDevice {
    integration_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
}

#[derive(Deserialize)]
struct TomlGroupLink {
    group_id: String,
}

#[derive(Deserialize)]
struct TomlSceneConfig {
    name: String,
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default)]
    devices: Option<HashMap<String, HashMap<String, serde_json::Value>>>,
    #[serde(default)]
    groups: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    expr: Option<String>,
}

#[derive(Deserialize)]
struct TomlRoutineConfig {
    name: String,
    #[serde(default)]
    rules: Option<serde_json::Value>,
    #[serde(default)]
    actions: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
pub struct MigratePreviewResult {
    integrations: Vec<IntegrationRow>,
    groups: Vec<GroupRow>,
    scenes: Vec<SceneRow>,
    routines: Vec<RoutineRow>,
    core: CoreConfigRow,
}

#[derive(Serialize)]
struct MigrateApplyResult {
    integrations: usize,
    groups: usize,
    scenes: usize,
    routines: usize,
}

fn migrate_routes(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    let preview = warp::path!("migrate" / "preview")
        .and(warp::post())
        .and(warp::body::bytes())
        .and(with_state(app_state))
        .and_then(migrate_preview);

    let apply = warp::path!("migrate" / "apply")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_state(app_state))
        .and_then(migrate_apply);

    preview.or(apply)
}

pub fn parse_toml_config(toml_str: &str) -> Result<MigratePreviewResult, String> {
    let config: TomlConfig =
        toml::from_str(toml_str).map_err(|e| format!("Failed to parse TOML: {e}"))?;

    // Convert core config
    let core = CoreConfigRow {
        warmup_time_seconds: config.core.and_then(|c| c.warmup_time_seconds).unwrap_or(1) as i32,
    };

    // Convert integrations
    let integrations: Vec<IntegrationRow> = config
        .integrations
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(id, value)| {
            let plugin = value.get("plugin")?.as_str()?.to_string();
            // Convert the remaining config (exclude "plugin") to JSON
            let mut config_map = value.as_table().cloned().unwrap_or_default();
            config_map.remove("plugin");
            let config_json = serde_json::to_value(&config_map)
                .unwrap_or(serde_json::Value::Object(Default::default()));
            Some(IntegrationRow {
                id,
                plugin,
                config: config_json,
                enabled: true,
            })
        })
        .collect();

    // Convert groups
    let groups: Vec<GroupRow> = config
        .groups
        .unwrap_or_default()
        .into_iter()
        .map(|(id, group)| {
            let devices: Vec<GroupDeviceRow> = group
                .devices
                .unwrap_or_default()
                .into_iter()
                .map(|d| GroupDeviceRow {
                    integration_id: d.integration_id,
                    device_name: d.name.unwrap_or_default(),
                    device_id: d.device_id,
                })
                .collect();

            let linked_groups: Vec<String> = group
                .groups
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.group_id)
                .collect();

            GroupRow {
                id,
                name: group.name,
                hidden: group.hidden.unwrap_or(false),
                devices,
                linked_groups,
            }
        })
        .collect();

    // Convert scenes
    let scenes: Vec<SceneRow> = config
        .scenes
        .unwrap_or_default()
        .into_iter()
        .map(|(id, scene)| {
            // Convert device states: { integration_id: { device_name: config } }
            // → HashMap<"integration_id/device_name", config_json>
            let device_states: HashMap<String, serde_json::Value> = scene
                .devices
                .unwrap_or_default()
                .into_iter()
                .flat_map(|(integration_id, devices)| {
                    devices.into_iter().map(move |(device_name, config)| {
                        let key = format!("{integration_id}/{device_name}");
                        (key, config)
                    })
                })
                .collect();

            // Convert group states: { group_id: config }
            let group_states: HashMap<String, serde_json::Value> = scene.groups.unwrap_or_default();

            SceneRow {
                id,
                name: scene.name,
                hidden: scene.hidden.unwrap_or(false),
                script: scene.expr, // Store evalexpr as script (for reference/migration)
                device_states,
                group_states,
            }
        })
        .collect();

    // Convert routines
    let routines: Vec<RoutineRow> = config
        .routines
        .unwrap_or_default()
        .into_iter()
        .map(|(id, routine)| RoutineRow {
            id,
            name: routine.name,
            enabled: true,
            rules: routine.rules.unwrap_or(serde_json::Value::Array(vec![])),
            actions: routine.actions.unwrap_or(serde_json::Value::Array(vec![])),
        })
        .collect();

    Ok(MigratePreviewResult {
        integrations,
        groups,
        scenes,
        routines,
        core,
    })
}

/// Apply a parsed TOML migration result to the database.
pub async fn apply_migration(preview: &MigratePreviewResult) -> color_eyre::Result<()> {
    config_queries::db_update_core_config(&preview.core).await?;

    for integration in &preview.integrations {
        config_queries::db_upsert_integration(integration).await?;
    }

    // Collect valid group IDs so we can skip invalid group links
    let valid_group_ids: std::collections::HashSet<&str> =
        preview.groups.iter().map(|g| g.id.as_str()).collect();

    // Two-pass group import: insert all group rows first (without links),
    // then insert links in a second pass. This avoids FK violations when
    // a group links to another group that hasn't been inserted yet.
    for group in &preview.groups {
        let group_without_links = config_queries::GroupRow {
            linked_groups: Vec::new(),
            ..group.clone()
        };
        config_queries::db_upsert_group(&group_without_links).await?;
    }
    for group in &preview.groups {
        if group.linked_groups.is_empty() {
            continue;
        }
        // Filter out links to non-existent groups
        let valid_links: Vec<String> = group
            .linked_groups
            .iter()
            .filter(|id| {
                if valid_group_ids.contains(id.as_str()) {
                    true
                } else {
                    log::warn!(
                        "Group '{}' links to non-existent group '{}', skipping",
                        group.id,
                        id
                    );
                    false
                }
            })
            .cloned()
            .collect();
        if !valid_links.is_empty() {
            let filtered_group = config_queries::GroupRow {
                linked_groups: valid_links,
                ..group.clone()
            };
            config_queries::db_upsert_group(&filtered_group).await?;
        }
    }

    for scene in &preview.scenes {
        config_queries::db_upsert_config_scene(scene).await?;
    }
    for routine in &preview.routines {
        config_queries::db_upsert_routine(routine).await?;
    }

    for device in derive_migrated_mqtt_sensor_devices(preview) {
        db_update_device(&device).await?;
    }

    Ok(())
}

fn derive_migrated_mqtt_sensor_devices(preview: &MigratePreviewResult) -> Vec<Device> {
    let mqtt_integration_ids = preview
        .integrations
        .iter()
        .filter(|integration| integration.plugin == "mqtt")
        .map(|integration| IntegrationId::from(integration.id.clone()))
        .collect::<HashSet<_>>();

    if mqtt_integration_ids.is_empty() {
        return Vec::new();
    }

    let mut discovered_devices = BTreeMap::new();

    for routine in &preview.routines {
        let Ok(rules) = serde_json::from_value::<Rules>(routine.rules.clone()) else {
            warn!(
                "Failed to deserialize routine '{}' rules while deriving migrated MQTT sensors",
                routine.name,
            );
            continue;
        };

        collect_migrated_sensor_devices(&rules, &mqtt_integration_ids, &mut discovered_devices);
    }

    discovered_devices.into_values().collect()
}

fn collect_migrated_sensor_devices(
    rules: &Rules,
    mqtt_integration_ids: &HashSet<IntegrationId>,
    discovered_devices: &mut BTreeMap<String, Device>,
) {
    for rule in rules {
        match rule {
            crate::types::rule::Rule::Sensor(sensor_rule) => {
                let (integration_id, device_id, device_name) = match &sensor_rule.device_ref {
                    DeviceRef::Id(id_ref)
                        if mqtt_integration_ids.contains(&id_ref.integration_id) =>
                    {
                        (
                            id_ref.integration_id.clone(),
                            id_ref.device_id.clone(),
                            id_ref.device_id.to_string(),
                        )
                    }
                    DeviceRef::Name(name_ref)
                        if mqtt_integration_ids.contains(&name_ref.integration_id) =>
                    {
                        (
                            name_ref.integration_id.clone(),
                            DeviceId::new(&name_ref.name),
                            name_ref.name.clone(),
                        )
                    }
                    _ => continue,
                };

                let device = Device {
                    id: device_id,
                    name: device_name,
                    integration_id,
                    data: DeviceData::Sensor(non_matching_sensor_state(&sensor_rule.state)),
                    raw: None,
                };

                discovered_devices
                    .entry(device.get_device_key().to_string())
                    .or_insert(device);
            }
            crate::types::rule::Rule::Any(any_rule) => {
                collect_migrated_sensor_devices(
                    &any_rule.any,
                    mqtt_integration_ids,
                    discovered_devices,
                );
            }
            _ => {}
        }
    }
}

fn non_matching_sensor_state(expected: &SensorDevice) -> SensorDevice {
    match expected {
        SensorDevice::Boolean { value } => SensorDevice::Boolean { value: !value },
        SensorDevice::Text { value } => SensorDevice::Text {
            value: if value.is_empty() {
                "__unknown__".to_string()
            } else {
                String::new()
            },
        },
        SensorDevice::Number { value } => SensorDevice::Number {
            value: if *value == 0.0 { 1.0 } else { 0.0 },
        },
        SensorDevice::Color(state) => SensorDevice::Color(ControllableState {
            power: !state.power,
            brightness: None,
            color: None,
            transition: None,
        }),
    }
}

async fn migrate_preview(
    body: bytes::Bytes,
    _app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let toml_str = String::from_utf8_lossy(&body);

    match parse_toml_config(&toml_str) {
        Ok(result) => Ok(ApiResponse::success(result)),
        Err(e) => Ok(error_response(&e, StatusCode::BAD_REQUEST)),
    }
}

async fn migrate_apply(
    preview: MigratePreviewResult,
    app_state: Arc<RwLock<AppState>>,
) -> Result<impl Reply, warp::Rejection> {
    let counts = MigrateApplyResult {
        integrations: preview.integrations.len(),
        groups: preview.groups.len(),
        scenes: preview.scenes.len(),
        routines: preview.routines.len(),
    };

    if let Err(e) = apply_migration(&preview).await {
        return Ok(internal_error(e));
    }

    // Hot-reload all config
    let mut state = app_state.write().await;
    let _ = state.reload_integrations().await;
    let _ = state.reload_groups().await;
    let _ = state.reload_scenes().await;
    let _ = state.reload_routines().await;

    Ok(ApiResponse::success(counts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ordered_float::OrderedFloat;

    #[test]
    fn derive_migrated_mqtt_sensor_devices_seeds_named_sensor_rules() {
        let preview = MigratePreviewResult {
            integrations: vec![IntegrationRow {
                id: "zigbee2mqtt".to_string(),
                plugin: "mqtt".to_string(),
                config: serde_json::json!({}),
                enabled: true,
            }],
            groups: Vec::new(),
            scenes: Vec::new(),
            routines: vec![RoutineRow {
                id: "entryway_motion".to_string(),
                name: "Entryway motion".to_string(),
                enabled: true,
                rules: serde_json::json!([
                    {
                        "state": { "value": true },
                        "trigger_mode": "pulse",
                        "integration_id": "zigbee2mqtt",
                        "name": "Entryway motion sensor"
                    }
                ]),
                actions: serde_json::json!([]),
            }],
            core: CoreConfigRow {
                warmup_time_seconds: 1,
            },
        };

        let devices = derive_migrated_mqtt_sensor_devices(&preview);

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, DeviceId::new("Entryway motion sensor"));
        assert_eq!(devices[0].name, "Entryway motion sensor");
        assert_eq!(
            devices[0].data,
            DeviceData::Sensor(SensorDevice::Boolean { value: false })
        );
    }

    #[test]
    fn non_matching_sensor_state_avoids_matching_number_text_and_color_rules() {
        assert_eq!(
            non_matching_sensor_state(&SensorDevice::Text {
                value: "on_press".to_string(),
            }),
            SensorDevice::Text {
                value: String::new(),
            }
        );

        assert_eq!(
            non_matching_sensor_state(&SensorDevice::Number { value: 0.0 }),
            SensorDevice::Number { value: 1.0 }
        );

        assert_eq!(
            non_matching_sensor_state(&SensorDevice::Color(ControllableState {
                power: true,
                brightness: Some(OrderedFloat(0.5)),
                color: None,
                transition: None,
            })),
            SensorDevice::Color(ControllableState {
                power: false,
                brightness: None,
                color: None,
                transition: None,
            })
        );
    }
}
