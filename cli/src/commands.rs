use std::{env, fs, io::Write, path::PathBuf};

use homectl_server::core::{
    scenario::{run_scenario_suite, ScenarioSuite},
    simulate::prepare_simulation_config,
};
use homectl_server::db::config_queries::ConfigExport;

use crate::client::Client;
use crate::output::{self, Format};
use crate::{ActionCommand, DeviceAction, ListOrGet};
use colored::Colorize;

pub async fn devices(client: &Client, action: DeviceAction, format: &Format) -> Result<(), String> {
    match action {
        DeviceAction::List => {
            let resp = client.get("/api/v1/devices").await?;
            let devices = resp["devices"].as_array().cloned().unwrap_or_default();

            match format {
                Format::Json => output::print_json(&serde_json::Value::Array(devices)),
                Format::Compact => {
                    for d in &devices {
                        let id = d["id"].as_str().unwrap_or("-");
                        let name = d["name"].as_str().unwrap_or("-");
                        println!("{id}\t{name}");
                    }
                }
                Format::Table => output::print_devices_table(&devices),
            }
        }
        DeviceAction::SetSensor {
            id,
            name,
            integration,
            sensor_type,
            value,
        } => {
            let sensor_state = match sensor_type.as_str() {
                "boolean" | "bool" => {
                    let v: bool = value.parse().map_err(|_| "Invalid boolean value")?;
                    serde_json::json!({
                        "Boolean": { "value": v }
                    })
                }
                "number" => {
                    let v: f64 = value.parse().map_err(|_| "Invalid number value")?;
                    serde_json::json!({
                        "Number": { "value": v }
                    })
                }
                "text" => {
                    serde_json::json!({
                        "Text": { "value": value }
                    })
                }
                other => {
                    return Err(format!(
                        "Unknown sensor type: {other} (use boolean, number, or text)"
                    ))
                }
            };

            let device = serde_json::json!({
                "id": id,
                "name": name,
                "integration_id": integration,
                "data": { "Sensor": sensor_state },
            });

            client
                .put(&format!("/api/v1/devices/{id}"), &device)
                .await?;
            println!("Sensor {} set to {}", id.green(), value.cyan());
        }
    }
    Ok(())
}

pub async fn action(client: &Client, action: ActionCommand) -> Result<(), String> {
    let payload = match action {
        ActionCommand::ActivateScene { scene_id, groups } => {
            let mut desc = serde_json::json!({ "scene_id": scene_id });
            if let Some(groups) = groups {
                desc["group_keys"] = serde_json::json!(groups);
            }
            serde_json::json!({ "ActivateScene": desc })
        }
        ActionCommand::CycleScenes {
            scene_ids,
            nowrap,
            groups,
        } => {
            let scenes: Vec<serde_json::Value> = scene_ids
                .into_iter()
                .map(|id| serde_json::json!({ "scene_id": id }))
                .collect();
            let mut desc = serde_json::json!({ "scenes": scenes });
            if nowrap {
                desc["nowrap"] = serde_json::json!(true);
            }
            if let Some(groups) = groups {
                desc["group_keys"] = serde_json::json!(groups);
            }
            serde_json::json!({ "CycleScenes": desc })
        }
        ActionCommand::Dim { step, groups } => {
            let mut desc = serde_json::json!({ "step": step });
            if let Some(groups) = groups {
                desc["group_keys"] = serde_json::json!(groups);
            }
            serde_json::json!({ "Dim": desc })
        }
        ActionCommand::TriggerRoutine { routine_id } => {
            serde_json::json!({ "ForceTriggerRoutine": { "routine_id": routine_id } })
        }
        ActionCommand::Raw { json } => {
            serde_json::from_str(&json).map_err(|e| format!("Invalid JSON: {e}"))?
        }
    };

    client.post("/api/v1/actions/trigger", &payload).await?;
    println!("{}", "Action triggered successfully.".green());
    Ok(())
}

pub async fn config_resource(
    client: &Client,
    kind: &str,
    action: ListOrGet,
    format: &Format,
) -> Result<(), String> {
    match action {
        ListOrGet::List => {
            let resp = client.get(&format!("/api/v1/config/{kind}")).await?;
            let items = resp["data"].as_array().cloned().unwrap_or_default();

            match format {
                Format::Json => output::print_json(&serde_json::Value::Array(items)),
                Format::Compact => {
                    for item in &items {
                        let id = item["id"].as_str().unwrap_or("-");
                        let name = item["name"].as_str().unwrap_or("-");
                        println!("{id}\t{name}");
                    }
                }
                Format::Table => output::print_config_table(kind, &items),
            }
        }
        ListOrGet::Get { id } => {
            let resp = client.get(&format!("/api/v1/config/{kind}/{id}")).await?;
            let item = &resp["data"];
            output::print_json(item);
        }
    }
    Ok(())
}

pub async fn health(client: &Client) -> Result<(), String> {
    let (live, ready) = client.health().await?;

    let live_str = if live { "LIVE".green() } else { "DOWN".red() };
    let ready_str = if ready {
        "READY".green()
    } else {
        "NOT READY".yellow()
    };

    println!("Liveness:  {live_str}");
    println!("Readiness: {ready_str}");

    if !live {
        return Err("Server is not responding".to_string());
    }
    Ok(())
}

