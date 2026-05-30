use color_eyre::Result;
use eyre::eyre;
use once_cell::sync::OnceCell;
use percent_encoding::{percent_decode_str, utf8_percent_encode};
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use sqlx::migrate::MigrateDatabase;
use sqlx::Postgres;
use std::{fs, path::PathBuf, time::Duration};

pub mod actions;
pub mod config_queries;
pub mod migrations;
pub mod schema;

const DEFAULT_SQLITE_DATABASE_FILE: &str = "homectl.db";
// Encode punctuation that can break URL parsing, but preserve RFC3986
// unreserved characters: ALPHA / DIGIT / '-' / '.' / '_' / '~'.
// This avoids re-encoding characters like '.' and '-' which are common
// and harmless in usernames, while still percent-encoding characters
// such as '@', '/', '?', '#', ':', whitespace, and other punctuation.
const POSTGRES_USERINFO_ENCODE_SET: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')  .add(b'!')  .add(b'"') .add(b'#')  .add(b'$')  .add(b'%')  .add(b'&')
    .add(b'\'') .add(b'(')  .add(b')')  .add(b'*')  .add(b'+')  .add(b',')  .add(b'/')
    .add(b':')  .add(b';')  .add(b'<')  .add(b'=')  .add(b'>')  .add(b'?')  .add(b'@')
    .add(b'[')  .add(b'\\') .add(b']')  .add(b'^')  .add(b'`')  .add(b'{')  .add(b'|')
    .add(b'}');

static DB_CONNECTION: OnceCell<DatabaseConnection> = OnceCell::new();
static DATABASE_TARGET: OnceCell<DatabaseTarget> = OnceCell::new();

#[derive(Clone, Debug, PartialEq, Eq)]
struct DatabaseTarget {
    url: String,
    backend: DatabaseBackendKind,
    source: DatabaseTargetSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DatabaseBackendKind {
    Postgres,
    Sqlite,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DatabaseTargetSource {
    ExplicitUrl,
    DefaultSqlite,
}

pub async fn init_db(database_url: Option<&str>) -> Result<bool> {
    let target = DatabaseTarget::resolve(database_url)?;

    remember_database_target(target.clone());
    connect_database(&target).await
}

pub async fn connect_configured_database() -> Result<bool> {
    let Some(target) = configured_target() else {
        return Ok(false);
    };

    connect_database(target).await
}

pub fn get_db_connection() -> Result<&'static DatabaseConnection> {
    DB_CONNECTION
        .get()
        .ok_or_else(|| eyre!("Not connected to database"))
}

pub fn database_url() -> Option<&'static str> {
    DATABASE_TARGET.get().map(|target| target.url.as_str())
}

pub fn is_db_configured() -> bool {
    configured_target().is_some()
}

pub fn is_db_connected() -> bool {
    DB_CONNECTION.get().is_some()
}

pub fn is_db_reconnect_configured() -> bool {
    configured_target()
        .map(|target| target.source == DatabaseTargetSource::ExplicitUrl)
        .unwrap_or(false)
}

fn configured_target() -> Option<&'static DatabaseTarget> {
    DATABASE_TARGET.get()
}

fn remember_database_target(target: DatabaseTarget) {
    match DATABASE_TARGET.get() {
        Some(existing) if existing != &target => {
            warn!("Ignoring attempt to replace configured database target at runtime");
        }
        Some(_) => {}
        None => {
            if let Err(error) = DATABASE_TARGET.set(target) {
                warn!("Database target was already set: {error:?}");
            }
        }
    }
}

async fn connect_database(target: &DatabaseTarget) -> Result<bool> {
    if DB_CONNECTION.get().is_some() {
        return Ok(true);
    }

    ensure_database_exists(target).await?;

    info!("Connecting to database at {}...", redact_postgres_password(&target.url));
    let mut options = ConnectOptions::new(target.url.clone());
    options.acquire_timeout(Duration::from_secs(2));

    let connection = Database::connect(options).await?;
    migrations::Migrator::up(&connection, None).await?;

    if let Err(error) = DB_CONNECTION.set(connection) {
        warn!("DB connection was already set: {error:?}");
    }

    Ok(true)
}

