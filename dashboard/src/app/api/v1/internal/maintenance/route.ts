import { finalizeDeletionRequests, openUnresolvedSubmissionIncidents, runPaymentMaintenance, runRetentionMaintenance } from "@/domain/maintenance-service";
import { reconcileUnknownHederaPayments } from "@/domain/payment-reconciliation-service";
import { runResourceHealthChecks } from "@/domain/resource-health-service";
import { markOverdueInvoices } from "@/domain/invoice-service";
import { reconcileCrossChainTransfers } from "@/domain/cross-chain-service";
import { reconcileUnknownContractExecutions, resumeDeferredAutomationPayments, runEventDrivenAutomations, runScheduledAutomations } from "@/domain/automation-service";
import { runAllFinancialIntelligence } from "@/domain/financial-intelligence-service";
import { reconcileUnknownFiatTransfers } from "@/domain/fiat-reconciliation-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { authorizeInternalRequest } from "@/lib/internal-auth";

export async function POST(request: Request) {
  try {
    if (!authorizeInternalRequest(request)) return problem(401, "UNAUTHORIZED", "A valid maintenance service credential is required.");
    const [payments, paymentReconciliation, retention, deletions, resourceHealth, invoices, crossChain, fiat, scheduledAutomations, eventAutomations, deferredAutomations, contractReconciliation, intelligence] = await Promise.all([
      runPaymentMaintenance(),
      reconcileUnknownHederaPayments(),
      runRetentionMaintenance(),
      finalizeDeletionRequests(),
      runResourceHealthChecks(),
      markOverdueInvoices(),
      reconcileCrossChainTransfers(),
      reconcileUnknownFiatTransfers(),
      runScheduledAutomations(),
      runEventDrivenAutomations(),
      resumeDeferredAutomationPayments(),
      reconcileUnknownContractExecutions(),
      runAllFinancialIntelligence(),
    ]);
    const incidents = await openUnresolvedSubmissionIncidents();
    return ok({ payments, paymentReconciliation, retention, deletions, resourceHealth, invoices, crossChain, fiat, incidents, automations: { scheduled: scheduledAutomations, eventDriven: eventAutomations, deferredPayments: deferredAutomations, contractReconciliation }, intelligence });
  } catch (error) {
    return handleApiError(error);
  }
}
