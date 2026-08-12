#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/artifacts/release"
mkdir -p "$OUT_DIR"

cd "$ROOT_DIR"
ACTUAL_SHA="$(git rev-parse HEAD)"
EXPECTED_SHA="${CIRCLE_SHA1:-}"

if [[ -z "$EXPECTED_SHA" ]]; then
  printf 'CIRCLE_SHA1 is required for release evidence.\n' >&2
  exit 1
fi

if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  printf 'Release SHA mismatch: checkout=%s CircleCI=%s\n' "$ACTUAL_SHA" "$EXPECTED_SHA" >&2
  exit 1
fi

TREE_SHA="$(git rev-parse 'HEAD^{tree}')"
export ACTUAL_SHA TREE_SHA OUT_DIR

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  releaseSha: process.env.ACTUAL_SHA,
  sourceTreeSha: process.env.TREE_SHA,
  sourceRepository: process.env.CIRCLE_PROJECT_REPONAME
    ? `${process.env.CIRCLE_PROJECT_USERNAME}/${process.env.CIRCLE_PROJECT_REPONAME}`
    : 'Daniel419797/agentpay-control',
  ci: {
    provider: 'circleci',
    pipelineId: process.env.CIRCLE_PIPELINE_ID || null,
    workflowId: process.env.CIRCLE_WORKFLOW_ID || null,
    buildNumber: process.env.CIRCLE_BUILD_NUM || null,
    branch: process.env.CIRCLE_BRANCH || null,
    tag: process.env.CIRCLE_TAG || null,
    requiredJobs: [
      'verify',
      'security',
      'codeql',
      'cardano-signer',
      'container-builds'
    ],
    prerequisiteSemantics: 'This job is scheduled only after every required job succeeds.'
  },
  externalProductionEvidence: {
    status: 'NOT_EVALUATED_BY_CI',
    note: 'This manifest does not attest Mainnet canaries, custody review, restore drills, on-call readiness, provider approvals, or independent security assessment.'
  }
};

fs.writeFileSync(
  path.join(process.env.OUT_DIR, 'ci-release-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 }
);
NODE

(
  cd "$OUT_DIR"
  sha256sum ci-release-manifest.json > ci-release-manifest.sha256
)

printf 'Release gate bound to %s\n' "$ACTUAL_SHA"
