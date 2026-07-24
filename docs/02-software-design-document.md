# AgentPay Control

## Software Design Document (SDD)

**Version:** 1.0  
**Date:** 2026-07-21  
**Status:** MVP implementation baseline with production target architecture  

---

## 1. Design intent

AgentPay Control is designed as a multi-tenant control plane for autonomous-agent payments. Its primary safety property is that neither an LLM nor an untrusted resource server can cause a transfer that was not explicitly authorized by current platform, organization, and agent policy.

The MVP is implemented as a modular monolith plus an isolated signer and a replaceable x402 facilitator. This minimizes delivery and operational complexity while maintaining boundaries that can become independently deployed services in production.

This is a clean implementation inspired by the product pattern demonstrated in Cards402. It does not assume access to or reuse of Cards402 source code, data, credentials, branding, or infrastructure.

## 2. Architecture decisions

### ADR-001: Modular monolith for the control plane

**Decision:** Build the dashboard, REST API, policy orchestration, transaction ledger, approval logic, and reconciliation scheduling in one TypeScript application with strict internal modules.

**Reason:** It is faster to implement and test than microservices, avoids distributed consistency failures during the MVP, and remains separable through ports and adapters.

**Production evolution:** Split signer, settlement workers, outbound webhooks, and analytics when scale or security boundaries justify it.

### ADR-002: Next.js and TypeScript

**Decision:** Use a current supported Next.js App Router release, React, and strict TypeScript.

**Reason:** One repository can provide the operational dashboard, authenticated APIs, and server-rendered application shell. TypeScript provides shared contracts without forcing domain code into UI components.

### ADR-003: PostgreSQL as the system of record

**Decision:** Use PostgreSQL with Prisma for application persistence and migrations.

**Reason:** Payment policy and reservations require transactions, constraints, row-level locking, exact numerics, and auditable relational state. PostgreSQL is preferable to eventual-consistency document storage for this domain.

### ADR-004: Native Hedera x402 transfers

**Decision:** Use the Hedera x402 native-transfer integration and a facilitator capable of verifying, co-signing as fee payer, submitting, and confirming transactions.

**Reason:** It directly demonstrates Hedera rails, has predictable fees, and matches the official reference architecture. The buyer signs the debit while the facilitator sponsors the network fee; the facilitator cannot rewrite the signed business transfer.

### ADR-005: Off-chain policy control with on-chain settlement evidence

**Decision:** Policies, approvals, reservations, and business audit events live off-chain; settlement is on Hedera and linked by transaction ID/consensus evidence.

**Reason:** Spend policies need private organization context, fast updates, and rich queries. Putting every rule on-chain would increase complexity and expose business-sensitive rules. Hedera provides the authoritative payment fact.

### ADR-006: Isolated signing boundary

**Decision:** Agent wallet keys are never passed to application clients or LLM context. The control plane sends a canonical, pre-authorized signing command to a signer that permits only supported Hedera transfers.

**MVP:** Encrypted testnet key material may be stored in PostgreSQL, with the wrapping key supplied separately and decryption confined to the signer module/process.

**Production:** Replace database key ciphertext with KMS/HSM key references or external delegated wallets. Mainnet is disabled until this migration and review are complete.

### ADR-007: Settle before fulfilling paid data

**Decision:** The resource server must not return paid content until settlement is confirmed.

**Reason:** A verify-first/fulfill/settle-later design can leak the resource when settlement fails. Latency is acceptable for the MVP and correctness is more important.

### ADR-008: HBAR reference path, USDC-ready asset abstraction

**Decision:** The MVP must work with HBAR and model assets generically. USDC becomes the preferred demo asset only when supported end to end by the pinned Hedera x402 adapter/facilitator version.

**Reason:** The official Hedera references demonstrate native HBAR today, while the bounty permits HBAR or USDC. The product must not claim token support that has not been integration-tested.

### ADR-009: Operator-selectable custody

**Decision:** Each agent chooses one of two payment-authority modes:

