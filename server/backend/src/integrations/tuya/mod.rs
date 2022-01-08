use anyhow::{anyhow, Context, Result};
use async_std::sync::Mutex;
use async_std::task;
use async_std::{stream, task::JoinHandle};
use async_trait::async_trait;
use futures::StreamExt;
use homectl_types::device::CorrelatedColorTemperature;
use homectl_types::{
    device::{Device, DeviceId, DeviceState, Light},
    event::{Message, TxEventChannel},
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use palette::Hsv;
use rust_tuyapi::{tuyadevice::TuyaDevice, Payload, PayloadStruct};
use serde::Deserialize;
use serde_json::{json, Value};
use std::ops::Range;
use std::{
    collections::HashMap,
    net::IpAddr,
    str::FromStr,
    sync::Arc,
    time::{Duration, SystemTime},
};

#[derive(Clone, Debug, Deserialize)]
pub struct TuyaDeviceConfig {
    name: String,
    local_key: String,
    ip: String,
    power_on_field: String,
    brightness_field: String,
    color_temp_field: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TuyaConfig {
    devices: HashMap<DeviceId, TuyaDeviceConfig>,
}

type DeviceMutex = Arc<Mutex<()>>;

pub struct Tuya {
    id: IntegrationId,
    event_tx: TxEventChannel,
    config: TuyaConfig,
    device_mutexes: HashMap<DeviceId, DeviceMutex>,
    poll_handle: Option<JoinHandle<()>>,
}

#[async_trait]
impl Integration for Tuya {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Dummy integration")?;

        Ok(Tuya {
            id: id.clone(),
            config,
            event_tx,
            device_mutexes: HashMap::new(),
            poll_handle: None,
        })
    }

    async fn register(&mut self) -> Result<()> {
        self.device_mutexes = self
            .config
            .devices
            .keys()
            .map(|device_id| (device_id.clone(), Arc::new(Mutex::new(()))))
            .collect();

        for (device_id, device_config) in &self.config.devices {
            let device_mutex = self
                .device_mutexes
                .entry(device_id.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())));

            let device = get_tuya_state(device_id, &self.id, device_config, device_mutex).await?;

            self.event_tx
                .send(Message::IntegrationDeviceRefresh { device });
        }

        println!("registered tuya integration {}", self.id);

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("starting tuya integration {}", self.id);

        // let current_time = SystemTime::now()
        //     .duration_since(SystemTime::UNIX_EPOCH)
        //     .unwrap()
        //     .as_secs() as u32;

        // // Create a TuyaDevice, this is the type used to set/get status to/from a Tuya compatible
        // // device.
        // let tuya_device = TuyaDevice::create(
        //     "3.3",
        //     Some("6b1c2505fbff4edc"),
        //     IpAddr::from_str("192.168.1.210").unwrap(),
        // )?;

        // // Create the payload to be sent, this will be serialized to the JSON format
        // let payload = Payload::Struct(PayloadStruct {
        //     dev_id: "17862520c82b966b102f".to_string(),
        //     gw_id: Some("17862520c82b966b102f".to_string()),
        //     uid: Some("17862520c82b966b102f".to_string()),
        //     t: Some(current_time),
        //     dp_id: None,
        //     dps: Some(HashMap::new()),
        // });

        // dbg!(tuya_device.get(payload, 0))?;

        // let mut dps = HashMap::new();
        // dps.insert("22".to_string(), json!(10));

        // // Create the payload to be sent, this will be serialized to the JSON format
        // let payload = Payload::Struct(PayloadStruct {
        //     dev_id: "17862520c82b966b102f".to_string(),
        //     gw_id: None,
        //     uid: Some("17862520c82b966b102f".to_string()),
        //     t: Some(current_time),
        //     dp_id: None,
        //     dps: Some(dps),
        // });

        // dbg!(tuya_device.set(payload, 0))?;

        // tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        // let mut dps = HashMap::new();
        // dps.insert("22".to_string(), json!(10));

        // let payload = Payload::Struct(PayloadStruct {
        //     dev_id: "17862520c82b966b102f".to_string(),
        //     gw_id: None,
        //     uid: Some("17862520c82b966b102f".to_string()),
        //     t: Some(current_time),
        //     dp_id: None,
        //     dps: Some(dps),
        // });

        // dbg!(tuya_device.set(payload, 2))?;

        // Set the payload state on the Tuya device, an error here will contain
        // the error message received from the device.
        // tuya_device.set(payload, 1)?;

        let config = self.config.clone();
        let integration_id = self.id.clone();
        let sender = self.event_tx.clone();
        let device_mutexes = self.device_mutexes.clone();

        self.poll_handle = Some(task::spawn(async {
            poll_lights(config, integration_id, sender, device_mutexes).await
        }));

        println!("started tuya integration {}", self.id);

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        if let Some(poll_handle) = self.poll_handle.take() {
            poll_handle.cancel().await;
        }

        let config = self.config.clone();
        let integration_id = self.id.clone();
        let sender = self.event_tx.clone();
        let device_mutexes = self.device_mutexes.clone();

        self.poll_handle = Some(task::spawn(async {
            poll_lights(config, integration_id, sender, device_mutexes).await
        }));

        let device_config = self.config.devices.get(&device.id).context(format!(
            "Could not find TuyaDeviceConfig for device with id {}",
            device.id,
        ))?;
        let device_mutex = self
            .device_mutexes
            .entry(device.id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())));
        set_tuya_state(device, device_config, device_mutex).await?;
        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug)]
