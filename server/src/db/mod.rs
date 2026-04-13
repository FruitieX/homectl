use color_eyre::Result;
use eyre::eyre;
use once_cell::sync::OnceCell;
use sqlx::migrate::MigrateDatabase;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres};
use std::time::Duration;

pub mod actions;
pub mod config_queries;

static DB_CONNECTION: OnceCell<PgPool> = OnceCell::new();
static DATABASE_URL: OnceCell<String> = OnceCell::new();

pub async fn init_db(database_url: Option<&str>) -> Result<bool> {
    let Some(database_url) = database_url else {
        info!("No DATABASE_URL configured, starting without persistent storage");
        return Ok(false);
    };

    remember_database_url(database_url);
    connect_database(database_url).await
}

pub async fn connect_configured_database() -> Result<bool> {
    let Some(database_url) = database_url() else {
        return Ok(false);
    };

    connect_database(database_url).await
}

pub fn get_db_connection() -> Result<&'static PgPool> {
    DB_CONNECTION
        .get()
        .ok_or_else(|| eyre!("Not connected to database"))
}

pub fn database_url() -> Option<&'static str> {
    DATABASE_URL.get().map(|value| value.as_str())
}

pub fn is_db_configured() -> bool {
    database_url().is_some()
}

pub fn is_db_connected() -> bool {
    DB_CONNECTION.get().is_some()
}

fn remember_database_url(database_url: &str) {
    match DATABASE_URL.get() {
        Some(existing) if existing != database_url => {
            warn!("Ignoring attempt to replace configured DATABASE_URL at runtime");
        }
        Some(_) => {}
        None => {
            if let Err(error) = DATABASE_URL.set(database_url.to_string()) {
                warn!("Database URL was already set: {error:?}");
            }
        }
    }
}

async fn connect_database(database_url: &str) -> Result<bool> {
    if DB_CONNECTION.get().is_some() {
        return Ok(true);
    }

    ensure_database_exists(database_url).await?;

    info!("Connecting to PostgreSQL at {database_url}...");
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_secs(2))
        .connect(database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    if let Err(error) = DB_CONNECTION.set(pool) {
        warn!("DB connection was already set: {error:?}");
    }

    Ok(true)
}

async fn ensure_database_exists(database_url: &str) -> Result<()> {
    if Postgres::database_exists(database_url).await? {
        return Ok(());
    }

    info!("Creating PostgreSQL database referenced by DATABASE_URL...");

    match Postgres::create_database(database_url).await {
        Ok(()) => Ok(()),
        Err(error) if is_duplicate_database_error(&error) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn is_duplicate_database_error(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db_error| db_error.code())
        .as_deref()
        == Some("42P04")
}
