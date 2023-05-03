use anyhow::{Context, Result};
use once_cell::sync::OnceCell;
use sqlx::{pool::PoolOptions, PgPool};
use std::{env, time::Duration};

pub mod actions;

static DB_CONNECTION: OnceCell<PgPool> = OnceCell::new();

pub async fn init_db() -> Option<()> {
    let database_url = env::var("DATABASE_URL").ok();

    if database_url.is_none() {
        eprintln!("DATABASE_URL environment variable not set, skipping PostgreSQL initialization.")
    }

    let database_url = database_url?;

    let opt = PoolOptions::new().acquire_timeout(Duration::from_secs(3));

    println!("Connecting to PostgreSQL...");
    let db = opt
        .connect(&database_url)
        .await
        .expect("Could not open DB connection");

    DB_CONNECTION.set(db).unwrap();

    Some(())
}

pub async fn get_db_connection<'a>() -> Result<&'a PgPool> {
    DB_CONNECTION.get().context("Not connected to database")
}
