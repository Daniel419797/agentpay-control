# AgentPay Software Requirements

**Status:** implementation-aligned product and engineering requirements  
**Updated:** 2026-09-10

## 1. Purpose

AgentPay is a policy-controlled financial operating system for autonomous software agents. It enables agents and applications to request payments, purchase paid resources, receive payments, use configured financial-provider capabilities, and participate in controlled commerce without receiving unrestricted treasury or provider authority.

The system is responsible for establishing who may act, which agent is acting, what financial policy applies, whether human approval is required, how an operation is executed, and what evidence is required before the operation is considered complete.

## 2. Primary actors

- **Organization owner:** controls organization-level settings, members, emergency controls, and high-impact configuration.
- **Operator:** manages agents, resources, operational workflows, and permitted payment actions.
- **Approver:** makes approval decisions according to role and threshold requirements.
- **Viewer:** receives authorized read access without financial mutation authority.
- **Autonomous agent:** calls AgentPay using a scoped agent credential.
- **Application client:** integrates through REST, SDK, MCP, LangChain, or other approved adapters.
- **Payer/customer:** pays an invoice, resource, or hosted Moove payment link.
- **External provider/network:** executes or reports financial/network state under a constrained integration contract.

## 3. System boundary

The implemented system contains:

- Next.js/TypeScript control plane and dashboard;
- PostgreSQL system of record accessed through Prisma and explicit SQL where required;
- network facilitators for Hedera, Arc, and Cardano profiles;
- isolated Cardano signing service;
- x402 resource server;
- Moove Receive payment-link integration;
- Masumi registry and escrow integrations;
- Stripe-backed card/fiat adapter and sandbox adapter;
- Pyth, Veridian/KERIA, Blockfrost, Dune, and other configured external dependencies;
- SDK, MCP, LangChain, and agent-skill integration layers;
- CI, security, release, backup, and operational tooling.

## 4. Organization, identity, and access requirements

1. Every organization-scoped record must be protected from cross-tenant read or mutation.
2. Human access must be authenticated and authorized server-side.
3. Role checks must not rely on hidden UI controls alone.
4. Agents must have stable immutable identifiers.
5. Agent credentials must be scoped, revocable, expirable, and stored as non-recoverable secret representations after initial issuance.
6. Sensitive administrative and financial actions must emit audit evidence.
7. Organization workspaces and membership lifecycle must preserve tenant boundaries.
8. Emergency-stop state must be enforceable independently of agent intent.

## 5. Managed payment-identity requirements

For blockchain managed accounts, the system must enforce:

```text
(network, canonical payment identity) -> one PaymentAccount -> one agent
```

- A managed identity must never be silently shared between agents or organizations.
- Concurrent attempts to claim the same canonical identity must fail closed.
- Historical transaction evidence must retain the identity that actually performed the operation.
- Network-specific address/account normalization must happen before uniqueness decisions.

Current managed-capable profiles include Hedera Testnet, Arc Testnet, Cardano Preprod, and Cardano Mainnet external per-agent custody. Self-custody profiles remain separate from managed custody.

## 6. Policy requirements

Published policy versions must be immutable. A policy change is performed by publishing a complete successor version rather than mutating a version that previously authorized financial activity.

A policy may constrain:

- per-transaction, hourly, daily, and monthly spend;
- asset and network;
- merchant/resource allow and deny rules;
- resource categories and contract allowlists;
- schedule/activation/expiration windows;
- velocity and cooldown;
- `DENY` versus `REQUIRE_APPROVAL` behavior;
- approval and rejection thresholds;
- conservative USD-valued ceilings using Pyth where configured;
- Masumi counterparty, capability, online/freshness, observed-history, and reputation requirements;
- optional Veridian/KERI issuer, schema, subject, freshness, revocation, and identity-binding requirements.

External trust or pricing evidence that is required by policy must fail closed when missing, invalid, stale, or mismatched.

## 7. Approval requirements

