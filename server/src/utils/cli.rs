use clap::{Parser, Subcommand};

#[derive(Clone, Parser)]
#[command(version, about, long_about = None)]
pub struct Cli {
    #[arg(long, required = false, default_value_t = false)]
    pub dry_run: bool,

    /// Port to listen on
    #[arg(long, env = "PORT", default_value_t = 45289)]
    pub port: u16,

    /// Optional PostgreSQL connection string for persistent storage.
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: Option<String>,

    /// Path to a JSON backup export file for initial DB seeding (optional)
    #[arg(long, env = "CONFIG_FILE")]
    pub config: Option<String>,

    /// Warmup time in seconds (overrides DB value)
    #[arg(long, env = "WARMUP_TIME")]
    pub warmup_time: Option<u64>,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Clone, Subcommand)]
pub enum Command {
    /// Launch a sandboxed simulation server with an in-memory database.
    /// Copies config from a source database or JSON backup file and replaces
    /// MQTT integrations with dummy equivalents.
    Simulate(SimulateArgs),
}

#[derive(Clone, Parser)]
pub struct SimulateArgs {
    /// Port for the simulation server (avoids clash with production)
    #[arg(long, default_value_t = 45290)]
    pub port: u16,

    /// Optional path to a legacy SQLite database file or PostgreSQL URL to
    /// mirror for simulation.
    #[arg(long)]
    pub source_db: Option<String>,

    /// Path to a JSON backup export file (used if source DB is empty or
    /// missing)
    #[arg(long)]
    pub config: Option<String>,

    /// Warmup time in seconds (defaults to 0 for instant simulation startup)
    #[arg(long, default_value_t = 0)]
    pub warmup_time: u64,
}
