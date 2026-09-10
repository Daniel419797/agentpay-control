#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_TAG="${CIRCLE_SHA1:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf 'local')}"
NODE_IMAGE="${NODE_IMAGE:-node:22.22-bookworm}"

SERVICES=(
  facilitator
  facilitator-arc
  facilitator-combined
  resource-server
)

cd "$ROOT_DIR"

# Production images must use the dependency graph represented by the current
# manifests and security overrides. Regenerate the lock before building so a
# stale committed lock cannot retain a vulnerable transitive dependency.
printf '\n==> Regenerating dependency lock for production image builds\n'
docker run --rm \
  -v "$ROOT_DIR:/workspace" \
  -w /workspace \
  "$NODE_IMAGE" \
  bash -lc 'npm install --global npm@11.11.1 >/dev/null && npm install --package-lock-only --ignore-scripts --legacy-peer-deps'

for service in "${SERVICES[@]}"; do
  printf '\n==> Building %s\n' "$service"
  docker build \
    -f "$service/Dockerfile" \
    -t "agentpay/${service}:${RELEASE_TAG}" \
    .
done
