import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { ApprovalActions } from "@/components/approval-actions";
import { db } from "@/lib/db";
import { formatAtomic, formatTimestamp } from "@/lib/format";
import { currentWorkspace, workspaceHasRole } from "@/lib/workspace";

export default async function ApprovalPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const [{ approvalId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const approval = await db.approvalRequest.findFirst({
    where: { id: approvalId, paymentIntent: { organizationId: workspace.organization.id } },
    include: { decisions: true, paymentIntent: { include: { agent: true, quote: { include: { asset: true } } } } },
  });
  if (!approval) notFound();
  const initiator = await db.auditEvent.findFirst({
    where: {
      organizationId: workspace.organization.id,
      action: "PAYMENT_REQUEST_INITIATED",
      targetType: "PAYMENT_INTENT",
      targetId: approval.paymentIntentId,
      result: "SUCCESS",
    },
    orderBy: { occurredAt: "asc" },
    select: { actorType: true, actorId: true },
  });
  const quote = approval.paymentIntent.quote;
  const approvals = approval.decisions.filter((vote) => vote.decision === "APPROVE").length;
  const rejections = approval.decisions.filter((vote) => vote.decision === "REJECT").length;
  const canDecide = workspaceHasRole(workspace, ["OWNER", "APPROVER"]);
  const selfInitiated = initiator?.actorType === "USER" && initiator.actorId === workspace.user.id;
  return <FormPage title="Payment approval" description={`Requested ${formatTimestamp(approval.requestedAt)} · ${approval.status}`}>
    <div className="detail-grid">
      <div><span>Agent</span><strong>{approval.paymentIntent.agent.name}</strong></div>
      <div><span>Amount</span><strong>{quote ? `${formatAtomic(quote.amountAtomic.toString(), quote.asset.decimals)} ${quote.asset.symbol}` : "Quote unavailable"}</strong></div>
      <div><span>Reason</span><strong>{approval.requestPurpose ?? "Policy review required"}</strong></div>
      <div><span>Destination</span><strong>{quote?.payToAccountId ?? approval.paymentIntent.merchantHost}</strong></div>
      <div><span>Approval progress</span><strong>{approvals} / {approval.requiredApprovals}</strong></div>
      <div><span>Rejections</span><strong>{rejections} / {approval.requiredRejections}</strong></div>
    </div>
    {!canDecide && approval.status === "PENDING" && <div className="inline-notice" role="note">This account can review approval evidence but cannot vote. An Owner or Approver must decide the request.</div>}
    {canDecide && selfInitiated && approval.status === "PENDING" && <div className="inline-notice" role="note"><strong>Independent approval required.</strong> You initiated this payment, so you may reject it but cannot provide an approving vote. A different Owner or Approver must approve it.</div>}
    <ApprovalActions approvalId={approval.id} status={approval.status} canDecide={canDecide} canApprove={canDecide && !selfInitiated} />
  </FormPage>;
}
