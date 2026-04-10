//! Common test utilities and harness for integration tests.
//!
//! This module provides a `TestServer` struct that manages the lifecycle of a
//! homectl-server instance for testing purposes.

#![allow(dead_code)]

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

/// Counter for generating unique test instance IDs.
static TEST_INSTANCE_COUNTER: AtomicU32 = AtomicU32::new(0);

/// A test server instance that manages a homectl-server process.
pub struct TestServer {
    /// The child process running homectl-server
    process: Option<Child>,
    /// The port the API is running on
    pub port: u16,
    /// Temporary directory containing test data
    pub temp_dir: PathBuf,
    /// Path to the test config file
    pub config_path: PathBuf,
    /// Base URL for API calls
    pub base_url: String,
}

/// Configuration for creating a test server
#[derive(Default)]
pub struct TestServerConfig {
    /// Additional configuration options to append to Settings.toml
    pub extra_config: Option<String>,
    /// If set, start in simulation mode using this TOML config file path
    pub simulate_config: Option<PathBuf>,
}

impl TestServer {
    /// Create and start a new test server with default configuration.
    pub fn new() -> Result<Self, TestServerError> {
        Self::with_config(TestServerConfig::default())
    }

    /// Create and start a new test server with custom configuration.
    pub fn with_config(config: TestServerConfig) -> Result<Self, TestServerError> {
        let instance_id = TEST_INSTANCE_COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();

        // Create temporary directory
        let temp_dir = std::env::temp_dir().join(format!("homectl_test_{}_{}", pid, instance_id));
        if temp_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&temp_dir) {
                eprintln!("[test] Warning: failed to clear existing temp dir: {}", e);
            }
        }
        std::fs::create_dir_all(&temp_dir)?;

        let config_path = temp_dir.join("Settings.toml");
        let binary = find_binary()?;
        let mut process: Option<Child> = None;
        let mut final_port = 0;
        let mut final_base_url = String::new();

        // Retry loop to handle port race conditions
        let max_retries = 5;
        for attempt in 0..max_retries {
            if attempt > 0 {
                eprintln!("[test] Retry attempt {} of {}", attempt + 1, max_retries);
                std::thread::sleep(Duration::from_millis(100 * (attempt as u64 + 1)));
            }

            // Reserve a port
            let (listener, port) = reserve_port()?;

            // Generate config file with this port (not needed for simulation mode)
            if config.simulate_config.is_none() {
                let config_content = generate_config(port, config.extra_config.as_deref());
                if let Err(e) = std::fs::write(&config_path, &config_content) {
                    return Err(TestServerError::Io(e));
                }
            }

            // Drop the listener just before starting the server to minimize race window
            drop(listener);

            let mut cmd = Command::new(&binary);
            cmd.env("RUST_LOG", "warn,homectl_server=info")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            if let Some(ref sim_config) = config.simulate_config {
                // Simulation mode: run from workspace root (where prod-config.toml lives)
                let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap_or(Path::new(env!("CARGO_MANIFEST_DIR")));
                cmd.current_dir(workspace_root)
                    .arg("simulate")
                    .arg("--config")
                    .arg(sim_config)
                    .arg("--port")
                    .arg(port.to_string());
            } else {
                cmd.current_dir(&temp_dir)
                    .arg("--config")
                    .arg(&config_path)
                    .arg("--port")
                    .arg(port.to_string());
            }

            let mut child = match cmd.spawn() {
                Ok(child) => child,
                Err(e) => {
                    eprintln!("[test] Failed to spawn process: {}", e);
                    continue;
                }
            };

            let base_url = format!("http://127.0.0.1:{}", port);
            let timeout = if config.simulate_config.is_some() {
                Duration::from_secs(30)
            } else {
                Duration::from_secs(15)
            };

            match wait_for_ready(&mut child, &base_url, timeout) {
                Ok(()) => {
                    process = Some(child);
                    final_port = port;
                    final_base_url = base_url;
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[test] Server failed to start on attempt {}: {}",
                        attempt + 1,
                        e
                    );
                    // Extract stderr
                    if let Some(stderr) = child.stderr.take() {
                        let mut stderr_content = String::new();
                        use std::io::Read;
                        if let Ok(bytes) = std::io::BufReader::new(stderr)
                            .take(4096)
                            .read_to_string(&mut stderr_content)
                        {
                            if bytes > 0 {
                                eprintln!("[test] Server stderr: {}", stderr_content);
                            }
                        }
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }

        if let Some(child) = process {
            Ok(TestServer {
                process: Some(child),
                port: final_port,
                temp_dir,
                config_path,
                base_url: final_base_url,
            })
        } else {
            let _ = std::fs::remove_dir_all(&temp_dir);
            Err(TestServerError::ProcessStart(
                "Failed to start server after max retries".to_string(),
            ))
        }
    }

    /// Stop the server process.
    pub fn stop(&mut self) {
        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

/// Wait for the server to become ready by polling the health endpoint.
fn wait_for_ready(
    child: &mut Child,
    base_url: &str,
    timeout: Duration,
) -> Result<(), TestServerError> {
    let start_time = Instant::now();
    let health_url = format!("{}/health/live", base_url);

    eprintln!("[test] Waiting for server at {}", health_url);

    loop {
        if start_time.elapsed() > timeout {
            return Err(TestServerError::Timeout(
                "Server did not become ready within timeout".to_string(),
            ));
        }

        // Check if process is still running
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(TestServerError::ProcessStart(format!(
                    "Server process exited unexpectedly with status: {}",
                    status
                )));
            }
            Ok(None) => {
                // Process still running
            }
            Err(e) => {
                return Err(TestServerError::ProcessStart(format!(
                    "Failed to check process status: {}",
                    e
                )));
            }
        }

        // Try to connect
        match reqwest::blocking::get(&health_url) {
            Ok(response) if response.status().is_success() => {
                eprintln!("[test] Server ready!");
                return Ok(());
            }
            Ok(response) => {
                eprintln!("[test] Got response status: {}", response.status());
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                if start_time.elapsed().as_secs() % 3 == 0 {
                    eprintln!(
                        "[test] Connection error: {} (elapsed: {:?})",
                        e,
                        start_time.elapsed()
                    );
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop();
        if self.temp_dir.exists() {
            let _ = std::fs::remove_dir_all(&self.temp_dir);
        }
    }
}

/// Find an available TCP port and return the listener to keep it reserved.
fn reserve_port() -> Result<(TcpListener, u16), TestServerError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| TestServerError::PortAllocation(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| TestServerError::PortAllocation(e.to_string()))?
        .port();
    Ok((listener, port))
}

/// Find the homectl-server binary.
fn find_binary() -> Result<PathBuf, TestServerError> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));

    // For a workspace, the target directory is at the workspace root (parent of server/)
    let workspace_root = manifest_dir.parent().unwrap_or(manifest_dir);

    // First try the debug build in workspace target
    let debug_binary = workspace_root
        .join("target")
        .join("debug")
        .join("homectl-server");

    if debug_binary.exists() {
        return Ok(debug_binary);
    }

    // Try release build in workspace target
    let release_binary = workspace_root
        .join("target")
        .join("release")
        .join("homectl-server");

    if release_binary.exists() {
        return Ok(release_binary);
    }

    // Also try the package-local target directory (in case build is run from server/)
    let local_debug_binary = manifest_dir
        .join("target")
        .join("debug")
        .join("homectl-server");

    if local_debug_binary.exists() {
        return Ok(local_debug_binary);
    }

    let local_release_binary = manifest_dir
        .join("target")
        .join("release")
        .join("homectl-server");

    if local_release_binary.exists() {
        return Ok(local_release_binary);
    }

    // Try PATH
    if let Ok(path) = which::which("homectl-server") {
        return Ok(path);
    }

    Err(TestServerError::BinaryNotFound(
        "homectl-server binary not found. Run `cargo build` first.".to_string(),
    ))
}