- A policy decision requiring approval must leave the underlying payment non-signable until the threshold is satisfied.
- Approval context must identify agent, amount, asset/network, purpose/resource, policy reason, and expiry where applicable.
- Separation-of-duties rules must prevent prohibited self-approval.
- Approval decisions must be durable and auditable.
- An approval must not be reusable to authorize a materially different operation.

## 8. Reservation and idempotency requirements

- Financial mutations must use durable idempotency or equivalent one-shot claims where the provider/network semantics require it.
- Spend must be reserved before an authorized side effect when concurrent requests could exceed policy.
- A retry of the same intended operation must not create a second payment simply because the first response was lost.
- Operations with ambiguous submission must preserve enough evidence to reconcile rather than being reset to a clean pre-submission state.

## 9. Direct x402 requirements

AgentPay must:

1. retrieve paid resources using SSRF-safe network rules;
2. parse supported x402 payment requirements;
3. bind the requirement to the exact canonical resource requested;
4. verify the configured network, asset, amount, and payee;
5. apply organization/agent policy and trust requirements;
6. reserve spend before execution where required;
7. produce the correct self-custody or managed payment flow;
8. verify settlement evidence before treating the resource as paid;
9. persist payment and fulfillment evidence.

Supported direct profiles include Hedera Testnet/Mainnet, Arc Testnet, and Cardano Preprod/Mainnet subject to each environment's readiness configuration.

## 10. Cardano requirements

Cardano direct x402 supports the narrow `exact` profile implemented by the signer/facilitator boundary.

The signer must:

- resolve the exact payer identity;
- select bounded payer-owned inputs;
- construct a narrow key-spend transaction;
- calculate fee, TTL, outputs, and payer change;
- sign only under the selected custody mode;
- return unsigned/signed CBOR and identifiers required for independent verification;
- never submit the transaction to the chain.

The facilitator must independently verify:

- encoding and network;
- exact payer and payer-only inputs;
- exact payee, asset, and amount;
- supported asset set and conservation;
- payer-only change;
- fee and TTL bounds;
- resource binding and nonce/replay state;
- settlement claim uniqueness.

Submission and confirmation use independent Blockfrost evidence. An uncertain submission must be reconciled rather than blindly resubmitted.

Cardano Mainnet managed custody must not use a deployment-wide master payment key. External managed custody must resolve a stable per-agent Ed25519 public key/signer reference; AgentPay derives the address and verifies returned signatures locally.

## 11. Moove Receive requirements

AgentPay supports the live Moove Receive payment-link surface.

The integration must:

- keep the Moove API key server-side;
- restrict production API traffic to the configured trusted Moove host;
- bind one Moove account credential to one AgentPay organization;
- persist a local payment record before/around provider creation according to the idempotency protocol;
- use a durable AgentPay idempotency key for repeated client requests;
- never blindly retry an ambiguous create POST;
- reconcile ambiguous creates against provider-visible payment links using the durable marker strategy;
- persist provider link identifier, URL, status, destination/token evidence, received amount, transaction URL, and reconciliation timestamps when available;
- expose payment status through REST and agent adapters;
- treat only verified `COMPLETED` provider evidence as completion;
- validate exact configured token/network/decimals/amount before linked invoice automation marks an invoice paid.

## 12. Masumi requirements

Masumi has two independent roles:

- **registry/trust:** verify counterparty identity, capability, payment-address facts, freshness, and optional observed-history/reputation requirements for direct payment policy;
- **escrow:** maintain an explicit purchase/job lifecycle including funds locking, result evidence, completion, refunds, disputes, and reconciliation.

Direct x402 must never be mislabeled as escrow merely because Masumi registry evidence was used.

## 13. Cards and fiat requirements

The provider adapter layer supports a Stripe implementation and local sandbox implementation.

When the Stripe profile is enabled, the application may provide:

- cardholder creation and lifecycle state;
- virtual-card issuance and status control;
- spending-limit/category/country controls passed to the provider;
- short-lived card display-key creation through the provider;
- signed webhook processing for authorization events;
- provider financial-account creation and balance retrieval;
- inbound and outbound money movement and status retrieval.

