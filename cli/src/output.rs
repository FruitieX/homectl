use std::fmt;

use clap::ValueEnum;

#[derive(Clone, ValueEnum)]
pub enum Format {
    Table,
    Json,
    Compact,
}

impl fmt::Display for Format {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Format::Table => write!(f, "table"),
            Format::Json => write!(f, "json"),
            Format::Compact => write!(f, "compact"),
        }
    }
}

pub fn print_json(value: &serde_json::Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
    );
}

pub fn print_devices_table(devices: &[serde_json::Value]) {
    use tabled::{Table, Tabled};

    #[derive(Tabled)]
    struct DeviceRow {
        #[tabled(rename = "ID")]
        id: String,
        #[tabled(rename = "Name")]
        name: String,
        #[tabled(rename = "Integration")]
        integration: String,
        #[tabled(rename = "Type")]
        device_type: String,
        #[tabled(rename = "State")]
        state: String,
    }

    let rows: Vec<DeviceRow> = devices
        .iter()
        .map(|d| {
            let id = d["id"].as_str().unwrap_or("-").to_string();
            let name = d["name"].as_str().unwrap_or("-").to_string();
            let integration = d["integration_id"].as_str().unwrap_or("-").to_string();

            let (device_type, state) = if let Some(data) = d.get("data") {
                if let Some(controllable) = data.get("Controllable") {
                    let s = &controllable["state"];
                    let power = if s["power"].as_bool().unwrap_or(false) {
                        "ON"
                    } else {
                        "OFF"
                    };
                    let brightness = s["brightness"]
                        .as_f64()
                        .map(|b| format!(" {:.0}%", b * 100.0))
                        .unwrap_or_default();
                    ("Light".to_string(), format!("{power}{brightness}"))
                } else if let Some(sensor) = data.get("Sensor") {
                    let state = format_sensor(sensor);
                    ("Sensor".to_string(), state)
                } else {
                    ("Unknown".to_string(), "-".to_string())
                }
            } else {
                ("Unknown".to_string(), "-".to_string())
            };

            DeviceRow {
                id,
                name,
                integration,
                device_type,
                state,
            }
        })
        .collect();

    if rows.is_empty() {
        println!("No devices found.");
        return;
    }

    println!("{}", Table::new(rows));
}

pub fn print_config_table(kind: &str, items: &[serde_json::Value]) {
    use tabled::{Table, Tabled};

    #[derive(Tabled)]
    struct Row {
        #[tabled(rename = "ID")]
        id: String,
        #[tabled(rename = "Name")]
        name: String,
        #[tabled(rename = "Details")]
        details: String,
    }

    let rows: Vec<Row> = items
        .iter()
        .map(|item| {
            let id = item["id"].as_str().unwrap_or("-").to_string();
            let name = item["name"]
                .as_str()
                .unwrap_or(item["plugin"].as_str().unwrap_or("-"))
                .to_string();
            let details = match kind {
                "integrations" => item["plugin"]
                    .as_str()
                    .map(|p| format!("plugin={p}"))
                    .unwrap_or_default(),
                "groups" => {
                    let device_count = item["devices"]
                        .as_array()
                        .map(|a| a.len())
                        .unwrap_or(0);
                    let link_count = item["links"]
                        .as_array()
                        .map(|a| a.len())
                        .unwrap_or(0);
                    format!("{device_count} devices, {link_count} links")
                }
                "scenes" => {
                    let device_count = item["devices"]
                        .as_object()
                        .map(|o| o.len())
                        .or_else(|| item["devices"].as_array().map(|a| a.len()))
                        .unwrap_or(0);
                    format!("{device_count} device configs")
                }
                "routines" => {
                    let rule_count = item["rules"]
                        .as_array()
                        .map(|a| a.len())
                        .unwrap_or(0);
                    let action_count = item["actions"]
                        .as_array()
                        .map(|a| a.len())
                        .unwrap_or(0);
                    format!("{rule_count} rules, {action_count} actions")
                }
                _ => String::new(),
            };

            Row { id, name, details }
        })
        .collect();

    if rows.is_empty() {
        println!("No {kind} found.");
        return;
    }

    println!("{}", Table::new(rows));
}

fn format_sensor(sensor: &serde_json::Value) -> String {
    if let Some(obj) = sensor.get("Boolean") {
        format!(
            "{}",
            obj["value"].as_bool().unwrap_or(false)
        )
    } else if let Some(obj) = sensor.get("Number") {
        format!(
            "{}",
            obj["value"].as_f64().unwrap_or(0.0)
        )
    } else if let Some(obj) = sensor.get("Text") {
        obj["value"].as_str().unwrap_or("-").to_string()
    } else if sensor.get("Color").is_some() {
        "Color sensor".to_string()
    } else {
        format!("{sensor}")
    }
}
