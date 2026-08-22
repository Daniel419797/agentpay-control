# AgentPay Control: Software Design Document

**Status:** Current implementation architecture  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

The July 2026 design was written for the original Hedera x402 MVP and contained now-obsolete statements such as Mainnet being disabled pending a future custody migration. This version reflects the architecture implemented after the Cardano Mainnet external per-agent custody merge. The original design remains in Git history.

## 1. Design intent

AgentPay is a multi-tenant financial control plane for autonomous agents. The primary design property is that an agent may request spend, but cannot bypass organization policy, obtain unrestricted treasury authority, substitute another agent's payment identity, or force a settlement that the independent protocol boundary has not verified.

## 2. Deployed service architecture

```text
Human users / Autonomous agents
             |
             v
     Next.js Control Plane
         (Vercel)
             |
   +---------+----------+
   |                    |
PostgreSQL          External trust/data
(Prisma)        Pyth / Masumi / KERIA
   |
   +-----------------------------+
                                 |
                       payment orchestration
                                 |
                  +--------------+--------------+
                  |                             |
             Direct x402                   Masumi escrow
                  |                             |
          x402 Resource Server           Masumi Payment Service
                  |                             |
                  +-------------+---------------+
                                |
                       Unified Facilitator
                            (Render)
      Hedera Testnet/Mainnet | Arc Testnet | Cardano Preprod/Mainnet
                                |
                     Cardano Signer Gateway
                            (Render)
                         /              \
                  Preprod worker      Mainnet worker
                  per-agent keys      self-custody +
                                      external per-agent custody
                                             |
                                  HSM/KMS/delegation adapter
                                             |
                                  private key stays external
```

## 3. Control-plane design

The dashboard/API is a modular Next.js application containing:

- authentication and organization/RBAC;
- agents and scoped credentials;
- immutable policy versions;
- approvals;
- spend reservations/idempotency;
- resources and payment orchestration;
- transactions and settlement evidence;
- audit events;
- emergency stop;
- incidents/reconciliation;
- analytics/financial intelligence;
- data export/deletion and integration settings.

The control plane decides whether a spend is allowed, approval-required or denied. It does **not** hold production Cardano private signing material.

## 4. PostgreSQL design

PostgreSQL/Prisma is the system of record for organization state, agents, policy, reservations, payment intents, attempts, settlements, approvals, resources, audit/evidence and operational state.

A global canonical payment-identity invariant is enforced with a canonical unique identity index and transaction-scoped PostgreSQL advisory locking:

```text
network + canonical account identity -> one PaymentAccount -> one agent
```

This prevents two agents, including agents in different organizations or application replicas, from claiming the same managed payment identity.

## 5. Payment orchestration design

### 5.1 Direct x402

The control plane discovers the resource's HTTP 402 challenge, selects the exact requirement matching resource/network/asset/amount/payee, evaluates policy, creates/reserves spend, and then requests the correct managed/self-custody signing path.

The paid resource receives the x402 payment payload and invokes the facilitator's verify/settle protocol before returning paid content.

### 5.2 Masumi escrow

Masumi escrow is a separate protocol path. AgentPay verifies seller/registry facts, evaluates the same financial policy plus configured trust controls, creates/reconciles the purchase/job lifecycle, verifies result-hash evidence and records refund/dispute outcomes.

Direct x402 and escrow are never conflated.

## 6. Unified facilitator design

`facilitator-combined` is the public multi-rail protocol boundary. It mounts:

- `hedera:testnet`
- `hedera:mainnet`
- `eip155:5042002` (Arc Testnet)
- `cardano:preprod`
- `cardano:mainnet`

Root `/verify` and `/settle` dispatch by the exact network bound in payment requirement/payload.

For Cardano the facilitator:

1. receives/forwards managed identity/sign requests to the isolated signer;
2. independently decodes/verifies returned transaction CBOR;
3. checks payer, payee, amount, asset set, conservation, change, fee, TTL, nonce and resource binding;
4. maintains durable replay/settlement-claim state;
5. submits through Blockfrost;
6. polls independent chain evidence for confirmation;
7. returns success, definitive rejection, pending or ambiguous settlement state.

The Cardano facilitator does not hold a Cardano private signing key.

## 7. Cardano signer design

`cardano-signer` is a Render web-service gateway that starts isolated network-scoped child workers.

### 7.1 Preprod worker

