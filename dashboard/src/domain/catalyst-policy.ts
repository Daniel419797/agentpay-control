import { db } from "@/lib/db";
import { assertMasumiEntryMatches, fetchMasumiAgent, masumiMetadataHash, type MasumiNetwork } from "@/lib/masumi";
import { assertPythObservation, fetchPythPrice, usdMicrosForAtomic, type PythPriceObservation } from "@/lib/pyth";
import type { PolicyOutcome } from "@/domain/policy";

export type OraclePolicyLimit = {
  policyVersionId: string;
  quoteCurrency: "USD";
  perTransactionUsdMicros: bigint | null;
  hourlyUsdMicros: bigint | null;
  dailyUsdMicros: bigint | null;
  monthlyUsdMicros: bigint | null;
  maxPriceAgeSeconds: number;
  maxConfidenceBps: number;
};

export type MasumiPolicyTrust = {
  policyVersionId: string;
  required: boolean;
  network: MasumiNetwork;
  allowedAgentIdentifiers: string[];
  allowedCapabilities: string[];
  maxRegistryAgeSeconds: number;
  requireOnline: boolean;
};

export type MasumiResourceBinding = {
  resourceListingId: string;
  network: MasumiNetwork;
  agentIdentifier: string;
  registryPolicyId: string;
  apiBaseUrl: string;
  capabilityName: string | null;
  capabilityVersion: string | null;
  settlementAddress: string | null;
  paymentType: string | null;
  pricingSnapshot: unknown;
  metadataHash: string;
  verifiedAt: Date;
  expiresAt: Date;
};

export type CatalystPolicyContext = {
  oracle: OraclePolicyLimit | null;
  masumi: MasumiPolicyTrust | null;
};

export type OracleValuation = {
  usdMicros: bigint;
  observation: PythPriceObservation;
};

export type UsdSpendWindow = {
  hourlyUsdMicros: bigint;
  dailyUsdMicros: bigint;
  monthlyUsdMicros: bigint;
};

function normalizeBigInt(value: bigint | number | string | null | undefined): bigint | null {
  if (value == null) return null;
  return BigInt(value);
}

function normalizeOracle(row: Record<string, unknown>): OraclePolicyLimit {
  return {
    policyVersionId: String(row.policyVersionId),
    quoteCurrency: "USD",
    perTransactionUsdMicros: normalizeBigInt(row.perTransactionUsdMicros as never),
    hourlyUsdMicros: normalizeBigInt(row.hourlyUsdMicros as never),
    dailyUsdMicros: normalizeBigInt(row.dailyUsdMicros as never),
    monthlyUsdMicros: normalizeBigInt(row.monthlyUsdMicros as never),
    maxPriceAgeSeconds: Number(row.maxPriceAgeSeconds),
    maxConfidenceBps: Number(row.maxConfidenceBps),
  };
}

function normalizeMasumi(row: Record<string, unknown>): MasumiPolicyTrust {
  return {
    policyVersionId: String(row.policyVersionId),
    required: Boolean(row.required),
    network: String(row.network) as MasumiNetwork,
    allowedAgentIdentifiers: Array.isArray(row.allowedAgentIdentifiers) ? row.allowedAgentIdentifiers.map(String) : [],
    allowedCapabilities: Array.isArray(row.allowedCapabilities) ? row.allowedCapabilities.map(String) : [],
    maxRegistryAgeSeconds: Number(row.maxRegistryAgeSeconds),
    requireOnline: Boolean(row.requireOnline),
  };
}

export async function loadCatalystPolicyContext(policyVersionId: string): Promise<CatalystPolicyContext> {
  const [oracleRows, masumiRows] = await Promise.all([
    db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "PolicyOracleLimit" WHERE "policyVersionId" = ${policyVersionId}::uuid LIMIT 1
    `,
    db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "MasumiPolicyTrust" WHERE "policyVersionId" = ${policyVersionId}::uuid LIMIT 1
    `,
  ]);
  return {
    oracle: oracleRows[0] ? normalizeOracle(oracleRows[0]) : null,
    masumi: masumiRows[0] ? normalizeMasumi(masumiRows[0]) : null,
  };
}

