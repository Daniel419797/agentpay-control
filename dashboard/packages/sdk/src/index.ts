export type AgentPayClientOptions = { baseUrl: string; apiKey: string; fetch?: typeof globalThis.fetch };

export type PaidRequest = { resourceUrl: string; purpose?: string; maxAmountAtomic?: string; network?: string };

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
    settlement?: {
      transactionId: string;
      hashscanUrl: string;
      network?: string;
    } | null;
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
    network?: string;
  }>;
};

export type MooveReceiveRequest = {
  agentId: string;
  toAmount: string;
  description?: string;
  /** Omit for an unlimited-use Moove payment link. */
  maxUsage?: number;
  /** Future ISO-8601 timestamp. Omit for a non-expiring link. */
  expirationDate?: string;
  resourceListingId?: string;
  invoiceId?: string;
};

export type MooveReceivePayment = {
  id: string;
  organizationId: string;
  agentId?: string | null;
  resourceListingId?: string | null;
  invoiceId?: string | null;
  providerLinkId?: string | null;
  providerUrl?: string | null;
  providerStatus: "CREATING" | "ACTIVE" | "COMPLETED" | "INACTIVE" | "SUBMISSION_UNKNOWN" | "FAILED" | string;
  toAmount: string;
  description?: string | null;
  maxUsage?: number | null;
  expirationDate?: string | null;
  destinationAddress?: string | null;
  token?: {
    address: string;
    decimals: number;
    symbol: string;
    name: string;
    chain: { id: string; name: string; symbol: string; chainType?: string };
    isNative?: boolean | null;
    isStablecoin?: boolean | null;
    currencyCode?: string | null;
    isVerified?: boolean | null;
  } | null;
  receivedAmount?: string | null;
  transactionUrl?: string | null;
  failureCode?: string | null;
  lastReconciledAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

  createMooveReceivePayment(
    input: MooveReceiveRequest,
    idempotencyKey = crypto.randomUUID()
  ) {
    return this.request<MooveReceivePayment>("/api/v1/moove/payment-links", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    });
  }

  getMooveReceivePayment(id: string, options?: { refresh?: boolean }) {
    const suffix = options?.refresh ? "?refresh=true" : "";
    return this.request<MooveReceivePayment>(`/api/v1/moove/payment-links/${encodeURIComponent(id)}${suffix}`);
  }

  async waitForMooveReceivePayment(
    id: string,
    options?: { pollIntervalMs?: number; timeoutMs?: number }
  ) {
    const pollInterval = options?.pollIntervalMs ?? 3000;
    const timeout = options?.timeoutMs ?? 120000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const payment = await this.getMooveReceivePayment(id, { refresh: true });
      if (payment.providerStatus === "COMPLETED") return payment;
      if (["FAILED", "INACTIVE"].includes(payment.providerStatus)) return payment;
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    throw new AgentPayError(408, "POLL_TIMEOUT", `Moove receive payment ${id} did not complete within ${timeout}ms`);
  }

  listResources() {
    return this.request<ResourceListing[]>("/api/v1/resources");
  }

  getAgents() {
    return this.request<Array<{ id: string; name: string; status: string; network: string }>>("/api/v1/agents");
  }
}