- `MANAGED`: AgentPay provisions and isolates a testnet signing key; payments can execute autonomously within policy.
- `SELF_CUSTODY`: The operator connects a Hedera wallet and proves account control. Payments require wallet signing unless the wallet/provider grants a bounded delegated session signer.

**Reason:** Managed custody provides the strongest autonomous demo, while self-custody serves users who will not entrust keys to the platform. The UI and API must state the autonomy tradeoff honestly.

### ADR-010: Authentication follows custody while supporting both methods

**Decision:** Google OAuth is the primary platform sign-in, six-digit email OTP is the passwordless fallback, and magic link is a secondary option. HashPack/WalletConnect is linked after authentication as an optional Hedera payment identity. Wallet ownership never substitutes for the platform session, and connecting a wallet does not authorize a transaction.

**Reason:** Email works for company roles and recovery/notifications; wallet signatures prove ownership without exposing keys. Neither method alone serves all three target customer groups.

### ADR-011: One core API, multiple agent frameworks

**Decision:** REST is authoritative. The TypeScript SDK, `SKILL.md`, MCP server, and LangChain tools are thin, versioned adapters that call the same API and never reimplement policy or signing.

**Reason:** This delivers broad agent compatibility without creating inconsistent financial behavior.

### ADR-012: Common priced-resource provider interface

**Decision:** Market data, file downloads, AI inference, and web research implement one provider interface for catalog metadata, price, availability, and fulfillment.

**Reason:** The user requested all four use cases. One adapter contract prevents four separate payment systems; the deadline demo can prove one live canonical provider while keeping the others reproducible.

## 3. System context

```text
Operator/Approver
      |
      v
Web Dashboard ----> Control Plane API ----> PostgreSQL
                           |                    |
Agent Runtime/SDK/MCP -----+                    +--> Audit/Outbox
                           |
                           +--> Policy Engine
                           +--> Isolated Signer --> encrypted key/KMS reference
                           +--> x402 Client ------> Resource Server
                                                   |
                                                   +--> Hedera Facilitator
                                                          |
                                                          v
                                                    Hedera Network
                                                          |
                                                          v
                                                  Mirror Node/HashScan
```

### Trust zones

1. **Public/untrusted:** browser, agent runtime, arbitrary resource URL, resource response.
2. **Authenticated application:** dashboard/API and domain modules.
3. **Sensitive signing zone:** key unwrap/sign operation; no arbitrary network input.
4. **External payment infrastructure:** facilitator, Hedera nodes, mirror nodes.
5. **Operational data zone:** PostgreSQL, backups, logs, metrics, secret manager.

## 4. Recommended repository structure

```text
agentpay-control/
  apps/
    web/                      # Next.js dashboard and BFF/API routes
    worker/                   # production background worker; MVP may run inline/cron
    resource-server/          # x402 catalog: market data, files, AI inference, research
    mcp-server/               # least-privilege AgentPay MCP tools
    facilitator/              # pinned/self-hosted Hedera facilitator or wrapper
  packages/
    domain/                   # entities, value objects, state machines, errors
    application/              # use cases and ports
    policy-engine/            # deterministic policy evaluation
    signer/                   # signing command schema and implementations
    hedera-adapter/           # SDK/mirror node/HashScan adapters
    x402-adapter/             # protocol parsing and facilitator client
    provider-contracts/       # common priced-resource interfaces/adapters
    agent-integrations/       # TypeScript SDK, LangChain tools, SKILL.md support code
    db/                       # Prisma schema, migrations, repositories
    contracts/                # DTO schemas, OpenAPI, generated client types
    ui/                       # shared design-system components
    observability/            # logging, metrics, tracing utilities
    config/                   # validated runtime configuration
  docs/
  tests/
    integration/
    e2e/
  docker-compose.yml
```

The MVP may begin in a single Next.js repository, but imports must follow these dependency rules:

