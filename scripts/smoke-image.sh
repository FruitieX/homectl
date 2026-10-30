#!/usr/bin/env bash
# Start a built homectl image with no configuration (SQLite in the container,
# no integrations, no MQTT) and check that it serves health, API and UI.
#
# Usage: scripts/smoke-image.sh <image>
set -euo pipefail

image="${1:?usage: $0 <image>}"
port="${SMOKE_PORT:-45289}"
name="homectl-smoke-$$"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container logs ---"
    docker logs "$name" 2>&1 | tail -100 || true
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker run -d --name "$name" -p "127.0.0.1:${port}:45289" \
  -e RUST_LOG=homectl_server=info "$image" >/dev/null

base="http://127.0.0.1:${port}"
for _ in $(seq 1 60); do
  if curl -fsS "$base/health/ready" >/dev/null 2>&1; then
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then
    echo "container exited before becoming ready" >&2
    exit 1
  fi
  sleep 1
done

check() {
  local path="$1" pattern="$2" body
  body="$(curl -fsS "$base$path")"
  if ! grep -q -- "$pattern" <<<"$body"; then
    echo "GET $path: response did not contain '$pattern'" >&2
    echo "$body" | head -c 500 >&2
    exit 1
  fi
  echo "ok: GET $path"
}

check /health/live ''
check /health/ready ''
check /api/v1/devices '"devices"'
check /api/v1/config/groups '"success":true'
check / '<div id="root"'

if docker logs "$name" 2>&1 | grep -iE 'panicked|\bERROR\b'; then
  echo "server logged errors during startup" >&2
  exit 1
fi
echo "image smoke test passed"
