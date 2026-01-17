use crate::db::config_queries;
use crate::integrations::cron::Cron;
use crate::integrations::{
    circadian::Circadian, dummy::Dummy, mqtt::Mqtt, random::Random, timer::Timer,
};
use crate::types::{
    device::Device,
    event::TxEventChannel,
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use crate::utils::cli::Cli;
use color_eyre::Result;
use eyre::eyre;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct LoadedIntegration {
    integration: Arc<Mutex<Box<dyn Integration>>>,
    module_name: String,
    config: serde_json::Value,
}

pub type CustomIntegrationsMap = HashMap<IntegrationId, LoadedIntegration>;

#[derive(Clone)]
pub struct Integrations {
    custom_integrations: CustomIntegrationsMap,
    event_tx: TxEventChannel,
    cli: Cli,
}

impl Integrations {
    pub fn new(event_tx: TxEventChannel, cli: &Cli) -> Self {
        Integrations {
            custom_integrations: Default::default(),
            event_tx,
            cli: cli.clone(),
        }
    }

    pub async fn load_integration(
        &mut self,
        module_name: &str,
        integration_id: &IntegrationId,
        config: &serde_json::Value,
        cli: &Cli,
    ) -> Result<()> {
        info!("loading integration with module_name {module_name}");

        let event_tx = self.event_tx.clone();
        let integration =
            load_custom_integration(module_name, integration_id, config, cli, event_tx)?;

        let loaded_integration = LoadedIntegration {
            integration: Arc::new(Mutex::new(integration)),
            module_name: module_name.to_string(),
            config: config.clone(),
        };

        self.custom_integrations
            .insert(integration_id.clone(), loaded_integration);

        Ok(())
    }

    pub async fn run_register_pass(&self) -> Result<()> {
        for (integration_id, li) in self.custom_integrations.iter() {
            let mut integration = li.integration.lock().await;

            integration.register().await.unwrap();
            info!(
                "registered {} integration {}",
                li.module_name, integration_id
            );
        }

        Ok(())
    }

    pub async fn run_start_pass(&self) -> Result<()> {
        for (integration_id, li) in self.custom_integrations.iter() {
            let mut integration = li.integration.lock().await;

            integration.start().await.unwrap();
            info!("started {} integration {}", li.module_name, integration_id);
        }

        Ok(())
    }

    pub async fn set_integration_device_state(&self, device: Device) -> Result<()> {
        if device.is_readonly() {
            debug!(
                "Skipping ReadOnly device {integration_id}/{name} state update: {state}",
                integration_id = device.integration_id,
                name = device.name,
                state = device
                    .get_controllable_state()
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            );
            return Ok(());
        }

        let li = self
            .custom_integrations
            .get(&device.integration_id)
            .ok_or_else(|| {
                eyre!(
                    "Expected to find integration by id {}",
                    device.integration_id
                )
            })?;

        let mut integration = li.integration.lock().await;

        integration
            .set_integration_device_state(&device.clone())
            .await
    }

    pub async fn run_integration_action(
        &self,
        integration_id: &IntegrationId,
        payload: &IntegrationActionPayload,
    ) -> Result<()> {
        let li = self
            .custom_integrations
            .get(integration_id)
            .ok_or_else(|| eyre!("Expected to find integration by id {integration_id}"))?;
        let mut integration = li.integration.lock().await;

        integration.run_integration_action(payload).await
    }

    /// Load integrations from the database.
    pub async fn load_db_integrations(&mut self) -> Result<()> {
        let db_integrations = config_queries::db_get_integrations().await?;

        for row in db_integrations {
            if !row.enabled {
                continue;
            }

            let integration_id = IntegrationId::from(row.id.clone());

            // Skip if already loaded
            if self.custom_integrations.contains_key(&integration_id) {
                debug!(
                    "Integration {} already loaded, skipping",
                    integration_id
                );
                continue;
            }

            // Pass serde_json::Value directly - no conversion needed
            let config_json = row.config.clone();

            match self
                .load_integration(&row.plugin, &integration_id, &config_json, &self.cli.clone())
                .await
            {
                Ok(()) => {
                    info!("Loaded integration {} (plugin: {}) from database", integration_id, row.plugin);
                }
                Err(e) => {
                    error!(
                        "Failed to load integration {} from database: {e}",
                        integration_id
                    );
                }
            }
        }

        Ok(())
    }

    /// Full diff-based reload: add new, remove deleted, restart modified integrations.
    /// Returns the IDs of integrations that were removed.
    pub async fn reload_integrations(&mut self) -> Result<Vec<IntegrationId>> {
        let db_integrations = config_queries::db_get_integrations().await?;
        let mut removed_ids = Vec::new();

        // Build map of desired state from DB
        let desired: HashMap<IntegrationId, _> = db_integrations
            .into_iter()
            .filter(|row| row.enabled)
            .map(|row| (IntegrationId::from(row.id.clone()), row))
            .collect();

        // Find removed integrations (in current map but not desired)
        let current_ids: Vec<IntegrationId> =
            self.custom_integrations.keys().cloned().collect();
        for id in &current_ids {
            if !desired.contains_key(id) {
                if let Some(li) = self.custom_integrations.remove(id) {
                    info!("Stopping removed integration {}", id);
                    let mut integration = li.integration.lock().await;
                    if let Err(e) = integration.stop().await {
                        warn!("Error stopping integration {}: {e}", id);
                    }
                    removed_ids.push(id.clone());
                }
            }
        }

        // Find added and modified integrations
        for (id, row) in &desired {
            if let Some(existing) = self.custom_integrations.get(id) {
                // Check if config or plugin changed
                if existing.module_name != row.plugin || existing.config != row.config {
                    info!("Restarting modified integration {}", id);
                    // Stop old
                    {
                        let mut integration = existing.integration.lock().await;
                        if let Err(e) = integration.stop().await {
                            warn!("Error stopping integration {}: {e}", id);
                        }
                    }
                    self.custom_integrations.remove(id);

                    // Start new
                    match self
                        .load_integration(&row.plugin, id, &row.config, &self.cli.clone())
                        .await
                    {
                        Ok(()) => {
                            if let Some(li) = self.custom_integrations.get(id) {
                                let mut integration = li.integration.lock().await;
                                let _ = integration.register().await;
                                let _ = integration.start().await;
                            }
                            info!("Restarted integration {} (plugin: {})", id, row.plugin);
                        }
                        Err(e) => {
                            error!("Failed to restart integration {}: {e}", id);
                        }
                    }
                }
            } else {
                // New integration
                match self
                    .load_integration(&row.plugin, id, &row.config, &self.cli.clone())
                    .await
                {
                    Ok(()) => {
                        if let Some(li) = self.custom_integrations.get(id) {
                            let mut integration = li.integration.lock().await;
                            let _ = integration.register().await;
                            let _ = integration.start().await;
                        }
                        info!("Added integration {} (plugin: {})", id, row.plugin);
                    }
                    Err(e) => {
                        error!("Failed to add integration {}: {e}", id);
                    }
                }
            }
        }

        Ok(removed_ids)
    }
}

// TODO: Load integrations dynamically as plugins:
// https://michael-f-bryan.github.io/rust-ffi-guide/dynamic_loading.html
fn load_custom_integration(
    module_name: &str,
    id: &IntegrationId,
    config: &serde_json::Value,
    cli: &Cli,
    event_tx: TxEventChannel,
) -> Result<Box<dyn Integration>> {
    match module_name {
        "circadian" => Ok(Box::new(Circadian::new(id, config, cli, event_tx)?)),
        "cron" => Ok(Box::new(Cron::new(id, config, cli, event_tx)?)),
        "random" => Ok(Box::new(Random::new(id, config, cli, event_tx)?)),
        "timer" => Ok(Box::new(Timer::new(id, config, cli, event_tx)?)),
        "dummy" => Ok(Box::new(Dummy::new(id, config, cli, event_tx)?)),
        "mqtt" => Ok(Box::new(Mqtt::new(id, config, cli, event_tx)?)),
        _ => Err(eyre!("Unknown module name {module_name}!")),
    }
}
