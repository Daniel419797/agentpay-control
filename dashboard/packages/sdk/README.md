# @agentpay/sdk

TypeScript client for AgentPay's agent-facing API.

The SDK is intentionally thin: it authenticates requests, preserves idempotency, normalizes response types, and provides polling helpers. Policy, approvals, payment identity, custody, provider credentials, settlement validation, and reconciliation remain server-side in AgentPay.

## Client

```ts
import { AgentPayClient } from "./src/index";

const agentpay = new AgentPayClient({
  baseUrl: process.env.AGENTPAY_BASE_URL!,
  apiKey: process.env.AGENTPAY_API_KEY!,
});
```

Never embed an AgentPay credential in public browser code unless the credential is explicitly designed for that environment. Agent credentials should normally stay in the application/agent runtime that needs them.

## Paid resources

```ts
const intent = await agentpay.createPaidRequest(
  agentId,
  {
    resourceUrl: "https://provider.example/resource",
    purpose: "Acquire licensed data for task",
    maxAmountAtomic: "5000000",
  },
  "stable-idempotency-key"
);
```

Use `waitForSettlement(intent.id)` when the application should poll AgentPay until the intent reaches a recognized terminal state.

Important states include:

- `DENIED` — policy refused the action;
- `APPROVAL_PENDING` — human approval is required;
- `AUTHORIZED` — authorized but not necessarily settled;
- `SETTLED` — AgentPay has accepted the rail-specific settlement evidence;
- `FAILED_BEFORE_SUBMISSION` — no financial side effect was submitted;
- `SETTLEMENT_FAILED` — terminal settlement failure according to the rail;
- pending/ambiguous states — do not create a replacement payment simply because a response is uncertain.

## Moove Receive

```ts
const payment = await agentpay.createMooveReceivePayment(
  {
    agentId,
    toAmount: "10.00",
    description: "Invoice payment",
    maxUsage: 1,
    invoiceId,
  },
  "stable-receive-key"
);
```

Available methods:

```ts
createMooveReceivePayment(input, idempotencyKey?)
getMooveReceivePayment(id, { refresh? })
waitForMooveReceivePayment(id, options?)
```

`providerUrl` is a checkout URL, not payment evidence. Treat the receive payment as complete only when AgentPay returns `providerStatus === "COMPLETED"` after provider reconciliation.

## Discovery

```ts
await agentpay.listResources();
await agentpay.getAgents();
```

## Errors

SDK failures are represented by `AgentPayError` with HTTP status, stable error code where available, and message. Do not use automatic retry for every error. Reuse the same idempotency key only when retrying the same intended financial action.

## Security

The SDK never needs a blockchain private key, Moove API key, Stripe restricted key, Cardano custody credential, or other underlying provider secret. Those capabilities stay behind AgentPay's server-side boundaries.

See [`../../../docs/03-screens-and-dto-specification.md`](../../../docs/03-screens-and-dto-specification.md) and [`../../../docs/04-detailed-workflows.md`](../../../docs/04-detailed-workflows.md).
