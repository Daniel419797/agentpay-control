# AgentPay Application and API Reference

**Status:** implementation-facing UI and API contract  
**Updated:** 2026-09-10

This document describes the major application surfaces and API contract conventions. Route implementation remains authoritative for exact validation fields and response details.

## 1. Product UI

The authenticated application exposes operational workspaces for:

- Overview and organization status;
- Agents, credentials, integrations, payment accounts, and policy;
- Approvals and payment execution;
- Transactions and audit;
- Resources, providers, marketplace, and paid-resource flows;
- Invoices;
- Virtual cards/card operations;
- Cross-chain operations;
- Automation rules/executions;
- Financial intelligence;
- Cardano analytics;
- Organization settings, workspaces, members, retention/export/deletion, and emergency controls.

Provider-dependent pages must represent readiness/configuration honestly. A visible page or stored provider model does not mean that a production provider account is enabled.

## 2. API conventions

Authenticated API routes live under `/api/v1`.

Common conventions:

- session or Bearer authentication depending on route/client type;
- organization scoping resolved server-side;
- scoped agent credentials for agent-facing actions;
- `Idempotency-Key` on financial create/execute operations where required;
- structured JSON responses and stable error codes;
- atomic amounts represented as strings where integer precision matters;
- ISO-8601 timestamps;
- no private keys, restricted provider keys, session secrets, or raw card credentials in normal response DTOs.

## 3. Major API groups

### Agents and credentials

Representative routes:

```text
GET/POST /api/v1/agents
GET      /api/v1/agents/{agentId}/status
GET      /api/v1/agents/{agentId}/connection
GET/POST /api/v1/agents/{agentId}/credentials
DELETE   /api/v1/agents/{agentId}/credentials/{credentialId}
GET      /api/v1/agents/{agentId}/integrations
POST     /api/v1/agents/{agentId}/paid-requests
POST     /api/v1/agents/{agentId}/mcp
```

An agent's credential authorizes AgentPay operations according to scope; it is not the underlying payment private key.

### Policy

```text
GET  /api/v1/agents/{agentId}/policies/current
POST /api/v1/agents/{agentId}/policies/preview
POST /api/v1/agents/{agentId}/policies/publish
GET  /api/v1/policy-versions/{policyVersionId}/...
GET/POST /api/v1/contract-allowlist
```

Published policy versions are immutable.

### Approvals

```text
GET /api/v1/approvals
GET /api/v1/approvals/{approvalId}
POST /api/v1/approvals/{approvalId}/decision
```

Approval DTOs carry decision context without exposing signing secrets.

### Payment intents and transactions

```text
GET  /api/v1/payment-intents/{intentId}
POST /api/v1/payment-intents/{intentId}/cancel
POST /api/v1/payment-intents/{intentId}/self-custody
GET  /api/v1/transactions
GET  /api/v1/transactions/{transactionId}
```

Intent state and settlement state are separate. An ambiguous submission must not be rendered as a simple failed-before-submission result.

### Resources, providers, and marketplace

```text
GET/POST /api/v1/providers
POST     /api/v1/providers/{providerId}/verify
GET/POST /api/v1/providers/{providerId}/resources
GET/POST /api/v1/resources
GET      /api/v1/resources/{resourceId}
PUT/POST /api/v1/resources/{resourceId}/masumi-binding
PUT/POST /api/v1/resources/{resourceId}/veridian-binding
GET      /api/v1/marketplace/resources
GET      /api/v1/marketplace/resources/{resourceId}
GET/POST /api/v1/marketplace/resources/{resourceId}/reviews
```

Exact HTTP verbs should be checked against the route implementation when integrating directly; the group above documents the supported route surfaces.

### Invoices

```text
GET/POST /api/v1/invoices
GET      /api/v1/invoices/{invoiceId}
POST     /api/v1/invoices/{invoiceId}/send
POST     /api/v1/invoices/{invoiceId}/collect
POST     /api/v1/invoices/{invoiceId}/pay
POST     /api/v1/invoices/{invoiceId}/void
```

Invoices maintain separate item, event, settlement, and lifecycle state.

### Moove Receive

```text
POST /api/v1/moove/payment-links
GET  /api/v1/moove/payment-links
GET  /api/v1/moove/payment-links/{id}
POST /api/v1/moove/reconcile
```

Create requests use a durable idempotency key. `GET .../{id}?refresh=true` requests provider reconciliation before returning current local state.

Conceptual create input:

```ts
type MooveReceiveRequest = {
  agentId: string;
  toAmount: string;
  description?: string;
  maxUsage?: number;
  expirationDate?: string;
  resourceListingId?: string;
  invoiceId?: string;
};
```

Important response fields include AgentPay ID, provider link ID/URL, provider status, amount, resource/invoice binding, destination address, token/chain evidence, received amount, transaction URL, failure/reconciliation state, and timestamps.

Only `COMPLETED` backed by reconciled provider evidence is completion.

### Cards and cardholders

```text
GET/POST /api/v1/cardholders
GET/POST /api/v1/cards
POST     /api/v1/cards/{cardId}/status
POST     /api/v1/cards/{cardId}/display-key
GET      /api/v1/card-authorizations
POST     /api/v1/webhooks/stripe
```

