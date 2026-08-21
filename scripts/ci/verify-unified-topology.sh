#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"

# Vercel's project root is dashboard/, so its initial install may omit sibling
# workspace-only runtime packages. Add the locked workspace dependencies without
# rewriting package.json/package-lock or running package lifecycle scripts.
echo "[unified-topology] ensure backend workspace dependencies"
npm install --ignore-scripts --no-save --package-lock=false --workspaces --include-workspace-root=false

echo "[unified-topology] Cardano signer syntax and tests"
(
  cd cardano-signer
  npm run typecheck
  npm test
)

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
