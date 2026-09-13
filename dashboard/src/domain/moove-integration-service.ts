import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import {
  listMoovePaymentLinks,
  mooveConfigFromEnv,
  MooveProviderError,
  type MooveConfig,
  assertMooveSettlementToken,
} from "@/lib/moove";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

const LEGACY_ENV_KEYS = ["MOOVE_API_KEY", "MOOVE_ACCOUNT_ORGANIZATION_ID"] as const;

type IntegrationRow = {
  id: string;
  organizationId: string;
  encryptedApiKey: string | null;
  keyFingerprint: string | null;
  keyHint: string | null;
  status: string;
  settlementNetwork: string | null;
  settlementSymbol: string | null;
  settlementDecimals: number | null;
  lastValidatedAt: Date | null;
  lastUsedAt: Date | null;
  lastReconciledAt: Date | null;
  lastFailureCode: string | null;
};

export type MooveIntegrationSummary = {
  configured: boolean;
  status: string | null;
  keyHint: string | null;
  settlement: { network: string; symbol: string; decimals: number } | null;
  lastValidatedAt: Date | null;
  lastUsedAt: Date | null;
  lastReconciledAt: Date | null;
  lastFailureCode: string | null;
};

function settlementConfig(row: IntegrationRow) {
  if (!row.settlementNetwork || !row.settlementSymbol || row.settlementDecimals === null) return undefined;
  return { network: row.settlementNetwork, symbol: row.settlementSymbol, decimals: row.settlementDecimals };
}

function buildConfig(apiKey: string, organizationId: string, settlement?: { network: string; symbol: string; decimals: number }): MooveConfig {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MOOVE_RECEIVE_ENABLED: "true",
    MOOVE_API_KEY: apiKey,
    MOOVE_ACCOUNT_ORGANIZATION_ID: organizationId,
    MOOVE_SETTLEMENT_NETWORK: settlement?.network ?? "",
    MOOVE_SETTLEMENT_SYMBOL: settlement?.symbol ?? "",
    MOOVE_SETTLEMENT_DECIMALS: settlement ? String(settlement.decimals) : "",
  };
  return mooveConfigFromEnv(env);
}

function keyFingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function keyHint(apiKey: string) {
  return apiKey.slice(-4);
}

function isAuthError(error: unknown) {
  return error instanceof MooveProviderError && ["UNAUTHENTICATED", "INVALID_API_KEY", "EXPIRED_API_KEY", "INSUFFICIENT_API_SCOPE"].includes(error.code);
}

async function findIntegration(organizationId: string) {
  return (await db.$queryRaw<IntegrationRow[]>`
    SELECT * FROM "MooveIntegration"
    WHERE "organizationId"=${organizationId}::uuid
    LIMIT 1
  `)[0] ?? null;
}

