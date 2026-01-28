//! Integration tests for homectl-server using hurl scripts.
//!
//! These tests use datatest-stable for auto-discovery of `.hurl` test files.
//! Each `.hurl` file in `tests/hurl/` becomes an individual test case.
//!
//! Test configuration is specified via front-matter comments in each `.hurl` file:
//! - `# @skip` - Skip this test entirely
//! - `# @config` ... `# @endconfig` - Extra Settings.toml content

mod common;

use common::{TestServer, TestServerConfig};
use std::path::Path;
use std::process::Command;

/// Front-matter configuration parsed from a hurl file.
#[derive(Debug, Default)]
struct HurlConfig {
    skip: bool,
    extra_config: Option<String>,
}

/// Parse front-matter configuration from a hurl file's content.
fn parse_hurl_config(content: &str) -> HurlConfig {
    let mut config = HurlConfig::default();
    let mut in_config_block = false;
    let mut config_lines = Vec::new();

    // Look at comment lines at the start of the file for configuration
    for line in content.lines() {
        let trimmed = line.trim();

        // If we're not in a config block, stop at first non-comment line
        if !in_config_block && !trimmed.starts_with('#') {
            break;
        }

        if !trimmed.starts_with('#') {
            continue;
        }

        let comment = trimmed.trim_start_matches('#').trim();

        if comment.starts_with("@skip") {
            config.skip = true;
        } else if comment.starts_with("@config") {
            in_config_block = true;
        } else if comment.starts_with("@endconfig") {
            in_config_block = false;
        } else if in_config_block {
            config_lines.push(comment);
        }
    }

    if !config_lines.is_empty() {
        config.extra_config = Some(config_lines.join("\n"));
    }

    config
}

/// Check if hurl is available.
fn hurl_available() -> bool {
    Command::new("hurl")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run a hurl script against a test server.
fn run_hurl_script(server: &TestServer, script_path: &Path) -> Result<(), String> {
    let output = Command::new("hurl")
        .arg("--test")
        .arg("--file-root")
        .arg(env!("CARGO_MANIFEST_DIR"))
        .arg("--variable")
        .arg(format!("base_url={}", server.base_url))
        .arg(script_path)
        .output()
        .map_err(|e| format!("Failed to run hurl: {}", e))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Print the actual output with proper newlines
        eprintln!("\n=== Hurl script failed: {} ===", script_path.display());
        eprintln!("--- stdout ---");
        eprintln!("{}", stdout);
        eprintln!("--- stderr ---");
        eprintln!("{}", stderr);
        eprintln!("===");
        return Err(format!(
            "Hurl script {} failed",
            script_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
    }

    Ok(())
}

/// The inner test function that performs a single attempt.
fn run_hurl_test_inner(path: &Path, content: &str) -> datatest_stable::Result<()> {
    // Check prerequisites
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return Ok(());
    }

    // Parse configuration from front-matter
    let config = parse_hurl_config(content);

    // Check if test should be skipped
    if config.skip {
        eprintln!("Skipping test: marked with @skip");
        return Ok(());
    }

    // Build server configuration
    let server_config = TestServerConfig {
        extra_config: config.extra_config,
    };

    // Create and start the test server
    let server = TestServer::with_config(server_config)
        .map_err(|e| format!("Failed to start test server: {}", e))?;

    // Run the hurl script
    run_hurl_script(&server, path).map_err(|e| e.into())
}

/// The main test function called by datatest-stable for each `.hurl` file.
/// Wraps the inner function with retry logic.
fn run_hurl_test(path: &Path, content: String) -> datatest_stable::Result<()> {
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 1..=max_retries {
        match run_hurl_test_inner(path, &content) {
            Ok(()) => return Ok(()),
            Err(e) => {
                if attempt < max_retries {
                    eprintln!(
                        "Test {} failed attempt {}/{}: {}",
                        path.display(),
                        attempt,
                        max_retries,
                        e
                    );
                    // Add a small backoff between test retries
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap())
}

// Register the test harness with datatest-stable
// This discovers all .hurl files in tests/hurl/ and runs them as individual tests
datatest_stable::harness!(run_hurl_test, "tests/hurl", r".*\.hurl$");
