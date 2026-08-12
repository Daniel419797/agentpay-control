#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_TAG="${CIRCLE_SHA1:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf 'local')}"

cd "$ROOT_DIR/cardano-signer"
npm run typecheck
npm test

cd "$ROOT_DIR"
# The production signer image contains code only. Signing material is injected at
# runtime by the isolated custody boundary and is never passed as a Docker build
# argument or baked into an image layer.
docker build \
  -f cardano-signer/Dockerfile \
  -t "agentpay/cardano-signer:${RELEASE_TAG}" \
  .
