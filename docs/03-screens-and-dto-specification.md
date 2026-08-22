# AgentPay Control: Screens and DTO Specification

**Status:** Current implementation-facing UI/API reference  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

The original July specification described the Hedera-focused MVP UI and DTOs. The current product supports multiple rails, richer policies, Cardano Preprod/Mainnet custody modes, Masumi/Pyth/KERI controls, reconciliation, incidents and broader operations. This version replaces the obsolete MVP-only view with a current functional map. The earlier specification remains in Git history.

## 1. UI surface

The authenticated application is a Next.js dashboard/API control plane. Current functional areas include:

- overview/analytics;
- organizations and members/RBAC;
- agents and payment accounts;
- scoped agent credentials;
- policy creation/publishing;
- payment initiation and x402 paid requests;
- approvals;
- transactions/settlements;
- resources/marketplace;
- audit;
- incidents/reconciliation;
- Cardano analytics;
- invoices;
- cards/fiat adapters where enabled;
- cross-chain/automations where enabled;
- financial intelligence;
- organization settings, emergency stop, exports and deletion.

UI availability does not itself imply a production provider is enabled; feature pages must reflect configuration/readiness state.

## 2. Agent creation and custody choices

An agent has a stable immutable ID, network, status, payment account and policy relationship.

Current managed-capable networks include:

- Hedera Testnet;
- Arc Testnet;
- Cardano Preprod;
- Cardano Mainnet with `EXTERNAL_DELEGATED` custody.

Cardano Mainnet must distinguish:

- **self custody:** wallet-controlled signing of the prepared transaction;
- **external delegated custody:** one external Ed25519 signer identity for the immutable Agent ID.

The UI must never describe a shared Mainnet platform payer/master key because that architecture is prohibited.

## 3. Payment account DTO

Conceptually, a payment account exposes only non-secret identity and mode information:

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

Private keys, testnet master secrets, custody API credentials and encrypted secret material are never returned by ordinary read APIs.

The canonical identity must remain globally unique per network.

## 4. Managed identity DTO

The implemented managed-identity response is equivalent to:

```ts
type ManagedAgentIdentity = {
  accountId: string;
  publicKey?: string;
  signerRef: string;
};
```

Validation is network-specific:

- Hedera Testnet: `0.0.x`;
- Arc Testnet: `0x...` address;
- Cardano Preprod: `addr_test1...`;
- Cardano Mainnet: `addr1...`.

For Cardano Mainnet, the public identity comes from the external custody adapter, but AgentPay derives and validates the Cardano payer address itself.

## 5. x402 requirement DTO

The direct payment client expects x402 V2 requirements with:

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

For Cardano, `extra` must contain the implemented safety metadata, including server submission, resource binding and confirmation policy.

The selected requirement must match the exact canonical resource URL, network, asset, amount and payee expected by AgentPay.

## 6. Managed signing request

The control plane sends the facilitator:

```ts
{
  paymentRequirements,
  agentId,
  payerAccountId
}
```

The facilitator then uses the isolated Cardano signer. For Mainnet external custody, the signer resolves the exact Agent ID's public key/signer reference and signs only the resulting transaction-body hash.

## 7. Payment intent lifecycle

Relevant visible states include the policy/approval/signing/settlement distinction:

```text
request
  -> policy evaluation
  -> DENIED | APPROVAL_PENDING | AUTHORIZED
  -> SIGNING
  -> signed/submitted
  -> SETTLED
       or
     SUBMISSION_UNKNOWN -> reconciliation
       or
     FAILED_BEFORE_SUBMISSION
```

The UI should not display an ambiguous post-submission outcome as a clean pre-submission failure.

## 8. Approval screens

Approval detail must show enough context to make a financial decision:

- requesting agent;
- resource/provider;
- network;
- asset and amount;
- policy reason;
- expiration;
- prior decision state.

Self-approval is blocked where the configured role/threshold model requires separation.

## 9. Policy screens

Published policy can expose/configure:

- atomic transaction/hour/day/month limits;
- allow/deny merchant rules and categories;
- `DENY` or `REQUIRE_APPROVAL` over-limit behavior;
- approval/rejection thresholds;
- velocity and cooldown;
- schedule windows;
- Pyth USD ceilings;
- Masumi trust/history/reputation controls;
- optional KERI issuer/schema/freshness controls.

The UI must make clear that a published policy version is immutable and superseded by publishing a new complete version.

## 10. Cardano transaction detail

Cardano detail/evidence should distinguish:

- network (`cardano:preprod` or `cardano:mainnet`);
- payer and payee;
- asset and atomic amount;
- transaction ID;
- settlement/confirmation state;
- custody mode;
- reconciliation state if ambiguous.

The UI may link to public chain evidence but must not expose private keys, custody credentials or private AgentPay context.

## 11. Trust integration DTOs

### Pyth

Store/expose only the observation/evaluation evidence needed for policy traceability: price, confidence, publish time and resulting conservative USD valuation.

### Masumi

Resource binding includes verified registry source, agent identifier, capability, seller address/payment-key facts, pricing snapshot, verification time and expiry.

Escrow state is modeled separately from direct x402 and includes provider purchase/job identifiers, lifecycle status, result hash evidence and refund/dispute state.

### KERI/Veridian

Expose non-secret verification evidence such as credential SAID, issuer AID, schema SAID, verification/freshness status and binding result, not private credential/key material.

## 12. Operational screens

### Emergency stop

The organization emergency stop must clearly communicate that new risky side effects are blocked while reconciliation/defensive processing remains available.

### Readiness

Readiness views/endpoints must distinguish source support from the actually configured deployment profile.

### Incidents/reconciliation

Operators need transaction candidate ID, network, error/reason, current evidence and reconciliation status without needing access to signing secrets.

## 13. Security/UI rules

- never display raw blockchain private keys;
- never display managed-agent master secrets;
- never display Mainnet custody API credentials;
- secrets created for agents are shown once and subsequently represented only by non-secret metadata;
- destructive settings require authenticated authorization;
- tenant identifiers must not allow cross-organization reads/writes;
- external resource URLs must be treated as untrusted input.

## 14. Provenance

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor. The first AgentPay UI/API was originally built around the Hedera x402 bounty and later expanded into the current multi-rail implementation. This document describes the current functional contracts rather than the original Hedera-only screen plan.

See [`implementation-status.md`](implementation-status.md), [`04-detailed-workflows.md`](04-detailed-workflows.md), [`cardano-production.md`](cardano-production.md), and the code under `dashboard/src/` for authoritative implementation details.