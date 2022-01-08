use diesel::pg::PgConnection;
use std::env;

pub mod actions;
pub mod models;
pub mod schema;

use diesel::r2d2::{ConnectionManager, Pool};
type PgPool = Pool<ConnectionManager<PgConnection>>;
type PgPoolOpt = Option<PgPool>;

lazy_static! {
    pub static ref PG_POOL: PgPoolOpt= {
        let database_url = env::var("DATABASE_URL").ok()?;
        
        PgPool::builder()
            .max_size(10)
            .build(ConnectionManager::new(&database_url))
            .ok()
    };
}
