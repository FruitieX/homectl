# Generic MQTT effects and color slots

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
