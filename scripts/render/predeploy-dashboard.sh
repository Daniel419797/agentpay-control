#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/render/release-sha.sh
source "$ROOT_DIR/scripts/render/release-sha.sh"
assert_render_release_sha
configure_render_dashboard_env

: "${DATABASE_URL:?DATABASE_URL is required for production migration}"

cd "$ROOT_DIR"
npm run db:deploy --workspace=dashboard
printf 'Applied production migrations for immutable release %s\n' "$RELEASE_SHA"
