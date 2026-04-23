use crate::core::snapshot::SnapshotHandle;
use cached::proc_macro::cached;
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use ical::parser::ical::component::IcalEvent;
use ical::property::Property;
use serde_json::{json, Value};
use warp::{
    filters::BoxedFilter,
    http::StatusCode,
    reply::{self, Response},
    Filter, Reply,
};

use super::{widget_setting_string_or_env, CALENDAR_SETTING_KEY, ICS_URL_FIELD};

pub fn route(snapshot: SnapshotHandle, http: reqwest::Client) -> BoxedFilter<(Response,)> {
    warp::path!("api" / "calendar")
        .and(warp::get())
        .and_then(move || {
            let snapshot = snapshot.clone();
            let http = http.clone();
            async move { Ok::<_, warp::Rejection>(handle(snapshot, http).await) }
        })
        .boxed()
}

async fn handle(snapshot: SnapshotHandle, http: reqwest::Client) -> Response {
    let url = match widget_setting_string_or_env(
        &snapshot.load().runtime_config.widget_settings,
        CALENDAR_SETTING_KEY,
        ICS_URL_FIELD,
        "GOOGLE_CALENDAR_ICS_URL",
    ) {
        Some(url) => url,
        None => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Calendar ICS URL not configured",
            )
        }
    };

    let result = fetch_calendar(url, http).await;

    match result {
        Ok(value) => reply::json(&value).into_response(),
        Err(err) => {
            log::error!("Error fetching calendar events: {err}");
            error(StatusCode::BAD_GATEWAY, "Failed to fetch calendar events")
        }
    }
}

#[cached(
    result = true,
    time = 14400,
    key = "String",
    convert = r#"{ url.clone() }"#,
    sync_writes = "by_key"
)]
async fn fetch_calendar(url: String, http: reqwest::Client) -> Result<Value, String> {
    let res = http.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to fetch ICS: {}", res.status()));
    }
    let body = res.text().await.map_err(|e| e.to_string())?;
    parse_events(&body).map_err(|e| e.to_string())
}
fn error(status: StatusCode, message: &str) -> Response {
    reply::with_status(reply::json(&json!({ "error": message })), status).into_response()
}

fn parse_events(ics: &str) -> Result<Value, String> {
    let reader = ical::IcalParser::new(ics.as_bytes());

    let now = Local::now();
    let start_of_day = Local
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .single()
        .ok_or_else(|| "Failed to compute start of day".to_string())?;
    let end_of_day = start_of_day + chrono::Duration::days(1);

    let start_utc = start_of_day.with_timezone(&Utc);
    let end_utc = end_of_day.with_timezone(&Utc);

    let mut events: Vec<OutEvent> = Vec::new();

    for calendar in reader {
        let calendar = calendar.map_err(|e| format!("ICS parse error: {e:?}"))?;
        for event in calendar.events {
            if let Some(out) = convert_event(&event, start_utc, end_utc) {
                events.push(out);
            }
        }
    }

    events.sort_by(|a, b| a.start.cmp(&b.start));
    events.truncate(10);

    let events: Vec<Value> = events
        .into_iter()
        .map(|e| {
            json!({
                "id": e.id,
                "summary": e.summary,
                "start": e.start.to_rfc3339(),
                "end": e.end.to_rfc3339(),
                "description": e.description,
                "location": e.location,
                "isAllDay": e.is_all_day,
            })
        })
        .collect();

    Ok(json!({ "events": events }))
}

struct OutEvent {
    id: String,
    summary: String,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    description: Option<String>,
    location: Option<String>,
    is_all_day: bool,
}

fn convert_event(
    event: &IcalEvent,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Option<OutEvent> {
    let uid = property(event, "UID")
        .and_then(|p| p.value.clone())
        .unwrap_or_else(|| format!("{:x}", rand::random::<u64>()));
    let summary = property_text(event, "SUMMARY").unwrap_or_else(|| "No Title".to_string());
    let description = property_text(event, "DESCRIPTION");
    let location = property_text(event, "LOCATION");

    let dtstart = property(event, "DTSTART")?;
    let dtend = property(event, "DTEND");

    let (start, start_is_date) = parse_datetime(dtstart)?;
    let (end, _) = dtend
        .and_then(parse_datetime)
        .unwrap_or((start, start_is_date));

    // Happens-today check mirrors the previous Next.js logic: event overlaps
    // [startOfDay, endOfDay).
    if !(start < window_end && end > window_start) {
        return None;
    }

    Some(OutEvent {
        id: uid,
        summary,
        start,
        end,
        description,
        location,
        is_all_day: start_is_date,
    })
}

fn property<'a>(event: &'a IcalEvent, name: &str) -> Option<&'a Property> {
    event.properties.iter().find(|p| p.name == name)
}

fn property_text(event: &IcalEvent, name: &str) -> Option<String> {
    property(event, name)
        .and_then(|p| p.value.as_deref())
        .map(unescape_ical_text)
}

fn unescape_ical_text(value: &str) -> String {
    let mut unescaped = String::with_capacity(value.len());
    let mut chars = value.chars();

    while let Some(ch) = chars.next() {
        if ch != '\\' {
            unescaped.push(ch);
            continue;
        }

        match chars.next() {
            Some('n' | 'N') => unescaped.push('\n'),
            Some('\\') => unescaped.push('\\'),
            Some(',') => unescaped.push(','),
            Some(';') => unescaped.push(';'),
            Some(other) => unescaped.push(other),
            None => unescaped.push('\\'),
        }
    }

    unescaped
}

fn parse_datetime(prop: &Property) -> Option<(DateTime<Utc>, bool)> {
    let raw = prop.value.as_deref()?;
    let is_date = prop
        .params
        .as_ref()
        .into_iter()
        .flatten()
        .any(|(name, values)| name == "VALUE" && values.iter().any(|v| v == "DATE"));

    if is_date || raw.len() == 8 {
        let date = NaiveDate::parse_from_str(raw, "%Y%m%d").ok()?;
        let dt = Local
            .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
            .single()?;
        return Some((dt.with_timezone(&Utc), true));
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some((dt.with_timezone(&Utc), false));
    }

    if let Some(rest) = raw.strip_suffix('Z') {
        let naive = chrono::NaiveDateTime::parse_from_str(rest, "%Y%m%dT%H%M%S").ok()?;
        return Some((Utc.from_utc_datetime(&naive), false));
    }

    let naive = chrono::NaiveDateTime::parse_from_str(raw, "%Y%m%dT%H%M%S").ok()?;
    let local = Local.from_local_datetime(&naive).single()?;
    Some((local.with_timezone(&Utc), false))
}

#[cfg(test)]
mod tests {
    use super::unescape_ical_text;

    #[test]
    fn unescapes_ical_text_sequences() {
        assert_eq!(
            unescape_ical_text(
                r#"Ida byteskläder (skjorta\, byxor\, strumpor)\nExtra\\info\;done"#
            ),
            "Ida byteskläder (skjorta, byxor, strumpor)\nExtra\\info;done"
        );
    }
}
