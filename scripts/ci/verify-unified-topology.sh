#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"

# Vercel is configured with dashboard/ as its project root, while AgentPay is a
# repository workspace. Rebuild the dependency lock from the repository
# manifests before verification so a stale platform cache or workspace-local
# install cannot keep vulnerable transitive versions alive.
echo "[unified-topology] regenerate dependency lock from manifests"
npm install --package-lock-only --ignore-scripts --legacy-peer-deps

# During this repair branch, export the generated lock into the preview's public
# directory. This is removed before merge after the canonical lock is committed.
if [ "${AGENTPAY_EXPORT_GENERATED_LOCKFILE:-0}" = "1" ]; then
  cp package-lock.json dashboard/public/generated-package-lock.json
fi

# Build verification must run against a clean tree that exactly matches the
# just-generated lock. Remove platform-installed workspace trees first because
# npm overrides are evaluated at the repository root and stale nested modules
# can otherwise survive Vercel's initial dashboard install.
echo "[unified-topology] install clean repository workspace dependencies"
rm -rf node_modules \
  dashboard/node_modules \
  facilitator/node_modules \
  facilitator-arc/node_modules \
  facilitator-combined/node_modules \
  resource-server/node_modules
npm ci --ignore-scripts --legacy-peer-deps --include=dev

# Audit the actual production dependency graph. The gate fails on any
# high/critical finding that is not explicitly reviewed by the checker.
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
