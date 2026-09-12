# AgentPay Threat Model

**Updated:** 2026-09-10

## 1. Scope

This threat model covers AgentPay's control plane, autonomous-agent interfaces, payment rails, provider adapters, custody boundaries, persistence, resource fetching, automation, and production operations.

## 2. Protected assets

High-value assets include:

- organization membership, roles, policies, approvals, and emergency controls;
- agent credentials and stable agent identity;
- blockchain payment identities, private keys, signing capability, and custody references;
- provider API keys, webhook secrets, database/session secrets, and encryption material;
- cardholder/card/fiat-account provider state and any provider-authorized card-display flow;
- spend reservations, invoices, payment intents, attempts, settlements, transfer/automation state;
- Moove payment-link state and provider settlement evidence;
- Masumi escrow purchase/result/refund state;
- audit, reconciliation, incident, and notification evidence;
- private resource/customer/organization data.

## 3. Core security invariants

1. Organization-owned data cannot cross tenant boundaries.
2. Agent credentials authorize AgentPay operations, not unrestricted underlying payment secrets.
3. Published policy cannot be bypassed or mutated retroactively.
4. Required approvals must be satisfied before execution.
5. Managed blockchain payment identities are unique per agent and network.
6. Authorized payment context cannot be silently changed after approval.
7. A possible financial side effect is never retried as though nothing happened.
8. Settlement/transfer completion requires validated rail/provider evidence.
9. Required external trust evidence fails closed when invalid or unavailable.
10. Emergency controls can stop new risky side effects without destroying reconciliation evidence.

## 4. Trust boundaries

### Browser / human client

Untrusted input boundary. Session authentication and server-side RBAC are authoritative.

### Autonomous agent / SDK / MCP / LangChain

Untrusted instruction boundary. The client receives only an AgentPay credential scoped to allowed API capabilities.

### Control plane

Authoritative organization/policy orchestration boundary. It performs tenant resolution, authorization, policy evaluation, approvals, reservations, persistence, audit, and provider orchestration.

### PostgreSQL

Durable state and concurrency boundary. Financial uniqueness, idempotency, and transaction consistency rely on database constraints/locks in addition to application checks.

### Facilitators and Cardano signer

Protocol/custody boundaries. They must execute only supported network/payment profiles and validate exact identities/transactions.

### External custody

Holds Mainnet Cardano managed private keys. It is trusted only to resolve/sign the exact per-agent identity requested; AgentPay verifies public identity/address and returned signatures.

### Moove

Hosted receive-payment provider boundary. Its payment status and token/destination evidence are externally supplied and schema/identity validated before local business state advances.

### Stripe / financial providers

Card and fiat execution boundary. Provider identifiers/status and signed webhooks are validated; raw card secrets remain outside normal AgentPay persistence.

### Resource providers

External URLs, x402 challenges, redirects, bodies, and fulfillment payloads are untrusted.

### Pyth / Masumi / KERIA / Blockfrost / Dune

External evidence boundaries with deliberately limited authority.

## 5. Tenant-isolation threats

**Threat:** attacker supplies another organization's object ID or agent ID.

Controls:

- server-side organization resolution;
- role/scope checks on every mutation/read path;
- ownership validation for resource/invoice/payment bindings;
- agent-specific status reads where appropriate;
- no trust in client-provided organization IDs without authorization.

## 6. Agent credential threats

**Threats:** leaked token, over-broad scope, revoked token reuse, secret logging.

Controls:

- hashed/non-recoverable secret storage where implemented;
- one-time plaintext credential presentation;
- scopes, expiry, revocation, and agent binding;
- rate limiting;
- audit of credential lifecycle;
- no underlying blockchain/provider keys in agent context.

## 7. Policy and approval threats

**Threat:** agent bypasses limits or self-approves.

Controls:

- immutable published policy versions;
- server-side decision engine;
- spend reservations before irreversible execution;
- threshold approvals and separation rules;
- approval bound to original payment context;
- emergency-stop check before new risky actions.

## 8. Managed identity collision

**Threat:** two agents share the same managed payer.

Controls:

```text
(network, canonical payment identity) -> one PaymentAccount -> one agent
```

- network-specific canonical normalization;
- database unique constraint;
- transaction-scoped advisory lock;
- per-agent identity provisioning;
- fail-closed migration/provisioning if conflicts exist.

## 9. Payment mutation and replay

**Threats:** amount/payee/network/resource altered after authorization; old payment replayed.

Controls:

- quote/requirement fingerprinting;
- canonical resource binding;
- exact payer/payee/asset/amount checks;
- nonce/UTxO/claim controls where applicable;
- idempotency keys and one-shot mutation claims;
- facilitator independent validation.

