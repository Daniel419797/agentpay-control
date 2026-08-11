import { handleApiError, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { notificationDestinationDisplay } from "@/lib/notification-destination";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const PAGE_SIZE = 500;

type ExportRecord = { type: string; data: unknown };

function json(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

async function* exportRecords(organizationId: string): AsyncGenerator<ExportRecord> {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { retentionPolicy: true } });
  yield { type: "organization", data: organization };

  const members = await db.membership.findMany({ where: { organizationId }, include: { user: true }, orderBy: { id: "asc" } });
  for (const row of members) yield { type: "membership", data: row };

  const agents = await db.agent.findMany({ where: { organizationId }, include: { accounts: { select: { id: true, network: true, accountId: true, evmAddress: true, publicKey: true, custodyType: true, signingMode: true, status: true, syncedAt: true, createdAt: true } }, credentials: { select: { id: true, label: true, prefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true } }, policies: { include: { versions: true } } }, orderBy: { id: "asc" } });
  for (const row of agents) yield { type: "agent", data: row };

  const providers = await db.resourceProvider.findMany({ where: { organizationId }, include: { resources: { include: { prices: { include: { asset: true } } } } }, orderBy: { id: "asc" } });
  for (const row of providers) yield { type: "resourceProvider", data: row };

  const endpoints = await db.notificationEndpoint.findMany({ where: { organizationId }, select: { id: true, type: true, name: true, destination: true, eventTypes: true, status: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" } });
  for (const endpoint of endpoints) yield { type: "notificationEndpoint", data: { ...endpoint, destination: notificationDestinationDisplay(endpoint.type, endpoint.destination) } };

  const deletionRequests = await db.deletionRequest.findMany({ where: { organizationId }, orderBy: { id: "asc" } });
  for (const row of deletionRequests) yield { type: "deletionRequest", data: row };

  const cardholders = await db.cardholderProfile.findMany({ where: { organizationId }, orderBy: { id: "asc" } });
  for (const row of cardholders) yield { type: "cardholder", data: row };

  const cards = await db.virtualCard.findMany({ where: { organizationId }, select: { id: true, agentId: true, cardholderProfileId: true, provider: true, status: true, currency: true, last4: true, brand: true, expMonth: true, expYear: true, nickname: true, spendingLimitMinor: true, spendingInterval: true, allowedCategories: true, blockedCategories: true, allowedCountries: true, version: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" } });
  for (const row of cards) yield { type: "virtualCard", data: row };

  const fiatAccounts = await db.fiatAccount.findMany({ where: { organizationId }, select: { id: true, provider: true, status: true, currency: true, availableMinor: true, pendingMinor: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" } });
  for (const row of fiatAccounts) yield { type: "fiatAccount", data: row };

  const automationRules = await db.automationRule.findMany({ where: { organizationId }, select: { id: true, agentId: true, name: true, description: true, status: true, triggerType: true, triggerConfig: true, actionType: true, approvalThreshold: true, maxExecutionsPerDay: true, nextRunAt: true, version: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" } });
  for (const row of automationRules) yield { type: "automationRule", data: row };

  let paymentCursor: string | undefined;
  for (;;) {
    const rows = await db.paymentIntent.findMany({
      where: { organizationId },
      include: { quote: { include: { asset: true } }, decisions: true, reservation: true, approval: { include: { decisions: true } }, attempts: { include: { settlement: true } }, fulfillment: true },
      orderBy: { id: "asc" }, take: PAGE_SIZE, ...(paymentCursor ? { cursor: { id: paymentCursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) yield { type: "paymentIntent", data: row };
    paymentCursor = rows.at(-1)!.id;
  }

  let auditCursor: string | undefined;
  for (;;) {
    const rows = await db.auditEvent.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(auditCursor ? { cursor: { id: auditCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "auditEvent", data: row };
    auditCursor = rows.at(-1)!.id;
  }

  let authCursor: string | undefined;
  for (;;) {
    const rows = await db.cardAuthorization.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(authCursor ? { cursor: { id: authCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "cardAuthorization", data: row };
    authCursor = rows.at(-1)!.id;
  }

  let fiatCursor: string | undefined;
  for (;;) {
    const rows = await db.fiatTransfer.findMany({ where: { organizationId }, select: { id: true, fiatAccountId: true, provider: true, idempotencyKey: true, direction: true, status: true, amountMinor: true, currency: true, failureCode: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(fiatCursor ? { cursor: { id: fiatCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "fiatTransfer", data: row };
    fiatCursor = rows.at(-1)!.id;
  }

  let invoiceCursor: string | undefined;
  for (;;) {
    const rows = await db.agentInvoice.findMany({ where: { OR: [{ issuerOrganizationId: organizationId }, { recipientOrganizationId: organizationId }] }, include: { items: true, events: true, settlement: true }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(invoiceCursor ? { cursor: { id: invoiceCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "invoice", data: row };
    invoiceCursor = rows.at(-1)!.id;
  }

  let reviewCursor: string | undefined;
  for (;;) {
    const rows = await db.resourceReview.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(reviewCursor ? { cursor: { id: reviewCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "resourceReview", data: row };
    reviewCursor = rows.at(-1)!.id;
  }

  let crossChainCursor: string | undefined;
  for (;;) {
    const rows = await db.crossChainTransfer.findMany({ where: { organizationId }, include: { quote: { omit: { transactionRequestEncrypted: true } } }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(crossChainCursor ? { cursor: { id: crossChainCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "crossChainTransfer", data: row };
    crossChainCursor = rows.at(-1)!.id;
  }

  let automationExecutionCursor: string | undefined;
  for (;;) {
    const rows = await db.automationExecution.findMany({ where: { organizationId }, include: { decisions: true }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(automationExecutionCursor ? { cursor: { id: automationExecutionCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "automationExecution", data: row };
    automationExecutionCursor = rows.at(-1)!.id;
  }

  let observationCursor: string | undefined;
  for (;;) {
    const rows = await db.financialObservationDaily.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(observationCursor ? { cursor: { id: observationCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "financialObservationDaily", data: row };
    observationCursor = rows.at(-1)!.id;
  }

  let forecastCursor: string | undefined;
  for (;;) {
    const rows = await db.spendForecast.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(forecastCursor ? { cursor: { id: forecastCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "spendForecast", data: row };
    forecastCursor = rows.at(-1)!.id;
  }

  let anomalyCursor: string | undefined;
  for (;;) {
    const rows = await db.financialAnomaly.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(anomalyCursor ? { cursor: { id: anomalyCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "financialAnomaly", data: row };
    anomalyCursor = rows.at(-1)!.id;
  }

  let recommendationCursor: string | undefined;
  for (;;) {
    const rows = await db.budgetRecommendation.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(recommendationCursor ? { cursor: { id: recommendationCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "budgetRecommendation", data: row };
    recommendationCursor = rows.at(-1)!.id;
  }

  let intelligenceCursor: string | undefined;
  for (;;) {
    const rows = await db.intelligenceRun.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: PAGE_SIZE, ...(intelligenceCursor ? { cursor: { id: intelligenceCursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) yield { type: "intelligenceRun", data: row };
    intelligenceCursor = rows.at(-1)!.id;
  }
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before exporting organization data.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before exporting organization data.");

    const encoder = new TextEncoder();
    const iterator = exportRecords(workspace.organization.id)[Symbol.asyncIterator]();
    let started = false;
    let finished = false;
    const exportedAt = new Date().toISOString();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!started) {
            started = true;
            controller.enqueue(encoder.encode(`{"schemaVersion":5,"format":"record-stream","exportedAt":${json(exportedAt)},"exportSecurity":{"complete":true,"credentialBearingDestinationsRedacted":true,"encryptedSecretsExcluded":true},"records":[`));
          }
          const next = await iterator.next();
          if (next.done) {
            if (!finished) controller.enqueue(encoder.encode("]}"));
            finished = true;
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`${finished ? "," : ""}${json(next.value)}`));
          finished = true;
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        if (iterator.return) await iterator.return(undefined);
      },
    });
    return new Response(stream, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="agentpay-${workspace.organization.slug}-export.json"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return handleApiError(error);
  }
}
