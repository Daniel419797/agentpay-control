import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  assertMooveAmount,
  assertMooveOrganization,
  assertMooveSettlementToken,
  createMoovePaymentLink,
  listAllMoovePaymentLinks,
  mooveConfigFromEnv,
  MooveProviderError,
  retrieveMoovePaymentLink,
  type MooveConfig,
  type MoovePaymentLink,
  type MoovePublicPaymentLink,
} from "@/lib/moove";

type MooveLocalStatus = "CREATING" | "ACTIVE" | "COMPLETED" | "INACTIVE" | "SUBMISSION_UNKNOWN" | "FAILED";

export type MoovePaymentLinkRow = {
  id: string;
  organizationId: string;
  agentId: string | null;
  resourceListingId: string | null;
  invoiceId: string | null;
  idempotencyKey: string;
  requestHash: string;
  providerLinkId: string | null;
  providerUrl: string | null;
  providerStatus: MooveLocalStatus;
  toAmount: string;
  description: string | null;
  providerDescription: string;
  maxUsage: number | null;
  expirationDate: Date | null;
  destinationAddress: string | null;
  token: unknown;
  receivedAmount: string | null;
  transactionUrl: string | null;
  providerEvidence: unknown;
  failureCode: string | null;
  lastReconciledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateMooveReceiveInput = {
  organizationId: string;
  idempotencyKey: string;
  toAmount: string;
  description?: string;
  maxUsage?: number;
  expirationDate?: string;
  agentId?: string;
  resourceListingId?: string;
  invoiceId?: string;
  actorType: "USER" | "AGENT";
  actorId: string;
};

const payableInvoiceStatuses = ["SENT", "VIEWED", "APPROVAL_PENDING", "PAYMENT_PENDING", "OVERDUE"] as const;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("MOOVE_JSON_SERIALIZATION_FAILED");
  return JSON.parse(encoded) as Prisma.InputJsonValue;
}

function requestHash(input: Omit<CreateMooveReceiveInput, "actorType" | "actorId">) {
  return createHash("sha256").update(stable(input)).digest("hex");
}

function providerDescription(id: string, description?: string) {
  const marker = `AP:${id}`;
  if (!description?.trim()) return marker;
  return `${marker} | ${description.trim()}`.slice(0, 500);
}

function localStatus(status: MoovePaymentLink["status"]): MooveLocalStatus {
  if (status === "completed") return "COMPLETED";
  if (status === "inactive") return "INACTIVE";
  return "ACTIVE";
}

function decimalToAtomic(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("MOOVE_AMOUNT_INVALID");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("MOOVE_AMOUNT_PRECISION_INVALID");
  const scale = 10n ** BigInt(decimals);
  const fractional = decimals === 0 ? 0n : BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  return BigInt(whole!) * scale + fractional;
}

async function findLocalById(id: string, organizationId: string) {
  const rows = await db.$queryRaw<MoovePaymentLinkRow[]>`
    SELECT * FROM "MoovePaymentLink"
    WHERE "id"=${id}::uuid AND "organizationId"=${organizationId}::uuid
    LIMIT 1`;
  return rows[0] ?? null;
}

async function findLocalByIdempotency(organizationId: string, idempotencyKey: string) {
  const rows = await db.$queryRaw<MoovePaymentLinkRow[]>`
    SELECT * FROM "MoovePaymentLink"
    WHERE "organizationId"=${organizationId}::uuid AND "idempotencyKey"=${idempotencyKey}
    LIMIT 1`;
  return rows[0] ?? null;
}

