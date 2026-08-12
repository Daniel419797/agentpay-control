import { finalizeDeletionRequests, openUnresolvedSubmissionIncidents, runPaymentMaintenance, runRetentionMaintenance } from "@/domain/maintenance-service";
import { reconcileUnknownHederaPayments } from "@/domain/payment-reconciliation-service";
import { reconcileUnknownArcPayments } from "@/domain/arc-payment-reconciliation-service";
import { reconcileUnknownCardanoPayments } from "@/domain/cardano-payment-reconciliation-service";
import { reconcilePendingMasumiEscrows } from "@/domain/masumi-escrow-service";
import { openUnresolvedMasumiRefundMutationIncidents } from "@/domain/masumi-refund-mutation-incidents";
import { reconcilePendingMasumiRefundMutations } from "@/domain/masumi-refund-mutation-service";
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
    const [payments, hederaPaymentReconciliation, arcPaymentReconciliation, cardanoPaymentReconciliation, masumiEscrowReconciliation, masumiRefundMutationReconciliation, retention, deletions, resourceHealth, invoices, crossChain, fiat, scheduledAutomations, eventAutomations, deferredAutomations, contractReconciliation, intelligence] = await Promise.all([
      runPaymentMaintenance(),
      reconcileUnknownHederaPayments(),
      reconcileUnknownArcPayments(),
      reconcileUnknownCardanoPayments(),
      reconcilePendingMasumiEscrows(),
      reconcilePendingMasumiRefundMutations(),
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
    const [incidents, masumiRefundMutationIncidents] = await Promise.all([
      openUnresolvedSubmissionIncidents(),
      openUnresolvedMasumiRefundMutationIncidents(),
    ]);
    return ok({
      payments,
      paymentReconciliation: { hedera: hederaPaymentReconciliation, arc: arcPaymentReconciliation, cardano: cardanoPaymentReconciliation, masumiEscrow: masumiEscrowReconciliation, masumiRefundMutations: masumiRefundMutationReconciliation },
      retention,
      deletions,
      resourceHealth,
      invoices,
      crossChain,
      fiat,
      incidents,
      masumiRefundMutationIncidents,
      automations: { scheduled: scheduledAutomations, eventDriven: eventAutomations, deferredPayments: deferredAutomations, contractReconciliation },
      intelligence,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
