# Staircase Motion Sensor Tests
# Tests realistic scenarios based on actual prod config patterns:
# - Motion sensor turns on upstairs lights only when they're OFF
# - Motion sensor turns on downstairs lights with matching scene based on bedroom
#
# @configfile configs/staircase-motion.json

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
