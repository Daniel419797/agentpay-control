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

if [[ ! -x "$CODEQL_BIN" ]]; then
  mkdir -p "$CODEQL_HOME"
  TMP_BUNDLE="$(mktemp)"
  trap 'rm -f "$TMP_BUNDLE"' EXIT
  curl --fail --location --retry 3 --retry-all-errors "$BUNDLE_URL" --output "$TMP_BUNDLE"
  printf '%s  %s\n' "$CODEQL_BUNDLE_SHA256" "$TMP_BUNDLE" | sha256sum --check --strict
  tar -xzf "$TMP_BUNDLE" -C "$CODEQL_HOME"
fi

"$CODEQL_BIN" version > "$OUT_DIR/codeql-version.txt"

DB_DIR="$(mktemp -d)"
trap 'rm -rf "$DB_DIR"' EXIT

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

# External CI does not rely on GitHub's code-scanning UI to decide whether a
# release is allowed. Any CodeQL code-scanning result blocks this gate and the
# SARIF remains available as immutable review evidence.
RESULT_COUNT="$(jq '[.runs[]?.results[]?] | length' "$OUT_DIR/codeql.sarif")"
printf 'codeql_results=%s\n' "$RESULT_COUNT" > "$OUT_DIR/codeql-summary.txt"
if [[ "$RESULT_COUNT" -ne 0 ]]; then
  printf 'CodeQL reported %s result(s); refusing release.\n' "$RESULT_COUNT" >&2
  exit 1
fi