async function validateReferences(input: CreateMooveReceiveInput, config: MooveConfig) {
  if (input.agentId) {
    const agent = await db.agent.findFirst({ where: { id: input.agentId, organizationId: input.organizationId, status: { not: "ARCHIVED" } }, select: { id: true } });
    if (!agent) throw new Error("AGENT_NOT_FOUND");
  }
  if (input.resourceListingId) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT r."id" FROM "ResourceListing" r
      JOIN "ResourceProvider" p ON p."id"=r."providerId"
      WHERE r."id"=${input.resourceListingId}::uuid AND p."organizationId"=${input.organizationId}::uuid
      LIMIT 1`;
    if (!rows[0]) throw new Error("MOOVE_RESOURCE_NOT_OWNED");
  }
  if (input.invoiceId) {
    const invoice = await db.agentInvoice.findFirst({
      where: { id: input.invoiceId, issuerOrganizationId: input.organizationId, status: { in: [...payableInvoiceStatuses] } },
      include: { asset: true },
    });
    if (!invoice) throw new Error("MOOVE_INVOICE_NOT_PAYABLE");
    if (input.agentId && invoice.issuerAgentId !== input.agentId) throw new Error("MOOVE_INVOICE_AGENT_MISMATCH");
    if (input.maxUsage !== 1) throw new Error("MOOVE_INVOICE_MAX_USAGE_REQUIRED");
    if (!config.settlement) throw new Error("MOOVE_SETTLEMENT_CONFIG_REQUIRED");
    if (invoice.asset.network !== config.settlement.network || invoice.asset.symbol.toUpperCase() !== config.settlement.symbol || invoice.asset.decimals !== config.settlement.decimals) throw new Error("MOOVE_INVOICE_ASSET_MISMATCH");
    if (decimalToAtomic(input.toAmount, invoice.asset.decimals) !== BigInt(invoice.totalAtomic.toString())) throw new Error("MOOVE_INVOICE_AMOUNT_MISMATCH");
  }
}

async function audit(input: { organizationId: string; actorType: string; actorId?: string; action: string; targetId: string; result: "SUCCESS" | "FAILURE"; metadata?: Record<string, unknown> }) {
  await db.auditEvent.create({ data: {
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    targetType: "MOOVE_PAYMENT_LINK",
    targetId: input.targetId,
    result: input.result,
    metadata: toPrismaJson(input.metadata ?? {}),
  } });
}

async function markInvoicePending(invoiceId: string, row: MoovePaymentLinkRow) {
  await db.$transaction(async (tx) => {
    const changed = await tx.agentInvoice.updateMany({
      where: { id: invoiceId, issuerOrganizationId: row.organizationId, status: { in: ["SENT", "VIEWED", "APPROVAL_PENDING", "OVERDUE"] } },
      data: { status: "PAYMENT_PENDING" },
    });
    if (changed.count) {
      await tx.invoiceEvent.create({ data: { invoiceId, actorType: "SYSTEM", action: "INVOICE_MOOVE_PAYMENT_LINK_CREATED", metadata: { moovePaymentLinkId: row.id, providerLinkId: row.providerLinkId } } });
    }
  });
}

async function applyProviderRecord(row: MoovePaymentLinkRow, link: MoovePaymentLink | MoovePublicPaymentLink) {
  const config = mooveConfigFromEnv();
  if (config.settlement) assertMooveSettlementToken(link.token, config.settlement);
  const status = localStatus(link.status);
  const evidence = JSON.stringify(link);

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`moove:${row.id}`}, 0))`;
    const current = (await tx.$queryRaw<MoovePaymentLinkRow[]>`
      SELECT * FROM "MoovePaymentLink"
      WHERE "id"=${row.id}::uuid AND "organizationId"=${row.organizationId}::uuid
      FOR UPDATE`)[0];
    if (!current) throw new Error("MOOVE_PAYMENT_LINK_NOT_FOUND");
    if (current.providerLinkId && current.providerLinkId !== link.id) throw new Error("MOOVE_PROVIDER_LINK_MISMATCH");
    if (current.providerDescription !== (link.description ?? "")) throw new Error("MOOVE_PROVIDER_DESCRIPTION_MISMATCH");
    const completedNow = status === "COMPLETED" && current.providerStatus !== "COMPLETED";

    await tx.$executeRaw`
      UPDATE "MoovePaymentLink"
      SET "providerLinkId"=${link.id},
          "providerUrl"=${link.url},
          "providerStatus"=${status},
          "destinationAddress"=${link.destinationAddress},
          "token"=${evidence}::jsonb->'token',
          "receivedAmount"=${link.receivedAmount ?? null},
          "transactionUrl"=${link.transactionUrl ?? null},
          "providerEvidence"=${evidence}::jsonb,
          "failureCode"=NULL,
          "lastReconciledAt"=CURRENT_TIMESTAMP,
          "completedAt"=CASE WHEN ${status}='COMPLETED' THEN COALESCE("completedAt", CURRENT_TIMESTAMP) ELSE "completedAt" END,
          "updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=${current.id}::uuid AND "organizationId"=${current.organizationId}::uuid`;

    if (!completedNow) return;

    if (current.invoiceId) {
      if (!config.settlement) throw new Error("MOOVE_SETTLEMENT_CONFIG_REQUIRED");
      const invoice = await tx.agentInvoice.findFirst({ where: { id: current.invoiceId, issuerOrganizationId: current.organizationId }, include: { asset: true } });
      if (!invoice) throw new Error("MOOVE_INVOICE_NOT_PAYABLE");
      if (invoice.asset.network !== config.settlement.network || invoice.asset.symbol.toUpperCase() !== config.settlement.symbol || invoice.asset.decimals !== config.settlement.decimals) throw new Error("MOOVE_INVOICE_ASSET_MISMATCH");
      if (!link.receivedAmount) throw new Error("MOOVE_INVOICE_RECEIVED_AMOUNT_MISSING");
      if (decimalToAtomic(link.receivedAmount, invoice.asset.decimals) !== BigInt(invoice.totalAtomic.toString())) throw new Error("MOOVE_INVOICE_RECEIVED_AMOUNT_MISMATCH");
      const changed = await tx.agentInvoice.updateMany({ where: { id: invoice.id, status: { in: [...payableInvoiceStatuses] } }, data: { status: "PAID", paidAt: new Date() } });
      if (changed.count !== 1 && invoice.status !== "PAID") throw new Error("MOOVE_INVOICE_SETTLEMENT_CONFLICT");
      if (changed.count === 1) {
        await tx.invoiceEvent.create({ data: { invoiceId: invoice.id, actorType: "SYSTEM", action: "INVOICE_PAID_VIA_MOOVE", metadata: { moovePaymentLinkId: current.id, providerLinkId: link.id, receivedAmount: link.receivedAmount, transactionUrl: link.transactionUrl ?? null } } });
        await tx.outboxEvent.create({ data: { organizationId: invoice.recipientOrganizationId, eventType: "AGENT_INVOICE_PAID", aggregateType: "AGENT_INVOICE", aggregateId: invoice.id, payload: { invoiceNumber: invoice.number, settlementProvider: "MOOVE", moovePaymentLinkId: current.id, transactionUrl: link.transactionUrl ?? null } } });
      }
    }

    await tx.outboxEvent.create({ data: {
      organizationId: current.organizationId,
      eventType: "MOOVE_PAYMENT_COMPLETED",
      aggregateType: "MOOVE_PAYMENT_LINK",
      aggregateId: current.id,
      payload: toPrismaJson({
        moovePaymentLinkId: current.id,
        providerLinkId: link.id,
        agentId: current.agentId,
        resourceListingId: current.resourceListingId,
        invoiceId: current.invoiceId,
        toAmount: link.toAmount,
        receivedAmount: link.receivedAmount ?? null,
        token: link.token,
        destinationAddress: link.destinationAddress,
        transactionUrl: link.transactionUrl ?? null,
      }),
    } });
    if (current.resourceListingId) {
      await tx.outboxEvent.create({ data: { organizationId: current.organizationId, eventType: "MOOVE_RESOURCE_PAYMENT_COMPLETED", aggregateType: "RESOURCE_LISTING", aggregateId: current.resourceListingId, payload: toPrismaJson({ moovePaymentLinkId: current.id, providerLinkId: link.id, agentId: current.agentId, receivedAmount: link.receivedAmount ?? link.toAmount, token: link.token, transactionUrl: link.transactionUrl ?? null }) } });
    }
    await tx.auditEvent.create({ data: { organizationId: current.organizationId, actorType: "SYSTEM", action: "MOOVE_PAYMENT_COMPLETED", targetType: "MOOVE_PAYMENT_LINK", targetId: current.id, result: "SUCCESS", metadata: { providerLinkId: link.id, receivedAmount: link.receivedAmount ?? null, transactionUrl: link.transactionUrl ?? null, invoiceId: current.invoiceId, resourceListingId: current.resourceListingId } } });
  }, { isolationLevel: "Serializable" });

  return (await findLocalById(row.id, row.organizationId))!;
}

