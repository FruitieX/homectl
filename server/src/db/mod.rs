use diesel::pg::PgConnection;
use std::env;

pub mod actions;
pub mod models;
pub mod schema;

use diesel::r2d2::{ConnectionManager, Pool};

type PgPool = Pool<ConnectionManager<PgConnection>>;

lazy_static! {
    pub static ref PG_POOL: PgPool = {
        let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

        PgPool::builder()
            .max_size(10)
            .build(ConnectionManager::new(&database_url))
            .expect("Failed to create DB connection pool")
    };
}