async function migrateLegacyIntegration(organizationId: string) {
  const legacyApiKey = process.env[LEGACY_ENV_KEYS[0]]?.trim();
  const legacyOrganizationId = process.env[LEGACY_ENV_KEYS[1]]?.trim();
  if (!legacyApiKey || legacyOrganizationId !== organizationId) return null;

  const existing = await findIntegration(organizationId);
  if (existing) return existing;

  const fingerprint = keyFingerprint(legacyApiKey);
  const encrypted = encryptSecret(legacyApiKey);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`moove-integration:${organizationId}`}, 0))`;
    const current = (await tx.$queryRaw<IntegrationRow[]>`
      SELECT * FROM "MooveIntegration"
      WHERE "organizationId"=${organizationId}::uuid
      FOR UPDATE
    `)[0];
    if (current) return;

    await tx.$executeRaw`
      INSERT INTO "MooveIntegration" (
        "id","organizationId","encryptedApiKey","keyFingerprint","keyHint","status","lastValidatedAt"
      ) VALUES (
        gen_random_uuid(),${organizationId}::uuid,${encrypted},${fingerprint},${keyHint(legacyApiKey)},'ACTIVE',CURRENT_TIMESTAMP
      )
      ON CONFLICT ("organizationId") DO NOTHING
    `;
  });
  return findIntegration(organizationId);
}

async function requireIntegration(organizationId: string) {
  if (process.env.MOOVE_RECEIVE_ENABLED !== "true") throw new Error("MOOVE_RECEIVE_DISABLED");
  const row = (await findIntegration(organizationId)) ?? (await migrateLegacyIntegration(organizationId));
  if (!row || !row.encryptedApiKey || row.status !== "ACTIVE") throw new Error("MOOVE_INTEGRATION_NOT_CONFIGURED");

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedApiKey);
  } catch {
    throw new Error("MOOVE_INTEGRATION_SECRET_INVALID");
  }

  return { row, config: buildConfig(apiKey, organizationId, settlementConfig(row)) };
}

export async function getMooveConfigForOrganization(organizationId: string) {
  return (await requireIntegration(organizationId)).config;
}

export async function withMooveConfigForOrganization<T>(organizationId: string, fn: (config: MooveConfig) => Promise<T>) {
  const { config, row } = await requireIntegration(organizationId);
  try {
    return await fn(config);
  } finally {
    await db.$executeRaw`
      UPDATE "MooveIntegration"
      SET "lastUsedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=${row.id}::uuid AND "organizationId"=${organizationId}::uuid
    `;
  }
}

export async function connectMooveIntegration(input: {
  organizationId: string;
  actorId: string;
  apiKey: string;
  settlement?: { network: string; symbol: string; decimals: number };
}) {
  if (process.env.MOOVE_RECEIVE_ENABLED !== "true") throw new Error("MOOVE_RECEIVE_DISABLED");
  if (!/^\S{16,4096}$/.test(input.apiKey)) throw new Error("MOOVE_API_KEY_INVALID");
  if (input.settlement && (!/^\S{1,120}$/.test(input.settlement.network) || !/^\S{1,32}$/.test(input.settlement.symbol) || !Number.isInteger(input.settlement.decimals) || input.settlement.decimals < 0 || input.settlement.decimals > 255)) {
    throw new Error("MOOVE_SETTLEMENT_CONFIG_INVALID");
  }

  const config = buildConfig(input.apiKey, input.organizationId, input.settlement);
  const providerResult = await listMoovePaymentLinks({ offset: 0 }, config);
  const firstLink = providerResult.data[0];
  if (input.settlement && firstLink) assertMooveSettlementToken(firstLink.token, input.settlement);

  const fingerprint = keyFingerprint(input.apiKey);
  const encrypted = encryptSecret(input.apiKey);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`moove-integration:${input.organizationId}`}, 0))`;

    const duplicate = (await tx.$queryRaw<Array<{ organizationId: string }>>`
      SELECT "organizationId" FROM "MooveIntegration"
      WHERE "keyFingerprint"=${fingerprint} AND "organizationId"<>${input.organizationId}::uuid
      LIMIT 1
    `)[0];
    if (duplicate) throw new Error("MOOVE_CREDENTIAL_ALREADY_BOUND");

    await tx.$executeRaw`
      INSERT INTO "MooveIntegration" (
        "id","organizationId","encryptedApiKey","keyFingerprint","keyHint","status",
        "settlementNetwork","settlementSymbol","settlementDecimals","lastValidatedAt","lastFailureCode","createdBy"
      ) VALUES (
        gen_random_uuid(),${input.organizationId}::uuid,${encrypted},${fingerprint},${keyHint(input.apiKey)},'ACTIVE',
        ${input.settlement?.network ?? null},${input.settlement?.symbol?.toUpperCase() ?? null},${input.settlement?.decimals ?? null},CURRENT_TIMESTAMP,NULL,${input.actorId}::uuid
      )
      ON CONFLICT ("organizationId") DO UPDATE SET
        "encryptedApiKey"=EXCLUDED."encryptedApiKey",
        "keyFingerprint"=EXCLUDED."keyFingerprint",
        "keyHint"=EXCLUDED."keyHint",
        "status"='ACTIVE',
        "settlementNetwork"=EXCLUDED."settlementNetwork",
        "settlementSymbol"=EXCLUDED."settlementSymbol",
        "settlementDecimals"=EXCLUDED."settlementDecimals",
        "lastValidatedAt"=CURRENT_TIMESTAMP,
        "lastFailureCode"=NULL,
        "updatedAt"=CURRENT_TIMESTAMP
    `;

    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorId,
        action: "MOOVE_INTEGRATION_CONNECTED",
        targetType: "MOOVE_INTEGRATION",
        targetId: input.organizationId,
        result: "SUCCESS",
        metadata: { keyHint: keyHint(input.apiKey), settlementConfigured: Boolean(input.settlement) },
      },
    });
  }, { isolationLevel: "Serializable" });

  return getMooveIntegrationSummary(input.organizationId);
}

