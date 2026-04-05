#[macro_use]
extern crate log;

use homectl_server::api::init_api;
use homectl_server::api::config::{apply_migration, parse_toml_config};
use homectl_server::core::expr::Expr;
use homectl_server::core::simulate;
use homectl_server::core::{
    devices::Devices, event::handle_event, groups::Groups, integrations::Integrations,
    routines::Routines, scenes::Scenes, state::AppState, ui::Ui,
};
use homectl_server::db::{config_queries, init_db};
use homectl_server::types::event::{mk_event_channel, Event};
use homectl_server::utils::cli::{Cli, Command};

use clap::Parser;
use color_eyre::Result;
use std::error::Error;
use std::path::Path;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;
use tokio::sync::RwLock;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let cli = Cli::parse();
    color_eyre::install()?;
    pretty_env_logger::init();

    match &cli.command {
        Some(Command::Simulate(args)) => run_simulation(&cli, args).await,
        None => run_server(&cli).await,
    }
}

/// Normal server startup: file-based SQLite, TOML seeding, production config.
async fn run_server(cli: &Cli) -> Result<(), Box<dyn Error>> {
    init_db(&cli.db_path).await?;
    seed_from_toml_if_empty(cli).await?;

    run_event_loop(cli, cli.port, resolve_warmup_time(cli).await).await
}

/// Simulation mode: in-memory SQLite, mirror source config, MQTT→dummy translation.
async fn run_simulation(cli: &Cli, args: &homectl_server::utils::cli::SimulateArgs) -> Result<(), Box<dyn Error>> {
    info!("Starting simulation mode on port {}", args.port);

    // Initialize in-memory SQLite
    init_db(":memory:").await?;

    // Prepare simulation DB from source
    simulate::prepare_simulation_db(&args.source_db, args.config.as_deref()).await?;

    // Read the imported config to perform MQTT→dummy conversion
    let integrations = config_queries::db_get_integrations().await?;
    let groups = config_queries::db_get_groups().await?;
    let scenes = config_queries::db_get_config_scenes().await?;
    let routines = config_queries::db_get_routines().await?;

    simulate::convert_mqtt_to_dummy(&integrations, &groups, &scenes, &routines).await?;

    info!("Simulation DB ready, starting server...");
    run_event_loop(cli, args.port, args.warmup_time).await
}

/// Shared server startup: loads everything from DB, starts integrations, API, and event loop.
async fn run_event_loop(cli: &Cli, port: u16, warmup_time: u64) -> Result<(), Box<dyn Error>> {
    let (event_tx, mut event_rx) = mk_event_channel();

    // Load everything from the database
    let mut integrations = Integrations::new(event_tx.clone(), cli);
    integrations.load_db_integrations().await?;

    let mut groups = Groups::new(Default::default());
    groups.reload_from_db().await?;

    let mut scenes = Scenes::new(Default::default());
    scenes.refresh_db_scenes().await;

    let mut devices = Devices::new(event_tx.clone(), cli);
    devices.refresh_db_devices(&scenes).await;

    let expr = Expr::new();

    let mut rules = Routines::new(Default::default(), event_tx.clone());
    rules.reload_from_db().await?;

    let mut ui = Ui::new();
    ui.refresh_db_state().await;

    integrations.run_register_pass().await?;
    integrations.run_start_pass().await?;

    let state = AppState {
        warming_up: true,
        integrations,
        groups,
        scenes,
        devices,
        rules,
        event_tx,
        expr,
        ui,
        ws: Default::default(),
        ws_broadcast_pending: Arc::new(AtomicBool::new(false)),
    };

    let state = Arc::new(RwLock::new(state));

    init_api(&state, port)?;

    {
        let state = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(warmup_time)).await;
            let mut state = state.write().await;
            state.warming_up = false;
            state.event_tx.send(Event::StartupCompleted);
        });
    }

    loop {
        let event = event_rx
            .recv()
            .await
            .expect("Expected sender end of channel to never be dropped");

        let mut state = state.write().await;
        let result = handle_event(&mut state, &event).await;

        if let Err(err) = result {
            error!(
                "Error while handling event:\n    Event:\n    {event:#?}\n\n    Err:\n    {err:#?}",
            );
        }
    }
}

/// Seed the database from a TOML config file if the DB has no integrations.
async fn seed_from_toml_if_empty(cli: &Cli) -> Result<()> {
    if !config_queries::db_has_config().await? {
        let config_path = cli
            .config
            .as_deref()
            .map(Path::new)
            .unwrap_or_else(|| Path::new("Settings.toml"));

        if config_path.exists() {
            info!("Empty database detected, seeding from {}", config_path.display());
            let toml_str = std::fs::read_to_string(config_path)?;
            match parse_toml_config(&toml_str) {
                Ok(preview) => {
                    apply_migration(&preview).await?;
                    info!("Database seeded successfully from TOML config");
                }
                Err(e) => {
                    warn!("Failed to parse TOML config for seeding: {e}");
                }
            }
        } else {
            info!("No config file found at {}, starting with empty database", config_path.display());
        }
    }

    Ok(())
}

/// Resolve warmup time: CLI arg takes precedence, then DB, then default.
async fn resolve_warmup_time(cli: &Cli) -> u64 {
    if let Some(warmup) = cli.warmup_time {
        return warmup;
    }

    config_queries::db_get_core_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.warmup_time_seconds as u64)
        .unwrap_or(1)
}