The provider path may be Stripe or Sandbox depending on environment. Raw PAN/CVC must not be returned by AgentPay's ordinary card APIs.

### Fiat

```text
GET/POST /api/v1/fiat-accounts
GET/POST /api/v1/fiat-transfers
```

Provider-backed account/transfer availability depends on configuration and provider eligibility.

### Cross-chain

```text
GET  /api/v1/cross-chain/networks
POST /api/v1/cross-chain/quotes
POST /api/v1/cross-chain/quotes/{quoteId}/prepare
GET  /api/v1/cross-chain/transfers
POST /api/v1/cross-chain/transfers/{transferId}/submit
```

Quote, preparation, and submission state are deliberately separate.

### Automation

```text
GET/POST /api/v1/automations
POST     /api/v1/automations/{ruleId}/execute
GET      /api/v1/automations/{ruleId}/status
POST     /api/v1/automations/{ruleId}/webhook
GET      /api/v1/automations/executions
POST     /api/v1/automations/executions/{executionId}/decision
```

Automation does not bypass financial policy or emergency controls.

### Financial intelligence

```text
GET /api/v1/intelligence/summary
GET /api/v1/intelligence/anomalies
GET /api/v1/intelligence/anomalies/{anomalyId}
GET /api/v1/intelligence/forecasts
GET /api/v1/intelligence/recommendations
GET /api/v1/intelligence/recommendations/{recommendationId}
```

These outputs are advisory rather than payment authorization.

### Organization operations

```text
GET  /api/v1/organization
POST /api/v1/organization/kill-switch
GET/POST /api/v1/organization/retention
POST /api/v1/organization/export
GET  /api/v1/organization/export-stream
POST /api/v1/organization/export-complete
POST /api/v1/organization/deletion
GET  /api/v1/organization/release-evidence
GET  /api/v1/audit-events
GET  /api/v1/audit-events/export
GET/POST /api/v1/notification-endpoints
GET/POST /api/v1/support-cases
GET      /api/v1/usage
```

## 4. Payment intent DTO

The TypeScript SDK exposes a normalized intent view similar to:

```ts
type PaymentIntent = {
  id: string;
  status: string;
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
  } | null;
};
```

Important terminal/nonterminal states include `DENIED`, `APPROVAL_PENDING`, `AUTHORIZED`, `SETTLED`, `SETTLEMENT_FAILED`, `FAILED_BEFORE_SUBMISSION`, and rail-specific pending/ambiguous states.

## 5. Payment account view

A normal payment-account response contains non-secret identity/configuration information only:

```ts
type PaymentAccountView = {
  id: string;
  agentId: string;
  network: string;
  accountId: string;
  custodyType: string;
  signingMode: string;
  status: string;
};
```

Managed payment identities are canonicalized and unique per network.

## 6. Managed identity view

```ts
type ManagedAgentIdentity = {
  accountId: string;
  publicKey?: string;
  signerRef: string;
};
```

Network-specific identifiers include Hedera `0.0.x`, EVM `0x...`, Cardano Preprod `addr_test1...`, and Cardano Mainnet `addr1...`.

## 7. x402 requirement shape

The direct client expects supported x402 V2 `exact` requirements conceptually shaped as:

```ts
type PaymentRequirement = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};
```

The requirement must match the exact resource/network/asset/amount/payee selected by AgentPay.

## 8. TypeScript SDK

Current client methods include:

```ts
createPaidRequest(agentId, input, idempotencyKey?)
getPaymentIntent(intentId)
waitForSettlement(intentId, options?)
createMooveReceivePayment(input, idempotencyKey?)
getMooveReceivePayment(id, { refresh? })
waitForMooveReceivePayment(id, options?)
listResources()
getAgents()
```

See [`../dashboard/packages/sdk/README.md`](../dashboard/packages/sdk/README.md).

## 9. MCP tools

The hosted/local MCP integration exposes AgentPay operations including connection/resource/payment tools and Moove Receive tools. The current Moove tools include:

```text
agentpay_create_moove_payment_link
agentpay_get_moove_payment_status
```

See [`../dashboard/packages/mcp/README.md`](../dashboard/packages/mcp/README.md).

## 10. LangChain tools

Current LangChain-compatible helpers include:

- `agentpay_purchase_resource`;
- `agentpay_create_moove_payment_link`.

The wrappers return structured AgentPay intent/payment state and never perform independent payment authorization.

## 11. UI security rules

- never render private keys, provider restricted keys, managed master keys, or custody credentials;
- only reveal short-lived provider-authorized card display material through the dedicated provider flow;
- clearly distinguish policy denial, approval pending, pre-submission failure, ambiguous submission, and confirmed settlement;
- destructive organization actions require authenticated authorization;
- provider/readiness state must not be hidden behind optimistic UI;
- external URLs and provider payloads are untrusted data.

## 12. Readiness and health

`/api/v1/health` establishes process health. `/api/v1/ready` evaluates deployment capability/configuration. Integrations should use readiness rather than assuming source support means a rail is operational.
