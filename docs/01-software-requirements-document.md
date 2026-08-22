# AgentPay Control: Software Requirements Document

**Status:** Current implementation-aligned requirements  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

The July 2026 requirements were written around the original Hedera x402 bounty MVP. AgentPay has since become a multi-rail control plane and now includes Cardano Preprod managed signing, Cardano Mainnet self custody and external per-agent custody, Arc, expanded policy and trust integrations, durable reconciliation, and broader operational controls. This version replaces obsolete Hedera-only assumptions. The original July baseline remains available in Git history.

## 1. Product purpose

AgentPay is a policy-controlled financial operating layer for autonomous software agents. It allows agents to request and execute payments without giving an LLM, tool runtime, or untrusted resource unrestricted treasury authority.

The system must enforce organization tenancy, agent identity, immutable policy, approvals, spend reservations, idempotency, isolated signing, transaction verification, settlement reconciliation, audit evidence, and emergency controls around every supported payment rail.

## 2. Current system boundary

The implemented production topology is:

- **Control plane:** Next.js/TypeScript dashboard and APIs on Vercel.
- **System of record:** PostgreSQL through Prisma.
- **Unified facilitator:** Render service serving Hedera Testnet/Mainnet, Arc Testnet, Cardano Preprod and Cardano Mainnet.
- **Cardano signer gateway:** separate Render web service with isolated Preprod and Mainnet workers.
- **Resource server:** x402-protected paid-resource implementation.
- **External trust/data systems:** Pyth Hermes, Masumi Registry/Payment Service, optional Veridian/KERIA, Dune and Blockfrost.
- **External Cardano Mainnet custody:** per-agent Ed25519 HSM/KMS/delegation adapter, when autonomous Mainnet custody is enabled.

## 3. Core requirements

### 3.1 Identity, tenancy and access

- Every organization-scoped record must be protected from cross-tenant access.
- Dashboard users must be authenticated before organization data is exposed.
- Owner, Operator, Approver and Viewer authorization semantics must be enforced server-side.
- Sensitive actions must be auditable.
- Agent API credentials must be scoped, revocable, expirable and shown in plaintext only once at creation.
- An agent must have a stable immutable identifier used to bind managed payment identity.

### 3.2 Agent payment-identity isolation

The invariant is:

```text
(network, canonical payment identity) -> exactly one PaymentAccount -> exactly one agent
```

- A shared service deployment is allowed; a shared managed-agent wallet is not.
- The database must reject duplicate canonical payment identities, including concurrent claims across organizations/application replicas.
- Historical settlement evidence must not be rewritten when an old/shared identity is retired.

Implemented managed identity modes:

- Hedera Testnet: distinct Ed25519 account per agent.
- Arc Testnet: distinct secp256k1 address per agent.
- Cardano Preprod: distinct Ed25519 payment identity per agent, derived only inside the isolated signer from a testnet-only master secret.
- Cardano Mainnet: distinct externally custodied Ed25519 public key/signer reference per agent when external custody is configured.

### 3.3 Custody requirements

- The Vercel control plane must not contain blockchain private keys, managed-agent master keys or Cardano Mainnet custody API credentials.
- Testnet master secrets must remain testnet-only.
- `CARDANO_MANAGED_AGENT_MASTER_KEY` must never be accepted on Cardano Mainnet.
- Cardano Mainnet must support self-custody transaction preparation.
- Cardano Mainnet autonomous managed agents must use an external per-agent custody identity rather than a deployment-wide payer/master key.
- The external custody adapter must return a stable Ed25519 public key and signer reference for an immutable Agent ID.
- AgentPay must derive the corresponding `addr1...` address locally.
- Only the Cardano transaction-body hash may be sent to the external custody signer for signing.
- Returned Ed25519 signatures must be verified locally before signed CBOR is accepted.
- Custody-provider failure must fail closed; there must be no fallback to another agent, shared key, or platform payer.

### 3.4 Policy requirements

Published agent policy may constrain:

- per-transaction, hourly, daily and monthly atomic spend;
- over-limit action (`DENY` or `REQUIRE_APPROVAL`);
- merchant/resource allow and deny rules;
- merchant categories;
- approval/rejection thresholds;
- transaction velocity and cooldown;
- activation/expiry and UTC schedule windows;
- Pyth-valued USD ceilings;
- Masumi identity/capability/freshness requirements;
- minimum observed Masumi escrow history/reputation;
- optional Veridian/KERI issuer/schema/freshness requirements.

Published policy versions must remain immutable. A new version supersedes the old one atomically.

### 3.5 Spend and approval requirements

- Authorized spend must be represented by a durable reservation before signing.
- Active reservations and recently settled commitments must prevent stale balance snapshots from reopening budget.
- Initiators must not self-approve where separation of duties is required.
- Approval-required requests must not sign until the approval state is consumed.
- Organization emergency stop must block new risky side effects while allowing defensive reconciliation/evidence processing.

## 4. x402 payment requirements

### 4.1 Resource interaction

The direct flow is:

```text
Agent -> AgentPay -> x402 resource -> HTTP 402 requirement
      -> policy/reservation -> managed/self-custody signing
      -> resource with payment payload -> facilitator verify/settle
      -> confirmed resource response
```

