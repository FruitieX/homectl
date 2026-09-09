# Zigbee2MQTT MQTT profile

The MQTT integration supports an opt-in `zigbee2mqtt_base_topic` field in its
database-backed configuration (Integrations → MQTT). Set it to the bridge's MQTT
base topic, normally `zigbee2mqtt`. Broker connection and management settings
remain configured on the integration. Generic MQTT integrations still require
their state and command topic fields. The Zigbee2MQTT profile derives those topics
from the base topic and addresses commands by IEEE address.

The profile subscribes to `bridge/devices` and state topics. It derives writable
brightness, XY, HS and temperature support from each device's `definition.exposes`.
Temperature ranges are converted from mired to Kelvin. Reports select the active
representation using `color_mode`; outbound commands translate Kelvin to mired and
HS saturation from a fraction to a percentage. Commands are not retained.

The profile accepts incoming MQTT packets up to 4 MiB (outgoing limit 64 KiB).
The generic MQTT default is unchanged. Production bridge metadata exceeded the
client's previous 10 KiB incoming default and caused repeated reconnects.

MQTT controllable devices expose `last_report` separately from requested `state`,
with the normalized reported state, server receive time, retained/cached flag,
and a comparison with the requested state. `requested_at_ms` records when homectl
changes its requested state, not a hardware acknowledgement. Managed devices keep
their requested state when reports differ, while reports refresh capabilities and
remain visible even when raw values repeat. The device modal shows a compact
report status with expandable report values and age. “Report matches” means the
bridge report matches within the server's comparison tolerances; it does not
establish fresh per-property hardware confirmation. Other integration types may
not supply report metadata yet.

The profile refreshes enabled, discovered lights/switches whose state has not
been reported for five minutes. Set `zigbee2mqtt_poll_interval_secs` in the
database-backed integration configuration to change this stale threshold (positive
values are clamped to 30–86400 seconds), or `0` to disable all polling, including
command readbacks. Generic MQTT and dry-run mode never schedule these reads.

Non-retained `/set` messages observed through the bridge subscription schedule a
readback after the requested transition plus two seconds. Repeated commands
replace the pending deadline for that device. Fresh, non-retained state reports
defer background refresh; reports after the readback deadline satisfy it. Retained
startup state does not count as a fresh report. Disabled devices are excluded and
devices advertised offline are skipped.

One scheduler per MQTT integration allows at most one outstanding GET, with a
minimum two-second gap between requests. A report releases that slot; otherwise
it times out after 15 seconds and that device backs off from 30 seconds up to
15 minutes. MQTT queue writes never wait for capacity: a full queue leaves the
readback pending while MQTT processing continues. Requests are non-retained and
contain only GET-capable state/brightness/color properties. A single MQTT GET can
still cause several Zigbee reads; this limits homectl's request traffic, not all
traffic from other Zigbee clients. A report is not proof that every requested
property was freshly read, especially when bridge caching/optimistic updates are
enabled.

The inventory is cached for the MQTT task's lifetime, including reconnects, and
refreshed from bridge metadata. State arriving before discovery is buffered with a
bounded size. Discovery alone does not invent a power state or replay previous
reports. Explicit sensor value mappings remain available. Endpoint-specific light
controls are not currently mapped to independent homectl devices.

## Rollout and reporting

Before enabling this on an existing integration, inspect the bridge inventory and
confirm IEEE IDs match the existing homectl device IDs. Check the configured sensor
value mappings too. This is a wire-format change, not just a capability override.
Use fixtures for command conversion tests before testing an Office light.

This profile does not configure Zigbee attribute reporting. The household
installation currently needs `/get` requests for fresh device reports
(user-confirmed 2026-09-08); the Zigbee2MQTT frontend is at
http://192.168.1.15:8080. Old raw reports must not be interpreted as proof of device
failure. A homectl command acknowledgement means acceptance, not Zigbee readback.

Read-only inspection of the frontend inventory on 2026-09-08 confirmed that the
Office lamp exposes writable CT (153–500 mired), XY and HS. Endpoint 11 reported an
empty `configured_reportings` list and only a manufacturer-specific binding. This
is inventory evidence; no reporting configuration or device state was changed.

Follow-up Office lamp test: `/get` returned a state update, but reading reporting
configuration failed (power-cluster timeout; other clusters returned
`reportConfigs is not iterable` on Zigbee2MQTT `2.9.2-dev`). Configuring `genOnOff`
reporting on endpoint 11 (minimum 2 s, maximum 300 s) failed while binding to the
coordinator with `TABLE_FULL`. Reporting was not successfully enabled. No existing
bindings were removed. Inspect the actual binding table before removing any entry;
bounded polling remains the fallback for this lamp.

2026-09-09 follow-up: a direct ZDO binding-table read (cluster 0x0033, page 0)
returned exactly one entry: endpoint 11, cluster 0xfc03, coordinator endpoint 1.
There are no stale bindings identified for removal. Direct manufacturer-specific
ZCL reporting read/configure requests for attribute 0x0002 on that existing
cluster both returned default-response status 0x84 (`UNSUP_MANUF_GENERAL_COMMAND`).
The configure attempt requested a 2-second minimum and 300-second maximum.
The bridge action transport returned `status: ok`, but the device's embedded ZCL
response rejected the operation. No binding was removed or light state changed.
Native reporting remains unresolved; do not interpret these transport successes
as successful reporting configuration.

Remaining work: resolving native reporting requires device/firmware-specific
investigation. Per-property hardware confirmation and multi-endpoint controls
remain unsupported. Paced readback and separate bridge-report status are implemented;
production rollout verification is a separate step.

Protocol references:
- https://www.zigbee2mqtt.io/guide/usage/exposes.html
- https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