struct TuyaState {
    power_on: bool,
    brightness: u32,
    color_temperature: u32,
}

fn to_tuya_state(device: &Device) -> Result<TuyaState> {
    let light_state = match device.state {
        DeviceState::Light(Light {
            brightness,
            color,
            power,
            transition_ms,
            ref cct,
        }) => Ok(Light {
            power,
            brightness,
            color,
            transition_ms,
            cct: cct.clone(),
        }),
        _ => Err(anyhow!("Unsupported device state")),
    }?;

    let color = light_state.color.unwrap_or_else(|| Hsv::new(0.0, 1.0, 1.0));

    let brightness = light_state.brightness.unwrap_or(1.0) * color.value;

    // Brightness goes from 10 to 1000 ¯\_(ツ)_/¯
    let brightness = f32::floor(brightness * 990.0) as u32 + 10;

    let cct = light_state.cct.map(|cct| cct.get_cct()).unwrap_or(4000.0);

    // Range of my bulbs is from 2700K - 4100K (and they express this as a
    // 0-1000 range), this is very likely not true for all Tuya bulbs
    let min_supported_temp = 2700.0;
    let max_supported_temp = 4100.0;

    // Scale the value into 0.0 - 1.0 range
    let q = (cct - min_supported_temp) / (max_supported_temp - min_supported_temp);
    let q = q.clamp(0.0, 1.0);

    // Scale the value into 0 - 1000 range
    let color_temperature = f32::floor(q * 1000.0) as u32;

    let state = TuyaState {
        power_on: light_state.power,
        brightness,
        color_temperature,
    };

    Ok(state)
}

async fn set_tuya_state(
    device: &Device,
    device_config: &TuyaDeviceConfig,
    device_mutex: &DeviceMutex,
) -> Result<()> {
    let device_mutex = device_mutex.lock().await;
    let tuya_state = to_tuya_state(device)?;

    let current_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs() as u32;

    // Create a TuyaDevice, this is the type used to set/get status to/from a Tuya compatible
    // device.
    let tuya_device = TuyaDevice::create(
        "3.3",
        Some(&device_config.local_key),
        IpAddr::from_str(&device_config.ip).unwrap(),
    )?;

    let mut dps = HashMap::new();
    dps.insert(
        device_config.power_on_field.clone(),
        json!(tuya_state.power_on),
    );
    dps.insert(
        device_config.brightness_field.clone(),
        json!(tuya_state.brightness),
    );
    dps.insert(
        device_config.color_temp_field.clone(),
        json!(tuya_state.color_temperature),
    );

    // Create the payload to be sent, this will be serialized to the JSON format
    let payload = Payload::Struct(PayloadStruct {
        dev_id: device.id.to_string(),
        // gw_id: None,
        gw_id: Some(device.id.to_string()),
        uid: Some(device.id.to_string()),
        t: Some(current_time),
        dp_id: None,
        dps: Some(dps),
    });

    tuya_device.set(payload, 0)?;

    drop(device_mutex);

    Ok(())
}

