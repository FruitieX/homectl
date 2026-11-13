# Generic MQTT effects, color slots and sensor values

The `mqtt` integration's `mode: "generic"` maps JSON payloads with RFC 6901
pointers (`power_field`, `brightness_field`, `color_field`, …; see the
integration's settings page for the full list). Besides one color, a light
can report an **effect** (a named preset) and several **color slots**, for
example an LED animation controller whose preset uses two or three colors.

```json
{
  "mode": "generic",
  "host": "mqtt.example.com",
  "port": 1883,
  "topic": "home/lights/animations/{id}",
  "topic_set": "home/lights/animations/{id}/set",
  "effect_field": "/preset",
  "effect_list_field": "/presets",
  "colors_field": "/colors",
  "capabilities_override": { "hs": true, "rgb": true, "ct": null }
}
```

A matching device state:

```json
{
  "id": "window",
  "power": true,
  "brightness": 0.6,
  "color": { "h": 30, "s": 0.58 },
  "colors": [{ "h": 30, "s": 0.58 }, { "h": 270, "s": 0.8 }],
  "preset": "Aurora",
  "presets": ["Aurora", "Fire", "Snowfall"]
}
```

- The three pointers have no defaults: unless set they are neither read nor
  sent, so existing configurations behave as before. An empty value is unset.
- `effect_field`: the active effect name, read and written as a string. `null`
  means no named effect is active (the look was customised).
- `effect_list_field`: an array of effect names. It becomes the device's
  `capabilities.effects` and enables the effect picker in device controls
  and the scene editor.
- `colors_field`: an array with one color per slot. Each item uses the same
  formats as `color_field` (`{h,s}`, `{x,y}`, `{r,g,b}`, `{ct}`); a list with
  an item that cannot be parsed is ignored as a whole so slots never shift.
  The primary `color` is authoritative for slot 0 when both are sent.

Controls and scenes:

- Picking an effect requests it and clears the requested colors, so the
  preset shows its own colors. Changing the color or a color slot clears the
  requested effect, matching devices that report no preset once customised.
- Scene targets may set `effect` and `colors`. Unset fields never conflict
  with the device. A target that sets an effect together with a color accepts
  a device that reports no preset, instead of re-applying the preset forever.
- Devices that report neither effects nor color slots are never corrected for
  an effect or colors a scene asks for.

## Sensor values

`sensor_value_fields` lists pointers to sensor values (default `["/sensor_value"]`).
How several fields are read depends on `sensor_value_mode`:

- `"all"` (default): every listed value present in a payload becomes a named
  reading of **one** sensor device. A reading is a number, boolean or text:
  strings holding just a number (`"40"`) become numbers, `"true"`/`"false"`
  become booleans, and any other string is kept verbatim (`"85%"`,
  `"charging"`); a JavaScript block can parse it further. Objects, arrays,
  nulls and empty strings are skipped. A reading is named after the pointer's last token
  (`/temperature` → `temperature`), or the whole pointer without the leading
  slash (`indoor/value`) when two pointers end in the same token. Readings from
  earlier messages are kept, so a device that sends humidity on its own keeps
  its last temperature.
- `"first"`: the first listed field present in the payload is the device's
  single value (number, boolean or text). Use it when one list covers different
  kinds of device, such as `["/action", "/occupancy"]` for buttons and motion
  sensors.

A single listed field always yields a plain value, in either mode.

```json
{
  "mode": "generic",
  "topic": "home/sensors/{id}",
  "topic_set": "home/sensors/{id}/set",
  "sensor_value_fields": ["/temperature", "/humidity", "/battery"]
}
```

With `{"temperature": 21.4, "humidity": 45, "battery": "87%"}` the device shows
"21.4 °C · 45%" (battery in the details). Automations read one reading by path
(`/temperature`, also `/readings/temperature` or `/value/temperature`); `/value`
is the object of all readings. A reading the device hasn't reported reads as
unknown. React to a threshold with a `predicate_transition` trigger such as
`/humidity` `gt` 60; `state_change` triggers follow on/off state and don't fire
for readings. Configurations saved before `sensor_value_mode`
existed that list several fields were migrated to `"first"`, so they keep
decoding as before. Zigbee2MQTT always uses `"first"`.