export async function getMooveIntegrationSummary(organizationId: string): Promise<MooveIntegrationSummary> {
  let row = await findIntegration(organizationId);
  if (!row) row = await migrateLegacyIntegration(organizationId);

  return {
    configured: Boolean(row?.encryptedApiKey) && row?.status === "ACTIVE",
    status: row?.status ?? null,
    keyHint: row?.keyHint ?? null,
    settlement: row ? settlementConfig(row) ?? null : null,
    lastValidatedAt: row?.lastValidatedAt ?? null,
    lastUsedAt: row?.lastUsedAt ?? null,
    lastReconciledAt: row?.lastReconciledAt ?? null,
    lastFailureCode: row?.lastFailureCode ?? null,
  };
}

export async function disconnectMooveIntegration(organizationId: string, actorId: string) {
  const activeLinks = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "MoovePaymentLink"
    WHERE "organizationId"=${organizationId}::uuid
      AND "providerStatus" IN ('CREATING','ACTIVE','SUBMISSION_UNKNOWN','INACTIVE')
    LIMIT 1
  `;
  if (activeLinks[0]) throw new Error("MOOVE_ACTIVE_LINKS_EXIST");

  const current = await findIntegration(organizationId);
  if (!current) return { disconnected: false };

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "MooveIntegration"
      SET "encryptedApiKey"=NULL,"status"='REVOKED',"lastFailureCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "organizationId"=${organizationId}::uuid
    `;
    await tx.auditEvent.create({
      data: {
        organizationId,
        actorType: "USER",
        actorId,
        action: "MOOVE_INTEGRATION_DISCONNECTED",
        targetType: "MOOVE_INTEGRATION",
        targetId: organizationId,
        result: "SUCCESS",
        metadata: {},
      },
    });
  });

  return { disconnected: true };
}

export async function reconcileAllMooveTenants(limit = 20, concurrency = 3) {
  if (process.env.MOOVE_RECEIVE_ENABLED !== "true") return { tenantsScanned: 0, completed: 0, failed: 0, summaries: [] };

  const legacyOrg = process.env.MOOVE_ACCOUNT_ORGANIZATION_ID?.trim();
  if (legacyOrg && process.env.MOOVE_API_KEY?.trim()) await migrateLegacyIntegration(legacyOrg);

  const tenants = await db.$queryRaw<Array<{ id: string; organizationId: string }>>`
    SELECT "id","organizationId" FROM "MooveIntegration"
    WHERE "status"='ACTIVE' AND "encryptedApiKey" IS NOT NULL
    ORDER BY "lastReconciledAt" ASC NULLS FIRST, "updatedAt" ASC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `;

  let cursor = 0;
  let completed = 0;
  let failed = 0;
  const summaries: Array<{ organizationId: string; status: "ok" | "failed"; result?: unknown; error?: string }> = [];

  while (cursor < tenants.length) {
    const batch = tenants.slice(cursor, cursor + Math.max(1, Math.min(concurrency, 10)));
    const results = await Promise.allSettled(batch.map(async (tenant) => {
      try {
        const result = await withMooveConfigForOrganization(tenant.organizationId, async () => {
          const { reconcileMooveReceive } = await import("@/domain/moove-receive-service");
          return reconcileMooveReceive(tenant.organizationId);
        });
        await db.$executeRaw`
          UPDATE "MooveIntegration"
          SET "lastReconciledAt"=CURRENT_TIMESTAMP,"lastFailureCode"=NULL,"status"='ACTIVE',"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=${tenant.id}::uuid
        `;
        completed += 1;
        return { organizationId: tenant.organizationId, status: "ok" as const, result };
      } catch (error) {
        const authError = isAuthError(error);
        const code = authError ? (error as MooveProviderError).code : error instanceof Error ? error.message : "MOOVE_RECONCILIATION_FAILED";
        await db.$executeRaw`
          UPDATE "MooveIntegration"
          SET "lastReconciledAt"=CURRENT_TIMESTAMP,"lastFailureCode"=${code},"status"=${authError ? "ERROR" : "ACTIVE"},"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=${tenant.id}::uuid
        `;
        failed += 1;
        return { organizationId: tenant.organizationId, status: "failed" as const, error: code };
      }
    }));

    for (const result of results) {
      summaries.push(result.status === "fulfilled" ? result.value : { organizationId: "unknown", status: "failed", error: "MOOVE_RECONCILIATION_WORKER_FAILED" });
    }
    cursor += batch.length;
  }

  return { tenantsScanned: tenants.length, completed, failed, summaries };
}

export async function reconcileMooveTenant(organizationId: string) {
  return withMooveConfigForOrganization(organizationId, async () => {
    const { reconcileMooveReceive } = await import("@/domain/moove-receive-service");
    return reconcileMooveReceive(organizationId);
  });
}