- Resource URLs must be SSRF-protected and response bodies bounded.
- Idempotency keys must prevent duplicate intent creation.
- Cardano requirements must bind the canonical paid-resource URL using SHA-256 `resourceBinding`.

### 4.2 Cardano exact profile

Supported networks:

- `cardano:preprod`
- `cardano:mainnet`

Requirements:

- x402 version 2, scheme `exact`;
- ADA represented as `lovelace`;
- optional native-token support restricted to exactly the configured asset unit;
- Mainnet USDCx only when configured to the pinned canonical Cardano asset identity;
- server-submission policy and explicit confirmation depth;
- key-spend payment shape only;
- payer-only inputs and change;
- exact payee, asset and amount;
- token conservation;
- bounded fee and TTL;
- no scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data or unrelated third-party outputs.

The Cardano signer constructs the narrow transaction. The facilitator independently decodes and verifies the signed transaction before submission.

### 4.3 Cardano settlement and ambiguity

- The facilitator, not the signer, submits Cardano transactions through Blockfrost.
- A durable settlement claim must bind transaction hash, resource-bound requirement, payer and UTxO nonce.
- Submission state must be recorded before network submission.
- Timeouts/ambiguous responses must not be treated as definitive failure.
- Ambiguous outcomes must remain `SUBMISSION_UNKNOWN`/reconciliation-required until independent chain evidence resolves them.
- Confirmations and replay/mismatch decisions must use chain evidence.

## 5. Masumi requirements

Masumi serves two distinct roles:

1. **Direct x402 counterparty trust:** verify registry source, agent identifier, capability, seller wallet and Cardano payment credential.
2. **Escrow payment lifecycle:** create purchase, lock funds, start job, reconcile state, verify returned result hash, support refund request/authorization, and record disputes/failures.

Direct x402 must never be represented as Masumi escrow.

Seller reputation used by AgentPay policy must be derived from AgentPay-observed linked escrow outcomes, not invented or presented as a Masumi-native score.

## 6. Pyth and KERI requirements

### Pyth

- USD valuation must use bounded/fresh observations.
- Conservative policy valuation must not understate spend.
- Stale, future, non-positive or over-wide-confidence observations must fail closed where Pyth policy is required.
- Oracle failure must never relax an existing atomic policy.

### Veridian/KERIA

- KERI/ACDC cryptographic verification is delegated to the configured verifier.
- AgentPay must additionally enforce trusted issuer/schema sets, subject identity, expiry/revocation evidence and the expected Masumi-agent binding.
- Required credential evidence that is stale, invalid or mismatched must deny/defer new spend.

## 7. Observability and audit requirements

- Payment/policy/approval/security events must be auditable.
- Public Dune analytics may expose only public Cardano chain facts and must never authorize/sign/settle payments.
- Private organization, prompt, policy, credential and resource-content data must not be published to Dune.
- Reconciliation must remain available during emergency-stop operation.
- Incidents and ambiguous settlements must retain enough evidence for investigation.

## 8. Deployment requirements

### Vercel

The dashboard/API deployment requires valid application/auth/database/configuration secrets and must contain no blockchain signing secrets.

### Render facilitator

The combined facilitator hosts the supported rail-specific protocol boundaries and Cardano settlement verification/submission logic.

### Render Cardano signer

One public gateway starts isolated Preprod and Mainnet workers with distinct Blockfrost and capability credentials.

- Preprod worker: per-agent deterministic testnet identity + self-custody preparation.
- Mainnet worker: self-custody preparation + external per-agent custody when configured.

### External Mainnet custody

The provider is an external deployment dependency. It must implement:

```text
POST /identity
POST /sign
```

and retain private keys outside AgentPay.

## 9. Verification requirements

A release candidate must execute, not merely declare, the applicable checks:

- forward-only database migrations;
- concurrent payment-identity isolation verification;
- dashboard lint/typecheck/unit tests/build;
- browser smoke tests;
- Hedera/Arc/combined facilitator tests/builds;
- Cardano signer tests/image build;
- resource-server tests/build;
- CodeQL/dependency review and other required release gates.

A workflow that fails before executable steps are created is infrastructure-blocked, not a successful application validation.

## 10. Current maturity and proposal boundary

For Catalyst purposes, the current implementation is described conservatively as **TRL 5** until the intended Cardano Mainnet/pilot configuration is demonstrated in a relevant environment. The repository now contains the Mainnet external per-agent custody path, but source implementation alone is not a TRL 6 demonstration.

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor. AgentPay was originally built for the Hedera x402 bounty and later extended into the current multi-rail system. Prior Hedera work remains prior work. Catalyst scope should describe only the Cardano-specific and pilot work being proposed rather than retroactively treating completed Hedera work as Catalyst-funded delivery.

## 11. Authoritative companion documents

- [`README.md`](../README.md)
- [`implementation-status.md`](implementation-status.md)
- [`managed-signer-isolation.md`](managed-signer-isolation.md)
- [`cardano-production.md`](cardano-production.md)
- [`production-readiness.md`](production-readiness.md)
- [`unified-production-deployment.md`](unified-production-deployment.md)
- [`threat-model.md`](threat-model.md)

The pre-2026-08-22 version of this document remains available in Git history as the original Hedera MVP requirements baseline.