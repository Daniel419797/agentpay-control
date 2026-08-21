import fs from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("audit JSON path is required");

const report = JSON.parse(fs.readFileSync(path, "utf8"));
const vulnerabilities = report.vulnerabilities ?? {};
const severe = Object.entries(vulnerabilities).filter(([, value]) => value?.severity === "high" || value?.severity === "critical");

if (severe.length === 0) {
  console.log("[production-audit] no high/critical runtime dependency findings");
  process.exit(0);
}

// Prisma 7.9.1 currently pulls its CLI/config package into npm's production
// dependency graph through the Prisma Client peer relationship. The CLI config
// package depends on deepmerge-ts <8 and is affected by GHSA-ggr8-5vv4-36mx.
// npm's proposed automatic remediation is a breaking Prisma downgrade to 6.12.0.
// Permit ONLY this exact known chain while Prisma publishes a compatible fix.
const allowedPackages = new Set(["deepmerge-ts", "@prisma/config", "prisma"]);
for (const [name] of severe) {
  if (!allowedPackages.has(name)) {
    console.error(`[production-audit] unapproved high/critical finding: ${name}`);
    process.exit(1);
  }
}

const deepmerge = vulnerabilities["deepmerge-ts"];
const advisory = Array.isArray(deepmerge?.via)
  ? deepmerge.via.find((entry) => typeof entry === "object" && entry !== null && String(entry.url ?? "").includes("GHSA-ggr8-5vv4-36mx"))
  : undefined;

if (!advisory) {
  console.error("[production-audit] Prisma exception no longer matches the expected deepmerge-ts advisory");
  process.exit(1);
}

const prismaVia = Array.isArray(vulnerabilities.prisma?.via) ? vulnerabilities.prisma.via : [];
const configVia = Array.isArray(vulnerabilities["@prisma/config"]?.via) ? vulnerabilities["@prisma/config"].via : [];
if (!prismaVia.includes("@prisma/config") || !configVia.includes("deepmerge-ts")) {
  console.error("[production-audit] Prisma exception dependency chain changed; review required");
  process.exit(1);
}

console.warn("[production-audit] allowing only known Prisma CLI/config advisory GHSA-ggr8-5vv4-36mx; no other high/critical findings present");