Provider capability must be gated by configuration, entitlements, account eligibility, and provider responses. Raw card data must not be persisted or exposed through normal AgentPay APIs. Sandbox results must not be represented as real financial activity.

## 14. Invoicing, resources, and marketplace requirements

The system must support:

- providers and verified provider/resource relationships;
- resource listings, categories, endpoints, prices, and health state;
- marketplace discovery and reviews;
- invoices, items, sequence, lifecycle events, collection/payment, settlement, and voiding;
- resource fulfillment evidence;
- optional Masumi and Veridian identity bindings;
- payment-link or direct-payment association where supported.

A resource or invoice must not advance to a paid/fulfilled state solely because a payment request was initiated.

## 15. Cross-chain requirements

Cross-chain functionality is an orchestration surface for network discovery, quotes, transfer preparation, submission, and transfer state. It must remain provider/network gated and must not imply that every listed route is executable in every deployment.

Quotes and prepared operations must be bound to the intended source/destination, asset/amount, expiry, policy decision, and submission state. Ambiguous provider submission must be reconciled before a duplicate transfer is created.

## 16. Automation requirements

- Automation rules must be organization-scoped and auditable.
- Executions must have durable state.
- Webhook-triggered and manually triggered execution paths must authenticate/verify their configured boundary.
- Financial automation must still pass policy, approval, reservation, provider-readiness, idempotency, and emergency-stop controls.
- An automation failure after possible submission must preserve ambiguity and require reconciliation rather than automatic duplicate execution.

## 17. Financial intelligence requirements

AgentPay may compute and expose financial observations, forecasts, anomaly records, summaries, and budget recommendations. These outputs are advisory. They must not independently bypass published policy or grant new payment authority.

## 18. Audit, notifications, incidents, and data lifecycle

- Material actions must emit structured audit events.
- Audit integrity/sequence controls must make unauthorized rewriting detectable.
- Notification delivery must use durable outbox/delivery state where implemented.
- Reconciliation and maintenance operations must remain available when needed for defensive recovery.
- Organization exports must be authorized and bounded.
- Retention and deletion workflows must respect financial/audit evidence requirements and current application policy.
- Support cases and messages must remain tenant-scoped.

## 19. Security requirements

The system must protect against:

- cross-tenant access;
- credential leakage and privilege escalation;
- managed payment-identity collision;
- SSRF through paid-resource endpoints;
- replay and duplicate financial side effects;
- stale or manipulated trust/price evidence;
- forged provider webhooks;
- arbitrary contract or transaction complexity outside supported profiles;
- ambiguous provider/network response being misreported as success;
- supply-chain vulnerabilities and leaked repository secrets.

See [`threat-model.md`](threat-model.md) and [`../SECURITY.md`](../SECURITY.md).

## 20. Reliability and consistency requirements

- Financial state changes must be transactionally consistent where multiple durable records represent one business event.
- Idempotent retries must return/reconcile the original intended operation.
- External timeouts must have bounded deadlines.
- Provider/network failures must not silently relax policy or security.
- Reconciliation must be able to repair local status from authoritative external evidence without duplicating the original side effect.
- Health and readiness endpoints must distinguish process health from capability readiness.

## 21. Deployment and release requirements

A production profile must define and verify:

- exact source revision;
- database migration state;
- required secrets and external endpoints;
- enabled networks/providers;
- custody mode;
- HTTPS and trusted-host restrictions;
- reconciliation/maintenance scheduling;
- monitoring and incident procedures;
- backup/recovery expectations;
- successful lint, typecheck, unit/integration checks, security scans, and production service/container builds.

The presence of source code for a provider does not by itself establish that the provider is enabled in a specific deployment.

## 22. Agent integration requirements

REST, TypeScript SDK, MCP, LangChain, and skill adapters must delegate financial authority to AgentPay. They may expose status and non-secret evidence but must not require or return underlying blockchain private keys, managed master secrets, provider restricted keys, session secrets, or raw card credentials.
