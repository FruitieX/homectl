# ESPHome MQTT light profile

The single `mqtt` integration supports `mode: "esphome"` for ESPHome's normal
MQTT JSON light layout. It does not use Home Assistant discovery or the ESPHome
native API.

The small profile configuration is:

```json
{
  "mode": "esphome",
  "host": "mqtt.fruitiex.org",
  "port": 1883,
  "esphome_base_topic": "esphome",
  "esphome_light_object_id": "light",
  "esphome_warm_white_kelvin": 2700,
  "esphome_cold_white_kelvin": 6500
}
```

For a node named `gx53-test`, this subscribes to:

- `esphome/gx53-test/light/light/state`
- `esphome/gx53-test/status`

Commands are published to
`esphome/gx53-test/light/light/command` and are always non-retained. ESPHome
state uses `state`, `brightness`, and RGB values in `color.r/g/b`. CWWW state
uses cold `color.c` and warm `color.w` channel values; it does not need a
root-level `color_temp` state field.

The CWWW decoder uses the channel ratio in mired space:

```text
warm_fraction = w / (c + w)
mired = cold_mired + warm_fraction * (warm_mired - cold_mired)
kelvin = 1_000_000 / mired
```

This preserves the requested color temperature when ESPHome's
`constant_brightness` changes the absolute channel values. A zero channel sum
leaves color temperature unspecified. The configured warm/cold endpoints are
also exposed as homectl's CT capability range.
