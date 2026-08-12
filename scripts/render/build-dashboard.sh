#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/render/release-sha.sh
source "$ROOT_DIR/scripts/render/release-sha.sh"
assert_render_release_sha
configure_render_dashboard_env

cd "$ROOT_DIR"
npm install --global npm@11.11.1
npm ci
npm run build --workspace=dashboard

printf 'Built AgentPay dashboard for immutable release %s\n' "$RELEASE_SHA"
