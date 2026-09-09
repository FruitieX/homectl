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

When attribute reporting is unavailable, the profile polls each discovered
device's GET-capable properties every five minutes. Set
`zigbee2mqtt_poll_interval_secs` in the database-backed integration configuration
to change the interval, or to `0` to disable the fallback. Polls are bounded to
discovered devices and only request properties advertised by the bridge.

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

Remaining work: audit/configure reporting on the Office lamp, then consider bounded
post-transition polling for devices that need it. Poll only properties advertising
GET access, coalesce pending polls per device, and keep polling out of the state
actor. Explicit device-confirmation status in the UI remains a separate change.

Protocol references:
- https://www.zigbee2mqtt.io/guide/usage/exposes.html
- https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
