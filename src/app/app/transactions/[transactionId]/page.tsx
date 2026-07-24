import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function TransactionPage({ params }: { params: Promise<{ transactionId: string }> }) {
  const [{ transactionId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const walletEvent = await db.auditEvent.findFirst({
    where: { organizationId: workspace.organization.id, action: "WALLET_PAYMENT_SETTLED", targetId: transactionId },
  });
  if (walletEvent) {
    const metadata = walletEvent.metadata as { payerAccountId?: string; payeeAccountId?: string; amountHbar?: string; consensusTimestamp?: string };
    return <FormPage title="Hedera transaction" description={transactionId}>
      <div className="detail-grid">
        <div><span>Status</span><strong>SETTLED</strong></div>
        <div><span>Amount</span><strong>{metadata.amountHbar ?? "0"} HBAR</strong></div>
        <div><span>Payer</span><strong>{metadata.payerAccountId ?? "Unavailable"}</strong></div>
        <div><span>Payee</span><strong>{metadata.payeeAccountId ?? "Unavailable"}</strong></div>
        <div><span>Consensus</span><strong>{metadata.consensusTimestamp ?? "Confirmed"}</strong></div>
      </div>
      <a className="primary-button" href={`https://hashscan.io/testnet/transaction/${transactionId}`} target="_blank" rel="noreferrer">Open HashScan receipt</a>
    </FormPage>;
  }
  const intent = await db.paymentIntent.findFirst({
    where: { id: transactionId, organizationId: workspace.organization.id },
    include: { quote: true, decisions: true, attempts: { include: { settlement: true } } },
  });
  if (!intent) notFound();
  return <FormPage title="Transaction detail" description={`Intent ${intent.id}`}>
    <ol className="timeline">
      <li><strong>Request created</strong><span>{intent.createdAt.toLocaleString()}</span></li>
      {intent.decisions.map((decision) => <li key={decision.id}><strong>Policy {decision.outcome}</strong><span>{decision.reasonCodes.join(", ") || "No policy exceptions"}</span></li>)}
      {intent.attempts.map((attempt) => <li key={attempt.id}><strong>Attempt {attempt.status}</strong><span>{attempt.settlement?.transactionId ?? attempt.errorCode ?? "Awaiting settlement"}</span></li>)}
    </ol>
  </FormPage>;
}
