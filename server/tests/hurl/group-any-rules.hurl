# Group and Any Rules Tests
# Tests that group rules and "any" rules work correctly:
# - Group rules: { group_id = "...", power = false/true, scene = "..." }
# - Any rules: { any = [ ... ] } where any one rule matching is sufficient
#
# Based on prod config patterns like entryway_dark and activate_nightlight
#
# @config
# [groups.bedroom]
# name = "Bedroom"
# devices = [
#   { integration_id = "dummy", name = "Bedroom lamp" },
#   { integration_id = "dummy", name = "Bedroom lamp 2" },
# ]
#
# [groups.kitchen]
# name = "Kitchen"
# devices = [
#   { integration_id = "dummy", name = "Kitchen lamp" },
# ]
#
# [scenes.normal]
# name = "Normal"
# [scenes.normal.groups]
# bedroom = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
# kitchen = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
#
# [scenes.dark]
# name = "Dark"
# [scenes.dark.groups]
# bedroom = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
# kitchen = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
#
# [scenes.night]
# name = "Night"
# [scenes.night.groups]
# bedroom = { power = false }
# kitchen = { power = false }
#
# # Test "any" rule - multiple switches can trigger same action
# [routines.any_switch_night]
# name = "Any switch activates night"
# rules = [
#   { any = [
#     { integration_id = "dummy", name = "Bedroom switch", state = { value = "off_press" } },
#     { integration_id = "dummy", name = "Kitchen switch", state = { value = "off_press" } },
#     { integration_id = "dummy", name = "Bathroom switch", state = { value = "off_press" } },
#   ] },
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "night" },
# ]
#
# # Test "any" rule combined with group scene rule
# [routines.conditional_wake]
# name = "Conditional wake"
# rules = [
#   { integration_id = "dummy", name = "Motion sensor", state = { value = true } },
#   { any = [
#     { group_id = "bedroom", scene = "dark" },
#     { group_id = "bedroom", scene = "night" },
#   ] },
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "dark", group_keys = ["kitchen"] },
# ]
#
# # Test "any" rule with motion + power = false condition
# [routines.normal_wake]
# name = "Normal wake"
# rules = [
#   { integration_id = "dummy", name = "Motion sensor", state = { value = true } },
#   { group_id = "bedroom", scene = "normal" },
#   { group_id = "kitchen", power = false },
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "normal", group_keys = ["kitchen"] },
# ]
# @endconfig

# ============================================================================
# SETUP - Create devices
# ============================================================================