/// Run stored or file-backed scenarios against a read-only configuration snapshot.
pub async fn scenario_test(
    client: &Client,
    source_db: Option<String>,
    config_export: Option<PathBuf>,
    server: bool,
    scenarios: Option<PathBuf>,
) -> Result<(), String> {
    if source_db.is_some() && config_export.is_some() {
        return Err("choose either --source-db or --config-export, not both".to_string());
    }

    let source_db = if server || config_export.is_some() {
        None
    } else {
        source_db
            .or_else(|| env::var("DATABASE_URL").ok())
            .or_else(|| {
                PathBuf::from("./homectl.db")
                    .exists()
                    .then(|| "./homectl.db".into())
            })
    };
    if !server && source_db.is_none() && config_export.is_none() {
        return Err(
            "no configuration source found; provide --source-db, --config-export, DATABASE_URL, or ./homectl.db"
                .to_string(),
        );
    }

    let config: ConfigExport = if server {
        let response = client.get("/api/v1/config/export").await?;
        if response["success"] != true {
            return Err("live configuration export was unsuccessful".into());
        }
        serde_json::from_value(response["data"].clone())
            .map_err(|error| format!("invalid live configuration export: {error}"))?
    } else {
        prepare_simulation_config(
            source_db.as_deref(),
            config_export.as_ref().and_then(|path| path.to_str()),
        )
        .await
        .map_err(|error| {
            if source_db.is_some() {
                "could not read the database configuration in read-only mode; database details are redacted".to_string()
            } else {
                format!("could not load config export: {error:#}")
            }
        })?
    };
    let suite_value = if let Some(path) = scenarios {
        let suite_text = fs::read_to_string(&path).map_err(|error| {
            format!(
                "could not read scenario suite at {}: {error}",
                path.display()
            )
        })?;
        serde_json::from_str(&suite_text)
            .map_err(|error| format!("invalid scenario suite at {}: {error}", path.display()))?
    } else {
        config.scenario_suite.clone().ok_or_else(|| {
            "configuration has no stored scenario suite; upload one or pass --scenarios".to_string()
        })?
    };
    let suite: ScenarioSuite = serde_json::from_value(suite_value)
        .map_err(|error| format!("invalid scenario suite: {error}"))?;
    let report = run_scenario_suite(&config, &suite)
        .await
        .map_err(|error| format!("could not run scenario suite: {error:#}"))?;

    println!(
        "{} scenario(s): {} passed, {} failed",
        report.scenarios.len(),
        report.passed_count().to_string().green(),
        report.failed_count().to_string().red()
    );
    for scenario in &report.scenarios {
        if scenario.passed {
            println!("{} {}", "PASS".green(), scenario.name);
        } else {
            println!("{} {}", "FAIL".red(), scenario.name);
            for failure in &scenario.failures {
                println!("  - {failure}");
            }
        }
    }
    if report.failed_count() > 0 {
        return Err(format!("{} scenario(s) failed", report.failed_count()));
    }
    Ok(())
}

pub async fn upload_scenarios(client: &Client, file: PathBuf) -> Result<(), String> {
    let contents = fs::read_to_string(&file)
        .map_err(|error| format!("could not read {}: {error}", file.display()))?;
    let suite: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("invalid JSON at {}: {error}", file.display()))?;
    let parsed: ScenarioSuite = serde_json::from_value(suite.clone())
        .map_err(|error| format!("invalid scenario suite: {error}"))?;
    if parsed.version != 1 || parsed.scenarios.is_empty() {
        return Err("scenario suite must use version 1 and contain at least one scenario".into());
    }
    let response = client.put("/api/v1/config/scenarios", &suite).await?;
    if response["success"] != true {
        return Err(format!("scenario upload failed: {response}"));
    }
    if response["write"]["persistence"] != "persisted" {
        return Err(format!(
            "scenario suite reached the running server but was not saved: {}",
            response["write"]["warning"]
                .as_str()
                .unwrap_or("database persistence unavailable")
        ));
    }
    println!("Uploaded {} scenarios", parsed.scenarios.len());
    Ok(())
}

pub async fn download_scenarios(client: &Client, file: PathBuf, force: bool) -> Result<(), String> {
    let response = client.get("/api/v1/config/scenarios").await?;
    if response["success"] != true {
        return Err("server could not provide the scenario suite".into());
    }
    let suite = response["data"].clone();
    if suite.is_null() {
        return Err("server has no stored scenario suite".into());
    }
    let parsed: ScenarioSuite = serde_json::from_value(suite.clone())
        .map_err(|error| format!("invalid scenario suite from server: {error}"))?;
    let mut document = serde_json::to_string_pretty(&suite)
        .map_err(|error| format!("could not encode scenario suite: {error}"))?;
    document.push('\n');
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(force)
        .create_new(!force)
        .open(&file)
        .map_err(|error| format!("could not create {}: {error}", file.display()))?;
    output
        .write_all(document.as_bytes())
        .map_err(|error| format!("could not write {}: {error}", file.display()))?;
    println!(
        "Downloaded {} scenarios to {}",
        parsed.scenarios.len(),
        file.display()
    );
    Ok(())
}