async fn ensure_database_exists(target: &DatabaseTarget) -> Result<()> {
    match target.backend {
        DatabaseBackendKind::Postgres => ensure_postgres_database_exists(&target.url).await,
        DatabaseBackendKind::Sqlite => ensure_sqlite_database_exists(&target.url),
    }
}

async fn ensure_postgres_database_exists(database_url: &str) -> Result<()> {
    let database_url = normalize_postgres_database_url(database_url);

    if Postgres::database_exists(&database_url).await? {
        return Ok(());
    }

    info!("Creating PostgreSQL database referenced by DATABASE_URL...");

    match Postgres::create_database(&database_url).await {
        Ok(()) => Ok(()),
        Err(error) if is_duplicate_database_error(&error) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn ensure_sqlite_database_exists(database_url: &str) -> Result<()> {
    if is_sqlite_memory_url(database_url) {
        return Ok(());
    }

    let Some(path) = sqlite_database_path(database_url) else {
        return Ok(());
    };

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }

    if !path.exists() {
        info!(
            "Creating SQLite database referenced by DATABASE_URL at {}...",
            path.display()
        );
        match fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
        {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }

    Ok(())
}

fn is_duplicate_database_error(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db_error| db_error.code())
        .as_deref()
        == Some("42P04")
}

impl DatabaseTarget {
    fn resolve(database_url: Option<&str>) -> Result<Self> {
        match database_url {
            Some(database_url) => Self::explicit(database_url),
            None => Self::default_sqlite(),
        }
    }

    fn explicit(database_url: &str) -> Result<Self> {
        let backend = DatabaseBackendKind::from_url(database_url)?;
        let url = match backend {
            DatabaseBackendKind::Postgres => normalize_postgres_database_url(database_url),
            DatabaseBackendKind::Sqlite => normalize_sqlite_database_url(database_url),
        };

        Ok(Self {
            url,
            backend,
            source: DatabaseTargetSource::ExplicitUrl,
        })
    }

    fn default_sqlite() -> Result<Self> {
        let database_path = std::env::current_dir()?.join(DEFAULT_SQLITE_DATABASE_FILE);

        info!(
            "No DATABASE_URL configured, using SQLite database at {}",
            database_path.display()
        );

        Ok(Self {
            url: sqlite_file_url(database_path),
            backend: DatabaseBackendKind::Sqlite,
            source: DatabaseTargetSource::DefaultSqlite,
        })
    }
}

impl DatabaseBackendKind {
    fn from_url(database_url: &str) -> Result<Self> {
        if database_url.starts_with("postgres://") || database_url.starts_with("postgresql://") {
            Ok(Self::Postgres)
        } else if database_url.starts_with("sqlite:") {
            Ok(Self::Sqlite)
        } else {
            Err(eyre!(
                "Unsupported DATABASE_URL scheme. Supported database backends are PostgreSQL and SQLite"
            ))
        }
    }
}

fn sqlite_file_url(path: PathBuf) -> String {
    format!("sqlite://{}?mode=rwc", path.display())
}

fn normalize_sqlite_database_url(database_url: &str) -> String {
    if is_sqlite_memory_url(database_url) || database_url.contains("mode=") {
        return database_url.to_string();
    }

    let separator = if database_url.contains('?') { '&' } else { '?' };
    format!("{database_url}{separator}mode=rwc")
}

fn sqlite_database_path(database_url: &str) -> Option<PathBuf> {
    let path = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))?;
    let path = path.split('?').next().unwrap_or(path);

    if path.is_empty() || path.starts_with(":memory:") || path.starts_with("file:") {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

fn is_sqlite_memory_url(database_url: &str) -> bool {
    database_url == "sqlite::memory:"
        || database_url.starts_with("sqlite://:memory:")
        || database_url.contains("mode=memory")
}

fn normalize_postgres_database_url(database_url: &str) -> String {
    let Some((scheme, rest)) = database_url.split_once("://") else {
        return database_url.to_string();
    };

    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);

    let Some(at_index) = authority.rfind('@') else {
        return database_url.to_string();
    };

    let (userinfo, host) = authority.split_at(at_index);
    let host = &host[1..];

    let (username, password) = match userinfo.split_once(':') {
        Some((username, password)) => (username, Some(password)),
        None => (userinfo, None),
    };

    let username = normalize_postgres_userinfo_component(username);
    let password = password.map(normalize_postgres_userinfo_component);

    let mut normalized = format!("{scheme}://{username}");
    if let Some(password) = password {
        normalized.push(':');
        normalized.push_str(&password);
    }
    normalized.push('@');
    normalized.push_str(host);
    normalized.push_str(tail);
    normalized
}