- derives a unique Ed25519 identity for each immutable Agent ID from a signer-only testnet master secret;
- supports dedicated `/managed-identity` and `/managed-agent-sign` routes;
- supports unsigned/self-custody preparation;
- builds the narrow supported transaction shape.

### 7.2 Mainnet worker

- does not accept `CARDANO_MANAGED_AGENT_MASTER_KEY`;
- supports unsigned/self-custody preparation;
- supports external per-agent managed custody when configured;
- resolves a stable external Ed25519 `publicKeyHex` and `signerRef` for the immutable Agent ID;
- derives the `addr1...` payer address locally;
- sends only the transaction-body hash to the external signer;
- verifies the returned signature locally before returning signed CBOR.

The generic worker signing mode remains `unsigned-only`; dedicated per-agent managed routes coexist with it and do not introduce deployment-wide shared signing.

## 8. External Mainnet custody adapter

The external custody service is not hosted by AgentPay. It is a deployment dependency with the bounded API contract:

```text
POST /identity
POST /sign
```

`/identity` resolves public identity material for one Agent ID. `/sign` signs only the supplied transaction-body hash for that agent's signer reference.

Required safety properties:

- one stable signer identity per managed agent;
- no shared platform wallet;
- private keys never enter AgentPay;
- HTTPS and separate custody capability credential in production;
- identity/address mismatch fails closed;
- public-key/signer-reference mismatch fails closed;
- invalid signatures fail closed;
- provider unavailability does not trigger fallback to another key.

## 9. Cardano transaction design

The supported payment shape is deliberately narrow:

- phase-1/key-spend transactions;
- payer-only inputs;
- exact payee/asset/amount;
- ADA (`lovelace`) plus at most one explicitly configured native asset;
- payer-only change;
- bounded input count, fee and TTL;
- no scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data or unrelated assets/outputs.

The requirement includes SHA-256 binding of the canonical paid-resource URL.

## 10. Blockfrost boundary

Blockfrost is used by both Cardano components for different purposes:

- **Signer:** UTxOs/protocol/chain data required to construct the transaction.
- **Facilitator:** submission (`/tx/submit`), transaction evidence, latest block and confirmation depth.

Blockfrost is chain-access infrastructure, not an authorization system.

## 11. Policy and trust design

The control plane composes the most restrictive applicable outcome from:

- atomic spend policy;
- approval rules;
- reservations/budget state;
- Pyth USD valuation constraints;
- Masumi registry/capability/payment-key trust;
- observed Masumi escrow history/reputation;
- optional KERI/ACDC issuer/schema/freshness trust.

A configured trust dependency may make a payment more restrictive; failure must not silently relax policy.

## 12. Reconciliation design

A post-sign or post-submission timeout is not automatically a failure. Candidate transaction identity and durable claim state are retained and independently reconciled.

```text
SIGNED/SUBMISSION_STARTED
        |
        +-- confirmed evidence -> SETTLED
        +-- definitive rejection -> rejected/failed
        +-- unresolved -> SUBMISSION_UNKNOWN / reconciliation required
```

Blind resubmission is prohibited for ambiguous side effects.

## 13. Deployment trust boundaries

### Vercel control plane

Holds policy/business state and provider configuration. No blockchain private keys or Mainnet custody API credentials.

### Unified facilitator

Holds rail-specific protocol capability/infrastructure credentials. Cardano path verifies/submits but does not possess the payer private key.

### Cardano signer

Holds the Preprod derivation secret and Mainnet custody API capability where configured. It builds/signs but does not submit Cardano transactions on-chain.

### External custody

Holds Mainnet managed-agent private keys and signs body hashes only.

### Blockchains

Authoritative source of final settlement evidence.

## 14. Current maturity and provenance

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor. AgentPay was originally built for the Hedera x402 bounty and later extended to the implemented multi-rail architecture described here.

For Catalyst submission purposes, the current maturity remains **TRL 5** until the intended Cardano Mainnet/pilot configuration is demonstrated in a relevant environment. The source now implements external per-agent Mainnet custody, but implementation is not by itself a TRL 6 demonstration.

## 15. Current authoritative references

- [`README.md`](../README.md)
- [`implementation-status.md`](implementation-status.md)
- [`cardano-production.md`](cardano-production.md)
- [`managed-signer-isolation.md`](managed-signer-isolation.md)
- [`threat-model.md`](threat-model.md)
- [`production-readiness.md`](production-readiness.md)
- [`unified-production-deployment.md`](unified-production-deployment.md)

The prior July 2026 Hedera-specific SDD remains available in Git history for provenance.