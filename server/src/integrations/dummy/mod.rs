use crate::{
    types::{
        color::Capabilities,
        device::{ControllableDevice, Device, DeviceData, DeviceId, ManageKind},
        event::{Event, TxEventChannel},
        integration::{Integration, IntegrationActionPayload, IntegrationId},
    },
    utils::cli::Cli,
};
use async_trait::async_trait;
use color_eyre::Result;
use eyre::Context;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct DummyDeviceConfig {
    name: String,
    init_state: Option<DeviceData>,
}

#[derive(Debug, Deserialize)]
pub struct DummyConfig {
    devices: HashMap<DeviceId, DummyDeviceConfig>,
}

pub struct Dummy {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: DummyConfig,
    devices: HashMap<DeviceId, Device>,
}

#[async_trait]
impl Integration for Dummy {
    fn new(
        id: &IntegrationId,
        config: &serde_json::Value,
        _cli: &Cli,
        event_tx: TxEventChannel,
    ) -> Result<Self> {
        let config: DummyConfig = serde_json::from_value(config.clone())
            .wrap_err("Failed to deserialize config of Dummy integration")?;

        Ok(Dummy {
            id: id.clone(),
            config,
            event_tx,
            devices: HashMap::new(),
        })
    }

    async fn register(&mut self) -> Result<()> {
        for (id, device) in &self.config.devices {
            let state = device
                .init_state
                .clone()
                .unwrap_or(DeviceData::Controllable(ControllableDevice::new(
                    None,
                    false,
                    None,
                    None,
                    None,
                    Capabilities::default(),
                    ManageKind::Full,
                )));

            let device = Device::new(
                self.id.clone(),
                id.clone(),
                device.name.clone(),
                state,
                None,
            );
            self.event_tx.send(Event::ExternalStateUpdate {
                report_retained: false,
                device,
                integration_epoch: None,
            });
        }

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        // do nothing
        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        self.devices.insert(device.id.clone(), device.clone());
        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::device::SensorDevice;
    use serde_json::json;

    #[test]
    fn editor_initial_states_match_dummy_deserialization() {
        let config: DummyConfig = serde_json::from_value(json!({"devices": {
            "omitted": {"name": "Default"},
            "nullable": {"name": "Default", "init_state": null},
            "boolean": {"name": "Boolean", "init_state": {"Sensor": {"value": false, "future": [0, null]}}},
            "number": {"name": "Number", "init_state": {"Sensor": {"value": 0}}},
            "negative": {"name": "Temperature", "init_state": {"Sensor": {"value": -12.5}}},
            "text": {"name": "Text", "init_state": {"Sensor": {"value": ""}}},
            "color": {"name": "Color", "init_state": {"Sensor": {"power": false, "brightness": 0, "color": null, "transition": 0}}},
            "light": {"name": "Light", "init_state": {"Controllable": {"state": {"power": false}, "capabilities": {"brightness": false, "ct": null}}}}
        }})).unwrap();
        let state = |id: &str| &config.devices[&DeviceId::from(id.to_owned())].init_state;
        assert!(state("omitted").is_none());
        assert!(state("nullable").is_none());
        assert!(matches!(
            state("boolean"),
            Some(DeviceData::Sensor(SensorDevice::Boolean { value: false }))
        ));
        assert!(
            matches!(state("number"), Some(DeviceData::Sensor(SensorDevice::Number { value })) if *value == 0.0)
        );
        assert!(
            matches!(state("negative"), Some(DeviceData::Sensor(SensorDevice::Number { value })) if *value == -12.5)
        );
        assert!(
            matches!(state("text"), Some(DeviceData::Sensor(SensorDevice::Text { value })) if value.is_empty())
        );
        assert!(
            matches!(state("color"), Some(DeviceData::Sensor(SensorDevice::Color(value))) if !value.power && value.brightness.unwrap().0 == 0.0)
        );
        assert!(
            matches!(state("light"), Some(DeviceData::Controllable(value)) if !value.state.power)
        );
    }

    #[test]
    fn editor_capabilities_respect_nullable_and_integer_fields() {
        for capabilities in [
            json!({}),
            json!({"brightness": null, "hs": false, "ct": null}),
            json!({"ct": {"start": 1, "end": 65535}}),
        ] {
            assert!(serde_json::from_value::<Capabilities>(capabilities).is_ok());
        }
        for capabilities in [
            json!({"hs": null}),
            json!({"xy": null}),
            json!({"rgb": null}),
            json!({"ct": {"start": 2000.5, "end": 6500}}),
            json!({"ct": {"start": 2000, "end": 65536}}),
        ] {
            assert!(serde_json::from_value::<Capabilities>(capabilities).is_err());
        }
    }
}
