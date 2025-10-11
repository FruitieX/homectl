use std::collections::HashMap;

use eyre::Result;

use crate::db::actions::{db_get_ui_state, db_store_ui_state};

#[derive(Clone)]
pub struct Ui {
    ui_state: HashMap<String, serde_json::Value>,
}

impl Ui {
    pub fn new() -> Self {
        Self {
            ui_state: HashMap::new(),
        }
    }

    pub fn get_state(&self) -> &HashMap<String, serde_json::Value> {
        &self.ui_state
    }

    pub async fn store_state(&mut self, key: String, value: serde_json::Value) -> Result<()> {
        if let Err(e) = db_store_ui_state(&key, &value).await {
            // If DB is unavailable, continue and keep memory-only state
            warn!("DB not available when storing UI state '{key}': {e}");
        }
        self.ui_state.insert(key, value);

        Ok(())
    }

    pub async fn refresh_db_state(&mut self) {
        self.ui_state = db_get_ui_state().await.unwrap_or_default();
    }
}
