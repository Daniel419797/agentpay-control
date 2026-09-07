import type { AgentPayClient, MooveReceivePayment, MooveReceiveRequest, PaidRequest, PaymentIntent } from "../../sdk/src/index";

type ToolResult = { content: string; intent?: PaymentIntent };
type MooveToolResult = { content: string; payment: MooveReceivePayment };
type MooveLangChainInput = Omit<MooveReceiveRequest, "agentId"> & { idempotencyKey: string };

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

export function createAgentPayMooveReceiveTool(client: AgentPayClient, agentId: string) {
  return {
    name: "agentpay_create_moove_payment_link",
    description:
      "Create a Moove Receive payment link so the agent can accept payment into its organization's configured Moove settlement wallet. " +
      "The payment is not complete until providerStatus is COMPLETED. Reuse idempotencyKey for retries of the same intended link.",
    schema: {
      type: "object",
      properties: {
        toAmount: { type: "string", description: "Positive decimal amount in the configured Moove destination token" },
        description: { type: "string", description: "Customer-facing payment description" },
        maxUsage: { type: "integer", minimum: 1, description: "Maximum successful uses; omit for unlimited" },
        expirationDate: { type: "string", description: "Future ISO-8601 expiration; omit for no expiry" },
        resourceListingId: { type: "string", description: "Optional AgentPay resource ID" },
        invoiceId: { type: "string", description: "Optional AgentPay invoice ID; invoice links must be single-use" },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 100, description: "Stable unique key for this intended receive request" },
      },
      required: ["toAmount", "idempotencyKey"],
    },
    invoke: async (input: MooveLangChainInput): Promise<MooveToolResult> => {
      const { idempotencyKey, ...request } = input;
      const payment = await client.createMooveReceivePayment({ ...request, agentId }, idempotencyKey);
      const content = payment.providerStatus === "COMPLETED"
        ? `Moove payment completed. Received: ${payment.receivedAmount ?? payment.toAmount}. Transaction: ${payment.transactionUrl ?? "provider-confirmed"}`
        : `Moove payment link ready. Status: ${payment.providerStatus}. Payment URL: ${payment.providerUrl ?? "pending reconciliation"}. AgentPay payment ID: ${payment.id}`;
      return { content, payment };
    },
  };
}
