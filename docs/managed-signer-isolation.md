# AgentPay Managed Signer and Payment-Identity Isolation

**Status:** Current implementation  
**Updated:** 2026-08-22

## Revision note

AgentPay now supports Cardano Mainnet autonomous managed agents through external per-agent Ed25519 custody. The isolation rule applies consistently across Hedera, Arc and Cardano, and the documentation no longer treats Cardano Mainnet as self-custody-only.

## Core invariant

A shared service is permitted. A shared managed-agent payment identity is not.

```text
(network, canonical account identity)
          -> one PaymentAccount
          -> one agent
```

The same blockchain payment identity must not be assigned to two agents, including agents in different organizations or concurrent application replicas.

## Database enforcement

Migration `20260821080000_payment_identity_isolation` enforces the invariant with:

- canonical identity normalization;
- a unique canonical identity index;
- a transaction-scoped PostgreSQL advisory lock for competing claims.

If legacy duplicate identities exist, migration or provisioning must fail closed. Historical settlement evidence is retained; affected managed agents are archived or reprovisioned rather than having past payer evidence rewritten.

## Current managed identity modes

### Hedera Testnet

Each managed agent receives a distinct Ed25519 identity or account. The testnet derivation secret remains isolated to the appropriate service.

### Arc Testnet

Each managed agent receives a distinct secp256k1 address. Infrastructure relayer or contract-execution keys are not agent wallets.

### Cardano Preprod

Each managed agent receives a distinct Ed25519 payment identity and address derived inside the isolated signer from the testnet-only master secret.

```text
immutable Agent ID
  -> signer-only derivation
  -> unique Ed25519 key
  -> unique addr_test1...
```

### Cardano Mainnet

When autonomous managed custody is enabled, each immutable Agent ID resolves to a distinct external Ed25519 public key and signer reference.

```text
Agent ID
  -> external custody /identity
  -> publicKeyHex + signerRef
  -> AgentPay derives addr1... locally
  -> unique PaymentAccount
```

There is no Cardano Mainnet managed-agent master key or deployment-wide autonomous-agent payer.

Self-custody Mainnet wallets remain supported separately.

## Testnet master secrets

The deterministic managed-agent master secrets are testnet-only:

```text
HEDERA_MANAGED_AGENT_MASTER_KEY
ARC_MANAGED_AGENT_MASTER_KEY
CARDANO_MANAGED_AGENT_MASTER_KEY
```

They must:

- be independent from one another;
- contain 32 cryptographically random bytes encoded as canonical unpadded base64url;
- remain on the appropriate signer or facilitator service;
- never be copied to Vercel;
- never be configured on a Mainnet service.

## Cardano Mainnet custody boundary

Signer-only configuration:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

The external provider is a separate deployment and security boundary and implements:

```text
POST /identity
POST /sign
```

AgentPay accepts public identity material only. Private keys remain external.

Before signing, AgentPay verifies that the externally resolved public key derives the expected Cardano Mainnet payer address. During signing, only the transaction-body hash is sent to the exact signer reference. Returned signatures are verified locally.

The following are forbidden fallbacks:

- shared Mainnet hot wallet;
- deterministic Mainnet master key;
- another agent's signer reference;
- deployment-wide payer;
- accepting a changed public key or signer reference without failure.

## Dedicated routes

Managed-agent identity and signing uses dedicated routes rather than a shared deployment-wide signing identity:

```text
/managed-identity
/managed-agent-sign
```

For Cardano these routes are network-namespaced by the combined facilitator and signer topology.

The old generic shared `/managed-sign` path is deliberately disabled for the isolated-agent model.

## Infrastructure identities are not agent wallets

Service principals such as:

- Hedera operator or fee payer;
- Arc relayer or contract executor;
- settlement-store capability;
- Cardano facilitator and signer API credentials;

must never be copied into an agent's `PaymentAccount.accountId` merely because they exist in the same deployment.

## Concurrency behavior

Provisioning two agents concurrently with the same canonical identity must result in at most one successful identity claim. Application-level prechecks are not sufficient; the database-level lock and unique constraint are the authoritative protection.

## Failure behavior

Identity and custody errors fail closed. In particular:

- duplicate canonical identity -> provisioning rejected;
- Mainnet custody unavailable -> managed provisioning or signing unavailable;
- invalid external public key -> rejected;
- externally claimed address mismatch -> rejected;
- returned signer reference mismatch -> rejected;
- returned public-key mismatch -> rejected;
- invalid Ed25519 signature -> rejected.

No failure path may silently assign or sign with a different agent's identity.

## Operational verification

Before enabling managed agents on a release and profile:

1. run the concurrent identity-isolation verification against a disposable database;
2. provision two distinct agents;
3. verify they receive distinct canonical identities;
4. for Cardano Mainnet, verify distinct `publicKeyHex`, `signerRef` and locally derived `addr1...` values;
5. verify signer and custody capability credentials are isolated from Vercel;
6. execute a low-value transaction for the intended profile;
7. test custody-provider failure and confirm no shared fallback occurs.

## Update provenance

This document was updated after the Cardano Mainnet external per-agent custody implementation was merged. The documented isolation invariant now matches the current code and no longer implies that autonomous managed identities stop at testnet.

Primary builder: **Daniel Praise** (`Daniel419797`).