# Managed Signer and Payment-Identity Isolation

**Updated:** 2026-09-10

## Purpose

Managed payment execution requires infrastructure shared by many organizations and agents without sharing the actual autonomous payer identity. AgentPay therefore separates service identity from agent payment identity.

## Core invariant

```text
(network, canonical payment identity)
        -> exactly one PaymentAccount
        -> exactly one agent
```

A facilitator, signer process, database, or provider service may be multi-tenant. A managed-agent blockchain payer may not be assigned to multiple agents.

## Database enforcement

The payment-identity isolation migration and provisioning logic use:

- network-aware canonical normalization;
- a unique canonical identity constraint/index;
- transaction-scoped PostgreSQL advisory locking around competing claims.

Application prechecks improve errors but are not the concurrency authority; the database constraint remains final.

Legacy duplicate identities are not repaired by rewriting historical settlement evidence. Conflicting managed agents must be retired/reprovisioned under new identities.

## Hedera Testnet

Managed agents receive distinct Ed25519 test identities/accounts. Infrastructure operator or fee-payer credentials are service principals, not agent accounts.

## Arc Testnet

Managed agents receive distinct secp256k1 addresses. Relayer/contract-executor identities are infrastructure capabilities and must never be copied into an agent `PaymentAccount` as though they were its wallet.

## Cardano Preprod

The isolated signer derives one Ed25519 identity per immutable Agent ID from a signer-only test secret:

```text
Agent ID -> deterministic test derivation -> public key -> addr_test1...
```

The derivation secret never belongs in Vercel and is never valid for Mainnet.

## Cardano Mainnet

Mainnet offers two separate custody modes:

### Self custody

AgentPay prepares a bounded transaction for the verified payer; the user's/provider's wallet signs outside AgentPay.

### External per-agent managed custody

```text
Agent ID
 -> custody /identity
 -> stable publicKeyHex + signerRef
 -> AgentPay derives addr1... locally
 -> unique PaymentAccount
```

For signing, AgentPay sends the exact Agent ID, signer reference, payer address, and transaction-body hash. It rejects public-key/signer-reference drift and verifies the returned Ed25519 signature locally.

There is no deployment-wide Mainnet managed-agent master signing key and no fallback to another agent's identity.

## Test-only master secrets

Managed derivation secrets used for test profiles must be:

- independent per rail;
- cryptographically random at creation;
- stored only in the service requiring them;
- excluded from browser/control-plane logs;
- prohibited from Mainnet custody profiles.

## Moove account binding

Moove Receive is not a per-agent blockchain wallet model. The Moove API credential represents an account whose settlement destination is configured at the Moove account level.

AgentPay therefore uses a different isolation rule for this rail:

```text
one deployed Moove account credential -> one AgentPay organization
```

Agents inside that organization can receive only through authorization/scoping rules. Sibling organizations cannot use the credential or attach their invoices/resources to its links.

## Stripe/provider identities

Stripe cardholder/card/financial-account identifiers are provider resources, not blockchain managed payment identities. They remain organization-scoped and access-controlled, but are not inserted into the blockchain `PaymentAccount` uniqueness model.

## Failure behavior

Fail closed on:

- duplicate canonical blockchain identity;
- mismatched network/address normalization;
- Mainnet custody outage;
- invalid custody public key;
- claimed Cardano address mismatch;
- changed signer reference/public key;
- invalid returned signature;
- use of test master secrets in prohibited production/Mainnet profiles;
- Moove organization/account binding mismatch.

## Rotation and retirement

Credential rotation must distinguish:

- application credential rotation;
- infrastructure API-key rotation;
- external custody capability rotation;
- managed payment-identity replacement.

Rotating a service credential should not rewrite historical payer identity. Replacing a managed payment identity creates/attaches a new canonical identity while preserving old settlement evidence for audit and reconciliation.

## Verification

Before enabling a managed profile:

1. run the concurrent identity-isolation test against a disposable database;
2. provision at least two agents and confirm distinct canonical identities;
3. verify service/operator credentials are not represented as agent wallets;
4. for Cardano Mainnet managed custody, confirm distinct stable `publicKeyHex`, `signerRef`, and derived `addr1...` values;
5. test custody/provider failure and verify no shared fallback;
6. perform a deliberate low-value canary before material funding.
