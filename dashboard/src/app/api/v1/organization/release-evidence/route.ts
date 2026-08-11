import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { cardanoExactPaymentMatches, cardanoTransactionEvidence, type CardanoNetwork } from "@/lib/cardano";
import { parseCatalystEvidenceShape } from "@/lib/catalyst-evidence";
import { catalystEvidenceTypes, releaseEvidenceHash } from "@/lib/catalyst-release";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { fetchMasumiAgent, masumiMetadataHash, type MasumiNetwork } from "@/lib/masumi";
import { assertPythObservation, fetchPythPrice } from "@/lib/pyth";
import { authorizeReleaseEvidenceRequest } from "@/lib/release-evidence-auth";

const evidenceType = z.enum(catalystEvidenceTypes);
const schema = z.object({ releaseSha: z.string().regex(/^[0-9a-f]{40}$/), evidenceType, network: z.string().trim().min(1).max(100).optional(), asset: z.string().trim().min(1).max(150).optional(), transactionId: z.string().trim().min(8).max(200).optional(), evidence: z.record(z.string(), z.unknown()) });
const cardanoCanaries = new Set(["CARDANO_PREPROD_ADA_CANARY", "CARDANO_PREPROD_TOKEN_CANARY", "CARDANO_MAINNET_USDCX_CANARY"]);

type MasumiEscrowEvidence = {
  id: string;
  network: string;
  state: string;
  blockchainIdentifier: string;
  resultHash: string | null;
  resultVerifiedAt: Date | null;
  refundRequestedAt: Date | null;
  refundAuthorizedAt: Date | null;
  completedAt: Date | null;
};

function sameInstant(actual: Date | null, claimed: unknown) {
  return Boolean(actual && typeof claimed === "string" && actual.getTime() === new Date(claimed).getTime());
}

async function masumiEscrow(purchaseId: string) {
  const rows = await db.$queryRaw<MasumiEscrowEvidence[]>`
    SELECT "id","network","state","blockchainIdentifier","resultHash","resultVerifiedAt","refundRequestedAt","refundAuthorizedAt","completedAt"
    FROM "MasumiEscrowPurchase" WHERE "id"=${purchaseId}::uuid LIMIT 1
  `;
  if (!rows[0]) throw new Error("MASUMI_RELEASE_EVIDENCE_NOT_FOUND");
  return rows[0];
}

async function validateCardanoCanary(input: z.infer<typeof schema>, evidence: Record<string, unknown>) {
  if (!input.transactionId || !/^[0-9a-f]{64}$/.test(input.transactionId)) throw new Error("CARDANO_CANARY_TRANSACTION_ID_REQUIRED");
  const expectedNetwork: CardanoNetwork = input.evidenceType === "CARDANO_MAINNET_USDCX_CANARY" ? "cardano:mainnet" : "cardano:preprod";
  if (input.network !== expectedNetwork) throw new Error("CARDANO_CANARY_NETWORK_MISMATCH");
  if (!input.asset) throw new Error("CARDANO_CANARY_ASSET_REQUIRED");
  if (evidence.transactionId !== input.transactionId) throw new Error("CARDANO_CANARY_TRANSACTION_EVIDENCE_MISMATCH");
  const payerAddress = String(evidence.payerAddress), payeeAddress = String(evidence.payeeAddress), amountAtomic = String(evidence.amountAtomic);
  const networkConfig = await db.chainNetwork.findUnique({ where: { id: expectedNetwork }, select: { requiredConfirmations: true, enabled: true } });
  if (!networkConfig?.enabled) throw new Error("CARDANO_CANARY_NETWORK_NOT_ENABLED");
  const chain = await cardanoTransactionEvidence(expectedNetwork, input.transactionId);
  if (!chain || chain.confirmations < networkConfig.requiredConfirmations) throw new Error("CARDANO_CANARY_CONFIRMATIONS_PENDING");
  if (!cardanoExactPaymentMatches(chain, payerAddress, payeeAddress, input.asset, amountAtomic)) throw new Error("CARDANO_CANARY_PAYMENT_MISMATCH");
}

