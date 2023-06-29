use crate::types::{
    custom_integration::CustomIntegration,
    device::Device,
    event::TxEventChannel,
    integration::{IntegrationActionPayload, IntegrationId},
};
use crate::{
    db::actions::{db_get_neato_last_run, db_set_neato_last_run},
    utils::from_hh_mm,
};
use async_trait::async_trait;
use chrono::{Datelike, Weekday};
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;

mod api;

use api::clean_house;

use self::api::RobotCmd;

#[derive(Clone, Debug, Deserialize)]
pub struct NeatoConfig {
    email: String,
    password: String,

    /// Only clean on these days
    cleaning_days: Vec<Weekday>,

    /// Earliest possible time when cleaning is allowed to start
    #[serde(deserialize_with = "from_hh_mm")]
    cleaning_time_start: chrono::NaiveTime,

    /// Latest possible time when cleaning is allowed to start
    #[serde(deserialize_with = "from_hh_mm")]
    cleaning_time_end: chrono::NaiveTime,

    /// If set to true, will request robot info instead of sending start cleaning command
    dummy: bool,
}

pub struct Neato {
    integration_id: IntegrationId,

    config: NeatoConfig,

    prev_run: Option<chrono::NaiveDateTime>,
}

#[async_trait]
impl CustomIntegration for Neato {
    fn new(
        integration_id: &IntegrationId,
        config: &config::Value,
        _: TxEventChannel,
    ) -> Result<Neato> {
        let config = config
            .clone()
            .try_deserialize()
            .wrap_err("Failed to deserialize config of Neato integration")?;
        Ok(Neato {
            integration_id: integration_id.clone(),
            config,
            prev_run: None,
        })
    }

    async fn register(&mut self) -> color_eyre::Result<()> {
        let prev_run = db_get_neato_last_run(&self.integration_id).await;

        if let Ok(prev_run) = prev_run {
            self.prev_run = Some(prev_run);
        }

        Ok(())
    }

    async fn start(&mut self) -> color_eyre::Result<()> {
        Ok(())
    }

    async fn set_integration_device_state(&mut self, _: &Device) -> Result<()> {
        Ok(())
    }

    async fn run_integration_action(&mut self, payload: &IntegrationActionPayload) -> Result<()> {
        match payload.to_string().as_str() {
            "clean_house" | "clean_house_force" => {
                let force = payload.to_string() == "clean_house_force";
                let local = chrono::Local::now().naive_local();

                if !(self.config.cleaning_time_start..self.config.cleaning_time_end)
                    .contains(&local.time())
                {
                    info!("Skipping cleaning due to wrong time of day");
                    return Ok(());
                }

                if !force && !self.config.dummy {
                    let weekday = local.weekday();

                    if !self.config.cleaning_days.contains(&weekday) {
                        info!("Skipping cleaning due to wrong weekday");
                        return Ok(());
                    }

                    if !(self.config.cleaning_time_start..self.config.cleaning_time_end)
                        .contains(&local.time())
                    {
                        info!("Skipping cleaning due to wrong time of day");
                        return Ok(());
                    }

                    if let Some(prev_run) = self.prev_run {
                        if prev_run.num_days_from_ce() == local.num_days_from_ce() {
                            info!("Skipping cleaning due to previous run being today");
                            return Ok(());
                        }
                    }
                }

                self.prev_run = Some(local);
                let result = clean_house(&self.config, &RobotCmd::StartCleaning).await;

                db_set_neato_last_run(&self.integration_id, local)
                    .await
                    .ok();

                result
            }
            "stop_cleaning" => clean_house(&self.config, &RobotCmd::StopCleaning).await,
            _ => Ok(()),
        }
    }
}