PUT {{base_url}}/api/v1/devices/bedroom_lamp
Content-Type: application/json
{
    "id": "bedroom_lamp",
    "name": "Bedroom lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bedroom_lamp_2
Content-Type: application/json
{
    "id": "bedroom_lamp_2",
    "name": "Bedroom lamp 2",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/kitchen_lamp
Content-Type: application/json
{
    "id": "kitchen_lamp",
    "name": "Kitchen lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": null,
            "state": { "power": false, "brightness": null, "color": null, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "idle" }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/kitchen_switch
Content-Type: application/json
{
    "id": "kitchen_switch",
    "name": "Kitchen switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "idle" }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bathroom_switch
Content-Type: application/json
{
    "id": "bathroom_switch",
    "name": "Bathroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "idle" }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/motion_sensor
Content-Type: application/json
{
    "id": "motion_sensor",
    "name": "Motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

# ============================================================================
# TEST 1: "Any" rule - First switch (Bedroom) triggers night scene
# ============================================================================

# Verify initial state - bedroom is on in normal scene
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "normal"

# Press bedroom switch off_press
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "off_press" }
    }
}
HTTP 200

# Should activate night scene (lights off)
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "night"
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.power" contains false

# ============================================================================
# TEST 2: "Any" rule - Second switch (Kitchen) also triggers night scene
# ============================================================================

# Reset bedroom to normal
PUT {{base_url}}/api/v1/devices/bedroom_lamp
Content-Type: application/json
{
    "id": "bedroom_lamp",
    "name": "Bedroom lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bedroom_lamp_2
Content-Type: application/json
{
    "id": "bedroom_lamp_2",
    "name": "Bedroom lamp 2",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

# Press kitchen switch off_press (different switch, same routine)
PUT {{base_url}}/api/v1/devices/kitchen_switch
Content-Type: application/json
{
    "id": "kitchen_switch",
    "name": "Kitchen switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "off_press" }
    }
}
HTTP 200

# Should also activate night scene
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "night"

# ============================================================================
# TEST 3: "Any" rule - Third switch (Bathroom) also triggers night scene
# ============================================================================

# Reset bedroom to normal again
PUT {{base_url}}/api/v1/devices/bedroom_lamp
Content-Type: application/json
{
    "id": "bedroom_lamp",
    "name": "Bedroom lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bedroom_lamp_2
Content-Type: application/json
{
    "id": "bedroom_lamp_2",
    "name": "Bedroom lamp 2",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

# Press bathroom switch off_press (yet another switch, same routine)
PUT {{base_url}}/api/v1/devices/bathroom_switch
Content-Type: application/json
{
    "id": "bathroom_switch",
    "name": "Bathroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "off_press" }
    }
}
HTTP 200

# Should also activate night scene
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "night"

# ============================================================================
# TEST 4: "Any" rule with group scene condition - motion + dark/night bedroom
# ============================================================================

# Reset: Set bedroom to dark scene, kitchen off
PUT {{base_url}}/api/v1/devices/bedroom_lamp
Content-Type: application/json
{
    "id": "bedroom_lamp",
    "name": "Bedroom lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "dark",
            "state": { "power": true, "brightness": 0.25, "color": { "h": 25, "s": 0.95 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bedroom_lamp_2
Content-Type: application/json
{
    "id": "bedroom_lamp_2",
    "name": "Bedroom lamp 2",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "dark",
            "state": { "power": true, "brightness": 0.25, "color": { "h": 25, "s": 0.95 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/kitchen_lamp
Content-Type: application/json
{
    "id": "kitchen_lamp",
    "name": "Kitchen lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": null,
            "state": { "power": false, "brightness": null, "color": null, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

# Trigger motion sensor
PUT {{base_url}}/api/v1/devices/motion_sensor
Content-Type: application/json
{
    "id": "motion_sensor",
    "name": "Motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Kitchen should be in dark scene (matching the conditional_wake routine)
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.scene_id" contains "dark"
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.brightness" contains 0.25

# ============================================================================
# TEST 5: Group rule (power = false) + scene match -> normal_wake routine
# ============================================================================

# Reset: Set bedroom to normal scene, kitchen off
PUT {{base_url}}/api/v1/devices/bedroom_lamp
Content-Type: application/json
{
    "id": "bedroom_lamp",
    "name": "Bedroom lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bedroom_lamp_2
Content-Type: application/json
{
    "id": "bedroom_lamp_2",
    "name": "Bedroom lamp 2",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/kitchen_lamp
Content-Type: application/json
{
    "id": "kitchen_lamp",
    "name": "Kitchen lamp",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": null,
            "state": { "power": false, "brightness": null, "color": null, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

# Reset motion sensor
PUT {{base_url}}/api/v1/devices/motion_sensor
Content-Type: application/json
{
    "id": "motion_sensor",
    "name": "Motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

# Trigger motion sensor
PUT {{base_url}}/api/v1/devices/motion_sensor
Content-Type: application/json
{
    "id": "motion_sensor",
    "name": "Motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Kitchen should be in normal scene (matching the normal_wake routine)
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.scene_id" contains "normal"
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.brightness" contains 1.0

# ============================================================================
# TEST 6: Group rule (power = false) not met -> routine should NOT trigger
# ============================================================================

# Kitchen is now ON from the previous test
# Trigger motion sensor again
PUT {{base_url}}/api/v1/devices/motion_sensor
Content-Type: application/json
{
    "id": "motion_sensor",
    "name": "Motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/motion_sensor
Content-Type: application/json
{
    "id": "motion_sensor",
    "name": "Motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Kitchen should STILL be in normal scene (neither routine should trigger since kitchen power != false)
# The conditional_wake requires bedroom to be dark/night, but bedroom is normal
# The normal_wake requires kitchen power = false, but it's true
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.scene_id" contains "normal"
