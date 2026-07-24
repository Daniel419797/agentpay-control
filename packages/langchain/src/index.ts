import type { AgentPayClient, PaidRequest, PaymentIntent } from "@agentpay/sdk";

type ToolResult = { content: string; intent?: PaymentIntent };

export function createAgentPayTool(client: AgentPayClient, agentId: string) {
  return {
    name: "agentpay_purchase_resource",
    description:
      "Purchase an x402-protected resource (market data, file, AI inference, or web research) " +
      "within the agent's published Hedera spending policy. Returns payment intent with " +
      "settlement status and HashScan link if settled.",
    schema: {
      type: "object",
      properties: {
        resourceUrl: { type: "string", description: "URL of the x402-protected resource" },
        purpose: { type: "string", description: "Reason for the purchase" },
        maxAmountAtomic: { type: "string", description: "Maximum spend in tinybars" },
      },
      required: ["resourceUrl"],
    },
    invoke: async (input: PaidRequest): Promise<ToolResult> => {
      const intent = await client.createPaidRequest(agentId, input);
      let content: string;
      switch (intent.status) {
        case "SETTLED":
          const txId = intent.attempts?.[0]?.settlement?.transactionId;
          content = `Payment settled. Transaction: ${txId}\nHashScan: https://hashscan.io/testnet/transaction/${txId}`;
          break;
        case "DENIED":
          content = `Payment denied by policy. Reason codes not available in tool output.`;
          break;
        case "APPROVAL_PENDING":
          content = `Payment requires human approval. Approval ID: ${intent.approval?.id}. Poll with getPaymentStatus.`;
          break;
        default:
          content = `Payment status: ${intent.status}. Intent ID: ${intent.id}`;
      }
      return { content, intent };
    },
  };
}