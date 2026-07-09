//! Simulation mode: mirrors production config into an in-memory runtime snapshot
//! and replaces MQTT integrations with dummy equivalents.

use crate::api::config::{parse_config_backup, ParsedConfigBackup};
use crate::db::config_queries::{
    self, ConfigExport, GroupRow, IntegrationRow, RoutineRow, SceneRow,
};
use crate::db::schema::{
    CoreConfig, DashboardLayouts, DashboardWidgets, DeviceDisplayOverrides, Floorplans,
    GroupDevices, GroupLinks, Groups, Integrations, Routines, SceneDeviceStates, SceneGroupStates,
    Scenes, WidgetSettings,
};
use color_eyre::Result;
use eyre::eyre;
use sea_orm::sea_query::{Alias, Expr, Order, Query};
use sea_orm::{ConnectionTrait, Database, QueryResult, Statement, StatementBuilder};
use serde::de::DeserializeOwned;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::core::integrations::{PLUGIN_DUMMY, PLUGIN_MQTT};

/// Load config for simulation from a source database when available, or from the
/// optional JSON backup config file otherwise.
pub async fn prepare_simulation_config(
    source_db: Option<&str>,
    config_path: Option<&str>,
) -> Result<ConfigExport> {
    let config_export = if let Some(source_db) = source_db {
        match resolve_simulation_source(source_db) {
            SimulationSource::Postgres(database_url) => {
                info!("Reading simulation config from source PostgreSQL DB");

                match export_from_postgres_source_db(database_url).await {
                    Ok(export) if config_export_has_data(&export) => export,
                    Ok(_) => {
                        info!(
                            "Source PostgreSQL DB is empty, checking for config file fallback..."
                        );
                        load_simulation_config_fallback(
                            config_path,
                            "Source PostgreSQL DB is empty",
                        )
                        .await?
                    }
                    Err(error) => {
                        warn!(
                            "Failed to read simulation config from source PostgreSQL DB: {error}"
                        );
                        load_simulation_config_fallback(
                            config_path,
                            "Source PostgreSQL DB was not readable",
                        )
                        .await?
                    }
                }
            }
            SimulationSource::SqlitePath(source_path) if source_path.exists() => {
                info!(
                    "Reading simulation config from source DB: {}",
                    source_path.display()
                );
                let export = export_from_sqlite_source_db(source_path).await?;

                if config_export_has_data(&export) {
                    export
                } else {
                    info!("Source DB is empty, checking for config file fallback...");
                    load_simulation_config_fallback(config_path, "Source DB is empty").await?
                }
            }
            SimulationSource::SqlitePath(source_path) => {
                info!(
                    "Source DB not found at {}, checking for config file fallback...",
                    source_path.display()
                );
                load_simulation_config_fallback(config_path, "No simulation source DB was readable")
                    .await?
            }
        }
    } else {
        load_simulation_config_fallback(config_path, "No simulation source DB was readable").await?
    };

    Ok(config_export)
}

/// Open a source SQLite DB file with a temporary SeaORM connection and export
/// its full config. Current-schema databases share the same export path as the
/// runtime DB; older SQLite snapshots fall back to a legacy query-builder reader.
async fn export_from_sqlite_source_db(db_path: &Path) -> Result<ConfigExport> {
    let db = Database::connect(sqlite_readonly_url(db_path)).await?;

    match config_queries::db_export_config_from_connection(&db).await {
        Ok(export) => Ok(normalize_source_export(export)),
        Err(error) => {
            warn!(
                "Failed to read SQLite source using current schema, trying legacy schema fallback: {error}"
            );
            export_from_legacy_sqlite_source_db(&db).await
        }
    }
}

async fn export_from_postgres_source_db(database_url: &str) -> Result<ConfigExport> {
    let db = Database::connect(database_url).await?;
    let export = config_queries::db_export_config_from_connection(&db).await?;
    Ok(normalize_source_export(export))
}

