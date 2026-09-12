# AgentPay Software Design

**Status:** implementation-aligned architecture reference  
**Updated:** 2026-09-10

## 1. Design goals

AgentPay is designed to let autonomous software participate in payments and commerce without making an LLM, tool runtime, or individual provider adapter the final source of financial authority.

The architecture therefore separates:

- **intent** — what an agent wants to do;
- **authorization** — whether organization policy permits it;
- **execution** — which rail/provider performs it;
- **custody** — where signing or provider authority resides;
- **evidence** — what proves the outcome;
- **reconciliation** — how uncertain outcomes are repaired;
- **operations** — how humans observe, stop, recover, and audit the system.

## 2. Logical architecture

```text
             Human dashboard / REST clients / AI agents
                              |
                              v
                    Next.js Control Plane
 +----------------------------------------------------------------+
 | auth | organizations | workspaces | members | agents | creds    |
 | policies | approvals | reservations | intents | invoices        |
 | resources | marketplace | cards | fiat | cross-chain           |
 | automation | intelligence | audit | notifications | operations  |
 +----------------------------------------------------------------+
                              |
                    PostgreSQL system of record
                              |
        +---------------------+----------------------+ 
        |                     |                      |
        v                     v                      v
 direct x402 layer       Moove Receive         provider services
        |                     |              Stripe / Masumi / etc.
        v                     v
 unified facilitator       hosted checkout
        |
 +------+------------------------+
 |              |                |
 Hedera         Arc            Cardano
                                |
                      isolated Cardano signer
                                |
                Preprod key derivation / Mainnet
                 external per-agent custody
```

## 3. Control plane

The dashboard application is both the user-facing control surface and the primary authenticated API surface.

Major domains include:

- authentication/session and wallet-auth challenges;
- organizations, workspaces, memberships, entitlements, usage, and support;
- agents, credentials, payment accounts, and integration metadata;
- policies, policy versions, decisions, approvals, reservations, and contract allowlists;
- payment intents, attempts, settlements, transactions, and fulfillment;
- providers, resources, resource health, marketplace listings/reviews, and invoices;
- cards, cardholders, card authorizations, fiat accounts/transfers;
- cross-chain quotes/transfers;
- automation rules/executions/decisions;
- financial observations, anomalies, forecasts, recommendations;
- audit, notifications, reconciliation, retention, exports, deletion, release evidence, and emergency controls;
- Moove Receive and Masumi-specific lifecycle state.

## 4. Persistence model

PostgreSQL is the durable system of record. Prisma provides the primary model/client layer; explicit SQL is used when a feature requires a database invariant or table not represented as a first-class Prisma model.

Durable records intentionally distinguish:

- a requested payment from an executed attempt;
- an attempt from a confirmed settlement;
- policy decision from approval decision;
- spend reservation from final spend;
- provider/network submission from confirmed outcome;
- resource fulfillment from payment settlement;
- external provider evidence from local interpretation.

This separation prevents an intermediate event from being mistaken for financial completion.

## 5. Identity and tenancy

Every organization-owned object is resolved under an authenticated organization context. Human RBAC and agent credential scopes are enforced server-side.

Managed blockchain payment accounts use canonical identity normalization and database uniqueness. The core invariant is:

```text
(network, canonical identity) -> one PaymentAccount -> one agent
```

Transaction-scoped locking protects the identity-claim path from concurrent assignment races.

## 6. Policy engine

The policy engine evaluates the requested financial action against the currently published immutable policy version. Decisions are persisted so a later audit can reconstruct the policy context used at authorization time.

Policy can combine:

- atomic asset limits;
- USD-valued limits from Pyth evidence;
- merchant/resource/category controls;
- time/velocity/cooldown constraints;
- approval requirements;
- Masumi trust/history/reputation evidence;
- optional Veridian/KERI evidence;
- contract allowlists and network restrictions.

The most restrictive applicable outcome wins. Required external evidence failing validation cannot loosen the decision.

## 7. Approval architecture

Approval requests are separate durable objects from payment intents. Threshold decisions are accumulated under role/separation rules. Only after the required approval state is reached may the execution service proceed.

Approval consumption is bound to the intended operation so an approval cannot be repurposed for a materially different amount, resource, or payment identity.

## 8. Direct x402 architecture

The direct paid-resource path is:

```text
request resource
 -> receive 402/payment requirements
 -> canonicalize + validate resource
 -> verify registered resource/trust evidence
 -> evaluate policy
 -> reserve spend
 -> approval if required
 -> obtain self-custody or managed payment payload
 -> resource/facilitator verification and settlement
 -> validate settlement evidence
 -> persist fulfillment
```

External resource URLs are untrusted input and use bounded/SSRF-safe access controls.

## 9. Network facilitator architecture

Facilitators are payment-protocol/network services, not organization policy engines. They receive already-authorized execution context and enforce rail-specific cryptographic/transaction requirements.

### Hedera

The Hedera facilitator implements the supported Hedera payment/x402 profile and rail-scoped security/environment validation for Testnet/Mainnet profiles.

### Arc

The Arc facilitator implements the configured Arc Testnet EVM payment path, including network/security validation and settlement evidence. No unsupported Arc production network is implied by the adapter existing.

### Cardano

The combined facilitator dispatches Cardano Preprod/Mainnet and performs independent transaction verification, settlement claims, submission, and confirmation classification.

