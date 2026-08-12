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

print_sanitized_findings() {
  command -v python3 >/dev/null 2>&1 || {
    printf 'python3 unavailable; scanner JSON remains in CircleCI artifacts.\n' >&2
    return 0
  }

  python3 - "$OUT_DIR" <<'PY' || true
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])


def load(name, fallback):
    path = out / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def clean(value, limit=240):
    text = " ".join(str(value or "").split())
    return text[:limit]

print("\n=== Sanitized security finding summary ===")

audit = load("npm-audit.json", {})
vulns = audit.get("vulnerabilities", {}) if isinstance(audit, dict) else {}
if vulns:
    print("npm audit:")
    for name, item in sorted(vulns.items()):
        if not isinstance(item, dict):
            continue
        severity = clean(item.get("severity", "unknown"))
        via = item.get("via", [])
        ids = []
        for entry in via:
            if isinstance(entry, dict):
                ident = entry.get("url") or entry.get("source") or entry.get("title")
                if ident:
                    ids.append(clean(ident, 120))
        print(f"  - {clean(name, 120)} [{severity}]" + (f" :: {', '.join(ids[:4])}" if ids else ""))

osv = load("osv.json", {})
osv_rows = []
if isinstance(osv, dict):
    for result in osv.get("results", []) or []:
        if not isinstance(result, dict):
            continue
        source = result.get("source", {}) if isinstance(result.get("source"), dict) else {}
        source_path = clean(source.get("path", ""), 180)
        for package_entry in result.get("packages", []) or []:
            if not isinstance(package_entry, dict):
                continue
            package = package_entry.get("package", {}) if isinstance(package_entry.get("package"), dict) else {}
            name = clean(package.get("name", "unknown"), 120)
            version = clean(package.get("version", ""), 80)
            ids = [clean(v.get("id", ""), 80) for v in package_entry.get("vulnerabilities", []) or [] if isinstance(v, dict)]
            if ids:
                osv_rows.append((name, version, source_path, ids))
if osv_rows:
    print("OSV Scanner:")
    for name, version, source_path, ids in osv_rows[:100]:
        suffix = f" @ {source_path}" if source_path else ""
        print(f"  - {name}{('@' + version) if version else ''}: {', '.join(ids[:8])}{suffix}")

semgrep = load("semgrep.json", {})
results = semgrep.get("results", []) if isinstance(semgrep, dict) else []
if results:
    print("Semgrep:")
    for finding in results[:100]:
        if not isinstance(finding, dict):
            continue
        start = finding.get("start", {}) if isinstance(finding.get("start"), dict) else {}
        extra = finding.get("extra", {}) if isinstance(finding.get("extra"), dict) else {}
        line = start.get("line", "?")
        severity = clean(extra.get("severity", "unknown"), 40)
        message = clean(extra.get("message", ""), 200)
        print(f"  - {clean(finding.get('check_id', 'unknown'), 160)} [{severity}] {clean(finding.get('path', ''), 180)}:{line} :: {message}")

leaks = load("gitleaks.json", [])
if isinstance(leaks, list) and leaks:
    print("Gitleaks (secret values intentionally omitted):")
    for leak in leaks[:100]:
        if not isinstance(leak, dict):
            continue
        rule = clean(leak.get("RuleID") or leak.get("RuleId") or "unknown", 120)
        path = clean(leak.get("File") or leak.get("file") or "", 180)
        line = leak.get("StartLine") or leak.get("startLine") or "?"
        description = clean(leak.get("Description") or leak.get("description") or "", 180)
        print(f"  - {rule} {path}:{line}" + (f" :: {description}" if description else ""))

print("=== End sanitized security finding summary ===\n")
PY
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

print_sanitized_findings

(
  cd "$OUT_DIR"
  sha256sum npm-audit.json osv.json semgrep.json gitleaks.json > report-sha256.txt 2>/dev/null || true
)

exit "$STATUS"
