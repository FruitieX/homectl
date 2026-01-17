# Device State Management Tests
# Tests for creating devices via dummy integration and modifying their state

# ============================================================================
# CREATE A DUMMY DEVICE VIA PUT
# ============================================================================

# Create a test light device using the dummy integration
PUT {{base_url}}/api/v1/devices/test-light
Content-Type: application/json
{
    "id": "test-light",
    "name": "Test Light",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": null,
            "state": {
                "power": false,
                "brightness": 0.5,
                "color": null,
                "transition": null
            },
            "capabilities": {
                "color_modes": ["hs", "ct"],
                "min_ct": 2700,
                "max_ct": 6500
            },
            "managed": "Full"
        }
    }
}
HTTP 200


# ============================================================================
# VERIFY DEVICE EXISTS IN DEVICE LIST
# ============================================================================

# Get all devices and verify our test device is present
GET {{base_url}}/api/v1/devices
HTTP 200
[Asserts]
# At least one device should exist (our test device)
jsonpath "$.devices" count >= 1


# ============================================================================
# TURN ON THE DEVICE
# ============================================================================

# Update the device to be powered on
PUT {{base_url}}/api/v1/devices/test-light
Content-Type: application/json
{
    "id": "test-light",
    "name": "Test Light",
    "integration_id": "dummy",
    "data": {
        "Controllable": {
            "scene_id": null,
            "state": {
                "power": true,
                "brightness": 1.0,
                "color": null,
                "transition": null
            },
            "capabilities": {
                "color_modes": ["hs", "ct"],
                "min_ct": 2700,
                "max_ct": 6500
            },
            "managed": "Full"
        }
    }
}
HTTP 200


# ============================================================================
# CREATE A SENSOR DEVICE
# ============================================================================

# Create a motion sensor
PUT {{base_url}}/api/v1/devices/motion-sensor
Content-Type: application/json
{
    "id": "motion-sensor",
    "name": "Motion Sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": false }
    }
}
HTTP 200


# ============================================================================
# TRIGGER SENSOR STATE CHANGE
# ============================================================================

# Simulate motion detected
PUT {{base_url}}/api/v1/devices/motion-sensor
Content-Type: application/json
{
    "id": "motion-sensor",
    "name": "Motion Sensor",
    "integration_id": "dummy",
    "data": {
        "Sensor": { "value": true }
    }
}
HTTP 200


# ============================================================================
# VERIFY DEVICES WITH COLOR MODE PARAMETER
# ============================================================================

# Request devices with HS color mode - should work
GET {{base_url}}/api/v1/devices?color_mode=Hs
HTTP 200