- UI depends on application DTOs, not database models.
- Application depends on domain and ports.
- Infrastructure implements ports and may depend on SDKs/Prisma.
- Domain does not depend on Next.js, Prisma, Hedera SDK, or x402 packages.
- Signer accepts only canonical signing commands from application services.

## 5. Component design

### 5.1 Web dashboard

Responsibilities:

- Authenticated navigation and organization context.
- Agent, policy, approval, transaction, API key, and settings screens.
- Server-rendered layout with client islands only where interaction requires them.
- Accessible responsive states and safe mutation confirmations.

The dashboard never receives wallet private keys, unredacted API-key hashes, raw signer commands, or raw database records.

### 5.2 API/BFF

Responsibilities:

- Authentication, tenant resolution, authorization, CSRF protection where relevant, request validation, rate limiting, and response mapping.
- Idempotency enforcement on payment and approval mutations.
- Stable `/api/v1` contracts.
- Correlation IDs and audit context.

API handlers must remain thin: validate, authorize, invoke one application use case, and map the result.

### 5.3 Application services

Primary use cases:

- `CreateAgent`
- `ProvisionAgentAccount`
- `IssueAgentApiKey`
- `PublishPolicyVersion`
- `InitiatePaidRequest`
- `EvaluatePaymentQuote`
- `CreateApprovalRequest`
- `DecideApproval`
- `ExecuteAuthorizedPayment`
- `ReconcileSettlement`
- `PauseAgent`
- `ActivateKillSwitch`

Each use case receives an explicit actor/tenant context and returns a typed result. It must not infer organization scope from untrusted resource identifiers.

### 5.4 Policy engine

Input:

```ts
type PolicyEvaluationInput = {
  organizationId: string;
  agentId: string;
  policyVersionId: string;
  now: string;
  network: string;
  asset: { id: string; symbol: string; decimals: number };
  amountAtomic: string;
  merchantHost: string;
  resourceUrl: string;
  settledTodayAtomic: string;
  reservedTodayAtomic: string;
  organizationKillSwitch: boolean;
  agentStatus: string;
};
```

Output:

```ts
type PolicyEvaluationResult = {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  reasonCodes: string[];
  policyVersionId: string;
  evaluatedAt: string;
  reservationAtomic?: string;
};
```

Evaluation order:

1. Platform/network safety.
2. Organization kill switch.
3. Agent status and credential scope.
4. Network/asset support.
5. Challenge freshness and resource binding.
6. Merchant denylist, then allowlist.
7. Sufficient balance.
8. Per-transaction limit.
9. Daily limit including active reservations.
10. Determine allow, approval, or deny.

Policy evaluation must be a pure deterministic function. The application service gathers facts and atomically reserves budget after an `ALLOW` or approved decision.

### 5.5 Spend reservation service

The reservation service prevents races between concurrent purchases.

Algorithm:

1. Start a database transaction at `SERIALIZABLE` isolation or acquire an agent/asset advisory or row lock.
2. Re-read effective policy and agent/organization state.
3. Sum settled/submitted spend and active reservations for the budget window.
4. Re-evaluate policy with current facts.
5. Insert a reservation tied to the payment intent and expiration.
6. Commit.

Serialization failures may be retried a small bounded number of times. A reservation becomes `CONSUMED` when payment is submitted and `RELEASED` only after conclusive pre-submission failure, rejection, cancellation, or expiration.

### 5.6 x402 adapter

Responsibilities:

- Detect and parse `402 Payment Required`.
- Decode and validate `PAYMENT-REQUIRED` according to the pinned x402 version.
- Normalize accepted payment requirements into `PaymentQuote`.
- Select supported Hedera `exact` option.
- Create the payment payload using the isolated signer.
- Add `PAYMENT-SIGNATURE`, retry the request, and parse `PAYMENT-RESPONSE`.
- Enforce HTTPS, host/redirect checks, timeouts, maximum body/header sizes, and an egress allow policy.

The adapter must retain raw protocol objects only in encrypted/restricted diagnostic storage if needed. Normal logs contain fingerprints and safe fields only.

