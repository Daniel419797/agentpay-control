#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_TAG="${CIRCLE_SHA1:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf 'local')}"

SERVICES=(
  facilitator
  facilitator-arc
  facilitator-combined
  resource-server
)

cd "$ROOT_DIR"
for service in "${SERVICES[@]}"; do
  printf '\n==> Building %s\n' "$service"
  docker build \
    -f "$service/Dockerfile" \
    -t "agentpay/${service}:${RELEASE_TAG}" \
    .
done
