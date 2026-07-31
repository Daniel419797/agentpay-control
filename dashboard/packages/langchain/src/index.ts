import type { AgentPayClient, PaidRequest, PaymentIntent } from "../../sdk/src/index";

type ToolResult = { content: string; intent?: PaymentIntent };

function explorerUrl(network: string | undefined, txId: string): string {
  if (network === "eip155:5042002") return `https://testnet.arcscan.app/tx/${txId}`;
  return `https://hashscan.io/testnet/transaction/${txId}`;
}

export function createAgentPayTool(client: AgentPayClient, agentId: string) {
  return {
    name: "agentpay_purchase_resource",
    description:
      "Purchase an x402-protected resource (market data, file, AI inference, or web research) " +
      "within the agent's published spending policy. Returns payment intent with " +
      "settlement status and explorer link if settled.",
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
        case "DENIED":
          content = `Payment denied by policy.`;
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
