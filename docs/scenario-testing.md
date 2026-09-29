# Routine scenario tests

`homectl config test` runs named, deterministic scenarios through homectl's
production routine loader, compiler, event handler, and frame evaluator. It does
not start integrations. Simulated sensor reports enter the normal event path;
outbound device commands and integration actions are recorded instead of being
sent. Database writes, persistence work, and UI work are discarded.

## Household suite location

The scenario suite is stored in the runtime database and included in configuration
exports and imports. Upload an existing JSON suite once with:

```sh
homectl --url https://homectl.fruitiex.org config upload-scenarios ~/.config/homectl/scenarios.json
```

The upload validates the suite format and persists it through the normal config
write path. `--scenarios PATH` or `HOMECTL_SCENARIOS` overrides the stored suite
for local drafts; no default file is read implicitly.
The same document is available through `GET /api/v1/config/scenarios` and can
be replaced through `PUT /api/v1/config/scenarios`.
To save a copy from the server, run `homectl --url https://homectl.fruitiex.org
config download-scenarios ./scenarios.json`. The command refuses to overwrite an
existing file unless `--force` is passed.

Configuration source selection:

- `--source-db PATH_OR_URL` (or `HOMECTL_SOURCE_DB`) explicitly selects a DB.
- Otherwise `DATABASE_URL` is used when set, then `./homectl.db` if present.
- `--config-export PATH` selects an exported JSON snapshot instead of a DB.

SQLite sources are opened read-only. PostgreSQL exports run in a read-only
transaction. Scenario execution has no database connection and starts no
integration driver, so neither configuration testing nor simulated commands
can change live devices or config rows.

## Scenario format

A suite has `version: 1`, an optional shared `devices` inventory, and a
`scenarios` array. The inventory records integration-discovered metadata that
cannot be loaded safely in a test: stable device key, friendly name, kind, and
light capabilities. Light catalog entries must provide a `capabilities` object so
simulated devices do not silently inherit guessed integration defaults. The
inventory is a fixture only; no integration is started. Each scenario still
supplies the complete *dynamic starting state* for the devices it uses, plus
events and exact expected effects. Device keys use homectl's
`integration_id/device_id` form. When the shared inventory is provided, state
entries must refer to it and inherit its names/capabilities; legacy suites may
keep this metadata inline. The runner verifies that named routines exist, are
enabled, compile, and that the scenario includes their referenced devices.

```json
{
  "version": 1,
  "devices": [
    { "kind": "sensor", "device": "sim/motion", "name": "Motion" },
    { "kind": "light", "device": "sim/lamp", "name": "Lamp",
      "capabilities": { "brightness": true } }
  ],
  "scenarios": [{
    "name": "example motion behavior",
    "routines": ["Example motion routine"],
    "initial_state": [
      { "kind": "sensor", "device": "sim/motion", "value": false },
      { "kind": "light", "device": "sim/lamp", "power": false, "brightness": 0.3 }
    ],
    "events": [
      { "type": "sensor", "device": "sim/motion", "value": true }
    ],
    "expect": {
      "commands": [
        { "type": "device_state", "device": "sim/lamp", "power": true, "brightness": 0.3 }
      ],
      "final_state": [
        { "kind": "sensor", "device": "sim/motion", "value": true },
        { "kind": "light", "device": "sim/lamp", "power": true, "brightness": 0.3 }
      ],
      "unchanged": []
    }
  }]
}
```

`commands` is an exact, ordered dispatch assertion, including full light state;
`integration_action` entries can assert custom integration actions. Use
`device_power` and `light_power` assertions when only on/off matters; these ignore
brightness, color, and transition. A power-only command looks like
`{"type":"device_power","device":"sim/lamp","power":true}`; its final-state
counterpart is `{"kind":"light_power","device":"sim/lamp","power":true}`.
Set `expect.check_commands` to `false` when the behavior contract is the resulting
state and exact dispatch count or payload is an implementation detail. Final
state, unchanged-device, and helper assertions still run. The default is `true`,
so guard scenarios continue to assert that no commands were dispatched.
Use `expect.forbidden_command_devices` to ban commands to specific lights even
when `check_commands` is false, for example when staircase motion may light a
hall but must not send any command to a sleeping child's room.
The existing `device_state` and `light` assertions continue to compare the
complete light state.
Use `{"kind":"light_visual","device":"sim/lamp","power":true,"brightness":0.33,"color":{"h":0,"s":1}}`
to assert the visible output while ignoring transition timing.
Light entries in `initial_state` may include `scene_id` to
seed active-scene metadata for scene-aware group conditions and scene mirroring;
it should reference a scene in the configuration under test. When seeding a
light that is already following a scene, `state_source` may also be provided
with the exported `scope`, `kind`, `group_id`, `linked_scene_id`, and
`linked_device_key` fields. This matters for `unchanged` assertions, which
compare scene tracking metadata as well as physical state. Final-state entries
may use `{"kind":"light_scene","device":"sim/lamp","scene_id":"night"}`
to assert tracked scene identity independently of physical state, or
`{"kind":"light_scene_power","device":"sim/lamp","scene_id":"night","power":false}`
to assert scene identity and power together. Seeding or asserting a scene is
simulation-only and does not activate hardware or change configuration.
Scenes that link to a computed color source need that source in `initial_state`.
Seed its published or legacy alias key as
`{"kind":"color_source","device":"circadian/color","name":"Circadian rhythm","power":true,"brightness":1.0}`
and list it in `unchanged`. This creates a simulated read-only color sensor;
the runner does not start the source integration or compute its value.

Every initial device must appear in `final_state` or `unchanged`, so scenarios
cannot silently skip checking unrelated devices. Sensor events must retain the
value type seeded for that sensor. `advance_time` events move the fake wall and
monotonic clocks and fire due routine timers. Script-backed routines use the same
supervised worker path and have a bounded 15-second result timeout.

## Worker timezone

Workers do not inherit the server or CLI environment wholesale. If `TZ` is set,
the supervisor passes that variable to the script worker, plus `TZDIR` when set
(for hosts such as NixOS that use a nonstandard zoneinfo directory). No other
environment variables are passed. Thus `Date.getHours()` follows the configured
zone; without `TZ`, it uses the host's system timezone. Set `TZ` on the test
command to make time-dependent scenarios deterministic, for example:

```sh
TZ=Europe/Helsinki homectl config test --config-export ./sanitized-config.json --scenarios ./private-scenarios.json
TZ=UTC homectl config test --config-export ./sanitized-config.json --scenarios ./private-scenarios.json
```

Run locally with:

```sh
homectl config test
```

This reads configuration and its suite from the local database in read-only mode.

Or choose sources explicitly:

```sh
homectl config test --source-db ./homectl.db --scenarios ~/.config/homectl/scenarios.json
homectl config test --config-export ./sanitized-config.json --scenarios ./private-scenarios.json
```

To check the **current live configuration** from a machine that can reach the
server, fetch one current export including the stored suite:

```sh
TZ=Europe/Helsinki homectl --url https://homectl.fruitiex.org config test --server
```

The command fails if the export or suite is unavailable. `--scenarios PATH` can
override the stored suite while testing a proposed change. A saved export checks
the configuration at the time it was saved, not the current live configuration.

## Code tests and live checks

The checked-in Rust scenario-runner tests exercise the same production runtime
with synthetic configuration. CI can continue to use those public tests to
verify code behavior without reaching the homelab. The stored household suite
verifies the current live configuration when run on a machine that can reach
the server. It does not need production DB credentials or command real devices.