async fn export_from_legacy_sqlite_source_db<C: ConnectionTrait>(db: &C) -> Result<ConfigExport> {
    let integrations = all(
        db,
        Query::select()
            .columns([
                Integrations::Id,
                Integrations::Plugin,
                Integrations::Config,
                Integrations::Enabled,
            ])
            .from(Integrations::Table)
            .order_by(Integrations::Id, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(integration_from_row)
    .collect::<Result<Vec<_>>>()?;

    let core = one(
        db,
        Query::select()
            .column(CoreConfig::WarmupTimeSeconds)
            .from(CoreConfig::Table)
            .and_where(Expr::col(CoreConfig::Id).eq(1))
            .to_owned(),
    )
    .await?
    .map(|row| config_queries::CoreConfigRow {
        warmup_time_seconds: get_i32_or_default(&row, "warmup_time_seconds", 1),
    })
    .unwrap_or_default();

    let group_rows = all(
        db,
        Query::select()
            .columns([Groups::Id, Groups::Name, Groups::Hidden])
            .from(Groups::Table)
            .order_by(Groups::Name, Order::Asc)
            .to_owned(),
    )
    .await?;
    let mut groups = Vec::new();
    for row in group_rows {
        let id: String = row.try_get("", "id")?;
        groups.push(GroupRow {
            name: row.try_get("", "name")?,
            hidden: get_bool_or_default(&row, "hidden", false),
            devices: legacy_group_devices(db, &id).await?,
            linked_groups: legacy_group_links(db, &id).await?,
            id,
        });
    }

    let scene_rows = all(
        db,
        Query::select()
            .columns([Scenes::Id, Scenes::Name, Scenes::Hidden, Scenes::Script])
            .from(Scenes::Table)
            .order_by(Scenes::Name, Order::Asc)
            .to_owned(),
    )
    .await?;
    let mut scenes = Vec::new();
    for row in scene_rows {
        let id: String = row.try_get("", "id")?;
        scenes.push(SceneRow {
            name: row.try_get("", "name")?,
            hidden: get_bool_or_default(&row, "hidden", false),
            script: row.try_get("", "script")?,
            device_states: scene_state_map(
                db,
                SceneDeviceStates::Table,
                SceneDeviceStates::SceneId,
                SceneDeviceStates::DeviceKey,
                "device_key",
                &id,
            )
            .await?,
            group_states: scene_state_map(
                db,
                SceneGroupStates::Table,
                SceneGroupStates::SceneId,
                SceneGroupStates::GroupId,
                "group_id",
                &id,
            )
            .await?,
            id,
        });
    }

    let routines = all(
        db,
        Query::select()
            .columns([
                Routines::Id,
                Routines::Name,
                Routines::Enabled,
                Routines::Rules,
                Routines::Actions,
            ])
            .from(Routines::Table)
            .order_by(Routines::Name, Order::Asc)
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(routine_from_row)
    .collect::<Result<Vec<_>>>()?;

    let mut floorplans = legacy_floorplans(db).await?;
    floorplans.retain(|floorplan| !is_empty_default_floorplan_stub(floorplan));
    let floorplan = floorplans
        .iter()
        .find(|floorplan| floorplan.id == "default")
        .map(|floorplan| config_queries::FloorplanRow {
            image_data: floorplan.image_data.clone(),
            image_mime_type: floorplan.image_mime_type.clone(),
            width: floorplan.width,
            height: floorplan.height,
        });

    let device_display_overrides = optional_all(
        db,
        Query::select()
            .columns([
                DeviceDisplayOverrides::DeviceKey,
                DeviceDisplayOverrides::DisplayName,
            ])
            .from(DeviceDisplayOverrides::Table)
            .order_by(DeviceDisplayOverrides::DeviceKey, Order::Asc)
            .to_owned(),
        "device display overrides",
    )
    .await?
    .into_iter()
    .map(device_display_override_from_row)
    .collect::<Result<Vec<_>>>()?;

    let (dashboard_layouts, dashboard_widgets) = legacy_dashboard(db).await?;

    let widget_settings = optional_all(
        db,
        Query::select()
            .columns([WidgetSettings::Key, WidgetSettings::Config])
            .from(WidgetSettings::Table)
            .order_by(WidgetSettings::Key, Order::Asc)
            .to_owned(),
        "widget settings",
    )
    .await?
    .into_iter()
    .map(widget_setting_from_row)
    .collect::<Result<Vec<_>>>()?;

    Ok(ConfigExport {
        version: 1,
        core,
        integrations,
        groups,
        scenes,
        routines,
        floorplan,
        floorplans,
        group_positions: Vec::new(),
        device_display_overrides,
        device_sensor_configs: Vec::new(),
        widget_settings,
        dashboard_layouts,
        dashboard_widgets,
    })
}

async fn legacy_group_devices<C: ConnectionTrait>(
    db: &C,
    group_id: &str,
) -> Result<Vec<config_queries::GroupDeviceRow>> {
    let current_query = Query::select()
        .columns([GroupDevices::IntegrationId, GroupDevices::DeviceId])
        .from(GroupDevices::Table)
        .and_where(Expr::col(GroupDevices::GroupId).eq(group_id))
        .order_by(GroupDevices::SortOrder, Order::Asc)
        .to_owned();

    match all(db, current_query).await {
        Ok(rows) => rows
            .into_iter()
            .map(group_device_from_current_row)
            .collect::<Result<Vec<_>>>(),
        Err(_) => all(
            db,
            Query::select()
                .column(GroupDevices::IntegrationId)
                .column(Alias::new("device_name"))
                .from(GroupDevices::Table)
                .and_where(Expr::col(GroupDevices::GroupId).eq(group_id))
                .to_owned(),
        )
        .await?
        .into_iter()
        .map(group_device_from_legacy_row)
        .collect::<Result<Vec<_>>>(),
    }
}

async fn legacy_group_links<C: ConnectionTrait>(db: &C, group_id: &str) -> Result<Vec<String>> {
    let current_query = Query::select()
        .column(GroupLinks::ChildGroupId)
        .from(GroupLinks::Table)
        .and_where(Expr::col(GroupLinks::ParentGroupId).eq(group_id))
        .order_by(GroupLinks::SortOrder, Order::Asc)
        .to_owned();

    match all(db, current_query).await {
        Ok(rows) => rows
            .into_iter()
            .map(|row| Ok(row.try_get("", "child_group_id")?))
            .collect::<Result<Vec<_>>>(),
        Err(_) => all(
            db,
            Query::select()
                .column(Alias::new("linked_group_id"))
                .from(GroupLinks::Table)
                .and_where(Expr::col(Alias::new("group_id")).eq(group_id))
                .to_owned(),
        )
        .await?
        .into_iter()
        .map(|row| Ok(row.try_get("", "linked_group_id")?))
        .collect::<Result<Vec<_>>>(),
    }
}

async fn scene_state_map<C, T, S, K>(
    db: &C,
    table: T,
    scene_id_col: S,
    key_col: K,
    key_name: &str,
    scene_id: &str,
) -> Result<HashMap<String, serde_json::Value>>
where
    C: ConnectionTrait,
    T: sea_orm::sea_query::IntoTableRef,
    S: sea_orm::sea_query::IntoColumnRef,
    K: sea_orm::sea_query::IntoColumnRef,
{
    all(
        db,
        Query::select()
            .column(key_col)
            .column(Alias::new("config"))
            .from(table)
            .and_where(Expr::col(scene_id_col).eq(scene_id))
            .to_owned(),
    )
    .await?
    .into_iter()
    .map(|row| {
        let key: String = row.try_get("", key_name)?;
        let config: String = row.try_get("", "config")?;
        Ok((key, parse_json_or_default(&config)))
    })
    .collect()
}

async fn legacy_floorplans<C: ConnectionTrait>(
    db: &C,
) -> Result<Vec<config_queries::FloorplanExportRow>> {
    let current_query = Query::select()
        .columns([
            Floorplans::Id,
            Floorplans::Name,
            Floorplans::ImageData,
            Floorplans::ImageMimeType,
            Floorplans::Width,
            Floorplans::Height,
            Floorplans::GridData,
        ])
        .from(Floorplans::Table)
        .order_by(Floorplans::SortOrder, Order::Asc)
        .order_by(Floorplans::Name, Order::Asc)
        .to_owned();

    match all(db, current_query).await {
        Ok(rows) => rows
            .into_iter()
            .map(floorplan_export_from_row)
            .collect::<Result<Vec<_>>>(),
        Err(_) => Ok(one(
            db,
            Query::select()
                .columns([
                    Floorplans::ImageData,
                    Floorplans::ImageMimeType,
                    Floorplans::Width,
                    Floorplans::Height,
                    Floorplans::GridData,
                ])
                .from(Alias::new("floorplan"))
                .limit(1)
                .to_owned(),
        )
        .await?
        .map(floorplan_export_from_legacy_row)
        .transpose()?
        .map(|floorplan| vec![floorplan])
        .unwrap_or_default()),
    }
}

async fn legacy_dashboard<C: ConnectionTrait>(
    db: &C,
) -> Result<(
    Vec<config_queries::DashboardLayoutRow>,
    Vec<config_queries::DashboardWidgetRow>,
)> {
    let layout_rows = optional_all(
        db,
        Query::select()
            .columns([
                DashboardLayouts::Id,
                DashboardLayouts::Name,
                DashboardLayouts::IsDefault,
            ])
            .from(DashboardLayouts::Table)
            .order_by(DashboardLayouts::Id, Order::Asc)
            .to_owned(),
        "dashboard layouts",
    )
    .await?;

    let mut dashboard_layouts = Vec::new();
    let mut dashboard_widgets = Vec::new();
    for row in layout_rows {
        let layout = dashboard_layout_from_row(row)?;
        let widgets = optional_all(
            db,
            Query::select()
                .columns([
                    DashboardWidgets::Id,
                    DashboardWidgets::LayoutId,
                    DashboardWidgets::WidgetType,
                    DashboardWidgets::Config,
                    DashboardWidgets::GridX,
                    DashboardWidgets::GridY,
                    DashboardWidgets::GridW,
                    DashboardWidgets::GridH,
                    DashboardWidgets::SortOrder,
                ])
                .from(DashboardWidgets::Table)
                .and_where(Expr::col(DashboardWidgets::LayoutId).eq(layout.id))
                .order_by(DashboardWidgets::SortOrder, Order::Asc)
                .to_owned(),
            "dashboard widgets",
        )
        .await?
        .into_iter()
        .map(dashboard_widget_from_row)
        .collect::<Result<Vec<_>>>()?;
        dashboard_widgets.extend(widgets);
        dashboard_layouts.push(layout);
    }

    Ok((dashboard_layouts, dashboard_widgets))
}

/// Parse a JSON export backup config file into a ConfigExport.
async fn export_from_config_file(config_path: &str) -> Result<ConfigExport> {
    let path = Path::new(config_path);
    if !path.exists() {
        return Err(eyre!("Config file not found: {config_path}"));
    }

    info!("Reading simulation config from file: {config_path}");
    let config_str = std::fs::read_to_string(path)?;
    let parsed = parse_config_backup(&config_str).map_err(|e| eyre!(e))?;

    Ok(match parsed {
        ParsedConfigBackup::JsonExport(config) => config,
    })
}

#[derive(Clone, Copy)]
enum SimulationSource<'a> {
    Postgres(&'a str),
    SqlitePath(&'a Path),
}

fn resolve_simulation_source(source_db: &str) -> SimulationSource<'_> {
    if is_postgres_database_url(source_db) {
        SimulationSource::Postgres(source_db)
    } else {
        SimulationSource::SqlitePath(Path::new(source_db))
    }
}

fn is_postgres_database_url(source_db: &str) -> bool {
    source_db.starts_with("postgres://") || source_db.starts_with("postgresql://")
}

async fn load_simulation_config_fallback(
    config_path: Option<&str>,
    reason: &str,
) -> Result<ConfigExport> {
    match config_path {
        Some(path) => export_from_config_file(path).await,
        None => Err(eyre!("{reason} and no --config backup file provided")),
    }
}

fn config_export_has_data(config: &ConfigExport) -> bool {
    !config.integrations.is_empty()
        || !config.groups.is_empty()
        || !config.scenes.is_empty()
        || !config.routines.is_empty()
        || config.floorplan.is_some()
        || !config.floorplans.is_empty()
        || !config.group_positions.is_empty()
        || !config.device_display_overrides.is_empty()
        || !config.device_sensor_configs.is_empty()
        || config
            .dashboard_layouts
            .iter()
            .any(|layout| layout.id != 1 || layout.name != "Default" || !layout.is_default)
        || !config.dashboard_widgets.is_empty()
}

fn normalize_source_export(mut export: ConfigExport) -> ConfigExport {
    export
        .floorplans
        .retain(|floorplan| !is_empty_default_floorplan_stub(floorplan));
    export
}

fn is_empty_default_floorplan_stub(floorplan: &config_queries::FloorplanExportRow) -> bool {
    floorplan.id == "default"
        && floorplan.name == "Main floorplan"
        && floorplan.image_data.is_none()
        && floorplan.image_mime_type.is_none()
        && floorplan.width.is_none()
        && floorplan.height.is_none()
        && floorplan.grid_data.is_none()
}

fn sqlite_readonly_url(path: &Path) -> String {
    format!("sqlite://{}?mode=ro", path.display())
}

fn statement<C, S>(db: &C, builder: S) -> Statement
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    db.get_database_backend().build(&builder)
}

async fn all<C, S>(db: &C, builder: S) -> Result<Vec<QueryResult>>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    Ok(db.query_all(statement(db, builder)).await?)
}

async fn optional_all<C, S>(db: &C, builder: S, description: &str) -> Result<Vec<QueryResult>>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    match all(db, builder).await {
        Ok(rows) => Ok(rows),
        Err(error) => {
            warn!("Failed to read {description} from source database: {error}");
            Ok(Vec::new())
        }
    }
}

