#[macro_use]
extern crate log;

use homectl_server::api::config::{parse_config_backup, ParsedConfigBackup};
use homectl_server::api::init_api;
use homectl_server::core::simulate;
use homectl_server::core::{
    devices::Devices,
    event::DeferredEventWork,
    groups::Groups,
    integrations::Integrations,
    logs::init_logging,
    routines::Routines,
    scenes::Scenes,
    snapshot::{new_snapshot_handle, RuntimeSnapshot},
    state::{spawn_state_actor, AppState, StateHandle},
    ui::Ui,
};
use homectl_server::db::{
    actions, config_queries, connect_configured_database, init_db, is_db_configured,
    is_db_connected,
};
use homectl_server::types::event::{mk_event_channel, Event};
use homectl_server::types::scene::SceneOverridesConfig;
use homectl_server::utils::cli::{Cli, Command};

use clap::Parser;
use color_eyre::Result;
use eyre::eyre;
use std::collections::HashMap;
use std::error::Error;
use std::path::Path;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const DATABASE_RECONNECT_INTERVAL_SECS: u64 = 2;
const SLOW_DEFERRED_WORK_WARN_MS: u64 = 1000;

fn default_backup_config_path() -> &'static Path {
    Path::new("Settings.json")
}

fn backup_config_path<'a>(cli: &'a Cli) -> &'a Path {
    if let Some(config_path) = cli.config.as_deref() {
        Path::new(config_path)
    } else {
        default_backup_config_path()
    }
}

struct RuntimeConfigSnapshot {
    config: config_queries::ConfigExport,
    scene_overrides: SceneOverridesConfig,
    ui_state: HashMap<String, serde_json::Value>,
}

impl RuntimeConfigSnapshot {
    fn empty() -> Self {
        Self {
            config: config_queries::ConfigExport {
                version: 1,
                core: config_queries::CoreConfigRow::default(),
                integrations: Vec::new(),
                groups: Vec::new(),
                scenes: Vec::new(),
                routines: Vec::new(),
                floorplan: None,
                floorplans: Vec::new(),
                group_positions: Vec::new(),
                device_display_overrides: Vec::new(),
                device_sensor_configs: Vec::new(),
                widget_settings: Vec::new(),
                dashboard_layouts: Vec::new(),
                dashboard_widgets: Vec::new(),
            },
            scene_overrides: Default::default(),
            ui_state: Default::default(),
        }
    }

    fn from_parsed_backup(parsed: ParsedConfigBackup) -> Self {
        Self {
            config: parsed.to_config_export(),
            scene_overrides: Default::default(),
            ui_state: Default::default(),
        }
    }

