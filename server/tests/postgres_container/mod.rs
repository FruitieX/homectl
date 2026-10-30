//! Disposable PostgreSQL container for the Postgres-backed integration tests.
//!
//! Uses the same major version as the production cluster. The server listens
//! on 5432 with user, password and database all set to `postgres`.

use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::{ContainerRequest, GenericImage, ImageExt};

const READY: &str = "database system is ready to accept connections";

pub fn postgres() -> ContainerRequest<GenericImage> {
    GenericImage::new("postgres", "18-alpine")
        .with_exposed_port(5432.tcp())
        // The entrypoint starts a temporary server for initdb (logging READY
        // once) before the real one; wait for both announcements.
        .with_wait_for(WaitFor::message_on_stderr(READY))
        .with_wait_for(WaitFor::message_on_stdout(READY))
        .with_env_var("POSTGRES_DB", "postgres")
        .with_env_var("POSTGRES_USER", "postgres")
        .with_env_var("POSTGRES_PASSWORD", "postgres")
        .with_cmd(["-c", "fsync=off"])
}
