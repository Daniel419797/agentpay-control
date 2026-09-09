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

run_step() {
  printf '\n[verify] %s\n' "$1"
  shift
  "$@"
}

# Dependency/SAST/secret scanning is owned by scripts/ci/security.sh and is a
# separate required workflow dependency of release-gate. This job produces
# independent executable evidence for migrations, lint, typecheck, tests,
# builds, the card executor, and browser smoke tests.

(
  cd dashboard
  run_step "deploy database migrations" npm run db:deploy
  run_step "check canonical resources" npm run db:resources:check
  run_step "verify governance" npm run verify:governance
  run_step "lint dashboard" npm run lint
  run_step "typecheck dashboard" npm run typecheck
  run_step "test dashboard" npm run test
  # Call the underlying build script directly. `npm run build` would execute
  # dashboard/prebuild, which deliberately runs the repository-wide security
  # and topology gate again; security has its own required CircleCI job.
  run_step "build dashboard" bash ../scripts/ci/build-dashboard.sh
)

(
  cd facilitator
  run_step "build Hedera facilitator" npm run build
  run_step "typecheck Hedera facilitator" npm run typecheck
  run_step "test Hedera facilitator" npm test
)

(
  cd facilitator-arc
  run_step "build Arc facilitator" npm run build
  run_step "typecheck Arc facilitator" npm run typecheck
  run_step "test Arc facilitator" npm test
)

run_step "build Hedera facilitator workspace" npm run build --workspace=@agentpay/hedera-facilitator
run_step "build Arc facilitator workspace" npm run build --workspace=@agentpay/arc-facilitator
run_step "typecheck combined facilitator" npm run typecheck --workspace=@agentpay/combined-facilitator
run_step "test combined facilitator" npm test --workspace=@agentpay/combined-facilitator
run_step "build combined facilitator" npm run build --workspace=@agentpay/combined-facilitator

(
  cd resource-server
  run_step "build resource server" npm run build
  run_step "typecheck resource server" npm run typecheck
  run_step "test resource server" npm test
)

(
  cd card-executor
  run_step "install card executor dependencies" npm install --ignore-scripts --no-audit --no-fund
  run_step "audit card executor runtime dependencies" npm audit --omit=dev --audit-level=high
  run_step "syntax-check card executor" node --check src/index.mjs
  node --check src/checkout.mjs
  node --check src/security.mjs
  node --check src/stripe.mjs
  run_step "test card executor" npm test
)

if [[ "${CI_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  (
    cd dashboard
    run_step "install Playwright Chromium" npx playwright install --with-deps chromium
  )
fi

(
  cd dashboard
  run_step "run browser smoke tests" npm run test:e2e
)