export async function loadMasumiResourceBinding(resourceListingId: string): Promise<MasumiResourceBinding | null> {
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "MasumiResourceBinding" WHERE "resourceListingId" = ${resourceListingId}::uuid LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    resourceListingId: String(row.resourceListingId),
    network: String(row.network) as MasumiNetwork,
    agentIdentifier: String(row.agentIdentifier),
    registryPolicyId: String(row.registryPolicyId),
    apiBaseUrl: String(row.apiBaseUrl),
    capabilityName: row.capabilityName == null ? null : String(row.capabilityName),
    capabilityVersion: row.capabilityVersion == null ? null : String(row.capabilityVersion),
    settlementAddress: row.settlementAddress == null ? null : String(row.settlementAddress),
    paymentType: row.paymentType == null ? null : String(row.paymentType),
    pricingSnapshot: row.pricingSnapshot ?? null,
    metadataHash: String(row.metadataHash),
    verifiedAt: new Date(String(row.verifiedAt)),
    expiresAt: new Date(String(row.expiresAt)),
  };
}

export function masumiNetworkForCardano(network: string): MasumiNetwork {
  if (network === "cardano:preprod") return "Preprod";
  if (network === "cardano:mainnet") return "Mainnet";
  throw new Error("MASUMI_CARDANO_NETWORK_REQUIRED");
}

