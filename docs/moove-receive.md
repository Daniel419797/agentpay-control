# Moove Receive

**Updated:** 2026-09-13

AgentPay integrates Moove's production payment-link API as a hosted receive-payment rail. AgentPay remains responsible for tenant authorization, durable request identity, resource/invoice binding, reconciliation, audit, and downstream business state. Moove hosts the payer experience and settles each payment into the Moove account associated with the requesting AgentPay organization.

## Multi-tenant model

Moove is a tenant-scoped integration. Each AgentPay organization can connect its own Moove API credential and settlement configuration.

```text
AgentPay
  |
  +-- Organization A ---- encrypted Moove credential A ---- Moove account A
  |
  +-- Organization B ---- encrypted Moove credential B ---- Moove account B
  |
  +-- Organization C ---- encrypted Moove credential C ---- Moove account C
```

A payment request is always resolved against its own `organizationId` before AgentPay calls Moove. A credential belonging to one organization cannot be selected for another organization.

Customer credentials are encrypted at rest with AgentPay's `KEY_ENCRYPTION_MASTER_KEY`. The plaintext API key is not returned by any integration endpoint, exposed to agents, placed in `NEXT_PUBLIC_*` variables, written to audit metadata, or intentionally logged.

## Supported Moove API surface

AgentPay maps the current payment-link surface:

```text
POST /v1/payment-link       create
GET  /v1/payment-link       list/reconcile
GET  /v1/payment-link/{id}  retrieve
```

The integration intentionally exposes only provider operations implemented by the current Moove API contract. Moove Send/Swap/Bridge/Ramp capabilities are not represented as live AgentPay rails until the corresponding production provider endpoints are published and independently implemented.

## Architecture

```text
Agent / application / operator
        |
        v
AgentPay REST / SDK / MCP / LangChain
        |
        +-- tenant + scope checks
        +-- load organization-scoped Moove credential
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
tenant's Moove account settlement
        |
        v
bounded tenant reconciliation
        |
        +-- COMPLETED evidence
        +-- resource completion event
        +-- exact invoice settlement/PAID transition
        +-- audit/outbox evidence
```

## Organization integration lifecycle

### Connect

```http
POST /api/v1/moove/integration
Authorization: <AgentPay session>
Content-Type: application/json
```

Only an `OWNER` or `PROVIDER_ADMIN` with recent authentication may connect or replace a customer payment credential.

Conceptual body:

```json
{
  "apiKey": "<customer Moove API key>",
  "settlement": {
    "network": "<canonical network>",
    "symbol": "USDC",
    "decimals": 6
  }
}
```

The server validates the credential against the Moove list endpoint before storing it. AgentPay stores the key encrypted and keeps only a SHA-256 fingerprint and a four-character display hint for management/audit purposes.

### Inspect status

```http
GET /api/v1/moove/integration
```

Returns only safe integration metadata such as configured state, key hint, settlement identity, validation time, last use, last reconciliation and the last recorded failure code. The API key itself is never returned.

### Disconnect

```http
DELETE /api/v1/moove/integration
```

Disconnect requires the same elevated role and recent-authentication checks. AgentPay refuses to disconnect while local payment links are still non-terminal, preventing an active payment from becoming unreconcilable because its credential disappeared.

## Environment contract

Only deployment-level controls belong in Vercel environment variables:

```text
MOOVE_RECEIVE_ENABLED=true
MOOVE_API_BASE_URL=https://api.moove.xyz
MOOVE_TIMEOUT_MS=10000
MOOVE_MAX_RECONCILE_PAGES=100
MOOVE_RECONCILE_MAX_TENANTS=20
MOOVE_RECONCILE_CONCURRENCY=3
MOOVE_ALLOW_CUSTOM_BASE_URL=false
```

Customer Moove API keys and customer settlement identities are stored per organization in `MooveIntegration`, not in environment variables.

For one-time migration from the previous single-account deployment model, AgentPay may import the legacy `MOOVE_API_KEY` + `MOOVE_ACCOUNT_ORGANIZATION_ID` pair into the matching organization. Those variables should be removed from production after migration is verified.

## Persistence

The receive-payment lifecycle remains in:

```text
dashboard/prisma/migrations/20260907110000_moove_receive/migration.sql
```

The multi-tenant credential store is added by:

```text
dashboard/prisma/migrations/20260913100000_moove_multitenancy/migration.sql
```

`MoovePaymentLink` stores organization/agent ownership, optional resource/invoice binding, idempotency key/request hash, provider IDs/URL/status, requested amount/link controls, provider settlement destination/token evidence, received amount, transaction URL, failure/reconciliation state, and timestamps.

