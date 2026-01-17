# Homectl Configuration API Tests
# Tests for config CRUD operations and import/export roundtrip

# ============================================================================
# CORE CONFIG
# ============================================================================

# Get core config
GET {{base_url}}/api/v1/config/core
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.warmup_time_seconds" isInteger

# Update core config
PUT {{base_url}}/api/v1/config/core
Content-Type: application/json
{
    "warmup_time_seconds": 5
}
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.warmup_time_seconds" == 5

# Verify core config was updated
GET {{base_url}}/api/v1/config/core
HTTP 200
[Asserts]
jsonpath "$.data.warmup_time_seconds" == 5

# Reset core config
PUT {{base_url}}/api/v1/config/core
Content-Type: application/json
{
    "warmup_time_seconds": 1
}
HTTP 200


# ============================================================================
# GROUPS CRUD
# ============================================================================

# Create a test group
POST {{base_url}}/api/v1/config/groups
Content-Type: application/json
{
    "id": "test-hurl-group",
    "name": "Test Hurl Group",
    "hidden": false,
    "devices": [],
    "linked_groups": []
}
HTTP 201
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.id" == "test-hurl-group"

# Get the created group
GET {{base_url}}/api/v1/config/groups/test-hurl-group
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.name" == "Test Hurl Group"

# Update the group
PUT {{base_url}}/api/v1/config/groups/test-hurl-group
Content-Type: application/json
{
    "id": "test-hurl-group",
    "name": "Updated Hurl Group",
    "hidden": true,
    "devices": [],
    "linked_groups": []
}
HTTP 200
[Asserts]
jsonpath "$.data.name" == "Updated Hurl Group"
jsonpath "$.data.hidden" == true

# Delete the group
DELETE {{base_url}}/api/v1/config/groups/test-hurl-group
HTTP 200
[Asserts]
jsonpath "$.success" == true


# ============================================================================
# SCENES CRUD
# ============================================================================

# Create a test scene
POST {{base_url}}/api/v1/config/scenes
Content-Type: application/json
{
    "id": "test-hurl-scene",
    "name": "Test Hurl Scene",
    "hidden": false,
    "script": null,
    "device_states": {},
    "group_states": {}
}
HTTP 201
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.id" == "test-hurl-scene"

# Get the scene
GET {{base_url}}/api/v1/config/scenes/test-hurl-scene
HTTP 200
[Asserts]
jsonpath "$.data.name" == "Test Hurl Scene"

# Update with script
PUT {{base_url}}/api/v1/config/scenes/test-hurl-scene
Content-Type: application/json
{
    "id": "test-hurl-scene",
    "name": "Updated Hurl Scene",
    "hidden": false,
    "script": "({ power: true, brightness: 0.5 })",
    "device_states": {},
    "group_states": {}
}
HTTP 200
[Asserts]
jsonpath "$.data.script" == "({ power: true, brightness: 0.5 })"

# Delete the scene
DELETE {{base_url}}/api/v1/config/scenes/test-hurl-scene
HTTP 200


# ============================================================================
# ROUTINES CRUD
# ============================================================================

# Create a test routine
POST {{base_url}}/api/v1/config/routines
Content-Type: application/json
{
    "id": "test-hurl-routine",
    "name": "Test Hurl Routine",
    "enabled": true,
    "rules": [],
    "actions": []
}
HTTP 201
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.id" == "test-hurl-routine"

# Get the routine
GET {{base_url}}/api/v1/config/routines/test-hurl-routine
HTTP 200
[Asserts]
jsonpath "$.data.name" == "Test Hurl Routine"
jsonpath "$.data.enabled" == true

# Update routine with rules and actions
PUT {{base_url}}/api/v1/config/routines/test-hurl-routine
Content-Type: application/json
{
    "id": "test-hurl-routine",
    "name": "Updated Hurl Routine",
    "enabled": false,
    "rules": [
        {
            "Sensor": {
                "device_ref": { "IntegrationDeviceId": { "integration_id": "test", "device_id": "sensor1" } },
                "state": { "OnOffSensor": { "value": true } },
                "trigger_mode": "Level"
            }
        }
    ],
    "actions": [
        {
            "ActivateScene": { "scene_id": "some-scene" }
        }
    ]
}
HTTP 200
[Asserts]
jsonpath "$.data.enabled" == false
jsonpath "$.data.rules" count == 1
jsonpath "$.data.actions" count == 1

# Delete the routine
DELETE {{base_url}}/api/v1/config/routines/test-hurl-routine
HTTP 200


# ============================================================================
# EXPORT/IMPORT ROUNDTRIP
# ============================================================================

# Export current config
GET {{base_url}}/api/v1/config/export
HTTP 200
[Asserts]
jsonpath "$.success" == true
jsonpath "$.data.version" isInteger
jsonpath "$.data.core" exists
jsonpath "$.data.integrations" isCollection
jsonpath "$.data.groups" isCollection
jsonpath "$.data.scenes" isCollection
jsonpath "$.data.routines" isCollection
