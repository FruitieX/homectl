use super::{
    bridge::BridgeSensors,
    sensor_utils::{bridge_sensor_to_device, extrapolate_sensor_updates, find_bridge_sensor},
    HueConfig,
};
use crate::homectl_core::{
    events::{Message, TxEventChannel},
    integration::IntegrationId,
};
use async_std::sync::Mutex;
use std::{error::Error, sync::Arc, time::Duration};
use tokio::time::{interval_at, Instant};

pub struct SensorsState {
    pub bridge_sensors: BridgeSensors,
}

pub async fn do_refresh_sensors(
    config: HueConfig,
    integration_id: IntegrationId,
    sensors_state: Arc<Mutex<SensorsState>>,
    sender: TxEventChannel,
) -> Result<(), Box<dyn Error>> {
    // NOTE: we can't hold onto this mutex lock across the following .await
    // statements
    let prev_bridge_sensors = {
        let sensors_state = sensors_state.lock().await;
        let bridge_sensors = sensors_state.bridge_sensors.clone();
        bridge_sensors
    };

    let result: BridgeSensors = reqwest::get(&format!(
        "http://{}/api/{}/sensors",
        config.addr, config.username
    ))
    .await?
    .json()
    .await?;

    let mut sensors_state = sensors_state.lock().await;
    sensors_state.bridge_sensors = result.clone();

    for (sensor_id, bridge_sensor) in result {
        let prev_bridge_sensor = find_bridge_sensor(&prev_bridge_sensors, &sensor_id);

        let events = extrapolate_sensor_updates(prev_bridge_sensor, bridge_sensor)
            .into_iter()
            .map(|bridge_sensor| Message::IntegrationDeviceRefresh {
                device: bridge_sensor_to_device(
                    sensor_id.clone(),
                    integration_id.clone(),
                    bridge_sensor,
                ),
            });

        for event in events {
            sender.send(event).await;
        }
    }

    Ok(())
}

pub async fn poll_sensors(
    config: HueConfig,
    integration_id: IntegrationId,
    sender: TxEventChannel,
    init_bridge_sensors: BridgeSensors,
) {
    let poll_rate = Duration::from_millis(config.poll_rate_sensors);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    // Stores values from previous iteration, used for later comparisons
    let bridge_sensors: Arc<Mutex<SensorsState>> = Arc::new(Mutex::new(SensorsState {
        bridge_sensors: init_bridge_sensors,
    }));

    loop {
        interval.tick().await;

        let sender = sender.clone();
        let result = do_refresh_sensors(
            config.clone(),
            integration_id.clone(),
            bridge_sensors.clone(),
            sender,
        )
        .await;

        match result {
            Ok(()) => {}
            Err(e) => println!("Error while polling sensors: {:?}", e),
        }
    }
}
