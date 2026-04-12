use color_eyre::Result;
use eyre::eyre;
use once_cell::sync::OnceCell;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

pub mod actions;
pub mod config_queries;

static DB_CONNECTION: OnceCell<SqlitePool> = OnceCell::new();

pub async fn init_db(db_path: &str) -> Result<()> {
    let is_memory = db_path == ":memory:";
    let url = if is_memory {
        "sqlite::memory:".to_string()
    } else {
        format!("sqlite:{}?mode=rwc", db_path)
    };

    info!("Connecting to SQLite at {url}...");
    // In-memory SQLite: each connection gets its own database, so we must
    // limit the pool to a single connection to keep tables visible across queries.
    let pool = if is_memory {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await?
    } else {
        SqlitePool::connect(&url).await?
    };

    // Enable WAL mode for better concurrent read performance
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await?;

    // Enable foreign key enforcement (off by default in SQLite)
    sqlx::query("PRAGMA foreign_keys=ON").execute(&pool).await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    if let Err(e) = DB_CONNECTION.set(pool) {
        warn!("DB connection was already set: {e:?}");
    }

    Ok(())
}

pub fn get_db_connection() -> Result<&'static SqlitePool> {
    DB_CONNECTION
        .get()
        .ok_or_else(|| eyre!("Not connected to database"))
}
