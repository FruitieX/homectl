#[macro_use]
extern crate log;

use homectl_server::api::config::{parse_config_backup, ParsedConfigBackup};
use homectl_server::api::init_api;
use homectl_server::core::simulate;
use homectl_server::core::{
    automation::{sources, ConfigCatalog},
    clock::Clock,
    convert,
    devices::Devices,
    groups::Groups,
    integrations::Integrations,
    logs::init_logging,
    routines::Routines,
    scenes::Scenes,
    snapshot::{new_snapshot_handle, RuntimeSnapshot, SnapshotChanges},
    state::{spawn_state_actor, AppState, StateHandle},
    ui::Ui,
};
use homectl_server::db::{
    actions, config_queries, connect_configured_database, init_db, is_db_connected,
    is_db_reconnect_configured,
};
use homectl_server::types::automation_event::EventOrigin;
use homectl_server::types::event::{mk_event_channel, Event, TxEventChannel};
use homectl_server::types::scene::SceneOverridesConfig;
use homectl_server::utils::cli::{Cli, Command, ConvertArgs};

use clap::Parser;
use color_eyre::Result;
use eyre::eyre;
use std::collections::HashMap;
use std::error::Error;
use std::path::Path;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;
use tokio::sync::Mutex;

const DATABASE_RECONNECT_INTERVAL_SECS: u64 = 2;

fn default_backup_config_path() -> &'static Path {
    Path::new("Settings.json")
}

fn backup_config_path(cli: &Cli) -> &Path {
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
                helpers: Vec::new(),
                helper_values: Vec::new(),
                sources: Vec::new(),
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
        Some(Command::Convert(args)) => run_convert(&cli, args).await,
        None => run_server(&cli).await,
    }
}

/// Offline v1 -> v2 routine conversion. Dry-run by default; `--apply` and
/// `--restore` write to the database and refuse to run while a server owns
/// the configured port.
async fn run_convert(cli: &Cli, args: &ConvertArgs) -> Result<(), Box<dyn Error>> {
    if args.source_db.is_some() && args.source_export.is_some() {
        return Err(eyre!(
            "--source-db and --source-export select different inputs; pass only one"
        )
        .into());
    }
    if args.source_export.is_some() && (args.apply || args.restore.is_some()) {
        return Err(eyre!(
            "--source-export reads a JSON file and cannot be combined with --apply or --restore"
        )
        .into());
    }
    if args.restore.is_some() && args.apply {
        return Err(eyre!("--restore and --apply are mutually exclusive").into());
    }

    // Progress lines go to stderr when the report is machine-readable.
    let announce = |message: String| {
        if args.json {
            eprintln!("{message}");
        } else {
            println!("{message}");
        }
    };

    if let Some(archive_path) = &args.restore {
        let plan = convert::read_archive(Path::new(archive_path))?;
        check_converter_server_stopped(cli, args).await?;
        let database_url = args.source_db.clone().or_else(|| cli.database_url.clone());
        init_db(database_url.as_deref()).await?;
        convert::apply_conversion(&plan.routines, &plan.created_routines, &plan.integrations)
            .await?;
        announce(format!(
            "Restored {} archived routine row(s), removed {} converter-created routine(s), and re-enabled {} integration(s) from {}. Restart the server to load the archived semantics.",
            plan.routines.len(),
            plan.created_routines.len(),
            plan.integrations.len(),
            archive_path
        ));
        return Ok(());
    }

    // `--source-db` wins, otherwise the CLI's database URL (DATABASE_URL),
    // matching the apply/restore path so a dry run reads the database that
    // `--apply` will write.
    let source_db = args.source_db.clone().or_else(|| cli.database_url.clone());
    let (source, export) =
        convert::load_source_export(source_db.as_deref(), args.source_export.as_deref()).await?;
    if args.cron_timezone.is_none()
        && export
            .integrations
            .iter()
            .any(|integration| integration.plugin == "cron")
    {
        announce(
            "note: cron schedules present and no --cron-timezone given; they will be reported as needs-manual"
                .to_string(),
        );
    }
    let report = convert::build_report(&source, &export, args.cron_timezone.clone());

    let convertible = report.converted + report.cron_converted;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        print!("{}", convert::render_report(&report));
        if !args.apply && convertible > 0 {
            println!(
                "Dry run: {convertible} routine(s)/schedule(s) can be converted. Re-run with --apply (server stopped) to write them."
            );
        }
    }

    if !args.apply {
        return Ok(());
    }

    let blocking = report.needs_manual
        + report.unsupported
        + report.cron_needs_manual
        + report.cron_unsupported;
    if !report.is_clean() && !args.force {
        return Err(eyre!(
            "{blocking} routine(s)/schedule(s) need manual authoring or are unsupported; inspect the report, then re-run with --force to convert the convertible rows and leave the rest on v1"
        )
        .into());
    }

    let rows = convert::converted_rows(&report, &export)?;
    let disabled = convert::integrations_to_disable(&report, &export);
    if rows.is_empty() && disabled.is_empty() {
        announce("Nothing to apply.".to_string());
        return Ok(());
    }

    check_converter_server_stopped(cli, args).await?;

    let archive_path = args
        .archive
        .clone()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(convert::default_archive_path);
    convert::write_archive(&archive_path, &source, &export, &report)?;
    announce(format!(
        "Archived pre-conversion rows to {}",
        archive_path.display()
    ));

    let database_url = args.source_db.clone().or_else(|| cli.database_url.clone());
    init_db(database_url.as_deref()).await?;
    convert::apply_conversion(&rows, &[], &disabled).await?;
    announce(format!(
        "Applied {} converted routine(s), created {} cron routine(s), left {} row(s) and {} schedule(s) on v1 semantics, disabled {} legacy integration(s). Restart the server to load v2 routines.",
        report.converted,
        rows.len() - report.converted,
        report.total - report.converted,
        report.cron_total - report.cron_converted,
        disabled.len()
    ));
    Ok(())
}

