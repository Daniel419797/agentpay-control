import fs from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("OSV JSON path is required");

const report = JSON.parse(fs.readFileSync(path, "utf8"));
const results = Array.isArray(report?.results) ? report.results : [];
const findings = [];

for (const result of results) {
  const packages = Array.isArray(result?.packages) ? result.packages : [];
  for (const entry of packages) {
    const name = entry?.package?.name;
    const version = entry?.package?.version;
    const vulnerabilities = Array.isArray(entry?.vulnerabilities) ? entry.vulnerabilities : [];
    for (const vulnerability of vulnerabilities) {
      const id = vulnerability?.id;
      if (typeof name === "string" && typeof id === "string") {
        findings.push({ name, version: typeof version === "string" ? version : "", id });
      }
    }
  }
}

if (findings.length === 0) {
  console.log("[osv-policy] no dependency vulnerabilities reported");
  process.exit(0);
}

// Prisma 7.9.1 currently brings deepmerge-ts into the scanned lock graph via
// its CLI/config dependency. Keep this exception exactly aligned with
// check-production-audit.mjs: only GHSA-ggr8-5vv4-36mx on deepmerge-ts is
// accepted while Prisma publishes a compatible fix. Any other package or
// advisory remains a hard failure.
const allowed = findings.filter(
  (finding) => finding.name === "deepmerge-ts" && finding.id === "GHSA-ggr8-5vv4-36mx",
);
const unapproved = findings.filter(
  (finding) => !(finding.name === "deepmerge-ts" && finding.id === "GHSA-ggr8-5vv4-36mx"),
);

if (unapproved.length > 0) {
  for (const finding of unapproved) {
    console.error(`[osv-policy] unapproved finding: ${finding.name}@${finding.version || "unknown"} ${finding.id}`);
  }
  process.exit(1);
}

if (allowed.length === 0) {
  console.error("[osv-policy] expected Prisma deepmerge-ts exception did not match the OSV report");
  process.exit(1);
}

console.warn(
  `[osv-policy] allowing only known Prisma CLI/config advisory GHSA-ggr8-5vv4-36mx on deepmerge-ts (${allowed.length} occurrence${allowed.length === 1 ? "" : "s"}); no other OSV findings present`,
);
