import type { AgentPayClient, AutonomousCardPurchaseRequest, PaidRequest, PaymentIntent } from "../../sdk/src/index";

type ToolResult = { content: string; intent?: PaymentIntent; data?: unknown };

function explorerUrl(network: string | undefined, txId: string): string {
  if (network === "eip155:5042002") return `https://testnet.arcscan.app/tx/${txId}`;
  return `https://hashscan.io/testnet/transaction/${txId}`;
}

export function createAgentPayTool(client: AgentPayClient, agentId: string) {
  return {
    name: "agentpay_purchase_resource",
    description: "Purchase an x402-protected resource within the agent's published spending policy. AgentPay can allow, deny, or require human approval and returns settlement evidence.",
    schema: {
      type: "object",
      properties: {
        resourceUrl: { type: "string", description: "URL of the x402-protected resource" },
        purpose: { type: "string", description: "Reason for the purchase" },
        maxAmountAtomic: { type: "string", description: "Maximum spend in atomic units" },
      },
      required: ["resourceUrl"],
    },
    invoke: async (input: PaidRequest): Promise<ToolResult> => {
      const intent = await client.createPaidRequest(agentId, input);
      let content: string;
      switch (intent.status) {
        case "SETTLED": {
          const txId = intent.attempts?.[0]?.settlement?.transactionId;
          const network = intent.attempts?.[0]?.settlement?.network;
          content = `Payment settled. Transaction: ${txId}\nExplorer: ${explorerUrl(network, txId ?? "")}`;
          break;
        }
        case "DENIED": content = "Payment denied by policy."; break;
        case "APPROVAL_PENDING": content = `Payment requires human approval. Approval ID: ${intent.approval?.id}.`; break;
        default: content = `Payment status: ${intent.status}. Intent ID: ${intent.id}`;
      }
      return { content, intent };
    },
  };
}

export function createAgentPayCardPurchaseTool(client: AgentPayClient, agentId: string) {
  return {
    name: "agentpay_create_card_purchase",
    description: "Initiate a policy-controlled virtual-card checkout without exposing PAN or CVC to the agent. The input contains a constrained checkout plan whose secret fields are symbolic references resolved only inside AgentPay's isolated executor.",
    schema: {
      type: "object",
      properties: {
        virtualCardId: { type: "string" },
        merchantUrl: { type: "string" },
        amountMinor: { type: "string" },
        currency: { type: "string" },
        merchantCategory: { type: "string" },
        merchantCountry: { type: "string" },
        purpose: { type: "string" },
        checkoutPlan: { type: "object" },
      },
      required: ["merchantUrl", "amountMinor", "currency", "checkoutPlan"],
    },
    invoke: async (input: AutonomousCardPurchaseRequest): Promise<ToolResult> => {
      const result = await client.createAutonomousCardPurchase(agentId, input);
      const purchase = result.purchase;
      const content = purchase.status === "APPROVAL_PENDING"
        ? `Card purchase requires human approval. Purchase ID: ${purchase.id}. Approval ID: ${result.approvalId ?? "pending"}.`
        : purchase.status === "READY" || purchase.status === "EXECUTING"
          ? `Card purchase accepted for controlled checkout. Purchase ID: ${purchase.id}. Status: ${purchase.status}.`
          : `Card purchase status: ${purchase.status}. Purchase ID: ${purchase.id}.`;
      return { content, data: result };
    },
  };
}

export function createAgentPayCardStatusTool(client: AgentPayClient) {
  return {
    name: "agentpay_get_card_purchase",
    description: "Read an autonomous card purchase status and provider-backed result evidence.",
    schema: { type: "object", properties: { purchaseId: { type: "string" } }, required: ["purchaseId"] },
    invoke: async ({ purchaseId }: { purchaseId: string }): Promise<ToolResult> => {
      const purchase = await client.getAutonomousCardPurchase(purchaseId);
      return { content: `Card purchase ${purchase.id}: ${purchase.status}${purchase.resultCode ? ` (${purchase.resultCode})` : ""}.`, data: purchase };
    },
  };
}

export function createAgentPayTools(client: AgentPayClient, agentId: string) {
  return [createAgentPayTool(client, agentId), createAgentPayCardPurchaseTool(client, agentId), createAgentPayCardStatusTool(client)];
}
