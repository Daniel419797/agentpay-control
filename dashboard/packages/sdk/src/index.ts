export type AgentPayClientOptions = { baseUrl: string; apiKey: string; fetch?: typeof globalThis.fetch };

export type PaidRequest = { resourceUrl: string; purpose?: string; maxAmountAtomic?: string };

export type PaymentIntent = {
  id: string;
  status: "DENIED" | "APPROVAL_PENDING" | "AUTHORIZED" | "SETTLED" | "SETTLEMENT_FAILED" | "FAILED_BEFORE_SUBMISSION" | string;
  resourceUrl: string;
  merchantHost?: string;
  purpose?: string | null;
  quote?: {
    amountAtomic: string;
    asset: { symbol: string; decimals: number };
    payToAccountId: string;
    fingerprint: string;
    validUntil: string;
  } | null;
  approval?: { id: string; status: string } | null;
  fulfillment?: {
    status: "PENDING" | "FULFILLED" | "FAILED";
    contentType?: string | null;
    contentHash?: string | null;
    contentBytes?: number | null;
    responseBody?: unknown;
    errorCode?: string | null;
  } | null;
  attempts?: Array<{
    settlement?: { transactionId: string; hashscanUrl: string } | null;
  }> | null;
};

export type ResourceListing = {
  id: string;
  slug: string;
  category: "MARKET_DATA" | "FILE" | "AI_INFERENCE" | "WEB_RESEARCH";
  name: string;
  description: string;
  endpoint: string;
  prices: Array<{
    asset: { symbol: string; decimals: number };
    atomicAmount: string;
  }>;
};

export class AgentPayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "AgentPayError";
  }
}

export class AgentPayClient {
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(private readonly options: AgentPayClientOptions) {
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.requestFetch(new URL(path, this.options.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const body = await response.json();
    if (!response.ok) {
      throw new AgentPayError(
        response.status,
        body.code ?? "REQUEST_FAILED",
        body.detail ?? body.message ?? "AgentPay request failed"
      );
    }
    return (body.data ?? body) as T;
  }

  createPaidRequest(
    agentId: string,
    input: PaidRequest,
    idempotencyKey = crypto.randomUUID()
  ) {
    return this.request<PaymentIntent>(
      `/api/v1/agents/${agentId}/paid-requests`,
      {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      }
    );
  }

  getPaymentIntent(intentId: string) {
    return this.request<PaymentIntent>(`/api/v1/payment-intents/${intentId}`);
  }

  async waitForSettlement(
    intentId: string,
    options?: { pollIntervalMs?: number; timeoutMs?: number }
  ) {
    const pollInterval = options?.pollIntervalMs ?? 2000;
    const timeout = options?.timeoutMs ?? 30000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const intent = await this.getPaymentIntent(intentId);
      if (intent.status === "SETTLED") return intent;
      if (["DENIED", "SETTLEMENT_FAILED", "FAILED_BEFORE_SUBMISSION", "REJECTED", "EXPIRED"].includes(intent.status)) return intent;
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    throw new AgentPayError(408, "POLL_TIMEOUT", `Payment intent ${intentId} did not settle within ${timeout}ms`);
  }

  listResources() {
    return this.request<ResourceListing[]>("/api/v1/resources");
  }

  getAgents() {
    return this.request<Array<{ id: string; name: string; status: string; network: string }>>("/api/v1/agents");
  }
}