async fn one<C, S>(db: &C, builder: S) -> Result<Option<QueryResult>>
where
    C: ConnectionTrait,
    S: StatementBuilder,
{
    Ok(db.query_one(statement(db, builder)).await?)
}

fn integration_from_row(row: QueryResult) -> Result<IntegrationRow> {
    let config: String = row.try_get("", "config")?;
    Ok(IntegrationRow {
        id: row.try_get("", "id")?,
        plugin: row.try_get("", "plugin")?,
        config: parse_json_or_default(&config),
        enabled: get_bool_or_default(&row, "enabled", true),
    })
}

fn group_device_from_current_row(row: QueryResult) -> Result<config_queries::GroupDeviceRow> {
    Ok(config_queries::GroupDeviceRow {
        integration_id: row.try_get("", "integration_id")?,
        device_id: row.try_get("", "device_id")?,
    })
}

fn group_device_from_legacy_row(row: QueryResult) -> Result<config_queries::GroupDeviceRow> {
    Ok(config_queries::GroupDeviceRow {
        integration_id: row.try_get("", "integration_id")?,
        device_id: row.try_get("", "device_name")?,
    })
}

fn routine_from_row(row: QueryResult) -> Result<RoutineRow> {
    let rules: String = row.try_get("", "rules")?;
    let actions: String = row.try_get("", "actions")?;
    Ok(RoutineRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        enabled: get_bool_or_default(&row, "enabled", true),
        rules: parse_json_or_default(&rules),
        actions: parse_json_or_default(&actions),
    })
}

