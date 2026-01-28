# Scene Cycling with Mixed Initial States Tests
# Tests that CycleScenes action works correctly even when devices start
# in various states (mixed scenes, some on/off, etc.)
#
# Based on prod config patterns like bedroom_activate_nightlight:
# - CycleScenes with nowrap option
# - Multiple scenes in sequence
# - Should correctly determine next scene based on current state
#
# @config
# [groups.bedroom]
# name = "Bedroom"
# devices = [
#   { integration_id = "dummy", name = "Bedroom lamp" },
#   { integration_id = "dummy", name = "Bedroom lamp 2" },
# ]
#
# [groups.bathroom]
# name = "Bathroom"
# devices = [
#   { integration_id = "dummy", name = "Bathroom lamp" },
# ]
#
# [scenes.normal]
# name = "Normal"
# [scenes.normal.groups]
# bedroom = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
# bathroom = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
#
# [scenes.dark]
# name = "Dark"
# [scenes.dark.groups]
# bedroom = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
# bathroom = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
#
# [scenes.night]
# name = "Night"
# [scenes.night.groups]
# bedroom = { power = false }
# bathroom = { power = false }
#
# [scenes.bright]
# name = "Bright"
# [scenes.bright.groups]
# bedroom = { power = true, color = { h = 0, s = 0 }, brightness = 1.0 }
# bathroom = { power = true, color = { h = 0, s = 0 }, brightness = 1.0 }
#
# # Cycle through scenes: normal -> dark -> night (with nowrap)
# [routines.bedroom_down]
# name = "Bedroom down"
# rules = [
#   { integration_id = "dummy", name = "Bedroom switch", state = { value = "down_press" } },
# ]
# actions = [
#   { action = "CycleScenes", nowrap = true, scenes = [
#     { scene_id = "normal", group_keys = ["bedroom"] },
#     { scene_id = "dark", group_keys = ["bedroom"] },
#     { scene_id = "night", group_keys = ["bedroom"] },
#   ] },
# ]
#
# # Cycle through scenes: dark -> normal -> bright (with nowrap)
# [routines.bedroom_up]
# name = "Bedroom up"
# rules = [
#   { integration_id = "dummy", name = "Bedroom switch", state = { value = "up_press" } },
# ]
# actions = [
#   { action = "CycleScenes", nowrap = true, scenes = [
#     { scene_id = "dark", group_keys = ["bedroom"] },
#     { scene_id = "normal", group_keys = ["bedroom"] },
#     { scene_id = "bright", group_keys = ["bedroom"] },
#   ] },
# ]
#
# # Cycle WITH wrap (default)
# [routines.bathroom_cycle]
# name = "Bathroom cycle"
# rules = [
#   { integration_id = "dummy", name = "Bathroom switch", state = { value = "press" } },
# ]
# actions = [
#   { action = "CycleScenes", scenes = [
#     { scene_id = "normal", group_keys = ["bathroom"] },
#     { scene_id = "dark", group_keys = ["bathroom"] },
#     { scene_id = "night", group_keys = ["bathroom"] },
#   ] },
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
            "scene_id": null,
            "state": { "power": false, "brightness": null, "color": null, "transition": null },
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
            "scene_id": null,
            "state": { "power": false, "brightness": null, "color": null, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/bathroom_lamp
Content-Type: application/json
{
    "id": "bathroom_lamp",
    "name": "Bathroom lamp",
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

# ============================================================================
# TEST 1: CycleScenes from "normal" -> "dark" (first press of down)
# ============================================================================

# First set bedroom to normal scene
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

# Press down - should cycle to dark
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "down_press" }
    }
}
HTTP 200

# Bedroom should be in "dark" scene now
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.brightness" contains 0.25
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "dark"
jsonpath "$.devices[?(@.id=='bedroom_lamp_2')].data.Controllable.scene_id" contains "dark"


# ============================================================================
# TEST 2: CycleScenes from "dark" -> "night" (second press of down)
# ============================================================================

# Press down again - should cycle to night
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "down_press" }
    }
}
HTTP 200

# Bedroom should be in "night" scene now (power off)
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "night"


# ============================================================================
# TEST 3: CycleScenes with nowrap - should stay at "night" (third press)
# ============================================================================

# Press down again - should stay at night (nowrap)
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "down_press" }
    }
}
HTTP 200

# Bedroom should STILL be in "night" scene (nowrap prevents cycling back)
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "night"


# ============================================================================
# TEST 4: CycleScenes with WRAP - should cycle back to beginning
# ============================================================================

# First set bathroom to normal scene
PUT {{base_url}}/api/v1/devices/bathroom_lamp
Content-Type: application/json
{
    "id": "bathroom_lamp",
    "name": "Bathroom lamp",
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

# Press 1 - cycle to dark
PUT {{base_url}}/api/v1/devices/bathroom_switch
Content-Type: application/json
{
    "id": "bathroom_switch",
    "name": "Bathroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bathroom_lamp')].data.Controllable.scene_id" contains "dark"

# Press 2 - cycle to night
PUT {{base_url}}/api/v1/devices/bathroom_switch
Content-Type: application/json
{
    "id": "bathroom_switch",
    "name": "Bathroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bathroom_lamp')].data.Controllable.scene_id" contains "night"

# Press 3 - should WRAP back to normal
PUT {{base_url}}/api/v1/devices/bathroom_switch
Content-Type: application/json
{
    "id": "bathroom_switch",
    "name": "Bathroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bathroom_lamp')].data.Controllable.scene_id" contains "normal"
jsonpath "$.devices[?(@.id=='bathroom_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='bathroom_lamp')].data.Controllable.state.brightness" contains 1.0


# ============================================================================
# TEST 5: CycleScenes from MIXED initial state - devices in different scenes
# ============================================================================

# Set one lamp to dark, other to normal (mixed state)
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
            "scene_id": "normal",
            "state": { "power": true, "brightness": 1.0, "color": { "h": 30, "s": 0.5 }, "transition": null },
            "capabilities": {},
            "managed": "Full"
        }
    }
}
HTTP 200

# Press down - from mixed state, should still find next scene and unify
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "down_press" }
    }
}
HTTP 200

# After cycling from mixed state, both should be in same scene
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "dark"
jsonpath "$.devices[?(@.id=='bedroom_lamp_2')].data.Controllable.scene_id" contains "dark"


# ============================================================================
# TEST 6: CycleScenes "up" action (dark -> normal -> bright)
# ============================================================================

# Set bedroom to dark scene
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

# Press up - should cycle to normal
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "up_press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "normal"
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.brightness" contains 1.0

# Press up again - should cycle to bright
PUT {{base_url}}/api/v1/devices/bedroom_switch
Content-Type: application/json
{
    "id": "bedroom_switch",
    "name": "Bedroom switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "up_press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.scene_id" contains "bright"