    fn from_config_export(config: config_queries::ConfigExport) -> Self {
        Self {
            config,
            scene_overrides: Default::default(),
            ui_state: Default::default(),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let cli = Cli::parse();
    color_eyre::install()?;
    #[cfg(feature = "tokio-console")]
    console_subscriber::init();
    init_logging()?;

    match &cli.command {
        Some(Command::Simulate(args)) => run_simulation(&cli, args).await,
        None => run_server(&cli).await,
    }
}

/// Normal server startup: optional Postgres persistence plus backup-config fallback.
async fn run_server(cli: &Cli) -> Result<(), Box<dyn Error>> {
    let runtime_config = match init_db(cli.database_url.as_deref()).await {
        Ok(true) => {
            seed_from_config_if_empty(cli).await?;

            match load_runtime_config_snapshot().await {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    warn!(
                        "Failed to load runtime config snapshot from database, falling back to config file: {error}"
                    );
                    load_runtime_config_from_backup(cli)?
                }
            }
        }
        Ok(false) => load_runtime_config_from_backup(cli)?,
        Err(error) => {
            warn!(
                "Failed to initialize database, starting from backup config if available: {error}"
            );
            load_runtime_config_from_backup(cli)?
        }
    };

    let warmup_time =
        resolve_warmup_time(cli, runtime_config.config.core.warmup_time_seconds as u64);

    run_event_loop(cli, cli.port, warmup_time, runtime_config).await
}

/// Simulation mode: in-memory runtime snapshot, mirroring source config when provided.
async fn run_simulation(
    cli: &Cli,
    args: &homectl_server::utils::cli::SimulateArgs,
) -> Result<(), Box<dyn Error>> {
    info!("Starting simulation mode on port {}", args.port);

    let mut config =
        simulate::prepare_simulation_config(args.source_db.as_deref(), args.config.as_deref())
            .await?;
    simulate::convert_mqtt_to_dummy(&mut config)?;

    info!("Simulation runtime snapshot ready, starting server...");
    let runtime_config = RuntimeConfigSnapshot::from_config_export(config);
    let mut simulation_cli = cli.clone();
    simulation_cli.port = args.port;
    simulation_cli.database_url = None;
    simulation_cli.warmup_time = Some(args.warmup_time);
    simulation_cli.command = None;

    run_event_loop(&simulation_cli, args.port, args.warmup_time, runtime_config).await
}

/// Shared server startup: loads everything from DB, starts integrations, API, and event loop.
async fn run_event_loop(
    cli: &Cli,
    port: u16,
    warmup_time: u64,
    runtime_config: RuntimeConfigSnapshot,
) -> Result<(), Box<dyn Error>> {
    let (event_tx, mut event_rx) = mk_event_channel();
    let (deferred_work_tx, mut deferred_work_rx) =
        tokio::sync::mpsc::unbounded_channel::<DeferredEventWork>();

    tokio::spawn(async move {
        while let Some(work) = deferred_work_rx.recv().await {
            let started_at = Instant::now();
            let result = work.execute().await;
            let elapsed = started_at.elapsed();

            if elapsed > Duration::from_millis(SLOW_DEFERRED_WORK_WARN_MS) {
                warn!("Deferred event work took {:?}", elapsed);
            }

            if let Err(err) = result {
                error!("Error while executing deferred event work:\n    Err:\n    {err:#?}");
            }
        }
    });

    let mut integrations = Integrations::new(event_tx.clone(), cli);
    integrations
        .load_config_rows(&runtime_config.config.integrations)
        .await?;

    let mut groups = Groups::new(Default::default());
    groups.load_config_rows(&runtime_config.config.groups);

    let mut scenes = Scenes::new(Default::default());
    scenes.load_config_rows(
        &runtime_config.config.scenes,
        runtime_config.scene_overrides,
    );

    let mut devices = Devices::new(event_tx.clone(), cli);
    devices.refresh_db_devices(&scenes).await;

    let mut rules = Routines::new(Default::default(), event_tx.clone());
    rules.load_config_rows(&runtime_config.config.routines);

    let ui = Ui::with_state(runtime_config.ui_state);

    integrations.run_register_pass().await?;
    integrations.run_start_pass().await?;

    let snapshot = new_snapshot_handle(RuntimeSnapshot {
        runtime_config: Arc::new(runtime_config.config.clone()),
        devices: Arc::new(devices.get_state().clone()),
        flattened_groups: Arc::new(groups.get_flattened_groups().clone()),
        flattened_scenes: Arc::new(scenes.get_flattened_scenes().clone()),
        routine_statuses: Arc::new(rules.get_runtime_statuses()),
        ui_state: Arc::new(ui.get_state().clone()),
        warming_up: true,
    });

    let state = AppState {
        warming_up: true,
        runtime_config: runtime_config.config.clone(),
        integrations,
        groups,
        scenes,
        devices,
        rules,
        event_tx: event_tx.clone(),
        ui,
        ws: Default::default(),
        ws_broadcast_pending: Arc::new(AtomicBool::new(false)),
        runtime_apply_lock: Arc::new(Mutex::new(())),
        snapshot: snapshot.clone(),
    };

    let ws_handle = state.ws.clone();

    // Spawn the state actor. The actor owns `AppState` by value and is
    // the sole writer; admin handlers dispatch mutations through
    // `StateHandle`, and the main loop below forwards incoming events
    // onto the actor's command channel.
    let state_handle = spawn_state_actor(state, snapshot.clone(), deferred_work_tx.clone());

    init_api(
        snapshot.clone(),
        state_handle.clone(),
        ws_handle,
        event_tx.clone(),
        port,
    )?;

    if cli.database_url.is_some() {
        start_database_reconnect_loop(state_handle.clone());
    }

    {
        let state_handle = state_handle.clone();
        let event_tx = event_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(warmup_time)).await;
            let _ = state_handle
                .mutate(|state| {
                    Box::pin(async move {
                        state.warming_up = false;
                    })
                })
                .await;
            event_tx.send(Event::StartupCompleted);
        });
    }

    loop {
        let event = event_rx
            .recv()
            .await
            .expect("Expected sender end of channel to never be dropped");

        state_handle.send_event(event);
    }
}

