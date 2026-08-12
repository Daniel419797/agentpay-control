import { handleApiError, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { notificationDestinationDisplay } from "@/lib/notification-destination";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before exporting organization data.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before exporting organization data.");
    const organizationId = workspace.organization.id;
    const [organization, members, agents, intents, providers, auditEvents, notificationEndpoints, deletionRequests, cardholders, cards, cardAuthorizations, fiatAccounts, fiatTransfers, invoices, reviews, crossChainTransfers, automationRules, automationExecutions, observations, forecasts, anomalies, recommendations, intelligenceRuns] = await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { retentionPolicy: true } }),
      db.membership.findMany({ where: { organizationId }, include: { user: true } }),
      db.agent.findMany({ where: { organizationId }, include: { accounts: { select: { id: true, network: true, accountId: true, evmAddress: true, publicKey: true, custodyType: true, signingMode: true, status: true, syncedAt: true, createdAt: true } }, credentials: { select: { id: true, label: true, prefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true } }, policies: { include: { versions: true } } } }),
      db.paymentIntent.findMany({ where: { organizationId }, include: { quote: { include: { asset: true } }, decisions: true, reservation: true, approval: { include: { decisions: true } }, attempts: { include: { settlement: true } }, fulfillment: true }, orderBy: { createdAt: "asc" }, take: 50_000 }),
      db.resourceProvider.findMany({ where: { organizationId }, include: { resources: { include: { prices: { include: { asset: true } } } } } }),
      db.auditEvent.findMany({ where: { organizationId }, orderBy: { occurredAt: "asc" }, take: 50_000 }),
      db.notificationEndpoint.findMany({ where: { organizationId }, select: { id: true, type: true, name: true, destination: true, eventTypes: true, status: true, createdAt: true, updatedAt: true } }),
      db.deletionRequest.findMany({ where: { organizationId }, orderBy: { requestedAt: "asc" } }),
      db.cardholderProfile.findMany({ where: { organizationId } }),
      db.virtualCard.findMany({ where: { organizationId }, select: { id: true, agentId: true, cardholderProfileId: true, provider: true, status: true, currency: true, last4: true, brand: true, expMonth: true, expYear: true, nickname: true, spendingLimitMinor: true, spendingInterval: true, allowedCategories: true, blockedCategories: true, allowedCountries: true, version: true, createdAt: true, updatedAt: true } }),
      db.cardAuthorization.findMany({ where: { organizationId }, orderBy: { requestedAt: "asc" }, take: 50_000 }),
      db.fiatAccount.findMany({ where: { organizationId }, select: { id: true, provider: true, status: true, currency: true, availableMinor: true, pendingMinor: true, createdAt: true, updatedAt: true } }),
      db.fiatTransfer.findMany({ where: { organizationId }, select: { id: true, fiatAccountId: true, provider: true, idempotencyKey: true, direction: true, status: true, amountMinor: true, currency: true, failureCode: true, createdAt: true, updatedAt: true } }),
      db.agentInvoice.findMany({ where: { OR: [{ issuerOrganizationId: organizationId }, { recipientOrganizationId: organizationId }] }, include: { items: true, events: true, settlement: true }, orderBy: { createdAt: "asc" }, take: 50_000 }),
      db.resourceReview.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 50_000 }),
      db.crossChainTransfer.findMany({ where: { organizationId }, include: { quote: { omit: { transactionRequestEncrypted: true } } }, orderBy: { createdAt: "asc" }, take: 50_000 }),
      db.automationRule.findMany({ where: { organizationId }, select: { id: true, agentId: true, name: true, description: true, status: true, triggerType: true, triggerConfig: true, actionType: true, approvalThreshold: true, maxExecutionsPerDay: true, nextRunAt: true, version: true, createdAt: true, updatedAt: true } }),
      db.automationExecution.findMany({ where: { organizationId }, include: { decisions: true }, orderBy: { createdAt: "asc" }, take: 50_000 }),
      db.financialObservationDaily.findMany({ where: { organizationId }, orderBy: { observationDate: "asc" }, take: 50_000 }),
      db.spendForecast.findMany({ where: { organizationId }, orderBy: { generatedAt: "asc" }, take: 50_000 }),
      db.financialAnomaly.findMany({ where: { organizationId }, orderBy: { detectedAt: "asc" }, take: 50_000 }),
      db.budgetRecommendation.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 50_000 }),
      db.intelligenceRun.findMany({ where: { organizationId }, orderBy: { startedAt: "asc" }, take: 50_000 }),
    ]);
    const safeNotificationEndpoints = notificationEndpoints.map((endpoint) => ({
      ...endpoint,
      destination: notificationDestinationDisplay(endpoint.type, endpoint.destination),
    }));
    const body = JSON.stringify({ schemaVersion: 4, exportedAt: new Date().toISOString(), exportSecurity: { credentialBearingDestinationsRedacted: true, encryptedSecretsExcluded: true }, organization, members, agents, paymentIntents: intents, providers, auditEvents, notificationEndpoints: safeNotificationEndpoints, deletionRequests, cardholders, cards, cardAuthorizations, fiatAccounts, fiatTransfers, invoices, reviews, crossChainTransfers, automationRules, automationExecutions, financialIntelligence: { observations, forecasts, anomalies, recommendations, runs: intelligenceRuns } }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
    return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="agentpay-${organization.slug}-export.json"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return handleApiError(error);
  }
}
