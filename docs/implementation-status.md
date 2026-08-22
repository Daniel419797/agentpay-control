# AgentPay Implementation Status

**Status:** Current source implementation inventory  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

> **Why this document was updated:** This inventory now reflects the merged Cardano Mainnet external per-agent custody implementation and distinguishes implemented source behavior from deployment-specific provider/configuration facts. Older self-custody-only Mainnet wording is obsolete.

## Product/control plane

Implemented source includes:

- Next.js/TypeScript dashboard and authenticated APIs;
- passwordless/OAuth-oriented authentication flows and session controls;
- organizations and server-side RBAC;
- agents and scoped/revocable API credentials;
- network/payment accounts;
- immutable published policy versions;
- approval workflows;
- spend reservations/idempotency;
- payment intents/attempts/settlements;
- resources/provider catalog;
- immutable/tamper-evident audit behavior;
- emergency stop;
- incidents and reconciliation;
- organization export/deletion flows;
- analytics/financial intelligence;
- notification/outbox and operational integrations;
- marketplace/invoice/automation/cross-chain/card/fiat adapter surfaces where configured.

## Managed payment-identity isolation

Implemented invariant:

```text
(network, canonical account identity) -> one PaymentAccount -> one agent
```

Database migration includes canonical uniqueness and a transaction-scoped advisory-lock mechanism so competing claims cannot safely assign one canonical identity to multiple agents.

Implemented managed identity modes:

- Hedera Testnet: per-agent Ed25519 account;
- Arc Testnet: per-agent secp256k1 address;
- Cardano Preprod: per-agent Ed25519 identity/address derived inside isolated signer;
- Cardano Mainnet: external per-agent Ed25519 identity when custody adapter configured.

## Hedera

Implemented rail support includes Hedera Testnet/Mainnet child applications in the unified facilitator, x402/payment verification/settlement paths and rail-specific infrastructure credentials. Current Mainnet agent-custody model remains self custody; service operator/payer credentials are not agent wallets.

## Arc

Implemented Arc Testnet support includes x402 settlement, per-agent managed testnet identities, self-custody paths and bounded contract-execution infrastructure. Public Arc Mainnet is not declared as an enabled production rail without an actual reviewed supported network/profile.

## Cardano networks

Implemented:

- `cardano:preprod`;
- `cardano:mainnet`;
- x402 V2 `exact`;
- ADA (`lovelace`);
- at most one explicitly configured native asset;
- Mainnet USDCx canonical asset pinning when enabled;
- canonical resource SHA-256 binding;
- server submission and confirmation policy;
- narrow key-spend transaction construction;
- independent facilitator CBOR verification;
- Blockfrost submission/confirmation evidence;
- durable settlement claims/replay checks;
- ambiguous submission reconciliation.

## Cardano signer

Implemented as a Render web-service gateway with isolated Preprod/Mainnet workers.

### Preprod

- signer-only deterministic testnet master secret;
- per-Agent-ID Ed25519 derivation;
- locally derived `addr_test1...` identity;
- `/managed-identity`;
- `/managed-agent-sign`;
- unsigned/self-custody preparation.

### Mainnet

- self-custody unsigned preparation;
- external per-agent managed custody;
- no deterministic managed-agent master key;
- external `/identity` and `/sign` adapter calls;
- local `addr1...` derivation from custody public key;
- signer-reference/public-key consistency checks;
- local Ed25519 signature verification;
- fail-closed provider behavior.

The Cardano signer constructs/signs but does **not** submit transactions on-chain.

## Cardano facilitator

Implemented responsibilities include:

- network-scoped managed identity/signing routes;
- independent signed-CBOR parsing/verification;
- exact payer/payee/asset/amount checks;
- supported-asset/conservation/change rules;
- fee/TTL/nonce/resource-binding validation;
- durable settlement claim/replay protection;
- Blockfrost `/tx/submit`;
- transaction/latest-block evidence and confirmation polling;
- pending/ambiguous/definitive settlement classification.

## Pyth

Implemented optional policy integration:

- Hermes price fetch;
- freshness/confidence validation;
- positive-price checks;
- conservative USD-micro valuation;
- per-transaction/hour/day/month USD policy;
- fail-closed behavior where required.

## Masumi

Implemented roles are intentionally separate:

### Registry/direct-payee trust

- registry source/network verification;
- agent identifier/capability checks;
- seller settlement address/payment-key evidence;
- freshness/online requirements.

### Escrow lifecycle

- purchase creation/reconciliation;
- funds-locking/funds-locked/result/completion states;
- exact result-hash verification;
- refund request/authorization;
- dispute/failure tracking;
- seller reputation based on AgentPay-observed linked outcomes.

## Veridian/KERI

Implemented optional integration delegates cryptographic credential verification to configured KERIA and applies AgentPay issuer/schema/subject/freshness/revocation/identity-binding policy.

## Dune

Implemented read-only Cardano analytics assets include checked-in SQL/publishing support. Dune is outside payment authorization, signing, settlement and reconciliation authority. Real public query/dashboard identifiers are deployment facts.

## x402 resource server

Implemented demonstration resource server provides x402-protected resource flows and participates in the `402 -> payment payload -> verify/settle -> paid response` lifecycle.

Synthetic/demo content must be described as synthetic; it must not be presented as live customer, market, model or research evidence unless it actually is.

## Security/operational controls

Implemented source includes controls for:

- tenant/RBAC boundaries;
- scoped credentials;
- SSRF-safe/bounded resource fetches;
- immutable policy/audit behavior;
- spend reservations and stale-balance protection;
- approval separation;
- emergency stop;
- payment identity isolation;
- signer/facilitator capability separation;
- production HTTPS/secret guards;
- raw Cardano production signing-seed rejection;
- reconciliation/incident handling;
- CI/security/dependency validation configuration.

## Source implementation versus deployment facts

The repository implementing a feature means the code path/configuration contract exists. It does **not** by itself prove that every external provider credential, funded account or production dependency is currently configured in a particular deployment.

Examples of external deployment facts:

- real Mainnet custody provider URL/API key;
- funded external agent addresses;
- real Pyth/Masumi/KERIA credentials;
- published Dune query/dashboard IDs;
- exact release deployed to Vercel/Render;
- pilot/user activity.

These should be reported from the actual environment rather than fabricated from fixtures.

## Catalyst maturity/provenance

I am **Daniel Praise** (`Daniel419797`), the repository owner and primary technical contributor. I originally built AgentPay for the Hedera x402 bounty and subsequently extended it into the current multi-rail architecture.

For Catalyst I currently use **TRL 5** until the intended Cardano Mainnet/pilot configuration is demonstrated in a relevant environment. The Mainnet external per-agent custody implementation removes the prior code limitation, but source implementation alone is not a TRL 6 demonstration.

## Update summary

Updated 2026-08-22 to:

- record Mainnet external per-agent custody as implemented;
- preserve Mainnet self-custody as a separate supported mode;
- identify the actual primary builder;
- distinguish source capability from real deployment/pilot evidence;
- make signer versus facilitator responsibilities explicit;
- align the feature inventory with the merged code.