async fn check_converter_server_stopped(
    cli: &Cli,
    args: &ConvertArgs,
) -> Result<(), Box<dyn Error>> {
    if args.skip_running_check {
        return Ok(());
    }
    let mut ports = vec![cli.port];
    if cli.port != 45289 {
        ports.push(45289);
    }
    for port in ports {
        if convert::server_reachable(port).await {
            return Err(eyre!(
                "a homectl server appears to be running on port {port} (checked /health/live); stop it before writing, pass --port for a custom port, or pass --skip-running-check",
            )
            .into());
        }
    }
    Ok(())
}

/// Normal server startup: database persistence plus backup-config fallback.
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
    let deferred_work_tx = homectl_server::core::deferred::spawn_deferred_worker();

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

    let clock = Arc::new(homectl_server::core::clock::SystemClock::new());

    // P11: seed computed-source devices before routines compile, so a device
    // reference to `computed/<id>` resolves on the first load. The registry
    // is handed to `AppState`, and the startup refresh then sees the sources
    // as already computed for this cadence.
    let mut sources = sources::Sources::default();
    sources.load_rows(runtime_config.config.sources.clone());
    for (definition, profile) in sources::evaluate_due_sources(&mut sources, clock.wall_ms()) {
        let device = sources::synthetic_device(&definition, &profile);
        devices.set_state_with_origin(&device, true, true, EventOrigin::Derived);
    }

    let mut rules = Routines::new(Default::default(), event_tx.clone());
    let catalog = ConfigCatalog::new(
        devices.get_state().0.keys().cloned(),
        &runtime_config.config,
    );
    rules.load_config_rows(&runtime_config.config.routines, &catalog);

    let ui = Ui::with_state(runtime_config.ui_state);

    integrations.run_register_pass().await?;
    integrations.run_start_pass().await?;

    let snapshot = new_snapshot_handle(RuntimeSnapshot {
        runtime_config: Arc::new(runtime_config.config.clone()),
        devices: Arc::new(devices.get_state().clone()),
        flattened_groups: Arc::new(groups.get_flattened_groups().clone()),
        flattened_scenes: Arc::new(scenes.get_flattened_scenes().clone()),
        routine_statuses: rules.get_runtime_statuses(),
        helper_statuses: Arc::new(Vec::new()),
        timers: Arc::new(Vec::new()),
        ui_state: Arc::new(ui.get_state().clone()),
        warming_up: true,
    });

    let mut state = AppState {
        calibration_sessions: Default::default(),
        warming_up: true,
        runtime_config: runtime_config.config.clone(),
        integrations,
        groups,
        scenes,
        devices,
        rules,
        helpers: Default::default(),
        sources,
        intents: Default::default(),
        scripts: Default::default(),
        timers: Default::default(),
        pending_timer_fires: Vec::new(),
        pending_predicate_fires: Vec::new(),
        pending_schedule_fires: Vec::new(),
        clock,
        pending_deferred_work: Vec::new(),
        event_tx: event_tx.clone(),
        ui,
        ws: Default::default(),
        ws_broadcast_pending: Arc::new(AtomicBool::new(false)),
        pending_ws_update: Arc::new(std::sync::Mutex::new(Default::default())),
        runtime_apply_lock: Arc::new(Mutex::new(())),
        snapshot: snapshot.clone(),
        frame_log: Default::default(),
    };

    // Startup discovery/restore mutations are seeded as startup frames and
    // must not fire routines (E06).
    state.sync_script_owners();
    // P11: every enabled computed source computes once at startup; the
    // published synthetic devices join the same startup seed.
    state.apply_runtime_sources();
    state.seed_startup_state().await;

    // P10: restore best-effort durable named timers so a restart does not lose
    // "turn the hallway light off in 10 minutes". Schedule occurrences re-arm
    // from now and predicate deadlines re-evaluate from state, both with
    // visible logs; only named timers are persisted.
    restore_startup_timers(&mut state).await;
    state.arm_schedules_at_startup();
    state.log_predicate_recovery();
    // The restored/armed jobs must be visible before the actor processes its
    // first command (the actor republishes timers only on lifecycle changes).
    state.publish_snapshot(SnapshotChanges {
        timers: true,
        ..SnapshotChanges::none()
    });

    let ws_handle = state.ws.clone();

    // Spawn the state actor. The actor owns `AppState` by value and is
    // the sole writer; admin handlers dispatch mutations through
    // `StateHandle`, and the main loop below forwards incoming events
    // onto the actor's command channel.
    let state_handle = spawn_state_actor(state, snapshot.clone(), deferred_work_tx.clone());

    // P11: computed sources refresh on their own cadence. The ticker only
    // wakes the actor; per-source due checks stay in actor state.
    spawn_source_refresh_ticker(event_tx.clone());

    init_api(
        snapshot.clone(),
        state_handle.clone(),
        ws_handle,
        event_tx.clone(),
        port,
    )?;

    if is_db_reconnect_configured() {
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

/// P11: periodic opportunity for computed sources to refresh. A fixed
/// one-second tick honors every validated cadence (the minimum is one
/// second); each source's own interval is enforced in actor state, so the
/// tick carries no per-source decision.
fn spawn_source_refresh_ticker(event_tx: TxEventChannel) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // The first tick completes immediately; startup already computed.
        interval.tick().await;
        loop {
            interval.tick().await;
            event_tx.send(Event::SourceRefreshTick);
        }
    });
}