### 5.7 Isolated signer

Signer command:

```ts
type SignHederaExactPaymentCommand = {
  commandId: string;
  organizationId: string;
  agentId: string;
  paymentIntentId: string;
  authorizationId: string;
  network: "hedera:testnet" | "hedera:mainnet";
  payerAccountId: string;
  payeeAccountId: string;
  assetId: string;
  amountAtomic: string;
  validUntil: string;
  paymentFingerprint: string;
};
```

Signer checks:

- Command schema and network allowlist.
- Authorization exists, is current, unused, and fingerprint-matched.
- Agent/account/key reference match.
- Kill switch and agent status are rechecked through a signed/authoritative context.
- Amount is positive and within signer hard caps.
- Destination and asset exactly match the authorization.
- Command ID has not been used.

The output is an opaque, partially signed payment payload plus a non-secret signature fingerprint. The signer must not expose the private key or general-purpose signing primitives.

For `SELF_CUSTODY` accounts, the same canonical command is converted to an external wallet signing request. AgentPay validates the returned signed transaction against the authorization before forwarding it. When a wallet/provider supports a delegated session signer, the grant must be bounded by account, network, asset, amount, destination/resource policy, and expiration. A normal wallet connection alone does not grant unattended autonomy.

### 5.8 Hedera facilitator

Required capabilities:

- Advertise supported scheme/network/asset and fee payer.
- Verify that a partially signed native transfer matches the x402 requirements.
- Co-sign as the Hedera fee payer.
- Submit the transaction to Hedera.
- Wait for authoritative confirmation.
- Return transaction ID, network, payer/payee, amount/asset, and success/failure details.

The facilitator key is a separate ECDSA testnet account funded only for fees. It is stored in server-side secret management and never in the web application or browser. Production should deploy the facilitator separately with strict egress, minimum balance monitoring, rotation, and rate limits.

### 5.9 Resource server

MVP endpoints:

- `GET /health` - free health check.
- `GET /catalog` - free resource metadata across all provider types.
- `GET /v1/market-data/:symbol` - x402-protected deterministic or licensed market data.
- `GET /v1/files/:fileId` - x402-protected file download/short-lived URL.
- `POST /v1/inference/:model` - x402-protected bounded AI inference.
- `POST /v1/research` - x402-protected bounded web-research result.

The paid handler order is:

1. Validate resource request.
2. Construct price requirements.
3. If no payment, return 402.
4. Verify payment.
5. Settle and confirm payment.
6. Fetch/compute the resource.
7. Return 200 with `PAYMENT-RESPONSE`.

If the underlying resource computation can fail, it should be computed or availability-checked before settlement without disclosing it, or the product must define a refund/credit policy. The deterministic MVP resource avoids this issue.

#### Provider contract

```ts
type PricedResourceProvider = {
  describe(input: unknown): Promise<ResourceDescriptor>;
  quote(input: unknown, asset: Asset): Promise<ResourcePrice>;
  checkAvailability(input: unknown): Promise<AvailabilityResult>;
  fulfill(input: unknown, context: SettledPaymentContext): Promise<ResourceResult>;
};
```

Implementations are `MarketDataProvider`, `FileProvider`, `InferenceProvider`, and `ResearchProvider`. Providers do not verify policy or sign payments; they receive settlement context only after x402 verification/settlement.

### 5.9A Agent integration adapters

- **TypeScript SDK:** typed client, automatic idempotency-key helper, async status polling, and explicit approval-required outcome.
- **`SKILL.md`:** operational instructions for agents, including never exposing keys and never using a new idempotency key after an unknown submission.
- **MCP server:** tools `list_resources`, `get_agent_budget`, `request_paid_resource`, and `get_payment_status`; credentials remain in server configuration, not tool arguments.
- **LangChain:** structured tools over the SDK with schema-validated inputs and safe result messages.

Adapters are stateless clients. They cannot access the database, signer, or facilitator directly.

### 5.10 Hedera reader and reconciliation

Responsibilities:

- Query account state and token balances.
- Query transaction evidence by ID or consensus timestamp.
- Normalize SDK/mirror-node responses.
- Generate network-specific HashScan URLs from validated identifiers.
- Resolve `SUBMISSION_UNKNOWN` and delayed confirmations.

Mirror-node data is treated as a read model and may lag. The internal ledger remains pending until authoritative evidence arrives; it must not invent a failed state merely because a transaction is temporarily absent.

### 5.11 Audit/outbox

Business transactions write audit events and outbound notification records to an outbox in the same database transaction. A worker claims outbox rows with `FOR UPDATE SKIP LOCKED`, delivers them, and records attempts. This prevents committed payment/approval changes from losing their audit or notification event.

## 6. Domain model

### 6.1 Core entities

#### Organization

- `id`, `name`, `slug`, `status`, `environmentMode`, `killSwitchEnabled`, timestamps.

#### User and Membership

- User identity and organization-scoped role set.

#### Agent

- Identity, status, environment, default asset, active policy version, timestamps.

#### AgentCredential

- Hashed API credential with scopes, prefix, expiry, usage, and revocation.

#### PaymentAccount

- Hedera network/account identifiers, public key, custody type, key reference/ciphertext for managed accounts, verified wallet connection/delegation metadata for self-custody accounts, status, and sync state.

#### ResourceProvider and ResourceListing

- Provider identity/type, verified settlement account, resource metadata, pricing options, endpoint/adapter configuration, availability, and lifecycle status.

#### Asset

- Network-scoped asset identifier, symbol, decimals, type (`NATIVE` or `TOKEN`), verified status.

#### Policy and PolicyVersion

- Mutable logical policy identity plus immutable published configuration.

#### PaymentIntent

- Business-level attempt to acquire one resource, with idempotency key and immutable request facts.

#### PaymentQuote

- Normalized x402 challenge: resource, merchant, amount, asset, payee, scheme, network, expiration, fingerprint.

#### PolicyDecision

- Immutable decision, reason codes, facts snapshot hash, and policy version.

#### SpendReservation

- Atomic amount reserved against an agent/asset/budget window.

#### ApprovalRequest and ApprovalDecision

- Human authorization lifecycle bound to the exact quote fingerprint.

#### PaymentAttempt

- Technical execution attempt with protocol and settlement states.

#### Settlement

- On-chain outcome and evidence.

#### AuditEvent

- Append-only actor/action/target/result record.

### 6.2 Relational schema outline

```text
organizations 1---* memberships *---1 users
organizations 1---* agents
agents        1---* agent_credentials
agents        1---* payment_accounts
agents        1---* policies 1---* policy_versions
agents        1---* payment_intents
payment_intents 1---1 payment_quotes
payment_intents 1---* policy_decisions
payment_intents 1---* spend_reservations
payment_intents 1---0..1 approval_requests 1---* approval_decisions
payment_intents 1---* payment_attempts 1---0..1 settlements
organizations 1---* audit_events
organizations 1---* outbox_events
```

### 6.3 Important database constraints

- Unique organization slug.
- Unique `(organization_id, agent_id, idempotency_key)` for payment intents.
- Unique API-key hash and unique non-secret prefix where practical.
- One active payment account per `(agent_id, network)`.
- One active/published policy version pointer per agent.
- Unique payment fingerprint for non-terminal intent within organization.
- Unique Hedera transaction ID per network after submission.
- Unique active reservation per payment intent.
- Check constraints for positive atomic amounts and valid expiration.
- Foreign keys never cascade-delete financial/audit history.

### 6.4 Exact money representation

PostgreSQL uses `NUMERIC(78,0)` or bounded `NUMERIC` for atomic amounts. Application code uses `bigint` where supported and serializes amounts as decimal strings. Each amount is paired with immutable asset decimals. UI formatting never feeds back into calculations.

## 7. State machines

### 7.1 Agent