fn floorplan_export_from_row(row: QueryResult) -> Result<config_queries::FloorplanExportRow> {
    Ok(config_queries::FloorplanExportRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        image_data: row.try_get("", "image_data")?,
        image_mime_type: row.try_get("", "image_mime_type")?,
        width: row.try_get("", "width")?,
        height: row.try_get("", "height")?,
        grid_data: row.try_get("", "grid_data")?,
    })
}

fn floorplan_export_from_legacy_row(
    row: QueryResult,
) -> Result<config_queries::FloorplanExportRow> {
    Ok(config_queries::FloorplanExportRow {
        id: "default".to_string(),
        name: "Main floorplan".to_string(),
        image_data: row.try_get("", "image_data")?,
        image_mime_type: row.try_get("", "image_mime_type")?,
        width: row.try_get("", "width")?,
        height: row.try_get("", "height")?,
        grid_data: row.try_get("", "grid_data")?,
    })
}

fn device_display_override_from_row(
    row: QueryResult,
) -> Result<config_queries::DeviceDisplayNameRow> {
    Ok(config_queries::DeviceDisplayNameRow {
        device_key: row.try_get("", "device_key")?,
        display_name: row.try_get("", "display_name")?,
    })
}

fn dashboard_layout_from_row(row: QueryResult) -> Result<config_queries::DashboardLayoutRow> {
    Ok(config_queries::DashboardLayoutRow {
        id: row.try_get("", "id")?,
        name: row.try_get("", "name")?,
        is_default: get_bool_or_default(&row, "is_default", false),
    })
}

