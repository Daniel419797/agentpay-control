import { z } from "zod";

import type { CatalystEvidenceType } from "@/lib/catalyst-release";

const hash64 = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.string().uuid();
const isoDate = z.string().datetime();
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "HTTPS URL required");
const positiveQueryId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]);
const outcomePassed = z.literal("passed");

const cardanoCanary = z.object({
  source: z.string().min(1).max(100),
  transactionId: hash64,
  payerAddress: z.string().min(20).max(250),
  payeeAddress: z.string().min(20).max(250),
  amountAtomic: z.string().regex(/^[1-9]\d*$/),
  operatorEvidenceUrl: httpsUrl.nullish(),
  recordedAt: isoDate,
}).passthrough();

const pythFeed = z.object({
  feedId: z.string().min(10).max(150),
  publishTime: z.number().int().positive(),
}).passthrough();

const schemas: Record<CatalystEvidenceType, z.ZodType<Record<string, unknown>>> = {
  CARDANO_PREPROD_ADA_CANARY: cardanoCanary,
  CARDANO_PREPROD_TOKEN_CANARY: cardanoCanary,
  CARDANO_MAINNET_USDCX_CANARY: cardanoCanary,
  PYTH_LIVE_FEEDS: z.object({ ada: pythFeed, usdcx: pythFeed }).passthrough(),
  MASUMI_REGISTRY_LIVE: z.object({
    agentIdentifier: z.string().regex(/^[0-9a-fA-F]{57,250}$/),
    network: z.enum(["Preprod", "Mainnet"]),
    sellerAddress: z.string().regex(/^addr(_test)?1[0-9a-z]+$/),
    registryPolicyId: z.string().regex(/^[0-9a-fA-F]{56,64}$/),
    metadataHash: hash64,
    checkedAt: isoDate,
  }).passthrough(),
  MASUMI_ESCROW_COMPLETED: z.object({
    purchaseId: uuid,
    blockchainIdentifier: z.string().min(1).max(8000),
    resultHash: hash64,
    completedAt: isoDate,
    evidenceHash: hash64,
  }).passthrough(),
  MASUMI_RESULT_HASH_VERIFIED: z.object({
    purchaseId: uuid,
    resultHash: hash64,
    resultVerifiedAt: isoDate,
  }).passthrough(),
  MASUMI_REFUND_DRILL: z.object({
    purchaseId: uuid,
    refundRequestedAt: isoDate,
    refundAuthorizedAt: isoDate,
    outcome: z.literal("RefundAuthorized"),
  }).passthrough(),
  VERIDIAN_CREDENTIAL_VERIFIED: z.object({
    resourceId: uuid,
    credentialSaid: z.string().min(20).max(200),
    issuerAid: z.string().min(20).max(200),
    schemaSaid: z.string().min(20).max(200),
    claimsHash: hash64,
    verifiedAt: isoDate,
  }).passthrough(),
  DUNE_PUBLISHED: z.object({
    dashboardUrl: httpsUrl,
    overviewQueryId: positiveQueryId,
    sampleQueryId: positiveQueryId,
    activityQueryId: positiveQueryId.nullish(),
  }).passthrough(),
  DUNE_SAMPLE_VERIFIED: z.object({
    dashboardUrl: httpsUrl,
    executedAt: isoDate,
    blockfrostVerifiedTransactionIds: z.array(hash64).min(1).max(3),
  }).passthrough(),
  REMOTE_SIGNER_CUSTODY_REVIEW: z.object({
    reportUrl: httpsUrl,
    reviewer: z.string().trim().min(2).max(200),
    reviewedAt: isoDate,
    custodyProvider: z.string().trim().min(2).max(200),
    keyScope: z.string().trim().min(2).max(300),
    outcome: z.literal("approved"),
  }).passthrough(),
  MONITORING_ONCALL: z.object({
    runbookUrl: httpsUrl,
    onCallOwner: z.string().trim().min(2).max(200),
    pagingProvider: z.string().trim().min(2).max(200),
    pagingTestAt: isoDate,
    outcome: outcomePassed,
  }).passthrough(),
  PITR_RESTORE_DRILL: z.object({
    reportUrl: httpsUrl,
    backupPointAt: isoDate,
    restoredAt: isoDate,
    rpoSeconds: z.number().int().nonnegative(),
    rtoSeconds: z.number().int().positive(),
    outcome: outcomePassed,
  }).passthrough(),
  INCIDENT_EXERCISE: z.object({
    reportUrl: httpsUrl,
    conductedAt: isoDate,
    scenario: z.string().trim().min(10).max(1000),
    participants: z.array(z.string().trim().min(2).max(200)).min(2).max(50),
    outcome: outcomePassed,
  }).passthrough(),
  INDEPENDENT_SECURITY_ASSESSMENT: z.object({
    reportUrl: httpsUrl,
    assessor: z.string().trim().min(2).max(200),
    completedAt: isoDate,
    outcome: z.enum(["passed", "accepted_with_findings"]),
    openCriticalFindings: z.literal(0),
    openHighFindings: z.literal(0),
  }).passthrough(),
};

export function parseCatalystEvidenceShape(type: CatalystEvidenceType, evidence: unknown): Record<string, unknown> {
  return schemas[type].parse(evidence);
}
