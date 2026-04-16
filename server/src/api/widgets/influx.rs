//! Minimal InfluxDB v2 Flux query client returning rows as JSON objects.
//!
//! The previous Next.js handlers used the official `@influxdata/influxdb-client`
//! JS library which POSTs Flux to `/api/v2/query` and yields annotated CSV.
//! This module mirrors that behaviour — annotation rows (`#group`, `#datatype`,
//! `#default`) are parsed to infer numeric vs textual columns, then data rows
//! are emitted as JSON with typed `_value` fields.

use serde_json::{Map, Value};

pub async fn query(
    http: &reqwest::Client,
    url: &str,
    token: &str,
    flux: &str,
) -> Result<Vec<Value>, String> {
    let endpoint = format!(
        "{}/api/v2/query?org=influxdata",
        url.trim_end_matches('/')
    );
    let res = http
        .post(endpoint)
        .header("Authorization", format!("Token {token}"))
        .header("Content-Type", "application/vnd.flux")
        .header("Accept", "application/csv")
        .body(flux.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("InfluxDB query failed: {status}: {body}"));
    }

    let body = res.text().await.map_err(|e| e.to_string())?;
    parse_annotated_csv(&body)
}

fn parse_annotated_csv(body: &str) -> Result<Vec<Value>, String> {
    let mut rows: Vec<Value> = Vec::new();
    let mut datatypes: Vec<String> = Vec::new();
    let mut headers: Vec<String> = Vec::new();

    for raw_line in body.split('\n') {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            datatypes.clear();
            headers.clear();
            continue;
        }

        let fields = parse_csv_line(line);

        if let Some(first) = fields.first() {
            if first.starts_with('#') {
                if first == "#datatype" {
                    datatypes = fields[1..].to_vec();
                }
                continue;
            }
        }

        if headers.is_empty() {
            headers = fields.iter().skip(1).cloned().collect();
            continue;
        }

        let values = &fields[1..];
        let mut obj = Map::new();
        for (idx, header) in headers.iter().enumerate() {
            if header == "result" || header == "table" {
                continue;
            }
            let raw = values.get(idx).map(String::as_str).unwrap_or("");
            let dtype = datatypes.get(idx + 1).map(String::as_str).unwrap_or("string");
            obj.insert(header.clone(), coerce(raw, dtype));
        }
        rows.push(Value::Object(obj));
    }

    Ok(rows)
}

fn coerce(raw: &str, datatype: &str) -> Value {
    match datatype {
        "double" | "long" | "unsignedLong" => raw
            .parse::<f64>()
            .map(|n| {
                serde_json::Number::from_f64(n)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            })
            .unwrap_or(Value::Null),
        "boolean" => match raw {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => Value::Null,
        },
        _ => Value::String(raw.to_string()),
    }
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                out.push(std::mem::take(&mut current));
            }
            other => current.push(other),
        }
    }
    out.push(current);
    out
}
