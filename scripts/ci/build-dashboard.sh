#!/usr/bin/env sh
set -eu

# Vercel Preview deployments intentionally do not receive all Production-only
# credentials. Building a preview with APP_ENV=production would otherwise execute
# the production configuration gate during Next.js page-data collection and fail
# before the preview can be inspected. This override applies only to the build
# process of Vercel Preview deployments. Actual Vercel Production builds, local
# APP_ENV=production builds, and production runtime configuration remain strict.
if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${APP_ENV:-}" = "production" ]; then
  echo "[dashboard-build] Vercel Preview detected; using development config only for build-time evaluation"
  APP_ENV=development exec next build
fi

exec next build
