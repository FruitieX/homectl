# Trigger Mode Tests
# Tests for the different trigger modes: pulse, edge, and level
#
# Pulse mode (default for sensors): Triggers on every matching update when device is event source
# Edge mode: Only triggers on state transitions (new state != previous state)
# Level mode (default for device/group rules): Original behavior - triggers when rule becomes true
#
# @config
# [groups.bedroom]
# name = "Bedroom"
# devices = [
#   { integration_id = "dummy", name = "Bedroom Light 1" },
#   { integration_id = "dummy", name = "Bedroom Light 2" }
# ]
#
# [scenes.bright]
# name = "Bright"
# groups.bedroom.power = true
# groups.bedroom.brightness = 1.0
#
# [scenes.dim]
# name = "Dim"
# groups.bedroom.power = true
# groups.bedroom.brightness = 0.3
#
# [scenes.off]
# name = "Off"
# groups.bedroom.power = false
#
# # Pulse mode routine (default for sensors) - triggers on every matching update
# [routines.pulse_button]
# name = "Pulse Button"
# rules = [
#   { integration_id = "dummy", name = "Pulse Switch", state = { value = "press" } }
# ]
# actions = [
#   { action = "CycleScenes", scenes = [
#     { scene_id = "bright" },
#     { scene_id = "dim" },
#     { scene_id = "off" }
#   ]}
# ]
#
# # Edge mode routine - only triggers on state transitions
# [routines.edge_button]
# name = "Edge Button"
# rules = [
#   { integration_id = "dummy", name = "Edge Switch", state = { value = "press" }, trigger_mode = "edge" }
# ]
# actions = [
#   { action = "ActivateScene", scene_id = "bright" }
# ]
# @endconfig

# ============================================================================
# SETUP - Create devices
# ============================================================================

# Create bedroom lights (initially off)
PUT {{base_url}}/api/v1/devices/bed_light_1
Content-Type: application/json
{
    "id": "bed_light_1",
    "name": "Bedroom Light 1",
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

PUT {{base_url}}/api/v1/devices/bed_light_2
Content-Type: application/json
{
    "id": "bed_light_2",
    "name": "Bedroom Light 2",
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

# Create sensors
PUT {{base_url}}/api/v1/devices/pulse_switch
Content-Type: application/json
{
    "id": "pulse_switch",
    "name": "Pulse Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "idle" }
    }
}
HTTP 200

PUT {{base_url}}/api/v1/devices/edge_switch
Content-Type: application/json
{
    "id": "edge_switch",
    "name": "Edge Switch",
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
    "name": "Motion Sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200


# ============================================================================
# TEST 1: Pulse Mode - Triggers on every matching update (even same value)
# ============================================================================

# 1. Initial state - lights should be off
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes false

# 2. First button press - should cycle to "bright" (first scene)
PUT {{base_url}}/api/v1/devices/pulse_switch
Content-Type: application/json
{
    "id": "pulse_switch",
    "name": "Pulse Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes true
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.brightness" includes 1.0

# 3. Second button press - SAME VALUE "press" again
#    With pulse mode, this should STILL trigger and cycle to "dim"
PUT {{base_url}}/api/v1/devices/pulse_switch
Content-Type: application/json
{
    "id": "pulse_switch",
    "name": "Pulse Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes true
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.brightness" includes 0.3

# 4. Third button press - SAME VALUE "press" again
#    Should cycle to "off"
PUT {{base_url}}/api/v1/devices/pulse_switch
Content-Type: application/json
{
    "id": "pulse_switch",
    "name": "Pulse Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes false

# 5. Fourth button press - Should cycle back to "bright"
PUT {{base_url}}/api/v1/devices/pulse_switch
Content-Type: application/json
{
    "id": "pulse_switch",
    "name": "Pulse Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes true
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.brightness" includes 1.0


# ============================================================================
# TEST 2: Edge Mode - Only triggers on state transitions
# ============================================================================

# Reset lights to off for this test
PUT {{base_url}}/api/v1/devices/bed_light_1
Content-Type: application/json
{
    "id": "bed_light_1",
    "name": "Bedroom Light 1",
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

PUT {{base_url}}/api/v1/devices/bed_light_2
Content-Type: application/json
{
    "id": "bed_light_2",
    "name": "Bedroom Light 2",
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

# Verify lights are off
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes false

# 1. First edge button press - should trigger and turn lights bright
PUT {{base_url}}/api/v1/devices/edge_switch
Content-Type: application/json
{
    "id": "edge_switch",
    "name": "Edge Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes true
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.brightness" includes 1.0

# 2. Turn lights off manually for the next test
PUT {{base_url}}/api/v1/devices/bed_light_1
Content-Type: application/json
{
    "id": "bed_light_1",
    "name": "Bedroom Light 1",
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

PUT {{base_url}}/api/v1/devices/bed_light_2
Content-Type: application/json
{
    "id": "bed_light_2",
    "name": "Bedroom Light 2",
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

# 3. Second edge button press - SAME VALUE "press" again
#    With edge mode, this should NOT trigger because there's no transition
#    (switch was already at "press")
PUT {{base_url}}/api/v1/devices/edge_switch
Content-Type: application/json
{
    "id": "edge_switch",
    "name": "Edge Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

# Lights should STILL be off (edge mode didn't re-trigger)
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes false

# 4. Change switch to different value, then back to "press"
#    This should now trigger because it's a real transition
PUT {{base_url}}/api/v1/devices/edge_switch
Content-Type: application/json
{
    "id": "edge_switch",
    "name": "Edge Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "release" }
    }
}
HTTP 200

# Lights still off (release doesn't match the rule)
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes false

# Now press again - this IS a transition from "release" to "press"
PUT {{base_url}}/api/v1/devices/edge_switch
Content-Type: application/json
{
    "id": "edge_switch",
    "name": "Edge Switch",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": "press" }
    }
}
HTTP 200

# NOW lights should be on (edge transition detected)
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.power" includes true
jsonpath "$.devices[?(@.id=='bed_light_1')].data.Controllable.state.brightness" includes 1.0