async function validatePythEvidence(evidence: Record<string, unknown>) {
  const claimedAda = evidence.ada as { feedId: string; publishTime: number };
  const claimedUsdcx = evidence.usdcx as { feedId: string; publishTime: number };
  const [ada, usdcx] = await Promise.all([fetchPythPrice("ADA"), fetchPythPrice("USDCX")]);
  assertPythObservation(ada, { maxAgeSeconds: 60, maxConfidenceBps: 1000 });
  assertPythObservation(usdcx, { maxAgeSeconds: 60, maxConfidenceBps: 1000 });
  if (claimedAda.feedId.toLowerCase() !== ada.feedId.toLowerCase() || claimedUsdcx.feedId.toLowerCase() !== usdcx.feedId.toLowerCase()) throw new Error("PYTH_RELEASE_FEED_ID_MISMATCH");
  if (claimedAda.publishTime > ada.publishTime || ada.publishTime - claimedAda.publishTime > 300 || claimedUsdcx.publishTime > usdcx.publishTime || usdcx.publishTime - claimedUsdcx.publishTime > 300) throw new Error("PYTH_RELEASE_OBSERVATION_STALE");
}

async function validateMasumiRegistryEvidence(evidence: Record<string, unknown>) {
  const claimed = evidence as { agentIdentifier: string; network: MasumiNetwork; sellerAddress: string; registryPolicyId: string; metadataHash: string };
  const current = await fetchMasumiAgent(claimed.agentIdentifier, claimed.network);
  if (current.sellerWallet.address !== claimed.sellerAddress) throw new Error("MASUMI_RELEASE_SELLER_MISMATCH");
  if (current.RegistrySource.policyId.toLowerCase() !== claimed.registryPolicyId.toLowerCase()) throw new Error("MASUMI_RELEASE_REGISTRY_POLICY_MISMATCH");
  if (masumiMetadataHash(current) !== claimed.metadataHash) throw new Error("MASUMI_RELEASE_METADATA_MISMATCH");
}

async function validateMasumiEscrowEvidence(type: z.infer<typeof evidenceType>, evidence: Record<string, unknown>) {
  const purchaseId = String(evidence.purchaseId);
  const current = await masumiEscrow(purchaseId);
  if (type === "MASUMI_ESCROW_COMPLETED") {
    if (current.state !== "Completed" || !current.completedAt || !current.resultVerifiedAt || !current.resultHash) throw new Error("MASUMI_RELEASE_ESCROW_NOT_VERIFIED_COMPLETE");
    if (current.blockchainIdentifier !== evidence.blockchainIdentifier || current.resultHash !== evidence.resultHash || !sameInstant(current.completedAt, evidence.completedAt)) throw new Error("MASUMI_RELEASE_ESCROW_EVIDENCE_MISMATCH");
  }
  if (type === "MASUMI_RESULT_HASH_VERIFIED") {
    if (!current.resultVerifiedAt || !current.resultHash || current.resultHash !== evidence.resultHash || !sameInstant(current.resultVerifiedAt, evidence.resultVerifiedAt)) throw new Error("MASUMI_RELEASE_RESULT_EVIDENCE_MISMATCH");
  }
  if (type === "MASUMI_REFUND_DRILL") {
    if (current.state !== "RefundAuthorized" || !sameInstant(current.refundRequestedAt, evidence.refundRequestedAt) || !sameInstant(current.refundAuthorizedAt, evidence.refundAuthorizedAt)) throw new Error("MASUMI_RELEASE_REFUND_EVIDENCE_MISMATCH");
  }
}

async function validateVeridianEvidence(evidence: Record<string, unknown>) {
  const resourceId = String(evidence.resourceId);
  const rows = await db.$queryRaw<Array<{ credentialSaid: string; issuerAid: string; schemaSaid: string; claimsHash: string; verifiedAt: Date; expiresAt: Date | null }>>`
    SELECT "credentialSaid","issuerAid","schemaSaid","claimsHash","verifiedAt","expiresAt"
    FROM "KeriResourceIdentity" WHERE "resourceListingId"=${resourceId}::uuid LIMIT 1
  `;
  const current = rows[0];
  if (!current || (current.expiresAt && current.expiresAt <= new Date())) throw new Error("VERIDIAN_RELEASE_IDENTITY_NOT_CURRENT");
  if (current.credentialSaid !== evidence.credentialSaid || current.issuerAid !== evidence.issuerAid || current.schemaSaid !== evidence.schemaSaid || current.claimsHash !== evidence.claimsHash || !sameInstant(current.verifiedAt, evidence.verifiedAt)) throw new Error("VERIDIAN_RELEASE_EVIDENCE_MISMATCH");
}

