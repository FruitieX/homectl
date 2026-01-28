# Staircase Motion Sensor Tests
# Tests realistic scenarios based on actual prod config patterns:
# - Motion sensor turns on upstairs lights only when they're OFF
# - Motion sensor turns on downstairs lights with matching scene based on bedroom
#
# @config
# [groups.upstairs]
# name = "Upstairs lights"
# devices = [
#   { integration_id = "dummy", name = "Staircase lamp" },
#   { integration_id = "dummy", name = "Bedroom lamp" },
# ]
#
# [groups.bedroom]
# name = "Bedroom"
# devices = [
#   { integration_id = "dummy", name = "Bedroom lamp" },
# ]
#
# [groups.downstairs]
# name = "Downstairs lights"
# devices = [
#   { integration_id = "dummy", name = "Living room lamp" },
#   { integration_id = "dummy", name = "Kitchen lamp" },
# ]
#
# [groups.kids_room]
# name = "Kids room"
# devices = [
#   { integration_id = "dummy", name = "Kids room lamp" },
# ]
#
# [scenes.normal]
# name = "Normal"
# [scenes.normal.groups]
# upstairs = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
# downstairs = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
# kids_room = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
#
# [scenes.dark]
# name = "Dark"
# [scenes.dark.groups]
# upstairs = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
# downstairs = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
# kids_room = { power = true, color = { h = 25, s = 0.95 }, brightness = 0.25 }
#
# [scenes.night]
# name = "Night"
# [scenes.night.groups]
# upstairs = { power = false }
# downstairs = { power = false }
# kids_room = { power = false }
# [scenes.night.devices.dummy]
# "Staircase lamp" = { power = true, color = { h = 22, s = 1 }, brightness = 0.15 }
#
# [scenes.kids_room_normal]
# name = "Kids room normal"
# [scenes.kids_room_normal.groups]
# kids_room = { power = true, color = { h = 30, s = 0.5 }, brightness = 1.0 }
#
# # Routine: Motion triggers upstairs lights ONLY if upstairs is off and kids room is off
# [routines.staircase_upstairs]
# name = "Staircase (upstairs)"
# rules = [
#   { integration_id = "dummy", name = "Staircase motion sensor", state = { value = true } },
#   { group_id = "upstairs", power = false },
#   { group_id = "kids_room", power = false },
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "normal", group_keys = ["upstairs"] },
#   { action = "ActivateScene", scene_id = "kids_room_normal" },
# ]
#
# # Routine: Motion triggers downstairs with normal scene if bedroom is in normal
# [routines.staircase_downstairs]
# name = "Staircase (downstairs)"
# rules = [
#   { integration_id = "dummy", name = "Staircase motion sensor", state = { value = true } },
#   { group_id = "downstairs", power = false },
#   { group_id = "bedroom", scene = "normal" },
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "normal", group_keys = ["downstairs"] },
# ]
#
# # Routine: Motion triggers downstairs with dark scene if bedroom is in dark/night
# [routines.staircase_downstairs_dark]
# name = "Staircase (downstairs, dark)"
# rules = [
#   { integration_id = "dummy", name = "Staircase motion sensor", state = { value = true } },
#   { group_id = "downstairs", power = false },
#   { any = [
#     { group_id = "bedroom", scene = "dark" },
#     { group_id = "bedroom", scene = "night" },
#   ] },
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "dark", group_keys = ["downstairs"] },
# ]
# @endconfig

# ============================================================================
# SETUP - Create devices (all initially off)
# ============================================================================

PUT {{base_url}}/api/v1/devices/staircase_lamp
Content-Type: application/json
{
    "id": "staircase_lamp",
    "name": "Staircase lamp",
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

PUT {{base_url}}/api/v1/devices/living_room_lamp
Content-Type: application/json
{
    "id": "living_room_lamp",
    "name": "Living room lamp",
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

PUT {{base_url}}/api/v1/devices/kids_room_lamp
Content-Type: application/json
{
    "id": "kids_room_lamp",
    "name": "Kids room lamp",
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

# Create the motion sensor
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

# ============================================================================
# TEST 1: Motion sensor should turn on upstairs lights when upstairs is OFF
# ============================================================================

# Verify initial state - all lights off
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='staircase_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains false
jsonpath "$.devices[?(@.id=='kids_room_lamp')].data.Controllable.state.power" contains false

# Trigger motion sensor
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Upstairs AND kids room should now be on with "normal" scene
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='staircase_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='staircase_lamp')].data.Controllable.state.brightness" contains 1.0
jsonpath "$.devices[?(@.id=='bedroom_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='kids_room_lamp')].data.Controllable.state.power" contains true

# ============================================================================
# TEST 2: Motion sensor should NOT turn on upstairs when already on
# ============================================================================

# Turn off motion sensor first, then reset it
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

# Manually set upstairs to "dark" scene (different from normal - dimmer)
PUT {{base_url}}/api/v1/devices/staircase_lamp
Content-Type: application/json
{
    "id": "staircase_lamp",
    "name": "Staircase lamp",
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

# Trigger motion sensor again
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Upstairs should STILL be in "dark" scene (routine didn't trigger because power != false)
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='staircase_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='staircase_lamp')].data.Controllable.state.brightness" contains 0.25
jsonpath "$.devices[?(@.id=='staircase_lamp')].data.Controllable.scene_id" contains "dark"


# ============================================================================
# TEST 3: Downstairs gets "normal" scene when bedroom is in "normal"
# ============================================================================

# Reset: Turn off downstairs, set bedroom to normal scene, turn off kids room
PUT {{base_url}}/api/v1/devices/living_room_lamp
Content-Type: application/json
{
    "id": "living_room_lamp",
    "name": "Living room lamp",
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

# Reset motion sensor
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

# Trigger motion sensor
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Downstairs should be in "normal" scene (brightness 1.0, hue 30)
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='living_room_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='living_room_lamp')].data.Controllable.state.brightness" contains 1.0
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.power" contains true


# ============================================================================
# TEST 4: Downstairs gets "dark" scene when bedroom is in "dark"
# ============================================================================

# Reset: Turn off downstairs, set bedroom to dark scene
PUT {{base_url}}/api/v1/devices/living_room_lamp
Content-Type: application/json
{
    "id": "living_room_lamp",
    "name": "Living room lamp",
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

# Reset motion sensor
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200

# Trigger motion sensor
PUT {{base_url}}/api/v1/devices/staircase_motion
Content-Type: application/json
{
    "id": "staircase_motion",
    "name": "Staircase motion sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200

# Downstairs should be in "dark" scene (brightness 0.25, hue 25)
GET {{base_url}}/api/v1/devices
[Options]
retry: 10
retry-interval: 50ms
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='living_room_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='living_room_lamp')].data.Controllable.state.brightness" contains 0.25
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.power" contains true
jsonpath "$.devices[?(@.id=='kitchen_lamp')].data.Controllable.state.brightness" contains 0.25
