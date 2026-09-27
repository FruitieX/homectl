use std::{path::PathBuf, process};

use clap::{Parser, Subcommand};
use client::Client;

mod client;
mod commands;
mod output;

#[derive(Parser)]
#[command(
    name = "homectl",
    version,
    about = "CLI for the homectl home automation server"
)]
struct Cli {
    /// Base URL of the homectl server
    #[arg(
        long,
        short,
        env = "HOMECTL_URL",
        default_value = "http://localhost:45290"
    )]
    url: String,

    /// Output format
    #[arg(long, short, default_value = "table")]
    format: output::Format,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List and inspect devices
    Devices {
        #[command(subcommand)]
        action: DeviceAction,
    },
    /// Trigger actions (activate scene, dim, trigger routine, etc.)
    Action {
        #[command(subcommand)]
        action: ActionCommand,
    },
    /// List and inspect groups
    Groups {
        #[command(subcommand)]
        action: ListOrGet,
    },
    /// List and inspect scenes
    Scenes {
        #[command(subcommand)]
        action: ListOrGet,
    },
    /// List and inspect routines
    Routines {
        #[command(subcommand)]
        action: ListOrGet,
    },
    /// List and inspect integrations
    Integrations {
        #[command(subcommand)]
        action: ListOrGet,
    },
    /// Check server health
    Health,
    /// Run private, simulated automation scenarios against the configured routines.
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
}

#[derive(Subcommand)]
enum ConfigAction {
    /// Test routines without sending commands to integrations or hardware.
    Test {
        /// Read configuration from a database in read-only mode (defaults to DATABASE_URL or ./homectl.db).
        #[arg(long, env = "HOMECTL_SOURCE_DB")]
        source_db: Option<String>,
        /// Read a JSON config export instead of a database.
        #[arg(long)]
        config_export: Option<PathBuf>,
        /// Private scenario suite (defaults to $XDG_CONFIG_HOME/homectl/scenarios.json).
        #[arg(long, env = "HOMECTL_SCENARIOS")]
        scenarios: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum DeviceAction {
    /// List all devices
    List,
    /// Set a sensor device state (for simulation testing)
    SetSensor {
        /// Device ID
        id: String,
        /// Device name
        #[arg(long)]
        name: String,
        /// Integration ID
        #[arg(long, default_value = "dummy")]
        integration: String,
        /// Sensor type: boolean, number, or text
        #[arg(long, default_value = "boolean")]
        sensor_type: String,
        /// Sensor value (true/false for boolean, number for number, string for text)
        value: String,
    },
}

#[derive(Subcommand)]
enum ActionCommand {
    /// Activate a scene
    ActivateScene {
        /// Scene ID to activate
        scene_id: String,
        /// Limit to specific group IDs (comma-separated)
        #[arg(long, value_delimiter = ',')]
        groups: Option<Vec<String>>,
    },
    /// Cycle through scenes
    CycleScenes {
        /// Scene IDs to cycle through (comma-separated)
        #[arg(value_delimiter = ',')]
        scene_ids: Vec<String>,
        /// Don't wrap around to the beginning
        #[arg(long)]
        nowrap: bool,
        /// Limit to specific group IDs (comma-separated)
        #[arg(long, value_delimiter = ',')]
        groups: Option<Vec<String>>,
    },
    /// Dim lights
    Dim {
        /// Dim step (e.g. 0.1 for 10%)
        #[arg(long, default_value_t = 0.1)]
        step: f32,
        /// Limit to specific group IDs (comma-separated)
        #[arg(long, value_delimiter = ',')]
        groups: Option<Vec<String>>,
    },
    /// Force-trigger a routine
    TriggerRoutine {
        /// Routine ID
        routine_id: String,
    },
    /// Send a raw action as JSON
    Raw {
        /// JSON string representing the Action
        json: String,
    },
}

#[derive(Subcommand)]
enum ListOrGet {
    /// List all items
    List,
    /// Get a single item by ID
    Get {
        /// Item ID
        id: String,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let client = Client::new(&cli.url);

    let result = match cli.command {
        Commands::Devices { action } => commands::devices(&client, action, &cli.format).await,
        Commands::Action { action } => commands::action(&client, action).await,
        Commands::Groups { action } => {
            commands::config_resource(&client, "groups", action, &cli.format).await
        }
        Commands::Scenes { action } => {
            commands::config_resource(&client, "scenes", action, &cli.format).await
        }
        Commands::Routines { action } => {
            commands::config_resource(&client, "routines", action, &cli.format).await
        }
        Commands::Integrations { action } => {
            commands::config_resource(&client, "integrations", action, &cli.format).await
        }
        Commands::Health => commands::health(&client).await,
        Commands::Config { action } => match action {
            ConfigAction::Test {
                source_db,
                config_export,
                scenarios,
            } => commands::scenario_test(source_db, config_export, scenarios).await,
        },
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        process::exit(1);
    }
}
