# Homectl Health and Server State Tests
# These tests verify the server is running and responding correctly

# ============================================================================
# LIVENESS CHECK - Server is running
# ============================================================================

GET {{base_url}}/health/live
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"


# ============================================================================
# READINESS CHECK - Server is ready to handle requests
# ============================================================================

# Server should report ready status after warmup
# Note: The test harness waits for liveness before running, so server should be ready
GET {{base_url}}/health/ready
HTTP 200
[Asserts]
jsonpath "$.status" == "ready"