/// Generate a test configuration file.
fn generate_config(port: u16, extra_config: Option<&str>) -> String {
    let mut config = format!(
        r#"# Test configuration for homectl-server

[core]
warmup_time_seconds = 0
port = {port}

# Dummy integration for testing
[integrations.dummy]
plugin = "dummy"
devices = {{}}"#,
        port = port
    );

    if let Some(extra) = extra_config {
        config.push('\n');
        config.push('\n');
        config.push_str(extra);
    }

    // Debug: write config to temp file for inspection
    let _ = std::fs::write("/tmp/test_config_debug.toml", &config);

    config
}

/// Errors that can occur when managing a test server.
#[derive(Debug)]
pub enum TestServerError {
    Io(std::io::Error),
    PortAllocation(String),
    BinaryNotFound(String),
    ProcessStart(String),
    Timeout(String),
}

impl std::fmt::Display for TestServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TestServerError::Io(e) => write!(f, "IO error: {}", e),
            TestServerError::PortAllocation(e) => write!(f, "Port allocation error: {}", e),
            TestServerError::BinaryNotFound(e) => write!(f, "Binary not found: {}", e),
            TestServerError::ProcessStart(e) => write!(f, "Process start error: {}", e),
            TestServerError::Timeout(e) => write!(f, "Timeout: {}", e),
        }
    }
}

impl std::error::Error for TestServerError {}

impl From<std::io::Error> for TestServerError {
    fn from(e: std::io::Error) -> Self {
        TestServerError::Io(e)
    }
}
