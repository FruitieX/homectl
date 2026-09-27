use std::{env, fs, path::PathBuf};

use homectl_server::core::{
    scenario::{run_scenario_suite, ScenarioSuite},
    simulate::prepare_simulation_config,
};

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

/// Run a private suite against a read-only config export and simulated devices.
pub async fn scenario_test(
    source_db: Option<String>,
    config_export: Option<PathBuf>,
    scenarios: Option<PathBuf>,
) -> Result<(), String> {
    if source_db.is_some() && config_export.is_some() {
        return Err("choose either --source-db or --config-export, not both".to_string());
    }

    let source_db = if config_export.is_some() {
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
    if source_db.is_none() && config_export.is_none() {
        return Err(
            "no configuration source found; provide --source-db, --config-export, DATABASE_URL, or ./homectl.db"
                .to_string(),
        );
    }

    let scenario_path = scenarios.unwrap_or_else(default_scenario_path);
    let scenario_text = fs::read_to_string(&scenario_path).map_err(|error| {
        format!(
            "could not read private scenario suite at {}: {error}",
            scenario_path.display()
        )
    })?;
    let suite: ScenarioSuite = serde_json::from_str(&scenario_text).map_err(|error| {
        format!(
            "invalid scenario suite at {}: {error}",
            scenario_path.display()
        )
    })?;

    let config = prepare_simulation_config(
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
    })?;
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

fn default_scenario_path() -> PathBuf {
    let config_home = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    config_home.join("homectl").join("scenarios.json")
}
