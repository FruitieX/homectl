use crate::homectl_core::{device::Device, events::TxEventChannel, integration::{Integration, IntegrationId}};
use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{Datelike, Weekday};
use serde::Deserialize;
use crate::utils::from_hh_mm;

mod api;

use api::clean_house;

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
    dummy: bool
}

pub struct Neato {
  config: NeatoConfig,

  // TODO: persist this in db
  prev_run: Option<chrono::NaiveDateTime>
}

#[async_trait]
impl Integration for Neato {
    fn new(_id: &IntegrationId, config: &config::Value, _: TxEventChannel) -> Result<Neato> {
        let config = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Neato integration")?;
        Ok(Neato { config, prev_run: None })
    }

    async fn register(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    async fn start(&mut self) -> anyhow::Result<()> {
        Ok(())
    }

    async fn set_integration_device_state(&mut self, _: &Device) -> Result<()> {
        Ok(())
    }

    async fn run_integration_action(&mut self, payload: &crate::homectl_core::integration::IntegrationActionPayload) -> Result<()> {
      if payload == "clean_house" {
        let local = chrono::Local::now().naive_local();

        let weekday = local.weekday();

        if !self.config.cleaning_days.contains(&weekday) {
          println!("Skipping cleaning due to wrong weekday");
          return Ok(())
        }

        if !(self.config.cleaning_time_start..self.config.cleaning_time_end).contains(&local.time()) {
          println!("Skipping cleaning due to wrong time of day");
          return Ok(())
        }

        if let Some(prev_run) = self.prev_run {
          if prev_run.num_days_from_ce() == local.num_days_from_ce() {
            println!("Skipping cleaning due to previous run being today");
            return Ok(())
          }
        }

        let result = clean_house(&self.config).await;
        self.prev_run = Some(local);
        result
      } else {
        Ok(())
      }
    }
}
