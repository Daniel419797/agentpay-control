# Moove Receive

**Updated:** 2026-09-10

AgentPay integrates Moove's production payment-link API as a hosted receive-payment rail. AgentPay remains responsible for organization/agent authorization, durable request identity, resource/invoice binding, reconciliation, audit, and downstream business state. Moove hosts the payer experience and settles according to the configured Moove account.

## Supported API surface

AgentPay maps the current payment-link surface:

```text
POST /v1/payment-link       create
GET  /v1/payment-link       list/reconcile
GET  /v1/payment-link/{id}  retrieve
```

The AgentPay integration intentionally documents and exposes only the provider operations that are implemented and supported by the current API contract.

## Architecture

```text
Agent / application / operator
        |
        v
AgentPay REST / SDK / MCP / LangChain
        |
        +-- tenant + scope checks
        +-- idempotency + durable local state
        +-- resource/invoice validation
        |
        v
Moove payment-link API
        |
        v
hosted payment URL
        |
      payer
        |
        v
Moove account settlement
        |
        v
AgentPay reconciliation
        |
        +-- COMPLETED evidence
        +-- resource completion event
        +-- exact invoice settlement/PAID transition
        +-- audit/outbox evidence
```

## Organization/account binding

A Moove API credential represents an account whose default settlement wallet/token is configured at the provider level. Payment-link creation does not choose an arbitrary AgentPay destination wallet.

AgentPay therefore binds the deployed Moove credential to one organization:

```text
MOOVE_ACCOUNT_ORGANIZATION_ID=<organization UUID>
```

Requests from another organization fail closed. This prevents one tenant from creating links that settle to another tenant's configured Moove account.

## Environment contract

Typical configuration:

```text
MOOVE_RECEIVE_ENABLED=true
MOOVE_API_BASE_URL=https://api.moove.xyz
MOOVE_API_KEY=<server-side API key>
MOOVE_ACCOUNT_ORGANIZATION_ID=<organization UUID>
MOOVE_TIMEOUT_MS=10000
MOOVE_MAX_RECONCILE_PAGES=100
MOOVE_ALLOW_CUSTOM_BASE_URL=false
```

The API key requires the payment-link create/read scopes used by the integration. It must never be exposed through `NEXT_PUBLIC_*`, API responses, logs, SDK/MCP/LangChain client configuration, or committed files.

### Invoice settlement identity

Invoice automation additionally requires the configured expected settlement identity:

```text
MOOVE_SETTLEMENT_NETWORK=<canonical network>
MOOVE_SETTLEMENT_SYMBOL=<asset symbol>
MOOVE_SETTLEMENT_DECIMALS=<asset decimals>
```

These values must match the actual Moove account settlement token. Drift causes invoice settlement to fail closed.

## Persistence

Migration:

```text
dashboard/prisma/migrations/20260907110000_moove_receive/migration.sql
```

`MoovePaymentLink` stores organization/agent ownership, optional resource/invoice binding, idempotency key/request hash, provider IDs/URL/status, requested amount/link controls, provider settlement destination/token evidence, received amount, transaction URL, failure/reconciliation state, and timestamps.

Important database invariants include unique organization/idempotency identity, unique provider link identity, unique recovery marker, constrained status, and ownership foreign keys.

### Prisma schema note

The initial integration creates/accesses this table through the authoritative SQL migration and parameterized Prisma raw SQL. It is not currently a first-class Prisma schema model. If Prisma introspection or schema-diff generation is used later, add/represent the table deliberately before accepting a generated migration. A migration that attempts to drop `MoovePaymentLink` merely because the Prisma schema does not model it is invalid.

## AgentPay API

### Create

```http
POST /api/v1/moove/payment-links
Authorization: Bearer <AgentPay credential/session>
Idempotency-Key: <stable key>
Content-Type: application/json
```

Conceptual body:

```json
{
  "agentId": "<agent UUID>",
  "toAmount": "5.00",
  "description": "Research service",
  "maxUsage": 1,
  "expirationDate": "2026-10-01T12:00:00Z",
  "resourceListingId": "<optional resource UUID>",
  "invoiceId": "<optional invoice UUID>"
}
```

Invoice-bound links must satisfy the stricter invoice validation path and be single-use.

### List

```http
GET /api/v1/moove/payment-links?status=ACTIVE&limit=50&offset=0
```

Returns organization-scoped local records.

### Detail / refresh

```http
GET /api/v1/moove/payment-links/<AgentPay id>?refresh=true
```

`refresh=true` retrieves current provider evidence before returning local state.

### Reconcile

```http
GET  /api/v1/moove/reconcile   # scheduler/cron secret
POST /api/v1/moove/reconcile   # authorized operator or cron secret
```

Background authority is separated from browser session behavior. Reconciliation is bounded and rate limited according to the route/configuration.

## Idempotency and ambiguous create

The create path does not assume provider-side POST idempotency. AgentPay persists its own unique intended request before the irreversible provider call.

```text
local CREATING row + request fingerprint
 -> one provider create POST
      -> success: persist provider id/url/status
      -> uncertain response: SUBMISSION_UNKNOWN
           -> list provider account links
           -> locate exact AP:<local UUID> marker
           -> recover original provider link
```

Only safe reads are retried with bounded backoff. An uncertain write is reconciled rather than duplicated.

## Completion semantics

The following are not payment proof:

- receiving a payment URL;
- provider create returning HTTP success;
- link being `ACTIVE`;
- the payer returning to an AgentPay page.

Completion requires reconciled provider status `COMPLETED`. AgentPay then stores provider destination/token/received-amount/transaction evidence and transitions local state under serialized database control so concurrent refresh/reconciliation cannot emit duplicate completion events.

## Resource binding

A resource-bound payment validates that the resource belongs to the organization before provider creation. Completion emits a durable resource-payment event that downstream resource/workflow logic can consume. Reconciliation itself does not execute arbitrary resource URLs.

## Invoice binding

Before a linked invoice can become `PAID`, AgentPay verifies:

- invoice ownership and payable state;
- agent/issuer relationship where applicable;
- single-use link requirement;
- configured settlement network/symbol/decimals;
- exact requested decimal amount converted with integer-safe arithmetic;
- exact provider-reported received amount;
- provider completion evidence.

An unrelated payment to the same Moove account cannot satisfy the invoice simply because it has a similar description.

## Agent integrations

### TypeScript SDK

```ts
createMooveReceivePayment(input, idempotencyKey)
getMooveReceivePayment(id, { refresh: true })
waitForMooveReceivePayment(id)
```

### MCP

```text
agentpay_create_moove_payment_link
agentpay_get_moove_payment_status
```

### LangChain

`createAgentPayMooveReceiveTool(client, agentId)` creates receive links using an explicit stable idempotency key.

The agent never receives the Moove API key.

## Security controls

- server-only, organization-bound provider credential;
- reviewed production provider origin;
- schema validation for provider payloads;
- decimal strings and integer-safe invoice matching;
- tenant/agent-scoped reads;
- resource/invoice ownership validation before create;
- no blind write retry;
- serialized completion transition;
- constant-time secret handling for scheduler authorization where implemented;
- retained provider evidence without retained provider secret;
- readiness failure when enabled configuration is incomplete.

## Production verification

1. Apply the Moove SQL migration.
2. Configure a dedicated API credential with the minimum payment-link scopes.
3. Bind it to the intended AgentPay organization.
4. Verify the provider account's settlement wallet/token configuration.
5. Configure exact settlement identity before enabling invoice automation.
6. Configure and protect reconciliation scheduling.
7. Verify `/api/v1/ready` reports the intended Moove capability.
8. Create/pay a deliberately low-value single-use link.
9. Confirm one local `COMPLETED` transition with token/amount/transaction evidence.
10. Test an invoice-bound payment separately and verify exact matching.
11. Simulate an uncertain create in staging and confirm recovery without duplicate link creation.
