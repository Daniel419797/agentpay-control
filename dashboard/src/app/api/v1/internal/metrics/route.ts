import { problem } from "@/lib/api";
import { db } from "@/lib/db";
import { authorizeInternalRequest } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizeInternalRequest(request)) return problem(401, "UNAUTHORIZED", "A valid monitoring credential is required.");
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
  const [intents, pendingApprovals, unknownSettlements, deadLetters, pendingOutbox, oldestOutbox, recentFailures, failedAutomations, pendingBridges, failedBridges, declinedCards, overdueInvoices, failedIntelligenceRuns, unknownFiatTransfers] = await Promise.all([
    db.paymentIntent.groupBy({ by: ["status"], _count: { _all: true } }),
    db.approvalRequest.count({ where: { status: "PENDING" } }),
    db.paymentIntent.count({ where: { status: "SUBMISSION_UNKNOWN" } }),
    db.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
    db.outboxEvent.count({ where: { processedAt: null, deadLetteredAt: null } }),
    db.outboxEvent.findFirst({ where: { processedAt: null, deadLetteredAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.paymentIntent.count({ where: { updatedAt: { gte: fiveMinutesAgo }, status: { in: ["SETTLEMENT_FAILED", "FAILED_BEFORE_SUBMISSION"] } } }),
    db.automationExecution.count({ where: { status: "FAILED", updatedAt: { gte: fiveMinutesAgo } } }),
    db.crossChainTransfer.count({ where: { status: { in: ["SUBMITTED", "BRIDGING"] } } }),
    db.crossChainTransfer.count({ where: { status: "FAILED", updatedAt: { gte: fiveMinutesAgo } } }),
    db.cardAuthorization.count({ where: { approved: false, requestedAt: { gte: fiveMinutesAgo } } }),
    db.agentInvoice.count({ where: { status: "OVERDUE" } }),
    db.intelligenceRun.count({ where: { status: "FAILED", startedAt: { gte: fiveMinutesAgo } } }),
    db.fiatTransfer.count({ where: { status: "SUBMISSION_UNKNOWN" } }),
  ]);
  const statusCounts = new Map(intents.map((row) => [row.status, row._count._all]));
  const lines = [
    "# HELP agentpay_payment_intents Payment intents by status.",
    "# TYPE agentpay_payment_intents gauge",
    ...[...statusCounts].map(([status, count]) => `agentpay_payment_intents{status="${status}"} ${count}`),
    "# TYPE agentpay_pending_approvals gauge",
    `agentpay_pending_approvals ${pendingApprovals}`,
    "# TYPE agentpay_unknown_settlements gauge",
    `agentpay_unknown_settlements ${unknownSettlements}`,
    "# TYPE agentpay_outbox_pending gauge",
    `agentpay_outbox_pending ${pendingOutbox}`,
    "# TYPE agentpay_outbox_dead_letters gauge",
    `agentpay_outbox_dead_letters ${deadLetters}`,
    "# TYPE agentpay_outbox_oldest_age_seconds gauge",
    `agentpay_outbox_oldest_age_seconds ${oldestOutbox ? Math.max(0, Math.floor((now.getTime() - oldestOutbox.createdAt.getTime()) / 1000)) : 0}`,
    "# TYPE agentpay_recent_payment_failures gauge",
    `agentpay_recent_payment_failures ${recentFailures}`,
    "# TYPE agentpay_recent_automation_failures gauge",
    `agentpay_recent_automation_failures ${failedAutomations}`,
    "# TYPE agentpay_cross_chain_pending gauge",
    `agentpay_cross_chain_pending ${pendingBridges}`,
    "# TYPE agentpay_recent_cross_chain_failures gauge",
    `agentpay_recent_cross_chain_failures ${failedBridges}`,
    "# TYPE agentpay_recent_card_declines gauge",
    `agentpay_recent_card_declines ${declinedCards}`,
    "# TYPE agentpay_overdue_invoices gauge",
    `agentpay_overdue_invoices ${overdueInvoices}`,
    "# TYPE agentpay_recent_intelligence_failures gauge",
    `agentpay_recent_intelligence_failures ${failedIntelligenceRuns}`,
    "# TYPE agentpay_fiat_submission_unknown gauge",
    `agentpay_fiat_submission_unknown ${unknownFiatTransfers}`,
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" } });
}