```text
PROVISIONING -> ACTIVE -> PAUSED -> ACTIVE
       |          |         |
       v          v         v
     ERROR      ARCHIVED  ARCHIVED
```

`ARCHIVED` is terminal. `ERROR` may return to `PROVISIONING` after remediation.

### 7.2 Payment intent

```text
CREATED
  -> QUOTED
      -> DENIED (terminal)
      -> APPROVAL_PENDING
          -> REJECTED (terminal)
          -> EXPIRED (terminal)
          -> AUTHORIZED
      -> AUTHORIZED
          -> SIGNING
              -> FAILED_BEFORE_SUBMISSION (terminal/retryable by new attempt)
              -> SUBMITTED
                  -> SETTLED (terminal success)
                  -> SUBMISSION_UNKNOWN
                      -> SETTLED
                      -> SETTLEMENT_FAILED (terminal)
                  -> SETTLEMENT_FAILED (terminal)
          -> CANCELED (before submission only)
```

No transition may move from a terminal state back to an executable state. Technical retries create a new `PaymentAttempt` under the same intent only when safe.

### 7.3 Approval

```text
PENDING -> APPROVED -> CONSUMED
   |          |
   |          +-> EXPIRED (if not consumed before authorization expiry)
   +-> REJECTED
   +-> EXPIRED
   +-> CANCELED
```

### 7.4 Reservation

```text
ACTIVE -> CONSUMED -> SETTLED
   |          +----> RELEASED (only after conclusive settlement failure)
   +-> RELEASED
   +-> EXPIRED (only before signing/submission)
```

## 8. API and contract design

All APIs use JSON over HTTPS, `/api/v1`, ISO 8601 UTC timestamps, UUID/ULID opaque IDs, and `application/problem+json` errors. DTO details are defined in document 03.

### Conventions

- Request IDs: `X-Request-Id` accepted or generated.
- Idempotency: `Idempotency-Key` required for payment initiation and other replay-sensitive creates.
- Pagination: cursor-based with `nextCursor`.
- Filtering: explicit allowlisted query fields.
- Optimistic concurrency: version/ETag for policy edits where needed.
- Money: atomic decimal strings plus asset object.
- Secrets: write-only inputs; never echoed.

### Error envelope

```json
{
  "type": "https://agentpay.example/problems/policy-denied",
  "title": "Payment denied by policy",
  "status": 403,
  "code": "PAYMENT_POLICY_DENIED",
  "detail": "The request exceeds the active per-transaction limit.",
  "requestId": "req_...",
  "errors": [{ "field": "amount", "code": "LIMIT_EXCEEDED" }]
}
```

## 9. Security design

### 9.1 Threat model highlights

| Threat | Control |
|---|---|
| Prompt injection asks agent to reveal/sign arbitrary data | LLM has no key; signer accepts bounded payment command only |
| Resource server changes destination/amount | Normalize and fingerprint challenge; bind policy/approval/signature to exact fields |
| API key theft | Hash at rest, scopes, expiry, rotation, rate limits, last-used telemetry |
| Tenant ID enumeration | Resolve tenant from auth; repository methods require organization scope |
| Concurrent budget bypass | Serialized reservation transaction and active-reservation accounting |
| Replay of signed payload | Unique fingerprint/command, expiration, state transition, facilitator/network replay protection |
| SSRF and redirect pivot | HTTPS, DNS/IP validation, egress policy, redirect revalidation, size/time limits |
| Facilitator key compromise | Low-balance fee-only account, exact payer-signed transfer, rotation and monitoring |
| Database compromise | Encrypted keys, separated wrapping key/KMS, least privilege, audit and backups |
| Insider abuse | RBAC, approval separation, immutable audit, mainnet step-up and maker-checker |

### 9.2 Key management

MVP envelope encryption:

1. Generate an agent ECDSA key in the signer boundary.
2. Encrypt private material with a random data-encryption key using an authenticated cipher.
3. Wrap the data key with a master key provided by a secret manager/runtime secret.
4. Store ciphertext, nonce, algorithm/version, wrapped key, and public identifiers.
5. Zero sensitive buffers where runtime support permits.

