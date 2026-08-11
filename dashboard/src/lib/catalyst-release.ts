import { createHash } from "node:crypto";

import { cardanoAssetReadinessErrors } from "@/lib/cardano-assets";
import { db } from "@/lib/db";
import { fetchAgentPayDuneAnalytics, duneReadinessErrors } from "@/lib/dune";
import { masumiReadinessErrors } from "@/lib/masumi";
import { masumiPaymentReadinessErrors } from "@/lib/masumi-payment";
import { assertPythObservation, fetchPythPrice, pythReadinessErrors } from "@/lib/pyth";
import { releaseEvidenceAuthErrors } from "@/lib/release-evidence-auth";
import { veridianReadinessErrors } from "@/lib/veridian-keri";

export const catalystEvidenceTypes = [
  "CARDANO_PREPROD_ADA_CANARY",
  "CARDANO_PREPROD_TOKEN_CANARY",
  "CARDANO_MAINNET_USDCX_CANARY",
  "PYTH_LIVE_FEEDS",
  "MASUMI_REGISTRY_LIVE",
  "MASUMI_ESCROW_COMPLETED",
  "MASUMI_RESULT_HASH_VERIFIED",
  "MASUMI_REFUND_DRILL",
  "VERIDIAN_CREDENTIAL_VERIFIED",
  "DUNE_PUBLISHED",
  "DUNE_SAMPLE_VERIFIED",
  "REMOTE_SIGNER_CUSTODY_REVIEW",
  "MONITORING_ONCALL",
  "PITR_RESTORE_DRILL",
  "INCIDENT_EXERCISE",
  "INDEPENDENT_SECURITY_ASSESSMENT",
] as const;
export type CatalystEvidenceType = (typeof catalystEvidenceTypes)[number];

const transactionEvidence = new Set<CatalystEvidenceType>(["CARDANO_PREPROD_ADA_CANARY", "CARDANO_PREPROD_TOKEN_CANARY", "CARDANO_MAINNET_USDCX_CANARY"]);

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

export function releaseEvidenceHash(value: unknown) { return createHash("sha256").update(stable(value)).digest("hex"); }

export function catalystProductionConfigErrors(env: NodeJS.ProcessEnv = process.env) {
  if (env.CATALYST_PRODUCTION_ENABLED !== "true") return [];
  const errors = [
    ...(env.APP_ENV === "production" ? [] : ["APP_ENV=production"]),
    ...(env.CARDANO_USDCX_ENABLED === "true" ? [] : ["CARDANO_USDCX_ENABLED=true"]),
    ...(env.PYTH_POLICY_ENABLED === "true" ? [] : ["PYTH_POLICY_ENABLED=true"]),
    ...(env.MASUMI_POLICY_ENABLED === "true" ? [] : ["MASUMI_POLICY_ENABLED=true"]),
    ...(env.MASUMI_ESCROW_ENABLED === "true" ? [] : ["MASUMI_ESCROW_ENABLED=true"]),
    ...(env.VERIDIAN_IDENTITY_ENABLED === "true" ? [] : ["VERIDIAN_IDENTITY_ENABLED=true"]),
    ...(env.DUNE_ANALYTICS_ENABLED === "true" ? [] : ["DUNE_ANALYTICS_ENABLED=true"]),
    ...cardanoAssetReadinessErrors(env),
    ...pythReadinessErrors(env),
    ...masumiReadinessErrors(env),
    ...masumiPaymentReadinessErrors(env),
    ...veridianReadinessErrors(env),
    ...duneReadinessErrors(env),
    ...releaseEvidenceAuthErrors(env),
  ];
  if (!env.CARDANO_PREPROD_FACILITATOR_URL) errors.push("CARDANO_PREPROD_FACILITATOR_URL");
  if (!env.CARDANO_PREPROD_USDCX_ASSET_ID) errors.push("CARDANO_PREPROD_USDCX_ASSET_ID");
  if (!env.CARDANO_MAINNET_FACILITATOR_URL) errors.push("CARDANO_MAINNET_FACILITATOR_URL");
  if (!env.CARDANO_MAINNET_USDCX_ASSET_ID) errors.push("CARDANO_MAINNET_USDCX_ASSET_ID");
  if (!env.DUNE_DASHBOARD_URL) errors.push("DUNE_DASHBOARD_URL");
  if (!env.RELEASE_SHA || !/^[0-9a-f]{40}$/.test(env.RELEASE_SHA)) errors.push("RELEASE_SHA");
  return [...new Set(errors)];
}

export async function liveCatalystDependencyChecks() {
  const [ada, usdcx, dune] = await Promise.all([fetchPythPrice("ADA"), fetchPythPrice("USDCX"), fetchAgentPayDuneAnalytics()]);
  assertPythObservation(ada, { maxAgeSeconds: 60, maxConfidenceBps: 1000 });
  assertPythObservation(usdcx, { maxAgeSeconds: 60, maxConfidenceBps: 1000 });
  if (!dune.overview.rows.length) throw new Error("DUNE_OVERVIEW_EMPTY");
  return { pyth: { ada: { feedId: ada.feedId, publishTime: ada.publishTime }, usdcx: { feedId: usdcx.feedId, publishTime: usdcx.publishTime } }, dune: { overviewQueryId: dune.overview.queryId, activityQueryId: dune.activity?.queryId ?? null, dashboardUrl: dune.dashboardUrl, executedAt: dune.overview.executedAt } };
}

export async function catalystReleaseEvidenceStatus(releaseSha = process.env.RELEASE_SHA ?? "") {
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) return { releaseSha, complete: false, present: [], missing: [...catalystEvidenceTypes] as CatalystEvidenceType[] };
  const rows = await db.$queryRaw<Array<{ evidenceType: CatalystEvidenceType; transactionId: string | null; evidenceHash: string; verifiedAt: Date }>>`
    SELECT "evidenceType","transactionId","evidenceHash","verifiedAt" FROM "ProductionReleaseEvidence" WHERE "releaseSha"=${releaseSha}
  `;
  const valid = rows.filter((row) => catalystEvidenceTypes.includes(row.evidenceType) && /^[0-9a-f]{64}$/.test(row.evidenceHash) && (!transactionEvidence.has(row.evidenceType) || Boolean(row.transactionId)));
  const present = [...new Set(valid.map((row) => row.evidenceType))];
  const missing = catalystEvidenceTypes.filter((type) => !present.includes(type));
  return { releaseSha, complete: missing.length === 0, present, missing };
}

export async function catalystProductionReadiness() {
  if (process.env.CATALYST_PRODUCTION_ENABLED !== "true") return { enabled: false, ready: false, configErrors: [], evidence: null, liveDependencies: null };
  const configErrors = catalystProductionConfigErrors(process.env);
  if (configErrors.length) return { enabled: true, ready: false, configErrors, evidence: null, liveDependencies: null };
  let liveDependencies: Awaited<ReturnType<typeof liveCatalystDependencyChecks>> | null = null;
  try { liveDependencies = await liveCatalystDependencyChecks(); }
  catch (error) { return { enabled: true, ready: false, configErrors: [error instanceof Error ? error.message : "CATALYST_DEPENDENCY_CHECK_FAILED"], evidence: await catalystReleaseEvidenceStatus(), liveDependencies: null }; }
  const evidence = await catalystReleaseEvidenceStatus();
  return { enabled: true, ready: evidence.complete, configErrors: [], evidence, liveDependencies };
}
