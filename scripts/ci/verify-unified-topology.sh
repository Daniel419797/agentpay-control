#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"

# Vercel's configured project root is dashboard/, so its first install can omit
# sibling-only runtime packages. Install the repository graph without changing
# package.json/package-lock and use the repository's established peer-resolution
# mode for the Hedera wallet-connect dependency. Dev dependencies are required
# here because this is a build-time verification step (tsc/vitest), not runtime.
echo "[unified-topology] ensure repository workspace dependencies"
npm install --ignore-scripts --no-save --package-lock=false --legacy-peer-deps --include=dev

# Audit the production dependency graph. npm currently reports one Prisma 7.9.1
# CLI/config advisory chain as production because Prisma Client peer-depends on
# the CLI. The checker permits only that exact advisory chain and fails on any
# additional high/critical finding or if the chain changes.
echo "[unified-topology] production dependency audit"
AUDIT_FILE="$(mktemp)"
trap 'rm -f "$AUDIT_FILE"' EXIT
npm audit --omit=dev --json > "$AUDIT_FILE" || true
node scripts/ci/check-production-audit.mjs "$AUDIT_FILE"

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

echo "[unified-topology] Resource server typecheck, tests and build"
APP_ENV=test npm run typecheck --workspace=@agentpay/resource-server
APP_ENV=test npm test --workspace=@agentpay/resource-server
APP_ENV=test npm run build --workspace=@agentpay/resource-server

echo "[unified-topology] Dashboard lint, typecheck and unit tests"
APP_ENV=test npm run lint --workspace=agentpay-control
APP_ENV=test npm run typecheck --workspace=agentpay-control
APP_ENV=test npm test --workspace=agentpay-control

echo "[unified-topology] complete"
