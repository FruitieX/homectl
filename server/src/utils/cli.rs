use clap::{Parser, Subcommand};

#[derive(Clone, Parser)]
#[command(version, about, long_about = None)]
pub struct Cli {
    #[arg(long, required = false, default_value_t = false)]
    pub dry_run: bool,

    /// Port to listen on
    #[arg(long, env = "PORT", default_value_t = 45289)]
    pub port: u16,

    /// Optional database connection string for persistent storage.
    /// Uses ./homectl.db SQLite storage when omitted.
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

    /// Convert legacy v1 routine rows to v2 definitions. Dry-run by default;
    /// `--apply` writes converted rows in one transaction after archiving the
    /// pre-conversion rows. The server must be stopped while applying.
    Convert(ConvertArgs),
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

#[derive(Clone, Parser)]
pub struct ConvertArgs {
    /// Source SQLite database file/URL or PostgreSQL URL to read (read-only).
    /// Defaults to DATABASE_URL or ./homectl.db.
    #[arg(long)]
    pub source_db: Option<String>,

    /// Read a JSON config export instead of a database. Cannot be combined
    /// with --apply or --restore.
    #[arg(long)]
    pub source_export: Option<String>,

    /// Write the converted v2 rows to the database. Requires the server to be
    /// stopped; the pre-conversion rows are archived to JSON first.
    #[arg(long, default_value_t = false)]
    pub apply: bool,

    /// Apply even when some rows still need manual authoring. Those rows stay
    /// on v1 semantics and keep running.
    #[arg(long, default_value_t = false)]
    pub force: bool,

    /// Restore a pre-conversion archive (rollback) instead of converting.
    /// The server must be stopped.
    #[arg(long)]
    pub restore: Option<String>,

    /// Archive path for the pre-conversion rows.
    #[arg(long)]
    pub archive: Option<String>,

    /// Print the conversion report as JSON instead of text.
    #[arg(long, default_value_t = false)]
    pub json: bool,

    /// Skip the running-server health check before --apply/--restore.
    #[arg(long, default_value_t = false)]
    pub skip_running_check: bool,
}