async fn get_tuya_state(
    device_id: &DeviceId,
    integration_id: &IntegrationId,
    device_config: &TuyaDeviceConfig,
    device_mutex: &DeviceMutex,
) -> Result<Device> {
    let device_mutex = device_mutex.lock().await;
    let current_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs() as u32;

    // Create a TuyaDevice, this is the type used to set/get status to/from a Tuya compatible
    // device.
    let tuya_device = TuyaDevice::create(
        "3.3",
        Some(&device_config.local_key),
        IpAddr::from_str(&device_config.ip).unwrap(),
    )?;

    // Create the payload to be sent, this will be serialized to the JSON format
    let payload = Payload::Struct(PayloadStruct {
        dev_id: device_id.to_string(),
        gw_id: Some(device_id.to_string()),
        uid: Some(device_id.to_string()),
        t: Some(current_time),
        dp_id: None,
        dps: Some(HashMap::new()),
    });

    let response = tuya_device.get(payload, 0)?;

    drop(device_mutex);

    let first = response
        .first()
        .context("Could not find valid Tuya Message in response")?;

    if let Payload::Struct(PayloadStruct { dps: Some(dps), .. }) = &first.payload {
        let power = if let Some(Value::Bool(value)) = dps.get(&device_config.power_on_field) {
            *value
        } else {
            true
        };

        let brightness =
            if let Some(Value::Number(value)) = dps.get(&device_config.brightness_field) {
                // Brightness goes from 10 to 1000 ¯\_(ツ)_/¯
                let bri = value.as_u64().unwrap_or(1000);

                // Scale range to 0-990
                let bri = bri - 10;

                // Scale range to 0-1
                Some(bri as f32 / 990.0)
            } else {
                None
            };

        let cct = if let Some(Value::Number(value)) = dps.get(&device_config.color_temp_field) {
            // Range of my bulbs is from 2700K - 4100K (and they express this as a
            // 0-1000 range), this is very likely not true for all Tuya bulbs
            let min_supported_temp = 2700.0;
            let max_supported_temp = 4100.0;

            let ct = value.as_u64().unwrap_or(1000);

            // Scale range to 0-1
            let q = ct as f32 / 1000.0;

            let cct = q * (max_supported_temp - min_supported_temp) + min_supported_temp;

            Some(CorrelatedColorTemperature::new(
                cct,
                Range {
                    start: min_supported_temp,
                    end: max_supported_temp,
                },
            ))
        } else {
            None
        };

        let state = DeviceState::Light(Light::new_with_cct(power, brightness, cct, Some(1000)));

        let device = Device {
            id: device_id.clone(),
            name: device_config.name.clone(),
            integration_id: integration_id.clone(),
            scene: None,
            state,
            locked: false,
        };

        Ok(device)
    } else {
        Err(anyhow!("Unsupported Tuya response"))
    }
}

pub async fn do_refresh_lights(
    config: TuyaConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
    device_mutexes: &HashMap<DeviceId, DeviceMutex>,
) -> Result<()> {
    for (device_id, device_config) in &config.devices {
        let device_mutex = device_mutexes.get(device_id).unwrap();
        let device =
            get_tuya_state(device_id, &integration_id, device_config, device_mutex).await?;

        // Tuya devices seem to only be able to handle one TCP connection at once.
        // Keeping track of this using Mutexes seems to not be enough
        async_std::task::sleep(Duration::from_millis(100)).await;

        sender.send(Message::IntegrationDeviceRefresh { device });
    }

    Ok(())
}

pub async fn poll_lights(
    config: TuyaConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
    device_mutexes: HashMap<DeviceId, DeviceMutex>,
) {
    let poll_rate = Duration::from_millis(1000);
    let mut interval = stream::interval(poll_rate);

    loop {
        interval.next().await;

        let sender = sender.clone();
        let result = do_refresh_lights(
            config.clone(),
            integration_id.clone(),
            sender,
            &device_mutexes,
        )
        .await;

        match result {
            Ok(()) => {}
            Err(e) => println!("Error while polling lights: {:?}", e),
        }
    }
}
