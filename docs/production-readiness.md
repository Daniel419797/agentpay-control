# AgentPay Production Readiness

**Status:** Current release/readiness criteria  
**Updated:** 2026-08-22

> **Why this document was updated:** AgentPay has already been deployed and personally exercised in supported environments. This document is not evidence that the project is undeployed or untested. It defines the checks for deciding whether a **specific release, network and custody profile** is ready for production operation. It was synchronized after Cardano Mainnet external per-agent custody was implemented so old self-custody-only assumptions no longer appear as current architecture.

## What this document testifies to

AgentPay source includes implemented payment, policy, signing, verification, reconciliation and operational controls. A production-readiness decision answers a narrower question:

> Is this exact release, with this exact network/custody/provider configuration, ready to carry the intended production workload?

That decision is separate from whether I have deployed and tested AgentPay before.

## Release decision

A specific profile is eligible for production operation when:

1. required repository checks execute successfully on the exact immutable release SHA;
2. the enabled services are deployed from that release/image digest;
3. the real credentials/providers/custody required by that profile are configured;
4. required low-value operational checks for that profile have been exercised; and
5. `/api/v1/ready` reports ready for the configured profile.

A previous green build does not prove a later commit.

## Repository validation gates

The applicable release candidate should execute:

- forward-only PostgreSQL migrations;
- global payment-identity isolation verification, including concurrent duplicate claims;
- resource endpoint/canonicalization checks;
- governance invariants;
- dashboard lint, typecheck, unit tests and production build;
- required browser/Playwright smoke tests;
- Hedera facilitator tests/build;
- Arc facilitator tests/build;
- combined facilitator tests/build;
- Cardano signer tests/image build;
- resource-server tests/build/image build;
- CodeQL/dependency review and any required release-blocking security checks.

A workflow that fails before executable steps are created is **infrastructure-blocked**, not a pass and not an application-test failure.

## Current payment-identity model

A shared service is acceptable; a shared managed-agent wallet/private key is not.

```text
(network, canonical account identity) -> one PaymentAccount -> one agent
```

Current managed modes:

- Hedera Testnet: distinct Ed25519 account per agent;
- Arc Testnet: distinct secp256k1 address per agent;
- Cardano Preprod: distinct Ed25519 address per agent derived inside the isolated signer;
- Cardano Mainnet: distinct external Ed25519 identity per agent when external custody is enabled.

Cardano Mainnet also supports self-custody in parallel.

## Cardano custody readiness

### Preprod managed

The signer derives the exact Agent ID's testnet identity using a signer-only testnet master secret.

### Mainnet self custody

AgentPay prepares the exact narrow transaction for a verified wallet and the wallet/provider signs externally.

### Mainnet autonomous managed custody

The implemented Mainnet signer uses a configured external custody adapter to resolve one Ed25519 `publicKeyHex`/`signerRef` per immutable Agent ID. AgentPay derives the `addr1...` address locally, sends only the transaction-body hash for signing and verifies the returned signature locally.

Mainnet deliberately rejects `CARDANO_MANAGED_AGENT_MASTER_KEY` and raw production signing seeds.

Before enabling this profile operationally, verify:

- custody URL/API key are signer-only;
- HTTPS is used;
- at least two Agent IDs resolve to distinct stable public identities and addresses;
- returned signatures verify locally;
- provider outage/invalid-signature tests fail closed;
- no shared-key/platform-payer fallback exists.

## Cardano direct x402 readiness

The current implementation requires:

- exact network (`cardano:preprod` or `cardano:mainnet`);
- x402 scheme `exact`;
- canonical resource SHA-256 binding;
- exact payer/payee/asset/amount;
- ADA (`lovelace`) or only the explicitly configured native asset;
- payer-only inputs/change;
- asset conservation;
- bounded fee/TTL/input count;
- no scripts/minting/certificates/withdrawals/collateral/bootstrap witnesses/auxiliary data/unrelated third-party outputs.

The signer constructs. The facilitator independently verifies. The facilitator submits through Blockfrost and confirms using independent chain evidence.

## Ambiguous settlement readiness

Possible submission must be durably recorded before external side effect. A timeout or uncertain response after submission does not become a clean retryable failure.

Expected behavior:

```text
possible submission
  -> preserve candidate transaction/claim/reservation
  -> SUBMISSION_UNKNOWN or pending
  -> independent reconciliation
  -> confirmed / definitively rejected / remain unresolved
```

Blind resubmission is not allowed.

## Common control-plane readiness

Production configuration should verify:

- correct `APP_ENV` and public origin;
- strong application/session secrets;
- managed PostgreSQL availability;
- scoped/revocable agent credentials;
- server-side RBAC and tenant isolation;
- immutable/hash-linked audit behavior;
- SSRF protection and bounded outbound responses;
- encrypted sensitive data where applicable;
- emergency stop behavior;
- approval separation where configured;
- stale-balance/spend-reservation protection;
- backups/restore capability appropriate to the deployment;
- incident/reconciliation procedures.

## Pyth readiness

When Pyth-valued policy is enabled:

- correct feed IDs/provider access configured;
- fresh/confidence-bounded observation succeeds;
- stale/future/non-positive/wide-confidence cases fail closed;
- failure does not relax atomic policy.

## Masumi readiness

When Masumi trust/escrow is enabled:

- correct Registry network/source configuration;
- seller identity/capability/payment-key verification exercised;
- Payment Service credential/configuration valid for escrow;
- successful purchase lifecycle reconciled;
- result-hash verification exercised;
- refund/dispute path reviewed;
- reputation policy based only on observed AgentPay-linked outcomes.

## Veridian/KERI readiness

When required by policy:

- reviewed KERIA verification endpoint configured;
- trusted issuer/schema sets defined;
- valid credential/identity binding exercised;
- stale/revoked/expired/untrusted/mismatched cases fail closed.

## Dune readiness

Dune is optional public observability. If presented as part of the operating/demo profile:

- real query/dashboard IDs should be configured;
- at least one known transaction should be cross-checked;
- only public-chain facts should be exposed;
- Dune must remain outside payment authorization/signing/settlement.

## Deployment topology readiness

Current canonical deployment topology:

```text
Vercel
  -> AgentPay dashboard/API

Render
  -> agentpay-facilitator
  -> agentpay-cardano-signer
       -> Preprod worker
       -> Mainnet worker
            -> optional external per-agent custody

External
  -> PostgreSQL
  -> Blockfrost
  -> x402 resource providers
  -> Pyth / Masumi / KERIA / Dune as enabled
```

Cardano Mainnet custody API credentials remain on the signer, not the facilitator/dashboard.

## Catalyst maturity statement

I am **Daniel Praise** (`Daniel419797`), repository owner and primary technical contributor. For Catalyst I currently state **TRL 5**. The reason is not that AgentPay has never been deployed or tested; it is that the TRL 6 claim should follow a documented relevant-environment demonstration of the intended Mainnet/pilot profile. The code now implements Mainnet external per-agent custody, removing the earlier technical limitation, but implementation alone does not manufacture that demonstration.

## Update summary

Updated on 2026-08-22 to:

- acknowledge prior deployment/testing explicitly;
- reflect implemented Cardano Mainnet external per-agent custody;
- preserve self-custody as a parallel mode;
- assign transaction construction to the signer and submission/confirmation to the facilitator;
- clarify that readiness applies to an exact release/profile rather than the existence of the product;
- keep Catalyst TRL wording conservative and evidence-based.