fn dashboard_widget_from_row(row: QueryResult) -> Result<config_queries::DashboardWidgetRow> {
    let config: String = row.try_get("", "config")?;
    Ok(config_queries::DashboardWidgetRow {
        id: row.try_get("", "id")?,
        layout_id: row.try_get("", "layout_id")?,
        widget_type: row.try_get("", "widget_type")?,
        config: parse_json_or_default(&config),
        grid_x: row.try_get("", "grid_x")?,
        grid_y: row.try_get("", "grid_y")?,
        grid_w: row.try_get("", "grid_w")?,
        grid_h: row.try_get("", "grid_h")?,
        sort_order: get_i32_or_default(&row, "sort_order", 0),
    })
}

fn widget_setting_from_row(row: QueryResult) -> Result<config_queries::WidgetSettingRow> {
    let config: String = row.try_get("", "config")?;
    Ok(config_queries::WidgetSettingRow {
        key: row.try_get("", "key")?,
        config: parse_json_or_default(&config),
    })
}

fn parse_json_or_default<T>(json: &str) -> T
where
    T: DeserializeOwned + Default,
{
    serde_json::from_str(json).unwrap_or_default()
}

fn get_bool_or_default(row: &QueryResult, column: &str, default: bool) -> bool {
    row.try_get::<Option<bool>>("", column)
        .ok()
        .flatten()
        .unwrap_or(default)
}

