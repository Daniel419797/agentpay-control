# Moove Receive integration

AgentPay integrates the currently live Moove Agentic Payments API as a receive-side commerce rail. AgentPay remains the policy, identity, audit and reconciliation control plane; Moove creates cross-chain/cross-token payment links that settle to the Moove account's configured default wallet and token.

## Supported Moove surface

Implemented against the public Moove API at `https://api.moove.xyz`:

- `POST /v1/payment-link` — create a payment link (`payment_link:create`)
- `GET /v1/payment-link` — list account payment links (`payment_link:read`)
- `GET /v1/payment-link/{id}` — retrieve a public payment link

Moove Send, Swap, Bridge and Ramp agent APIs are not represented as available AgentPay rails until Moove publishes live production endpoints for them. Do not add mock provider success paths for unreleased APIs.

## Architecture

```text
Agent / Operator
      |
      v
AgentPay API / SDK / MCP / LangChain
      |
      +-- tenant binding / auth / rate limit
      +-- idempotency / durable local record
      +-- invoice + resource bindings
      |
      v
Moove Receive API
      |
      v
Moove payment link
      |
 customer pays using supported source chain/token
      |
      v
Moove default settlement wallet/token
      |
      v
AgentPay reconciliation
      |
      +-- COMPLETED event
      +-- resource-payment event
      +-- invoice PAID transition when exact settlement identity matches
      +-- audit evidence
```

## Critical tenancy rule

A Moove API key belongs to one Moove account. Payment-link creation does not accept an arbitrary destination wallet; funds route to the default settlement wallet/token configured on that Moove account.

AgentPay therefore binds one deployed Moove credential to exactly one AgentPay organization through:

```bash
MOOVE_ACCOUNT_ORGANIZATION_ID=<agentpay-organization-uuid>
```

Any other workspace fails with `MOOVE_ORGANIZATION_NOT_CONFIGURED`. Do not remove this check unless credentials become tenant-specific and are stored with equivalent isolation.

## Environment

```bash
MOOVE_RECEIVE_ENABLED=true
MOOVE_API_BASE_URL=https://api.moove.xyz
MOOVE_API_KEY=<secret Moove API key>
MOOVE_ACCOUNT_ORGANIZATION_ID=<AgentPay organization UUID>
MOOVE_TIMEOUT_MS=10000
MOOVE_MAX_RECONCILE_PAGES=100
MOOVE_ALLOW_CUSTOM_BASE_URL=false
```

Create the Moove API key with both live payment-link scopes:

```text
payment_link:create
payment_link:read
```

The API key is server-side only. It must never be returned by AgentPay APIs, exposed through `NEXT_PUBLIC_*`, sent to an MCP/LangChain client, committed, or logged.

### Settlement identity for invoice automation

Generic payment links do not require AgentPay to know the destination token in advance. Automatic AgentPay invoice settlement does, because an invoice must not be marked paid merely because an unrelated token or amount reached the Moove account.

Set all three values when using `invoiceId` bindings:

```bash
MOOVE_SETTLEMENT_NETWORK=eip155:8453
MOOVE_SETTLEMENT_SYMBOL=USDC
MOOVE_SETTLEMENT_DECIMALS=6
```

These values must describe the actual default settlement token configured in the Moove account. AgentPay verifies the token returned by Moove during reconciliation and fails closed on drift with `MOOVE_SETTLEMENT_TOKEN_MISMATCH`.

Invoice-bound links additionally require:

- the invoice was issued by the configured AgentPay organization
- the agent, when present, is the invoice issuer agent
- invoice status is payable
- `maxUsage=1`
- invoice asset network/symbol/decimals equals the configured Moove settlement identity
- requested decimal amount exactly equals the invoice atomic total
- completed Moove `receivedAmount` exactly equals the invoice atomic total

Only then does AgentPay transition the invoice to `PAID` and emit `INVOICE_PAID_VIA_MOOVE` / `AGENT_INVOICE_PAID` evidence.

