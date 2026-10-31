# OpenMQTTGateway BLE sensor profile

The `mqtt` integration's `mode: "openmqttgateway"` turns BLE climate sensors
decoded by [OpenMQTTGateway](https://docs.openmqttgateway.com/) into homectl
sensor devices. Each sensor is one device holding several readings, so it can
be placed on the floorplan, assigned to rooms and used in automations.

```json
{
  "mode": "openmqttgateway",
  "host": "mqtt.example.com",
  "port": 1883,
  "openmqttgateway_base_topic": "home/sensors",
  "ble_devices": {
    "D7353530665A": "Living room",
    "C4:8D:1E:3E:57:67": ""
  }
}
```

- Subscribes to `<base>/+/BTtoMQTT/+`. The middle segment is the gateway name;
  any number of gateways can hear the same sensor.
- Devices are keyed by MAC (12 upper-case hex digits, colons optional in the
  config), so `ble/D7353530665A` is the same device whichever gateway heard it.
- `ble_devices` is the allowlist, MAC → display name. An empty name falls back
  to brand, model and the MAC's last four digits. Without a list, every sensor
  that reports temperature or humidity is added, which usually includes
  neighbours' sensors and should only be used to find MACs.
- Readings: `tempc` → `temperature` (°C, 0.1), `hum` → `humidity` (%, 0.1),
  `batt` → `battery` (%, 1). Packets carrying only some fields keep the other
  readings. Gateway name, RSSI, brand and model go to the device's raw data.
- Sensors advertise every few seconds and every gateway repeats them, so a
  report is only sent when a rounded reading changes, or every 5 minutes to
  show the sensor is alive.
- The devices are read-only; commands are rejected.
- The allowlist is reported to the state as sensors at start, so group
  power/scene conditions skip these members even before their first reading.

## Readings in the rest of homectl

The device state is `{"Sensor": {"readings": {"temperature": 21.4, ...}}}`
(`SensorDevice::Readings`). Automations read one metric with the path
`/temperature` (also `/value/temperature` or `/readings/temperature`); `/value`
returns all readings as an object.

History stays in InfluxDB or TimescaleDB (`TSDB_URL`), written by telegraf per gateway (`integration_id`
= gateway, `device_id` = MAC). Room views match a member whose device ID is a
MAC against that history from every gateway, averaging gateways that reported
the same window.