/// P10 startup recovery for best-effort durable named timers.
///
/// Named timers are loaded and restored (future due only; past-due rows are
/// logged, dropped, and deleted). Schedule occurrences and predicate deadlines
/// are intentionally not persisted: schedules re-arm from `now` through
/// `apply_runtime_routines`, and sustained predicates re-evaluate from current
/// state on the next frame. A database that is unavailable logs one warning
/// and leaves session-only behavior; persistence then happens per job when the
/// deferred lane can write.
async fn restore_startup_timers(state: &mut AppState) {
    if !is_db_connected() {
        warn!("Database unavailable; named timers are session-only for this run");
        return;
    }

    let rows = match config_queries::db_get_timer_jobs().await {
        Ok(rows) => rows,
        Err(error) => {
            warn!("Failed to load persisted timer jobs; timers are session-only: {error}");
            return;
        }
    };

    state.restore_timer_jobs(&rows);

    // Clean up rows that were dropped as past-due or stale so the next start
    // does not log them again.
    for row in rows {
        let dropped = match state.timers.named_job_snapshot(
            &homectl_server::types::rule::RoutineId(row.routine_id.clone()),
            &homectl_server::types::automation_definition::TimerId(row.timer_id.clone()),
        ) {
            Some(job) => job.generation != u64::try_from(row.generation).unwrap_or(0),
            None => true,
        };
        if dropped {
            if let Err(error) =
                config_queries::db_delete_timer_job(&row.routine_id, &row.timer_id).await
            {
                warn!(
                    "Failed to delete dropped timer job {}/{}: {error}",
                    row.routine_id, row.timer_id
                );
            }
        }
    }
}

fn start_database_reconnect_loop(state_handle: StateHandle) {
    tokio::spawn(async move {
        if !is_db_reconnect_configured() || is_db_connected() {
            return;
        }

        let mut interval =
            tokio::time::interval(Duration::from_secs(DATABASE_RECONNECT_INTERVAL_SECS));
        let mut last_connection_error: Option<String> = None;

        loop {
            interval.tick().await;

            if !is_db_reconnect_configured() {
                break;
            }

            if is_db_connected() {
                break;
            }

            match connect_configured_database().await {
                Ok(true) => {
                    info!("Connected to configured database in background reconnect loop");

                    if let Err(error) = synchronize_reconnected_database(&state_handle).await {
                        warn!("Failed to synchronize runtime snapshot after database reconnect: {error}");
                    }

                    break;
                }
                Ok(false) => break,
                Err(error) => {
                    let error_message = error.to_string();
                    if last_connection_error.as_deref() != Some(error_message.as_str()) {
                        warn!("Configured database is still unavailable: {error_message}");
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
            "Configured database became available with existing config; keeping the current runtime snapshot until restart"
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