async function recoverByMarker(row: MoovePaymentLinkRow) {
  const config = mooveConfigFromEnv();
  const { links } = await listAllMoovePaymentLinks(config);
  const matches = links.filter((link) => link.description === row.providerDescription);
  if (matches.length > 1) throw new Error("MOOVE_RECOVERY_AMBIGUOUS");
  if (!matches[0]) return null;
  return applyProviderRecord(row, matches[0]);
}

export async function createMooveReceivePayment(input: CreateMooveReceiveInput) {
  const config = mooveConfigFromEnv();
  assertMooveOrganization(input.organizationId, config);
  assertMooveAmount(input.toAmount);
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  if (input.description && input.description.length > 450) throw new Error("MOOVE_DESCRIPTION_TOO_LONG");
  if (input.maxUsage !== undefined && (!Number.isInteger(input.maxUsage) || input.maxUsage < 1 || input.maxUsage > 2_147_483_647)) throw new Error("MOOVE_MAX_USAGE_INVALID");
  if (input.expirationDate && (!Number.isFinite(Date.parse(input.expirationDate)) || Date.parse(input.expirationDate) <= Date.now())) throw new Error("MOOVE_EXPIRATION_INVALID");
  await validateReferences(input, config);

  const hash = requestHash({
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey,
    toAmount: input.toAmount,
    description: input.description,
    maxUsage: input.maxUsage,
    expirationDate: input.expirationDate,
    agentId: input.agentId,
    resourceListingId: input.resourceListingId,
    invoiceId: input.invoiceId,
  });
  const id = randomUUID();
  const providerDesc = providerDescription(id, input.description);
  const inserted = await db.$queryRaw<MoovePaymentLinkRow[]>`
    INSERT INTO "MoovePaymentLink" (
      "id","organizationId","agentId","resourceListingId","invoiceId","idempotencyKey","requestHash",
      "providerStatus","toAmount","description","providerDescription","maxUsage","expirationDate"
    ) VALUES (
      ${id}::uuid,${input.organizationId}::uuid,${input.agentId ?? null}::uuid,${input.resourceListingId ?? null}::uuid,
      ${input.invoiceId ?? null}::uuid,${input.idempotencyKey},${hash},'CREATING',${input.toAmount},${input.description ?? null},
      ${providerDesc},${input.maxUsage ?? null},${input.expirationDate ? new Date(input.expirationDate) : null}
    )
    ON CONFLICT ("organizationId","idempotencyKey") DO NOTHING
    RETURNING *`;

  if (!inserted[0]) {
    const existing = await findLocalByIdempotency(input.organizationId, input.idempotencyKey);
    if (!existing) throw new Error("MOOVE_IDEMPOTENCY_STATE_INVALID");
    if (existing.requestHash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
    if (["CREATING", "SUBMISSION_UNKNOWN"].includes(existing.providerStatus)) {
      try { return (await recoverByMarker(existing)) ?? existing; } catch { return existing; }
    }
    return existing;
  }

  const row = inserted[0];
  try {
    const created = await createMoovePaymentLink({
      toAmount: input.toAmount,
      description: providerDesc,
      ...(input.maxUsage !== undefined ? { maxUsage: input.maxUsage } : {}),
      ...(input.expirationDate ? { expirationDate: input.expirationDate } : {}),
    }, config);
    await db.$executeRaw`
      UPDATE "MoovePaymentLink"
      SET "providerLinkId"=${created.id},"providerUrl"=${created.url},"providerStatus"='ACTIVE',"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=${row.id}::uuid`;
    const current = (await findLocalById(row.id, row.organizationId))!;
    if (input.invoiceId) await markInvoicePending(input.invoiceId, current);
    await audit({ organizationId: row.organizationId, actorType: input.actorType, actorId: input.actorId, action: "MOOVE_PAYMENT_LINK_CREATED", targetId: row.id, result: "SUCCESS", metadata: { providerLinkId: created.id, toAmount: input.toAmount, agentId: input.agentId ?? null, invoiceId: input.invoiceId ?? null, resourceListingId: input.resourceListingId ?? null } });
    try {
      const provider = await retrieveMoovePaymentLink(created.id, config);
      return await applyProviderRecord(current, provider);
    } catch (error) {
      if (error instanceof Error && error.message === "MOOVE_SETTLEMENT_TOKEN_MISMATCH") {
        await db.$executeRaw`UPDATE "MoovePaymentLink" SET "failureCode"='MOOVE_SETTLEMENT_TOKEN_MISMATCH',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id}::uuid`;
        throw error;
      }
      return current;
    }
  } catch (error) {
    const alreadyCreated = Boolean((await findLocalById(row.id, row.organizationId))?.providerLinkId);
    if (alreadyCreated) throw error;
    const ambiguous = error instanceof MooveProviderError && error.ambiguous;
    const code = error instanceof MooveProviderError ? error.code : error instanceof Error ? error.message : "MOOVE_CREATE_FAILED";
    await db.$executeRaw`
      UPDATE "MoovePaymentLink"
      SET "providerStatus"=${ambiguous ? "SUBMISSION_UNKNOWN" : "FAILED"},"failureCode"=${code},"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=${row.id}::uuid`;
    await audit({ organizationId: row.organizationId, actorType: input.actorType, actorId: input.actorId, action: "MOOVE_PAYMENT_LINK_CREATE_FAILED", targetId: row.id, result: "FAILURE", metadata: { code, ambiguous } });
    if (ambiguous) {
      const unknown = (await findLocalById(row.id, row.organizationId))!;
      try { return (await recoverByMarker(unknown)) ?? unknown; } catch { return unknown; }
    }
    throw error;
  }
}

export async function listLocalMoovePaymentLinks(input: { organizationId: string; status?: MooveLocalStatus; limit?: number; offset?: number }) {
  const config = mooveConfigFromEnv();
  assertMooveOrganization(input.organizationId, config);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  if (input.status) {
    return db.$queryRaw<MoovePaymentLinkRow[]>`
      SELECT * FROM "MoovePaymentLink"
      WHERE "organizationId"=${input.organizationId}::uuid AND "providerStatus"=${input.status}
      ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  return db.$queryRaw<MoovePaymentLinkRow[]>`
    SELECT * FROM "MoovePaymentLink"
    WHERE "organizationId"=${input.organizationId}::uuid
    ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function getMooveReceivePayment(input: { organizationId: string; id: string; refresh?: boolean }) {
  const config = mooveConfigFromEnv();
  assertMooveOrganization(input.organizationId, config);
  const row = await findLocalById(input.id, input.organizationId);
  if (!row) throw new Error("MOOVE_PAYMENT_LINK_NOT_FOUND");
  if (input.refresh && row.providerLinkId && row.providerStatus !== "FAILED") {
    try { return await applyProviderRecord(row, await retrieveMoovePaymentLink(row.providerLinkId, config)); }
    catch (error) {
      if (error instanceof MooveProviderError && error.code === "CANNOT_FIND_PAYMENT_LINK") throw new Error("MOOVE_PROVIDER_LINK_NOT_FOUND");
      throw error;
    }
  }
  return row;
}

export async function reconcileMooveReceive(organizationId: string) {
  const config = mooveConfigFromEnv();
  assertMooveOrganization(organizationId, config);
  const local = await db.$queryRaw<MoovePaymentLinkRow[]>`
    SELECT * FROM "MoovePaymentLink"
    WHERE "organizationId"=${organizationId}::uuid
      AND "providerStatus" IN ('CREATING','ACTIVE','SUBMISSION_UNKNOWN','INACTIVE')
    ORDER BY "createdAt" DESC`;
  const { links, complete } = await listAllMoovePaymentLinks(config);
  const byId = new Map(links.map((link) => [link.id, link]));
  const byDescription = new Map<string, MoovePaymentLink[]>();
  for (const link of links) {
    const description = link.description ?? "";
    const group = byDescription.get(description) ?? [];
    group.push(link);
    byDescription.set(description, group);
  }
  let reconciled = 0;
  let completed = 0;
  let unresolved = 0;
  for (const row of local) {
    let match = row.providerLinkId ? byId.get(row.providerLinkId) : undefined;
    if (!match) {
      const candidates = byDescription.get(row.providerDescription) ?? [];
      if (candidates.length > 1) {
        await db.$executeRaw`UPDATE "MoovePaymentLink" SET "failureCode"='MOOVE_RECOVERY_AMBIGUOUS',"lastReconciledAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id}::uuid`;
        unresolved += 1;
        continue;
      }
      match = candidates[0];
    }
    if (!match) {
      await db.$executeRaw`UPDATE "MoovePaymentLink" SET "lastReconciledAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id}::uuid`;
      unresolved += 1;
      continue;
    }
    const before = row.providerStatus;
    try {
      await applyProviderRecord(row, match);
      reconciled += 1;
      if (before !== "COMPLETED" && match.status === "completed") completed += 1;
    } catch (error) {
      const code = error instanceof Error ? error.message : "MOOVE_RECONCILIATION_FAILED";
      await db.$executeRaw`UPDATE "MoovePaymentLink" SET "failureCode"=${code},"lastReconciledAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${row.id}::uuid`;
      unresolved += 1;
    }
  }
  return { providerLinksScanned: links.length, localLinksScanned: local.length, reconciled, completed, unresolved, providerScanComplete: complete };
}