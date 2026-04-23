pub mod actor;
pub mod command;

pub use actor::IntegrationHandle;

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
use std::collections::HashMap;

pub type CustomIntegrationsMap = HashMap<IntegrationId, IntegrationHandle>;

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

        let handle = IntegrationHandle::new(
            integration,
            integration_id.clone(),
            module_name.to_string(),
            config.clone(),
        );

        self.custom_integrations
            .insert(integration_id.clone(), handle);

        Ok(())
    }

    pub async fn run_register_pass(&self) -> Result<()> {
        for (integration_id, handle) in self.custom_integrations.iter() {
            handle.register().await?;
            info!(
                "registered {} integration {}",
                handle.module_name, integration_id
            );
        }

        Ok(())
    }

    pub async fn run_start_pass(&self) -> Result<()> {
        for (integration_id, handle) in self.custom_integrations.iter() {
            handle.start().await?;
            info!(
                "started {} integration {}",
                handle.module_name, integration_id
            );
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

        let handle = self
            .custom_integrations
            .get(&device.integration_id)
            .ok_or_else(|| {
                eyre!(
                    "Expected to find integration by id {}",
                    device.integration_id
                )
            })?;

        handle.set_device_state(device);
        Ok(())
    }

    pub async fn run_integration_action(
        &self,
        integration_id: &IntegrationId,
        payload: &IntegrationActionPayload,
    ) -> Result<()> {
        let handle = self
            .custom_integrations
            .get(integration_id)
            .ok_or_else(|| eyre!("Expected to find integration by id {integration_id}"))?;

        handle.run_action(payload.clone());
        Ok(())
    }

    pub async fn load_config_rows(
        &mut self,
        integrations: &[config_queries::IntegrationRow],
    ) -> Result<()> {
        for row in integrations {
            if !row.enabled {
                continue;
            }

            let integration_id = IntegrationId::from(row.id.clone());

            if self.custom_integrations.contains_key(&integration_id) {
                debug!("Integration {} already loaded, skipping", integration_id);
                continue;
            }

            match self
                .load_integration(&row.plugin, &integration_id, &row.config, &self.cli.clone())
                .await
            {
                Ok(()) => {
                    info!(
                        "Loaded integration {} (plugin: {}) from config rows",
                        integration_id, row.plugin
                    );
                }
                Err(e) => {
                    error!(
                        "Failed to load integration {} from config rows: {e}",
                        integration_id
                    );
                }
            }
        }

        Ok(())
    }

    /// Load integrations from the database.
    pub async fn load_db_integrations(&mut self) -> Result<()> {
        let db_integrations = config_queries::db_get_integrations().await?;
        self.load_config_rows(&db_integrations).await
    }

    /// Full diff-based reload from config rows: add new, remove deleted, restart modified.
    /// Returns the IDs of integrations that were removed.
    pub async fn reload_config_rows(
        &mut self,
        integrations: &[config_queries::IntegrationRow],
    ) -> Result<Vec<IntegrationId>> {
        let mut removed_ids = Vec::new();

        let desired: HashMap<IntegrationId, _> = integrations
            .iter()
            .filter(|row| row.enabled)
            .cloned()
            .map(|row| (IntegrationId::from(row.id.clone()), row))
            .collect();

        let current_ids: Vec<IntegrationId> = self.custom_integrations.keys().cloned().collect();
        for id in &current_ids {
            if !desired.contains_key(id) {
                if let Some(handle) = self.custom_integrations.remove(id) {
                    info!("Stopping removed integration {}", id);
                    if let Err(e) = handle.stop().await {
                        warn!("Error stopping integration {}: {e}", id);
                    }
                    removed_ids.push(id.clone());
                    // Dropping the handle here closes this clone's
                    // sender; the actor task exits once the last
                    // sender (held by the state actor's copy of the
                    // map) is also dropped after commit.
                    drop(handle);
                }
            }
        }

        for (id, row) in &desired {
            if let Some(existing) = self.custom_integrations.get(id) {
                if existing.module_name != row.plugin || existing.config != row.config {
                    info!("Restarting modified integration {}", id);
                    if let Some(handle) = self.custom_integrations.remove(id) {
                        if let Err(e) = handle.stop().await {
                            warn!("Error stopping integration {}: {e}", id);
                        }
                        drop(handle);
                    }

                    match self
                        .load_integration(&row.plugin, id, &row.config, &self.cli.clone())
                        .await
                    {
                        Ok(()) => {
                            if let Some(handle) = self.custom_integrations.get(id) {
                                let _ = handle.register().await;
                                let _ = handle.start().await;
                            }
                            info!("Restarted integration {} (plugin: {})", id, row.plugin);
                        }
                        Err(e) => {
                            error!("Failed to restart integration {}: {e}", id);
                        }
                    }
                }
            } else {
                match self
                    .load_integration(&row.plugin, id, &row.config, &self.cli.clone())
                    .await
                {
                    Ok(()) => {
                        if let Some(handle) = self.custom_integrations.get(id) {
                            let _ = handle.register().await;
                            let _ = handle.start().await;
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

    /// Full diff-based reload: add new, remove deleted, restart modified integrations.
    /// Returns the IDs of integrations that were removed.
    pub async fn reload_integrations(&mut self) -> Result<Vec<IntegrationId>> {
        let db_integrations = config_queries::db_get_integrations().await?;
        self.reload_config_rows(&db_integrations).await
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
        "random" => Ok(Box::new(Random::new(id, config, cli, event_tx)?)),
        "dummy" => Ok(Box::new(Dummy::new(id, config, cli, event_tx)?)),
        "mqtt" => Ok(Box::new(Mqtt::new(id, config, cli, event_tx)?)),
        "timer" => Ok(Box::new(Timer::new(id, config, cli, event_tx)?)),
        "cron" => Ok(Box::new(Cron::new(id, config, cli, event_tx)?)),
        _ => Err(eyre!("Unknown module name: {module_name}")),
    }
}
