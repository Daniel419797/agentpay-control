#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/render/release-sha.sh
source "$ROOT_DIR/scripts/render/release-sha.sh"
assert_render_release_sha

cd "$ROOT_DIR"
printf 'Starting AgentPay dashboard release %s\n' "$RELEASE_SHA"
exec npm run start --workspace=dashboard