Production replaces the decryptable key blob with a non-exportable KMS/HSM key or external signer. Key rotation, recovery, backup, and access auditing must be designed and exercised.

### 9.3 Authentication and authorization

- Dashboard: linked passwordless email and wallet-signature identities with secure, HTTP-only, same-site sessions. Managed custody requires email; self-custody connection requires a nonce-bound wallet proof.
- Agent API: opaque API key in `Authorization: Bearer`, with Argon2id/HMAC-based server verification as selected during implementation.
- Webhooks: HMAC signature with timestamp and replay window.
- Internal signer: private network or process boundary plus short-lived authenticated service identity and command authorization.

### 9.4 Data classification

- **Restricted:** private keys, wrapping keys, session tokens, raw API keys.
- **Confidential:** user email, policy details, internal risk facts, webhook secrets.
- **Internal:** organization/agent metadata, audit metadata, resource request details.
- **Public:** Hedera account IDs, transaction IDs, on-chain amounts, HashScan links, published resource metadata.

## 10. Deployment design

### 10.1 MVP topology

- Web/control plane: Vercel.
- PostgreSQL/auth: Supabase Postgres with backups enabled; email auth may use Supabase Auth or an equivalent provider while wallet identities are linked in the application identity model.
- Resource server: separate Node service or deployable app.
- Facilitator: Docker/container service with separate testnet fee-payer secret.
- Signer: separate process/container preferred; in-process module accepted for testnet demo if the same interface and isolation rules are maintained.
- MCP server and LangChain/SDK packages: deploy separately or publish from the monorepo; all use the control-plane API.
- Scheduled reconciliation: platform cron invoking a protected worker endpoint or dedicated worker.

### 10.2 Production topology

- CDN/WAF -> stateless web/API instances.
- Private application network -> managed PostgreSQL with HA/read replicas as needed.
- Queue -> signer/settlement/reconciliation/webhook workers.
- Isolated signer using KMS/HSM.
- Separately scaled facilitator and resource integrations.
- Central secret manager, observability stack, SIEM, backup vault, and incident tooling.

### 10.3 Environments

- `local`: mocks/local services; no external settlement by default.
- `test`: automated integration; deterministic fake facilitator.
- `testnet`: real Hedera testnet; clearly labeled.
- `staging-mainnet`: production-equivalent configuration with restricted accounts.
- `production`: mainnet enabled only after explicit readiness gate.

Network selection is server-controlled. A client cannot choose mainnet by changing a request field.

## 11. Configuration

Representative environment variables:

```text
APP_ENV
APP_BASE_URL
DATABASE_URL
AUTH_SECRET
KEY_ENCRYPTION_MASTER_KEY or KMS_KEY_ID
HEDERA_NETWORK
HEDERA_MIRROR_NODE_URL
HEDERA_USDC_TOKEN_ID (optional and verified)
FACILITATOR_URL
FACILITATOR_ACCOUNT_ID (facilitator service only)
FACILITATOR_PRIVATE_KEY (facilitator service only, MVP testnet)
X402_NETWORK
X402_PROTOCOL_VERSION
RESOURCE_SERVER_BASE_URL
EMAIL_AUTH_PROVIDER_CONFIG
WALLETCONNECT_PROJECT_ID
LOG_LEVEL
OTEL_EXPORTER_OTLP_ENDPOINT
```

Configuration is schema-validated at startup. Invalid or conflicting network/asset settings fail readiness.

## 12. Observability and operations

### Structured log fields

- `timestamp`, `level`, `service`, `environment`, `requestId`, `traceId`.
- `organizationId`, `agentId`, `paymentIntentId`, `attemptId` where relevant.
- `event`, `result`, `durationMs`, safe error code.
- Never raw key, API key, authorization header, signed payload, or full paid response.

### Metrics