export async function refreshMasumiResourceBinding(input: {
  resourceListingId: string;
  resourceUrl: string;
  agentIdentifier: string;
  network: MasumiNetwork;
  ttlSeconds: number;
  allowedCapabilities?: string[];
}): Promise<MasumiResourceBinding> {
  const entry = await fetchMasumiAgent(input.agentIdentifier, input.network);
  assertMasumiEntryMatches(entry, {
    network: input.network,
    agentIdentifier: input.agentIdentifier,
    resourceUrl: input.resourceUrl,
    allowedCapabilities: input.allowedCapabilities,
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(15, Math.min(input.ttlSeconds, 3600)) * 1000);
  const metadataHash = masumiMetadataHash(entry);
  const capabilityName = entry.Capability?.name ?? null;
  const capabilityVersion = entry.Capability?.version ?? null;
  const settlementAddress = entry.sellerWallet.address;
  const paymentType = entry.paymentType ?? null;
  const pricingSnapshot = entry.AgentPricing ?? null;
  await db.$executeRaw`
    INSERT INTO "MasumiResourceBinding" (
      "resourceListingId", "network", "agentIdentifier", "registryPolicyId", "apiBaseUrl",
      "capabilityName", "capabilityVersion", "settlementAddress", "paymentType", "pricingSnapshot",
      "metadataHash", "verifiedAt", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${input.resourceListingId}::uuid, ${input.network}, ${entry.agentIdentifier}, ${entry.RegistrySource.policyId}, ${entry.apiBaseUrl},
      ${capabilityName}, ${capabilityVersion}, ${settlementAddress}, ${paymentType}, ${JSON.stringify(pricingSnapshot)}::jsonb,
      ${metadataHash}, ${now}, ${expiresAt}, now(), now()
    )
    ON CONFLICT ("resourceListingId") DO UPDATE SET
      "network" = EXCLUDED."network",
      "agentIdentifier" = EXCLUDED."agentIdentifier",
      "registryPolicyId" = EXCLUDED."registryPolicyId",
      "apiBaseUrl" = EXCLUDED."apiBaseUrl",
      "capabilityName" = EXCLUDED."capabilityName",
      "capabilityVersion" = EXCLUDED."capabilityVersion",
      "settlementAddress" = EXCLUDED."settlementAddress",
      "paymentType" = EXCLUDED."paymentType",
      "pricingSnapshot" = EXCLUDED."pricingSnapshot",
      "metadataHash" = EXCLUDED."metadataHash",
      "verifiedAt" = EXCLUDED."verifiedAt",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = now()
  `;
  return {
    resourceListingId: input.resourceListingId,
    network: input.network,
    agentIdentifier: entry.agentIdentifier,
    registryPolicyId: entry.RegistrySource.policyId,
    apiBaseUrl: entry.apiBaseUrl,
    capabilityName,
    capabilityVersion,
    settlementAddress,
    paymentType,
    pricingSnapshot,
    metadataHash,
    verifiedAt: now,
    expiresAt,
  };
}

export async function verifyMasumiTrust(input: {
  trust: MasumiPolicyTrust;
  resourceListingId: string;
  resourceUrl: string;
  cardanoNetwork: string;
}): Promise<MasumiResourceBinding> {
  const expectedNetwork = masumiNetworkForCardano(input.cardanoNetwork);
  if (input.trust.network !== expectedNetwork) throw new Error("MASUMI_POLICY_NETWORK_MISMATCH");
  const current = await loadMasumiResourceBinding(input.resourceListingId);
  if (!current) throw new Error("MASUMI_RESOURCE_NOT_BOUND");
  if (current.network !== expectedNetwork) throw new Error("MASUMI_RESOURCE_NETWORK_MISMATCH");
  if (input.trust.allowedAgentIdentifiers.length && !input.trust.allowedAgentIdentifiers.some((id) => id.toLowerCase() === current.agentIdentifier.toLowerCase())) {
    throw new Error("MASUMI_AGENT_NOT_ALLOWED");
  }
  if (input.trust.allowedCapabilities.length && (!current.capabilityName || !input.trust.allowedCapabilities.includes(current.capabilityName))) {
    throw new Error("MASUMI_CAPABILITY_NOT_ALLOWED");
  }

  const now = Date.now();
  const maxAgeMs = input.trust.maxRegistryAgeSeconds * 1000;
  const stale = current.expiresAt.getTime() <= now || now - current.verifiedAt.getTime() > maxAgeMs;
  if (!stale && !input.trust.requireOnline && current.settlementAddress) return current;

  return refreshMasumiResourceBinding({
    resourceListingId: input.resourceListingId,
    resourceUrl: input.resourceUrl,
    agentIdentifier: current.agentIdentifier,
    network: expectedNetwork,
    ttlSeconds: input.trust.maxRegistryAgeSeconds,
    allowedCapabilities: input.trust.allowedCapabilities,
  });
}

export async function valueWithPyth(input: {
  oracle: OraclePolicyLimit;
  assetSymbol: string;
  assetDecimals: number;
  amountAtomic: string;
}): Promise<OracleValuation> {
  const observation = await fetchPythPrice(input.assetSymbol);
  assertPythObservation(observation, {
    maxAgeSeconds: input.oracle.maxPriceAgeSeconds,
    maxConfidenceBps: input.oracle.maxConfidenceBps,
  });
  return {
    usdMicros: usdMicrosForAtomic(input.amountAtomic, input.assetDecimals, observation),
    observation,
  };
}

export function evaluateUsdPolicy(input: {
  requestedUsdMicros: bigint;
  spend: UsdSpendWindow;
  limits: OraclePolicyLimit;
  overLimitAction: "DENY" | "REQUIRE_APPROVAL";
}): { decision: PolicyOutcome; reasonCodes: string[] } {
  const breaches: string[] = [];
  if (input.limits.perTransactionUsdMicros != null && input.requestedUsdMicros > input.limits.perTransactionUsdMicros) breaches.push("USD_PER_TRANSACTION_LIMIT_EXCEEDED");
  if (input.limits.hourlyUsdMicros != null && input.spend.hourlyUsdMicros + input.requestedUsdMicros > input.limits.hourlyUsdMicros) breaches.push("USD_HOURLY_LIMIT_EXCEEDED");
  if (input.limits.dailyUsdMicros != null && input.spend.dailyUsdMicros + input.requestedUsdMicros > input.limits.dailyUsdMicros) breaches.push("USD_DAILY_LIMIT_EXCEEDED");
  if (input.limits.monthlyUsdMicros != null && input.spend.monthlyUsdMicros + input.requestedUsdMicros > input.limits.monthlyUsdMicros) breaches.push("USD_MONTHLY_LIMIT_EXCEEDED");
  return breaches.length ? { decision: input.overLimitAction, reasonCodes: breaches } : { decision: "ALLOW", reasonCodes: ["USD_WITHIN_POLICY"] };
}

export function combinePolicyOutcomes(
  base: { decision: PolicyOutcome; reasonCodes: string[] },
  extra: { decision: PolicyOutcome; reasonCodes: string[] } | null,
): { decision: PolicyOutcome; reasonCodes: string[] } {
  if (!extra) return base;
  const rank: Record<PolicyOutcome, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
  const decision = rank[extra.decision] > rank[base.decision] ? extra.decision : base.decision;
  const reasons = [...base.reasonCodes.filter((reason) => reason !== "WITHIN_POLICY"), ...extra.reasonCodes.filter((reason) => reason !== "USD_WITHIN_POLICY")];
  return { decision, reasonCodes: reasons.length ? [...new Set(reasons)] : ["WITHIN_POLICY"] };
}