## Database

Migration:

```text
dashboard/prisma/migrations/20260907110000_moove_receive/migration.sql
```

The `MoovePaymentLink` table stores:

- owning organization / optional agent
- optional resource and invoice bindings
- AgentPay idempotency key + canonical request hash
- Moove provider link ID and URL
- provider status
- requested amount and link controls
- settlement destination/token evidence
- received amount and transaction URL
- reconciliation timestamps and failure code

Important invariants are enforced in PostgreSQL:

- one idempotency key per organization
- one local record per Moove provider link
- one unique AgentPay recovery marker per provider description
- constrained local provider states
- foreign keys for organization/agent/resource/invoice bindings

The initial integration accesses this table through parameterized Prisma raw SQL so the migration is authoritative. If the project later introspects/regenerates the Prisma schema, add the table as a first-class Prisma model before generating schema-diff migrations; never accept a generated migration that drops `MoovePaymentLink` as an "unknown" table.

## AgentPay API

### Create

```http
POST /api/v1/moove/payment-links
Authorization: Bearer <AgentPay credential or operator session>
Idempotency-Key: <stable 8-100 character key>
Content-Type: application/json
```

Example:

```json
{
  "agentId": "00000000-0000-4000-8000-000000000000",
  "toAmount": "5.00",
  "description": "Research job 3821",
  "maxUsage": 1,
  "expirationDate": "2026-09-08T12:00:00Z",
  "resourceListingId": "00000000-0000-4000-8000-000000000001"
}
```

Omit `maxUsage` for Moove's unlimited-use behavior. Omit `expirationDate` for a non-expiring link. Invoice-bound links are intentionally stricter and must be single-use.

Agent credentials require `payments:create`. Operators require `OWNER` or `OPERATOR`.

### List local receive records

```http
GET /api/v1/moove/payment-links?status=ACTIVE&limit=50&offset=0
```

This is workspace-scoped local state. It does not leak sibling tenants or the Moove API key.

### Read / refresh a receive record

```http
GET /api/v1/moove/payment-links/<internal-agentpay-id>?refresh=true
```

Workspace users can read their organization. An AgentPay agent can read only a record bound to that exact agent and needs `payments:read`.

`refresh=true` reads the provider's public payment-link detail and applies the latest provider evidence under a serialized database transition.

### Reconcile

Scheduled endpoint:

```http
GET /api/v1/moove/reconcile
Authorization: Bearer <CRON_SECRET>
```

Manual operator endpoint:

```http
POST /api/v1/moove/reconcile
```

`GET` is intentionally cron-secret-only so a browser navigation cannot trigger a state-mutating reconciliation through an operator cookie. `POST` allows an authenticated `OWNER`/`OPERATOR`, rate limited to 10/minute, or the cron secret.

For Vercel Cron, configure this path at an interval allowed by the deployment plan. For an external scheduler, send the same bearer secret. A 1–5 minute interval is appropriate for normal receive-payment UX when the hosting plan supports it; callers may also use detail `refresh=true` for interactive polling.

## Idempotency and ambiguous POSTs

Moove's create endpoint does not expose an idempotency-key parameter. AgentPay therefore must not blindly retry a POST after a timeout, 429/5xx response or network ambiguity.

The safe flow is:

```text
AgentPay INSERT CREATING row + unique idempotency key
            |
            v
single Moove POST
   | success               | ambiguous
   v                       v
store provider ID       SUBMISSION_UNKNOWN
   |                       |
   v                       v
public detail       list Moove account links
                           |
                 exact AP:<local UUID> marker
                           |
                           v
                    recover provider ID
```

Every provider description begins with a unique `AP:<local UUID>` marker. Account-wide list reconciliation can recover a link created by a request whose response was lost without creating a duplicate.

AgentPay only retries safe reads. It applies bounded backoff to network failures, HTTP 429 and HTTP 5xx responses.

