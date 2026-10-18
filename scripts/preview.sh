#!/usr/bin/env bash
# Serve the homectl UI from a local checkout with /api, /health and /ws proxied
# to the production deployment, so any device on the LAN can preview local UI
# changes against live data.
#
# Override with HOMECTL_PREVIEW_CHECKOUT, HOMECTL_PREVIEW_PORT or
# HOMECTL_DEV_PROXY_TARGET.
set -euo pipefail

checkout="${HOMECTL_PREVIEW_CHECKOUT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
port="${HOMECTL_PREVIEW_PORT:-3000}"
target="${HOMECTL_DEV_PROXY_TARGET:-https://homectl.fruitiex.org}"

export HOMECTL_DEV_PROXY_TARGET="$target"

cd "$checkout"
echo "homectl preview: UI from $checkout, API via $target, on port $port"
exec nix develop .#default -c bash -lc "cd ui && exec pnpm dev --host 0.0.0.0 --port $port --strictPort"