`MooveIntegration` stores organization ownership, encrypted credential material, credential fingerprint/hint, per-organization settlement identity, lifecycle status, validation/use/reconciliation timestamps, and failure state. The plaintext provider credential is never persisted.

Both tables are intentionally controlled through authoritative SQL migrations and parameterized Prisma raw SQL rather than an automatically generated Prisma model migration. Schema introspection must not generate a migration that drops either table merely because the Prisma schema does not model them.

## AgentPay payment API

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

The integration service resolves the Moove credential from the organization owning the request. Invoice-bound links must satisfy the stricter invoice validation path and be single-use.

### List

```http
GET /api/v1/moove/payment-links?status=ACTIVE&limit=50&offset=0
```

Returns organization-scoped local records.

### Detail / refresh

```http
GET /api/v1/moove/payment-links/<AgentPay id>?refresh=true
```

`refresh=true` retrieves current provider evidence using the organization that owns the local payment record.

### Reconcile

```http
GET  /api/v1/moove/reconcile   # scheduler/cron secret
POST /api/v1/moove/reconcile   # current organization or cron secret
```

A scheduler scans tenant integrations in bounded batches. Each tenant is reconciled using its own decrypted provider credential. Concurrency is intentionally bounded to protect both the provider and PostgreSQL/Supabase capacity.

The scheduler marks provider-authentication failures as tenant integration errors so a broken credential does not generate an endless retry storm. Other transient reconciliation failures preserve the integration and remain eligible for later recovery.

## Idempotency and ambiguous create

The create path does not assume provider-side POST idempotency. AgentPay persists its own unique intended request before the irreversible provider call.

```text
local CREATING row + request fingerprint
 -> one provider create POST using tenant credential
      -> success: persist provider id/url/status
      -> uncertain response: SUBMISSION_UNKNOWN
           -> list that tenant's Moove account links
           -> locate exact AP:<local UUID> marker
           -> recover original provider link
```

Only safe reads are retried with bounded backoff. An uncertain write is reconciled rather than blindly duplicated.

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
- that organization's configured settlement network/symbol/decimals;
- exact requested decimal amount converted with integer-safe arithmetic;
- exact provider-reported received amount;
- provider completion evidence.

A payment belonging to one organization's Moove account cannot satisfy an invoice owned by another organization because both the local invoice and provider credential are tenant-scoped.

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

The agent receives neither the Moove API key nor the credential-management endpoint authority.

## Security controls

- per-organization encrypted provider credential;
- role and recent-authentication checks for credential management;
- provider credential never returned through API responses or agent interfaces;
- SHA-256 credential fingerprint for duplicate-account binding control without storing a plaintext key;
- strict organization ownership checks on payments, agents, resources and invoices;
- reviewed production provider origin and HTTPS enforcement;
- schema validation for provider payloads;
- decimal strings and integer-safe invoice matching;
- no blind write retry;
- durable ambiguous-create recovery;
- serialized completion transition and idempotent downstream event emission;
- bounded multi-tenant reconciliation concurrency;
- constant-time cron-secret handling;
- provider evidence retained without provider secret;
- readiness no longer requires a global customer credential; it reports how many active tenant integrations exist.

## Production verification

1. Apply both Moove migrations.
2. Set the deployment-level Moove controls in Vercel and protect `KEY_ENCRYPTION_MASTER_KEY` and `CRON_SECRET`.
3. Sign in as an organization owner/provider administrator and connect that organization's Moove API key through the integration endpoint/UI.
4. Verify the integration status shows configured without exposing the credential.
5. Verify the provider account's settlement wallet/token configuration.
6. Configure exact settlement identity before enabling invoice automation for that organization.
7. Configure the scheduler to call `/api/v1/moove/reconcile` with the cron secret.
8. Create/pay a deliberately low-value single-use link for the organization.
9. Confirm one local `COMPLETED` transition with token/amount/transaction evidence.
10. Test an invoice-bound payment separately and verify exact matching.
11. Connect a second organization with a different Moove credential and verify isolation: its links reconcile only through its own provider account.
12. Attempt to reuse one Moove credential for a second organization and verify AgentPay rejects the duplicate credential binding.
13. Simulate an uncertain create in staging and confirm recovery without duplicate link creation.
14. After migrating any legacy env credential, remove the legacy `MOOVE_API_KEY` and `MOOVE_ACCOUNT_ORGANIZATION_ID` variables from production.