fn normalize_postgres_userinfo_component(component: &str) -> String {
    match percent_decode_str(component).decode_utf8() {
        Ok(decoded) => utf8_percent_encode(&decoded, POSTGRES_USERINFO_ENCODE_SET).to_string(),
        // If the userinfo component contains invalid percent-encoding or invalid
        // UTF-8, avoid silently replacing bytes with U+FFFD; fall back to returning
        // the original component unchanged so we don't corrupt credentials.
        Err(_) => component.to_string(),
    }
}

fn redact_postgres_password(database_url: &str) -> String {
    let Some((scheme, rest)) = database_url.split_once("://") else {
        return database_url.to_string();
    };

    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);

    let Some(at_index) = authority.rfind('@') else {
        return database_url.to_string();
    };

    let (userinfo, host) = authority.split_at(at_index);
    let host = &host[1..];

    let (username, password) = match userinfo.split_once(':') {
        Some((username, password)) => (username, Some(password)),
        None => (userinfo, None),
    };

    let mut result = format!("{scheme}://{username}");
    if password.is_some() {
        result.push(':');
        result.push_str("<redacted>");
    }
    result.push('@');
    result.push_str(host);
    result.push_str(tail);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_postgres_database_url,
        normalize_postgres_userinfo_component,
        redact_postgres_password,
    };

    #[test]
    fn normalizes_raw_postgres_credentials() {
        let url = "postgres://user:pa(ss)w@rd@localhost:5432/postgres";

        assert_eq!(
            normalize_postgres_database_url(url),
            "postgres://user:pa%28ss%29w%40rd@localhost:5432/postgres"
        );
    }

    #[test]
    fn preserves_already_encoded_postgres_credentials() {
        let url = "postgres://user:pa%28ss%29w%40rd@localhost:5432/postgres";

        assert_eq!(
            normalize_postgres_database_url(url),
            "postgres://user:pa%28ss%29w%40rd@localhost:5432/postgres"
        );
    }

    #[test]
    fn normalizes_individual_userinfo_component() {
        assert_eq!(
            normalize_postgres_userinfo_component("pa(ss)w@rd"),
            "pa%28ss%29w%40rd"
        );
    }

    #[test]
    fn normalizes_punctuation_heavy_postgres_credentials() {
        let url = "postgres://foo.bar-baz:pa(ss)w@rd&1*2@127.0.0.1:5432/homectl";

        assert_eq!(
            normalize_postgres_database_url(url),
            "postgres://foo.bar-baz:pa%28ss%29w%40rd%261%2A2@127.0.0.1:5432/homectl"
        );
    }

    #[test]
    fn redacts_password_when_logging() {
        let url = "postgres://user:pa%28ss%29w%40rd@localhost:5432/postgres";
        let redacted = redact_postgres_password(url);
        assert!(redacted.contains("<redacted>"));
        assert!(redacted.contains(":<redacted>@"));
        assert!(!redacted.contains("pa%28ss%29w%40rd"));
    }

    #[test]
    fn does_not_insert_redaction_when_no_password() {
        let url = "postgres://user@localhost:5432/postgres";
        let redacted = redact_postgres_password(url);
        assert!(!redacted.contains("<redacted>"));
        assert_eq!(redacted, url);
    }

    #[test]
    fn leaves_sqlite_urls_untouched() {
        let url = "sqlite://./homectl.db?mode=rwc";
        let redacted = redact_postgres_password(url);
        assert_eq!(redacted, url);
    }

    #[test]
    fn leaves_urls_without_userinfo_untouched() {
        let url = "postgres://localhost:5432/postgres";
        let redacted = redact_postgres_password(url);
        assert_eq!(redacted, url);
    }
}
