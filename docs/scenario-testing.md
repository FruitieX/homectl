# Routine scenario tests

`homectl config test` runs named, deterministic scenarios through homectl's
production routine loader, compiler, event handler, and frame evaluator. It does
not start integrations. Simulated sensor reports enter the normal event path;
outbound device commands and integration actions are recorded instead of being
sent. Database writes, persistence work, and UI work are discarded.

## Keep the household suite private

The default suite path is `$XDG_CONFIG_HOME/homectl/scenarios.json`, or
`~/.config/homectl/scenarios.json` when `XDG_CONFIG_HOME` is unset. Keep this
file outside the checkout and restrict it to the user (`chmod 600`). The
repository contains only the generic runner and synthetic tests for the
runner—not household device names, IDs, or test cases.

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
`integration_action` entries can assert custom integration actions. Every initial
device must appear in `final_state` or `unchanged`, so scenarios cannot silently
skip checking unrelated devices. Sensor events must retain the value type seeded
for that sensor. `advance_time` events move the fake wall and monotonic clocks and fire due routine
timers. Script-backed routines use the same supervised worker path and have a
bounded 15-second result timeout.

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

Or choose sources explicitly:

```sh
homectl config test --source-db ./homectl.db --scenarios ~/.config/homectl/scenarios.json
homectl config test --config-export ./sanitized-config.json --scenarios ./private-scenarios.json
```

## CI without committing household data

The checked-in Rust scenario-runner tests exercise the same production runtime
with synthetic configuration. To run the household suite in CI as well, provision
a **sanitized** config export and private scenario JSON from a private artifact
store (for example, a separate private repository or encrypted CI artifact),
then invoke the same `homectl config test --config-export … --scenarios …`
command. Do not put production DB credentials in CI and do not commit the
household export or scenario file to this repository. If CI is not provisioned
with those private files, it runs the generic runner tests only; it cannot test
the private active configuration.