fn start_database_reconnect_loop(state_handle: StateHandle) {
    tokio::spawn(async move {
        if !is_db_configured() || is_db_connected() {
            return;
        }

        let mut interval =
            tokio::time::interval(Duration::from_secs(DATABASE_RECONNECT_INTERVAL_SECS));
        let mut last_connection_error: Option<String> = None;

        loop {
            interval.tick().await;

            if !is_db_configured() {
                break;
            }

            if is_db_connected() {
                break;
            }

            match connect_configured_database().await {
                Ok(true) => {
                    info!(
                        "Connected to configured PostgreSQL database in background reconnect loop"
                    );

                    if let Err(error) = synchronize_reconnected_database(&state_handle).await {
                        warn!("Failed to synchronize runtime snapshot after database reconnect: {error}");
                    }

                    break;
                }
                Ok(false) => break,
                Err(error) => {
                    let error_message = error.to_string();
                    if last_connection_error.as_deref() != Some(error_message.as_str()) {
                        warn!(
                            "Configured PostgreSQL database is still unavailable: {error_message}"
                        );
                        last_connection_error = Some(error_message);
                    }
                }
            }
        }
    });
}

async fn synchronize_reconnected_database(state_handle: &StateHandle) -> Result<()> {
    if config_queries::db_has_config().await? {
        info!(
            "Configured PostgreSQL database became available with existing config; keeping the current runtime snapshot until restart"
        );
    } else {
        persist_runtime_snapshot(state_handle).await?;
    }

    Ok(())
}

async fn persist_runtime_snapshot(state_handle: &StateHandle) -> Result<()> {
    let (config, devices, scene_overrides, ui_state) = state_handle
        .mutate(|state| {
            Box::pin(async move {
                (
                    state.runtime_config.clone(),
                    state
                        .devices
                        .get_state()
                        .0
                        .values()
                        .cloned()
                        .collect::<Vec<_>>(),
                    state.scenes.get_scene_overrides(),
                    state.ui.get_state().clone(),
                )
            })
        })
        .await?;

    config_queries::db_import_config(&config).await?;

    for device in devices {
        actions::db_update_device(&device).await?;
    }

    for (scene_id, overrides) in scene_overrides {
        actions::db_store_scene_overrides(&scene_id, &overrides).await?;
    }

    for (key, value) in ui_state {
        actions::db_store_ui_state(&key, &value).await?;
    }

    Ok(())
}

/// Seed the database from a JSON export backup file if the DB has no integrations.
async fn seed_from_config_if_empty(cli: &Cli) -> Result<()> {
    if !config_queries::db_has_config().await? {
        let config_path = backup_config_path(cli);

        if config_path.exists() {
            info!(
                "Empty database detected, seeding from {}",
                config_path.display()
            );
            let config_str = std::fs::read_to_string(config_path)?;
            match parse_config_backup(&config_str) {
                Ok(ParsedConfigBackup::JsonExport(config)) => {
                    config_queries::db_import_config(&config).await?;
                    info!("Database seeded successfully from JSON backup config");
                }
                Err(e) => {
                    warn!("Failed to parse backup config for seeding: {e}");
                }
            }
        } else {
            info!(
                "No config file found at {}, starting with empty database",
                config_path.display()
            );
        }
    }

    Ok(())
}

async fn load_runtime_config_snapshot() -> Result<RuntimeConfigSnapshot> {
    let config = config_queries::db_export_config().await?;
    let scene_overrides = actions::db_get_scene_overrides().await.unwrap_or_default();
    let ui_state = actions::db_get_ui_state().await.unwrap_or_default();

    Ok(RuntimeConfigSnapshot {
        config,
        scene_overrides,
        ui_state,
    })
}

fn load_runtime_config_from_backup(cli: &Cli) -> Result<RuntimeConfigSnapshot> {
    let config_path = backup_config_path(cli);

    if !config_path.exists() {
        info!(
            "No backup config file found at {}, starting with empty in-memory config",
            config_path.display()
        );
        return Ok(RuntimeConfigSnapshot::empty());
    }

    let config_str = std::fs::read_to_string(config_path)?;
    let parsed = parse_config_backup(&config_str).map_err(|error| {
        eyre!(
            "Failed to parse backup config {}: {error}",
            config_path.display()
        )
    })?;

    info!(
        "Loaded runtime config from {} backup at {}",
        parsed.format_name(),
        config_path.display()
    );

    Ok(RuntimeConfigSnapshot::from_parsed_backup(parsed))
}

/// Resolve warmup time: CLI arg takes precedence, then DB, then default.
fn resolve_warmup_time(cli: &Cli, configured_warmup_time: u64) -> u64 {
    cli.warmup_time.unwrap_or(configured_warmup_time)
}