## 10. Ambiguous submission

**Threat:** timeout causes duplicate payment/transfer/link creation.

Controls:

- durable pre-submission/submission-started state;
- preserve candidate transaction/provider identifiers and reservations;
- `SUBMISSION_UNKNOWN`/pending classification;
- safe read reconciliation;
- no blind retry of irreversible provider/network mutations.

For Moove create operations, AgentPay uses a durable provider-description marker plus account listing reconciliation because provider-side create idempotency is not assumed.

## 11. Cardano threats

### Transaction injection/complexity

Reject unsupported scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data, unrelated assets/outputs, excessive fees/inputs, or payer/change manipulation.

### Mainnet custody compromise

- no Mainnet managed-agent master key;
- per-agent external Ed25519 identity;
- local Cardano address derivation;
- body-hash-only external signing;
- local signature verification;
- distinct signer/facilitator/custody capability credentials;
- fail closed on outage, key drift, signer-ref drift, or invalid signature.

### Provider ambiguity

Blockfrost transport failure after possible submission remains pending until chain evidence resolves it.

## 12. Moove threats

### Cross-tenant settlement

Moove payment links settle according to the configured Moove account. AgentPay therefore binds the credential to one organization and rejects sibling-tenant use.

### Duplicate link after timeout

Create POST is not blindly retried. A durable marker allows safe recovery through provider listing.

### False invoice completion

Invoice settlement requires exact expected network/symbol/decimals/requested amount/received amount and provider completion evidence.

### Provider payload manipulation

Provider JSON is schema-validated and converted to durable JSON-safe evidence before storage.

## 13. Card and fiat threats

### Raw card disclosure

AgentPay stores provider identifiers and non-secret card metadata; raw PAN/CVC is not part of ordinary persistence/API DTOs. Short-lived provider display authorization remains provider-controlled.

### Forged Stripe webhook

Validate signed timestamp/signature with the configured webhook secret and tolerance before mutating authorization state.

### Duplicate money movement

Use provider idempotency keys and durable local transfer state; distinguish accepted/processing from terminal success.

### Sandbox confusion

Development sandbox data must not be presented as live provider financial evidence.

## 14. Cross-chain threats

Threats include quote expiry, route drift, source/destination swap, amount mutation, duplicate submission, and provider ambiguity.

Controls include persisted quote identity, explicit prepare/submit boundary, policy/readiness checks before submission, durable transfer status, and reconciliation after possible submission.

## 15. Resource / SSRF threats

Threat: an agent points AgentPay at internal/private metadata endpoints or abusive redirects.

Controls include URL validation/canonicalization, private-network restrictions, bounded redirects/timeouts/response sizes, resource registration rules, and requirement/payee verification.

## 16. Pyth threats

Threat: stale, future, negative, or high-uncertainty price weakens policy.

Controls: publish-time/freshness, positive-price, confidence bounds, conservative valuation, and fail-closed required evidence.

## 17. Masumi threats

Registry evidence is checked for expected identity/network/capability/payment facts and freshness. Escrow provider state is separately reconciled; result completion requires exact result-hash evidence. Refund/dispute operations have their own lifecycle and authorization.

## 18. Veridian/KERIA threats

External cryptographic verification is not blindly trusted as policy truth. AgentPay additionally checks configured issuer/schema/subject, freshness, expiry/revocation, and binding to the expected counterparty identity.

## 19. Audit and database threats

Controls include transactional state transitions, tamper-evident/hash-linked audit behavior where implemented, durable outbox events, export redaction, and retention/deletion rules that preserve required financial evidence.

## 20. Supply-chain and CI threats

Controls include pinned/managed dependency versions, production dependency audit, OSV, Semgrep, Gitleaks, CodeQL, signer/service tests, container builds, and exact-commit release evidence.

A scanner exception must be narrow, reviewed, and tied to the exact known advisory/dependency chain; broad suppression is not acceptable.

## 21. Availability and denial of service

Rate limits, external request timeouts, bounded reconciliation, worker/cron controls, and provider-specific retries protect the application from unbounded work. Safe reads may be retried; irreversible writes use stricter semantics.

## 22. Residual risk

External chains/providers can fail, change behavior, or experience compromise. AgentPay limits blast radius through scoped credentials, payment-identity isolation, fail-closed validation, durable evidence, emergency stop, and operational reconciliation. Production operators must still apply provider-side access controls, monitoring, backups, and low-value rollout procedures.

## 23. Security verification

See [`testing-script.md`](testing-script.md), [`production-readiness.md`](production-readiness.md), and [`../SECURITY.md`](../SECURITY.md) for release and incident procedures.