## 10. Cardano signer architecture

The Cardano signer is a separate service boundary because transaction construction/signing authority should not be co-located with the control-plane application.

Preprod can derive a unique Ed25519 identity per immutable Agent ID from a signer-only test secret.

Mainnet supports:

- unsigned self-custody transaction preparation; or
- external per-agent Ed25519 custody.

For external custody:

```text
agentId
 -> external custody /identity
 -> publicKeyHex + signerRef
 -> derive addr1... locally
 -> construct bounded transaction
 -> hash transaction body
 -> external custody /sign
 -> verify returned Ed25519 signature locally
 -> signed CBOR
```

The signer never submits transactions. Submission belongs to the facilitator after independent verification.

## 11. Cardano settlement claims

Before on-chain submission, the facilitator creates/updates a durable claim bound to the candidate transaction and resource/payment context. This separates:

- not submitted;
- submission started;
- confirmed;
- definitively failed;
- submission unknown/reconciliation required.

Timeouts after possible submission therefore cannot trigger blind duplication.

## 12. Moove Receive architecture

Moove is modeled as a hosted receive-payment rail rather than a blockchain signer.

The service layer stores an AgentPay payment record and durable idempotency fingerprint, then creates or recovers the provider payment link. Because provider-side create idempotency is not assumed, ambiguous create responses are reconciled through the provider listing surface using an AgentPay marker.

A Moove account settles according to its account-level wallet/token configuration. AgentPay therefore binds the Moove credential to one organization and records provider-reported destination/token evidence.

Completion processing is transactional: settlement evidence is persisted, linked resource/invoice events are emitted, and invoice state changes only after exact settlement configuration checks pass.

## 13. Masumi architecture

Masumi is integrated through two separate services:

- registry/payment identity evidence used as policy/trust input for direct payment;
- escrow purchase lifecycle with its own provider state, result-hash verification, refund/dispute, and reconciliation logic.

These lifecycles remain separate in storage and UI because their financial semantics differ.

## 14. Card and fiat provider architecture

`CardProviderAdapter` isolates AgentPay business logic from the external provider implementation. Current implementations include Stripe and Sandbox.

The Stripe adapter covers issuing/cardholders, virtual cards, status changes, display-key creation, financial accounts, inbound/outbound money movement, provider reads, and signed webhook verification. The sandbox implementation produces development-only state and deliberately cannot reveal usable card credentials.

Provider records store non-secret identifiers/status rather than raw card credentials.

## 15. Cross-chain architecture

Cross-chain operations are represented as quotes and transfers with explicit lifecycle state. Preparation and submission are distinct so policy/readiness can be checked before the irreversible boundary. Source/destination and quote identity are persisted to support later reconciliation.

Provider/network configuration determines which routes are actually executable.

## 16. Automation architecture

Automation consists of rules, executions, and execution decisions. A trigger creates or advances durable execution state; financial actions still invoke the normal policy/approval/reservation/execution layers.

Webhook endpoints and manual execution routes are separate boundaries. Emergency stop can block new risky side effects while allowing defensive reconciliation/maintenance.

## 17. Financial intelligence architecture

Financial intelligence operates over persisted financial observations and produces summaries, anomalies, forecasts, and recommendations. It is an advisory layer and does not sign, settle, or authorize payments.

## 18. Resource and marketplace architecture

Resource providers, resource definitions, health checks, prices, marketplace listings, reviews, invoice data, and fulfillment evidence are stored separately so commercial presentation does not become the source of payment truth.

Canonical endpoint handling prevents the same paid endpoint from being ambiguously registered under multiple forms.

## 19. Notifications and audit

Material business events are written to audit/outbox structures. Notification endpoints and deliveries are processed from durable state so transient delivery failure does not erase the underlying event.

Audit integrity/sequence controls are designed to make mutation or ordering problems detectable.

## 20. External trust/data integrations

- **Pyth Hermes:** price/confidence/publish-time evidence for conservative policy valuation.
- **Masumi:** registry/payment identity and escrow provider evidence.
- **Veridian/KERIA:** optional cryptographic credential-verification boundary; AgentPay validates the returned claims against policy.
- **Blockfrost:** Cardano UTxO/protocol data, transaction submission, and confirmation evidence.
- **Dune:** read-only public analytics; never part of authorization/signing/reconciliation authority.

## 21. Failure model

AgentPay classifies failures by the irreversible boundary.

- **Before submission:** safe to report as pre-submission failure when no financial side effect occurred.
- **After possible submission:** preserve ambiguity, candidate identifiers, reservations, and evidence; reconcile before retry.
- **After confirmed settlement but failed fulfillment:** payment remains settled; fulfillment is recovered independently.
- **External trust/readiness failure:** fail closed when that dependency is required.

## 22. Deployment topology

The canonical topology uses Vercel for the control plane, PostgreSQL for durable state, and Render for facilitator/signer services. Provider/network credentials are scoped to the service that requires them.

The deployment contract is documented in [`unified-production-deployment.md`](unified-production-deployment.md).

## 23. Security model

The design assumes browsers, agents, resource URLs, provider responses, and network responses can be malformed or adversarial. Security depends on layered validation rather than trusting any single external source.

See [`threat-model.md`](threat-model.md), [`managed-signer-isolation.md`](managed-signer-isolation.md), and [`../SECURITY.md`](../SECURITY.md).
