use color_eyre::Result;
use eyre::eyre;
use once_cell::sync::OnceCell;
use sqlx::{pool::PoolOptions, PgPool};
use std::{env, time::Duration};

pub mod actions;

static DB_CONNECTION: OnceCell<PgPool> = OnceCell::new();

pub async fn init_db() -> Option<()> {
    let database_url = env::var("DATABASE_URL").ok();

    if database_url.is_none() {
        info!("DATABASE_URL environment variable not set, skipping PostgreSQL initialization.")
    }

    let database_url = database_url?;

    let opt = PoolOptions::new().acquire_timeout(Duration::from_secs(3));

    info!("Connecting to PostgreSQL...");
    match opt.connect(&database_url).await {
        Ok(db) => {
            if let Err(e) = DB_CONNECTION.set(db) {
                warn!("DB connection was already set: {e:?}");
            }
            Some(())
        }
        Err(e) => {
            warn!("Could not open DB connection, continuing without DB: {e}");
            None
        }
    }
}

pub async fn get_db_connection<'a>() -> Result<&'a PgPool> {
    DB_CONNECTION
        .get()
        .ok_or_else(|| eyre!("Not connected to database"))
}

pub fn is_db_available() -> bool {
    DB_CONNECTION.get().is_some()
}