async function validateDuneSampleEvidence(evidence: Record<string, unknown>) {
  const hashes = evidence.blockfrostVerifiedTransactionIds as string[];
  const provider = getConfig().CARDANO_MAINNET_PROVIDER_ADDRESS;
  if (!provider) throw new Error("CARDANO_MAINNET_PROVIDER_ADDRESS_REQUIRED");
  for (const hash of hashes) {
    const chain = await cardanoTransactionEvidence("cardano:mainnet", hash);
    if (!chain || !chain.validContract || !chain.outputs.some((output) => output.address === provider)) throw new Error("DUNE_RELEASE_SAMPLE_CHAIN_MISMATCH");
  }
}

async function validateEvidence(input: z.infer<typeof schema>) {
  if (process.env.APP_ENV === "production" && process.env.RELEASE_SHA && input.releaseSha !== process.env.RELEASE_SHA) throw new Error("RELEASE_SHA_MISMATCH");
  const evidence = parseCatalystEvidenceShape(input.evidenceType, input.evidence);
  if (cardanoCanaries.has(input.evidenceType)) await validateCardanoCanary(input, evidence);
  if (input.evidenceType === "PYTH_LIVE_FEEDS") await validatePythEvidence(evidence);
  if (input.evidenceType === "MASUMI_REGISTRY_LIVE") await validateMasumiRegistryEvidence(evidence);
  if (["MASUMI_ESCROW_COMPLETED", "MASUMI_RESULT_HASH_VERIFIED", "MASUMI_REFUND_DRILL"].includes(input.evidenceType)) await validateMasumiEscrowEvidence(input.evidenceType, evidence);
  if (input.evidenceType === "VERIDIAN_CREDENTIAL_VERIFIED") await validateVeridianEvidence(evidence);
  if (input.evidenceType === "DUNE_PUBLISHED") {
    const configured = process.env.DUNE_DASHBOARD_URL;
    if (!configured || new URL(String(evidence.dashboardUrl)).toString() !== new URL(configured).toString()) throw new Error("DUNE_RELEASE_DASHBOARD_MISMATCH");
  }
  if (input.evidenceType === "DUNE_SAMPLE_VERIFIED") await validateDuneSampleEvidence(evidence);
}

export async function GET(request: Request) {
  try {
    if (!authorizeReleaseEvidenceRequest(request)) return problem(401, "UNAUTHORIZED", "A dedicated release-evidence credential is required.");
    const releaseSha = new URL(request.url).searchParams.get("releaseSha") ?? process.env.RELEASE_SHA ?? "";
    if (!/^[0-9a-f]{40}$/.test(releaseSha)) return problem(422, "RELEASE_SHA_REQUIRED", "Provide the exact 40-character release SHA.");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT "releaseSha","evidenceType","network","asset","transactionId","evidenceHash","evidence","verifiedAt" FROM "ProductionReleaseEvidence" WHERE "releaseSha"=${releaseSha} ORDER BY "evidenceType" ASC`;
    return ok({ releaseSha, evidence: rows.map((row) => ({ ...row, network: row.network === "" ? null : row.network, asset: row.asset === "" ? null : row.asset })) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!authorizeReleaseEvidenceRequest(request)) return problem(401, "UNAUTHORIZED", "A dedicated release-evidence credential is required.");
    const input = schema.parse(await boundedJson(request, 128 * 1024));
    await validateEvidence(input);
    const network = input.network ?? "", asset = input.asset ?? "";
    const evidenceHash = releaseEvidenceHash({ releaseSha: input.releaseSha, evidenceType: input.evidenceType, network: network || null, asset: asset || null, transactionId: input.transactionId ?? null, evidence: input.evidence });
    await db.$executeRaw`
      INSERT INTO "ProductionReleaseEvidence" ("id","releaseSha","evidenceType","network","asset","transactionId","evidenceHash","evidence","verifiedBy","verifiedAt","createdAt")
      VALUES (gen_random_uuid(),${input.releaseSha},${input.evidenceType},${network},${asset},${input.transactionId ?? null},${evidenceHash},${JSON.stringify(input.evidence)}::jsonb,NULL,now(),now())
      ON CONFLICT ("releaseSha","evidenceType","network","asset") DO UPDATE SET "transactionId"=EXCLUDED."transactionId","evidenceHash"=EXCLUDED."evidenceHash","evidence"=EXCLUDED."evidence","verifiedBy"=NULL,"verifiedAt"=now()`;
    return ok({ releaseSha: input.releaseSha, evidenceType: input.evidenceType, evidenceHash });
  } catch (error) { return handleApiError(error); }
}
