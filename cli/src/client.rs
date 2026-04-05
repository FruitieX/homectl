use reqwest::StatusCode;

pub struct Client {
    http: reqwest::Client,
    base_url: String,
}

impl Client {
    pub fn new(base_url: &str) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    pub async fn get(&self, path: &str) -> Result<serde_json::Value, String> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }

        Ok(body)
    }

    pub async fn put(&self, path: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .http
            .put(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }

        Ok(body)
    }

    pub async fn post(&self, path: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .http
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        if !status.is_success() {
            return Err(format!("HTTP {status}: {body}"));
        }

        Ok(body)
    }

    pub async fn health(&self) -> Result<(bool, bool), String> {
        let live = self
            .http
            .get(format!("{}/health/live", self.base_url))
            .send()
            .await;
        let ready = self
            .http
            .get(format!("{}/health/ready", self.base_url))
            .send()
            .await;

        let live_ok = live.map(|r| r.status() == StatusCode::OK).unwrap_or(false);
        let ready_ok = ready.map(|r| r.status() == StatusCode::OK).unwrap_or(false);

        Ok((live_ok, ready_ok))
    }
}
