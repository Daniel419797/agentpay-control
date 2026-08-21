#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"

echo "[unified-topology] Cardano signer syntax and tests"
npm run typecheck --workspace=@agentpay/cardano-signer
npm test --workspace=@agentpay/cardano-signer

echo "[unified-topology] Hedera facilitator typecheck, tests and build"
npm run typecheck --workspace=@agentpay/hedera-facilitator
npm test --workspace=@agentpay/hedera-facilitator
npm run build --workspace=@agentpay/hedera-facilitator

echo "[unified-topology] Arc facilitator typecheck, tests and build"
npm run typecheck --workspace=@agentpay/arc-facilitator
npm test --workspace=@agentpay/arc-facilitator
npm run build --workspace=@agentpay/arc-facilitator

echo "[unified-topology] Combined facilitator typecheck, tests and build"
npm run typecheck --workspace=@agentpay/combined-facilitator
npm test --workspace=@agentpay/combined-facilitator
npm run build --workspace=@agentpay/combined-facilitator

echo "[unified-topology] complete"