fn get_i32_or_default(row: &QueryResult, column: &str, default: i32) -> i32 {
    row.try_get::<Option<i32>>("", column)
        .ok()
        .flatten()
        .unwrap_or(default)
}

/// Rewrite all MQTT integrations in the simulation snapshot as dummy equivalents.
/// Discovers devices by scanning groups, scenes, and routines for references
/// to each MQTT integration.
pub fn convert_mqtt_to_dummy(config: &mut ConfigExport) -> Result<()> {
    let mqtt_ids: Vec<String> = config
        .integrations
        .iter()
        .filter(|i| i.plugin == PLUGIN_MQTT)
        .map(|i| i.id.clone())
        .collect();

    if mqtt_ids.is_empty() {
        info!("No MQTT integrations found, nothing to convert");
        return Ok(());
    }

    // Collect sensor device keys from routine rules
    let sensor_keys = collect_sensor_device_keys(&config.routines);

    for mqtt_id in mqtt_ids {
        let mut devices: HashMap<String, serde_json::Value> = HashMap::new();

        // 1. Scan groups for device references
        for group in &config.groups {
            for gd in &group.devices {
                if gd.integration_id == mqtt_id {
                    let device_id = gd.device_id.clone();
                    let key = format!("{mqtt_id}/{device_id}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices
                        .entry(device_id.clone())
                        .or_insert_with(|| build_dummy_device_config(&device_id, is_sensor));
                }
            }
        }

        // 2. Scan scene device_states for device keys under this integration
        for scene in &config.scenes {
            for device_key_str in scene.device_states.keys() {
                if let Some((iid, did)) = device_key_str.split_once('/') {
                    if iid == mqtt_id {
                        let is_sensor = sensor_keys.contains(device_key_str);
                        devices
                            .entry(did.to_string())
                            .or_insert_with(|| build_dummy_device_config(did, is_sensor));
                    }
                }
            }
        }

        // 3. Scan routine rules for direct device references under this integration
        for routine in &config.routines {
            collect_device_refs_from_rules(&routine.rules, &mqtt_id, &sensor_keys, &mut devices);
        }

        if devices.is_empty() {
            warn!(
                "MQTT integration '{mqtt_id}' has no discoverable devices — \
                 creating empty dummy integration"
            );
        } else {
            info!(
                "Converting MQTT integration '{mqtt_id}' to dummy with {} devices",
                devices.len()
            );
        }

        // Build DummyConfig JSON and rewrite the integration row
        let dummy_config = json!({ "devices": devices });
        let row = IntegrationRow {
            id: mqtt_id.to_string(),
            plugin: PLUGIN_DUMMY.to_string(),
            config: dummy_config,
            enabled: true,
        };

        if let Some(existing) = config
            .integrations
            .iter_mut()
            .find(|integration| integration.id == mqtt_id)
        {
            *existing = row;
        }
    }

    Ok(())
}

/// Build a DummyDeviceConfig JSON value for a single device.
fn build_dummy_device_config(name: &str, is_sensor: bool) -> serde_json::Value {
    if is_sensor {
        json!({
            "name": name,
            "init_state": {
                "Sensor": {
                    "value": false
                }
            }
        })
    } else {
        json!({
            "name": name,
            "init_state": {
                "Controllable": {
                    "state": {
                        "power": false,
                        "color": null,
                        "brightness": null,
                        "transition_ms": null
                    },
                    "capabilities": {
                        "color_modes": ["Hs"],
                        "brightness_range": [0.0, 1.0]
                    },
                    "managed": "Full"
                }
            }
        })
    }
}

/// Collect device keys (as "integration_id/device_id") that appear in Sensor rules.
fn collect_sensor_device_keys(routines: &[RoutineRow]) -> HashSet<String> {
    let mut sensor_keys = HashSet::new();

    for routine in routines {
        collect_sensors_from_value(&routine.rules, &mut sensor_keys);
    }

    sensor_keys
}

/// Recursively scan a JSON value for Sensor rule patterns and extract device keys.
/// Sensor rules contain `"state": { "value": ... }` (untagged SensorDevice format)
/// and a device reference with `"integration_id"` + `"device_id"` or `"name"`.
fn collect_sensors_from_value(value: &serde_json::Value, sensor_keys: &mut HashSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            // Check if this object looks like a sensor rule: has "state" with a "value" key
            // SensorDevice is #[serde(untagged)], so it serializes as {"value": ...}
            let has_sensor_state = map
                .get("state")
                .is_some_and(|s| s.is_object() && s.get("value").is_some());

            if has_sensor_state {
                if let Some(iid) = map.get("integration_id").and_then(|v| v.as_str()) {
                    if let Some(did) = map.get("device_id").and_then(|v| v.as_str()) {
                        sensor_keys.insert(format!("{iid}/{did}"));
                    }
                    if let Some(name) = map.get("name").and_then(|v| v.as_str()) {
                        sensor_keys.insert(format!("{iid}/{name}"));
                    }
                }
            }

            // Recurse into all values
            for v in map.values() {
                collect_sensors_from_value(v, sensor_keys);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_sensors_from_value(v, sensor_keys);
            }
        }
        _ => {}
    }
}

