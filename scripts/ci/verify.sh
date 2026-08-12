#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AUTH_SECRET:?AUTH_SECRET is required}"
: "${KEY_ENCRYPTION_MASTER_KEY:?KEY_ENCRYPTION_MASTER_KEY is required}"
: "${CRON_SECRET:?CRON_SECRET is required}"

printf 'Node: %s\n' "$(node --version)"
printf 'npm: %s\n' "$(npm --version)"

# Dependency/SAST/secret scanning is owned by scripts/ci/security.sh and is a
# separate required workflow dependency of release-gate. Keep this job focused
# on executable application verification so security findings do not prevent
# migrations, lint, typecheck, tests, builds, and browser smoke tests from
# producing their own independent evidence.

(
  cd dashboard
  npm run db:deploy
  npm run db:resources:check
  npm run verify:governance
  npm run lint
  npm run typecheck
  npm run test
  npm run build
)

(
  cd facilitator
  npm run build
  npm run typecheck
  npm test
)

(
  cd facilitator-arc
  npm run build
  npm run typecheck
  npm test
)

npm run build --workspace=@agentpay/hedera-facilitator
npm run build --workspace=@agentpay/arc-facilitator
npm run typecheck --workspace=@agentpay/combined-facilitator
npm test --workspace=@agentpay/combined-facilitator
npm run build --workspace=@agentpay/combined-facilitator

(
  cd resource-server
  npm run build
  npm run typecheck
  npm test
)

if [[ "${CI_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  (
    cd dashboard
    npx playwright install --with-deps chromium
  )
fi

(
  cd dashboard
  npm run test:e2e
)