## Completion semantics

Do not treat a returned payment URL, an `ACTIVE` provider state, or an HTTP-successful create request as payment.

Payment is complete only after Moove reports:

```text
status = completed
```

AgentPay then persists provider evidence and creates completion events in the same serialized database transaction that changes local status to `COMPLETED`. This prevents concurrent polling/reconciliation from emitting duplicate business-completion events.

Events:

```text
MOOVE_PAYMENT_COMPLETED
MOOVE_RESOURCE_PAYMENT_COMPLETED   (when resourceListingId is bound)
AGENT_INVOICE_PAID                 (only after strict invoice verification)
```

The resource event is the safe automation boundary for a worker to execute/deliver a paid service. Do not automatically invoke arbitrary resource URLs from the reconciliation transaction; job input, retry semantics and fulfillment security belong to the resource/workflow layer, not the payment-provider callback.

## Agent integrations

### SDK

`AgentPayClient` exposes:

```ts
createMooveReceivePayment(input, idempotencyKey)
getMooveReceivePayment(id, { refresh: true })
waitForMooveReceivePayment(id)
```

### MCP

The AgentPay MCP endpoint exposes:

```text
agentpay_create_moove_payment_link
agentpay_get_moove_payment_status
```

Create requires `payments:create`; status requires `payments:read`. The agent never receives the Moove API key.

### LangChain

`createAgentPayMooveReceiveTool(client, agentId)` exposes payment-link creation with an explicit stable idempotency key.

## Security controls

- Moove credential is server-only and organization-bound.
- Production provider URL is pinned to `api.moove.xyz` unless an explicit reviewed custom-host override is set.
- Provider JSON is schema-validated with Zod before use.
- Decimal money values remain decimal strings; JavaScript floating-point arithmetic is not used for invoice matching.
- Invoice conversions use exact `BigInt` atomic arithmetic.
- Local reads are tenant-scoped; agent status reads are additionally agent-scoped.
- Resource/invoice IDs are checked against the owning organization before provider creation.
- POST creation is locally idempotent and not blindly retried.
- Completion transitions use a PostgreSQL advisory lock + serializable transaction.
- Scheduled reconciliation uses constant-time secret comparison.
- Provider evidence is retained for audit and reconciliation without storing the Moove API key.
- Readiness fails when Moove is enabled with invalid integration configuration.

## Operational verification

Before enabling in production:

1. Apply all Prisma migrations, including `20260907110000_moove_receive`.
2. Create a dedicated Moove API key with only `payment_link:create` and `payment_link:read`.
3. Set `MOOVE_ACCOUNT_ORGANIZATION_ID` to the intended AgentPay tenant.
4. Confirm the Moove account has its handle/default settlement wallet configured.
5. If invoice automation is used, set and independently verify the settlement network/symbol/decimals.
6. Set `CRON_SECRET` to at least 32 random characters and schedule reconciliation.
7. Call `/api/v1/ready`; Moove must report `configured` when enabled.
8. Create a low-value single-use test link through AgentPay.
9. Pay it through the Moove-hosted URL.
10. Verify AgentPay reaches `COMPLETED`, stores received/token/transaction evidence, and emits exactly one completion event.
11. Repeat using an invoice only after the generic flow succeeds; verify exact asset/amount checks and the invoice `PAID` transition.
12. Exercise a forced provider timeout in staging and verify the record remains `SUBMISSION_UNKNOWN` and is recovered rather than duplicated.

## Current provider limitation

Moove Receive is a receive-side rail. The live API key cannot be used by AgentPay to redirect/withdraw the account's funds or to perform autonomous sends. AgentPay's existing x402/Masumi/Cardano/Hedera/Arc outgoing rails remain separate. Add future Moove Send/Swap/Ramp rails only after the corresponding public production API contracts exist and receive their own threat-model, custody, policy, idempotency and reconciliation review.