/// Scan routine rules JSON for device references belonging to a specific integration.
fn collect_device_refs_from_rules(
    rules: &serde_json::Value,
    integration_id: &str,
    sensor_keys: &HashSet<String>,
    devices: &mut HashMap<String, serde_json::Value>,
) {
    match rules {
        serde_json::Value::Object(map) => {
            // Check if this has an integration_id matching ours
            let matches_integration = map
                .get("integration_id")
                .and_then(|v| v.as_str())
                .is_some_and(|iid| iid == integration_id);

            if matches_integration {
                if let Some(did) = map.get("device_id").and_then(|v| v.as_str()) {
                    let key = format!("{integration_id}/{did}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices
                        .entry(did.to_string())
                        .or_insert_with(|| build_dummy_device_config(did, is_sensor));
                }
                if let Some(name) = map.get("name").and_then(|v| v.as_str()) {
                    let key = format!("{integration_id}/{name}");
                    let is_sensor = sensor_keys.contains(&key);
                    devices
                        .entry(name.to_string())
                        .or_insert_with(|| build_dummy_device_config(name, is_sensor));
                }
            }

            for v in map.values() {
                collect_device_refs_from_rules(v, integration_id, sensor_keys, devices);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_device_refs_from_rules(v, integration_id, sensor_keys, devices);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::export_from_config_file;
    use crate::core::integrations::PLUGIN_DUMMY;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_temp_config_file(suffix: &str, contents: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("homectl-sim-config-{unique}.{suffix}"));
        fs::write(&path, contents).expect("temp config file should be written");
        path
    }

    #[tokio::test]
    async fn export_from_config_file_accepts_json_backup() {
        let path = write_temp_config_file(
            "json",
            &serde_json::json!({
                "version": 1,
                "core": { "warmup_time_seconds": 3 },
                "integrations": [
                    {
                        "id": "dummy",
                        "plugin": "dummy",
                        "config": { "devices": {} },
                        "enabled": true
                    }
                ],
                "groups": [],
                "scenes": [],
                "routines": [],
                "floorplan": null,
                "floorplans": [],
                "device_positions": [],
                "device_display_overrides": [],
                "device_sensor_configs": [],
                "dashboard_layouts": [],
                "dashboard_widgets": []
            })
            .to_string(),
        );

        let config = export_from_config_file(path.to_str().expect("utf-8 path"))
            .await
            .expect("json backup should load");

        assert_eq!(config.core.warmup_time_seconds, 3);
        assert_eq!(config.integrations.len(), 1);
        assert_eq!(config.integrations[0].plugin, PLUGIN_DUMMY);

        fs::remove_file(path).expect("temp config file should be removed");
    }

    #[tokio::test]
    async fn export_from_config_file_rejects_legacy_toml() {
        let path = write_temp_config_file(
            "toml",
            r#"
[core]
warmup_time_seconds = 9

[integrations.zigbee2mqtt]
plugin = "mqtt"
host = "mqtt.example.org"

[routines.entryway_motion]
name = "Entryway motion"
rules = [
  { integration_id = "zigbee2mqtt", name = "Entryway motion sensor", state = { value = true } }
]
actions = []
"#,
        );

        let error = export_from_config_file(path.to_str().expect("utf-8 path"))
            .await
            .expect_err("legacy toml should be rejected");

        assert!(error.to_string().contains("JSON export"));

        fs::remove_file(path).expect("temp config file should be removed");
    }
}
