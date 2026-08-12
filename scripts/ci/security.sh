#!/usr/bin/env bash
set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="$ROOT_DIR/artifacts/security"
mkdir -p "$OUT_DIR"

NODE_IMAGE="${NODE_IMAGE:-node:22.22-bookworm}"
OSV_IMAGE="${OSV_IMAGE:-ghcr.io/google/osv-scanner:v2.4.0}"
SEMGREP_IMAGE="${SEMGREP_IMAGE:-semgrep/semgrep:1.172.0}"
GITLEAKS_IMAGE="${GITLEAKS_IMAGE:-ghcr.io/gitleaks/gitleaks:v8.30.1}"
STATUS=0

record_failure() {
  local name="$1"
  local code="$2"
  printf '%s failed with exit code %s\n' "$name" "$code" >&2
  STATUS=1
}

printf 'node_image=%s\nosv_image=%s\nsemgrep_image=%s\ngitleaks_image=%s\n' \
  "$NODE_IMAGE" "$OSV_IMAGE" "$SEMGREP_IMAGE" "$GITLEAKS_IMAGE" \
  > "$OUT_DIR/tool-images.txt"

# npm audit is retained as an independent ecosystem-specific high-severity gate.
docker run --rm \
  -v "$ROOT_DIR:/workspace" \
  -w /workspace \
  "$NODE_IMAGE" \
  bash -lc 'npm install --global npm@11.11.1 >/dev/null && npm audit --omit=dev --audit-level=high --json' \
  > "$OUT_DIR/npm-audit.json"
RC=$?
[[ $RC -eq 0 ]] || record_failure "npm audit" "$RC"

# OSV Scanner checks supported manifests/lockfiles recursively against OSV data.
docker run --rm \
  -v "$ROOT_DIR:/src" \
  "$OSV_IMAGE" \
  scan source --recursive --format json --output-file /src/artifacts/security/osv.json /src
RC=$?
[[ $RC -eq 0 ]] || record_failure "OSV Scanner" "$RC"

# Semgrep CE blocks source findings from the OWASP Top Ten ruleset.
docker run --rm \
  -v "$ROOT_DIR:/src" \
  -w /src \
  "$SEMGREP_IMAGE" \
  semgrep scan \
    --config p/owasp-top-ten \
    --error \
    --metrics=off \
    --json \
    --output /src/artifacts/security/semgrep.json \
    /src
RC=$?
[[ $RC -eq 0 ]] || record_failure "Semgrep" "$RC"

# Scan the release tree for embedded credentials. Git history is deliberately
# separate from this release gate so a historical baseline cannot suppress a
# secret that is present in the immutable source tree being released.
docker run --rm \
  -v "$ROOT_DIR:/repo" \
  "$GITLEAKS_IMAGE" \
  dir /repo \
    --redact=100 \
    --report-format json \
    --report-path /repo/artifacts/security/gitleaks.json \
    --exit-code 1 \
    --no-banner
RC=$?
[[ $RC -eq 0 ]] || record_failure "Gitleaks" "$RC"

(
  cd "$OUT_DIR"
  sha256sum npm-audit.json osv.json semgrep.json gitleaks.json > report-sha256.txt 2>/dev/null || true
)

exit "$STATUS"