- API RED metrics.
- Policy decisions by outcome/reason.
- Active reservations and oldest reservation age.
- Approval queue count/age/outcome.
- Signer commands and rejection reasons.
- Facilitator verify/settle latency and failures.
- Transactions by state and oldest unknown submission.
- Reconciliation lag and discrepancies.
- Facilitator HBAR fee balance.

### Essential alerts

- Any mainnet request in non-production.
- Unknown submissions older than threshold.
- Reconciliation discrepancy.
- Elevated signer rejection or facilitator failure rate.
- Low facilitator fee balance.
- Kill switch activation.
- Key/credential administration event.

## 13. Testing strategy

### Unit

- Money parsing/formatting and atomic arithmetic.
- Policy decision table and boundary values.
- State-transition guards.
- Fingerprint canonicalization.
- x402 challenge validation and unsupported combinations.
- HashScan URL generation.

### Integration

- PostgreSQL repositories, constraints, tenant isolation, and migrations.
- Concurrent reservation tests.
- API authentication/authorization/idempotency.
- Signer command validation with test keys.
- Facilitator adapter against deterministic fake server.
- Mirror-node normalization fixtures.

### End-to-end

- Create managed agent -> provision -> fund -> policy -> paid request -> settled -> dashboard evidence.
- Connect self-custody wallet -> prove ownership -> request signing -> settle -> dashboard evidence.
- Market-data, file, inference, and research providers satisfy the common provider contract.
- REST, SDK, MCP, and LangChain calls produce identical business outcomes for the same request.
- Over-limit deny with no signer invocation.
- Approval -> approve -> execute once.
- Approval reject/expire.
- Facilitator timeout -> submission unknown -> reconciliation.
- Pause/kill switch before signing.
- Mobile and keyboard core workflows.

### Testnet release test

A controlled script executes the live Hedera testnet path and records transaction IDs. This test is not part of every CI run but is required before the demo/release.

## 14. CI/CD and release controls

Pull requests run formatting, lint, typecheck, unit/integration tests, migration validation, dependency/license scan, secret scan, and production build. Main branch deployment uses immutable artifacts. Database migrations run as a controlled release step. Production requires approval, change record, rollback plan, and post-deploy smoke test.

## 15. Failure and recovery design

- Database unavailable: readiness fails; no payment processing.
- Policy engine error: fail closed; no signing.
- Signer unavailable: keep authorized/reserved request pending; do not downgrade safety.
- Facilitator unavailable before submission: retry safely with same attempt/fingerprint within bounds.
- Timeout after possible submission: mark `SUBMISSION_UNKNOWN`; reconcile before retry.
- Mirror node lag: retain pending state and retry; do not declare failure solely from absence.
- Resource failure after settlement: record `RESOURCE_FULFILLMENT_FAILED`; MVP operator resolves manually, production credits/refunds by policy.
- Outbox delivery failure: retry independently without rolling back completed business action.

## 16. Production readiness backlog

Before mainnet:

1. Replace testnet key storage with KMS/HSM or reviewed delegated signing.
2. Complete legal and custody model review.
3. Add full RBAC, step-up authentication, security notifications, and maker-checker controls.
4. Deploy durable queue/workers and continuous reconciliation.
5. Implement backup restoration and disaster-recovery exercises.
6. Conduct threat modeling, penetration testing, dependency/SBOM review, and key compromise drill.
7. Add data retention/export/deletion and support tooling.
8. Define SLOs, alerts, runbooks, on-call rotations, and capacity limits.
9. Run load, concurrency, failover, and chaos tests.
10. Execute staged mainnet rollout with low hard caps and a global kill switch.

## 17. Sources and compatibility notes

The design follows the standard x402 challenge/payment/verification/settlement sequence and Hedera's official bounty references. Exact package names, network identifiers, payload fields, and asset support must be verified and pinned during implementation because the ecosystem is evolving. No DTO in this design should be treated as a substitute for the versioned upstream x402 schema.

- https://github.com/x402-foundation/x402
- https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use
- https://github.com/matevszm/x402-hedera-example
- https://docs.hedera.com/
