#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/artifacts/security"
mkdir -p "$OUT_DIR"

CODEQL_BUNDLE_VERSION="${CODEQL_BUNDLE_VERSION:-2.25.5}"
CODEQL_BUNDLE_SHA256="${CODEQL_BUNDLE_SHA256:-24717f939f1bef659f893ff4a9c99ba8c056fbaca9640f877c4dc74cf96486d7}"
CODEQL_CACHE_ROOT="${CODEQL_CACHE_ROOT:-$HOME/.cache/agentpay-codeql}"
CODEQL_HOME="$CODEQL_CACHE_ROOT/$CODEQL_BUNDLE_VERSION"
CODEQL_BIN="$CODEQL_HOME/codeql/codeql"
BUNDLE_URL="https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_BUNDLE_VERSION}/codeql-bundle-linux64.tar.gz"
TMP_BUNDLE=""
DB_DIR=""

cleanup() {
  [[ -z "$TMP_BUNDLE" ]] || rm -f "$TMP_BUNDLE"
  [[ -z "$DB_DIR" ]] || rm -rf "$DB_DIR"
}
trap cleanup EXIT

if [[ ! -x "$CODEQL_BIN" ]]; then
  mkdir -p "$CODEQL_HOME"
  TMP_BUNDLE="$(mktemp)"
  curl --fail --location --retry 3 --retry-all-errors "$BUNDLE_URL" --output "$TMP_BUNDLE"
  printf '%s  %s\n' "$CODEQL_BUNDLE_SHA256" "$TMP_BUNDLE" | sha256sum --check --strict
  tar -xzf "$TMP_BUNDLE" -C "$CODEQL_HOME"
  rm -f "$TMP_BUNDLE"
  TMP_BUNDLE=""
fi

"$CODEQL_BIN" version > "$OUT_DIR/codeql-version.txt"

DB_DIR="$(mktemp -d)"
cd "$ROOT_DIR"
"$CODEQL_BIN" database create "$DB_DIR/db" \
  --language=javascript-typescript \
  --source-root="$ROOT_DIR" \
  --threads=0

"$CODEQL_BIN" database analyze "$DB_DIR/db" \
  javascript-code-scanning.qls \
  --sarif-category=javascript-typescript \
  --format=sarif-latest \
  --output="$OUT_DIR/codeql.sarif" \
  --threads=0

# The external CI gate does not depend on GitHub's code-scanning UI. Parse the
# SARIF locally and fail closed if the code-scanning query suite reports any
# result. The summary intentionally prints only rule, source location and the
# scanner message; no source snippets or runtime secrets are emitted.
python3 --version > "$OUT_DIR/python-version.txt"
RESULT_COUNT="$(python3 - "$OUT_DIR/codeql.sarif" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    sarif = json.load(handle)

print(sum(len(run.get("results", [])) for run in sarif.get("runs", [])))
PY
)"
printf 'codeql_results=%s\n' "$RESULT_COUNT" > "$OUT_DIR/codeql-summary.txt"
if [[ "$RESULT_COUNT" -ne 0 ]]; then
  printf 'CodeQL reported %s result(s); refusing release.\n' "$RESULT_COUNT" >&2
  python3 - "$OUT_DIR/codeql.sarif" <<'PY' || true
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    sarif = json.load(handle)

print("=== Sanitized CodeQL finding summary ===")
shown = 0
for run in sarif.get("runs", []):
    for result in run.get("results", []):
        rule = str(result.get("ruleId") or "unknown")[:160]
        message = " ".join(str((result.get("message") or {}).get("text") or "").split())[:240]
        location = "unknown"
        locations = result.get("locations") or []
        if locations:
            physical = (locations[0].get("physicalLocation") or {})
            artifact = (physical.get("artifactLocation") or {})
            region = (physical.get("region") or {})
            path = str(artifact.get("uri") or "unknown")[:200]
            line = region.get("startLine") or "?"
            location = f"{path}:{line}"
        print(f"  - {rule} {location}" + (f" :: {message}" if message else ""))
        shown += 1
        if shown >= 100:
            break
    if shown >= 100:
        break
print("=== End sanitized CodeQL finding summary ===")
PY
  exit 1
fi
