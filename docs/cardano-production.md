# AgentPay Cardano Production Guide

**Status:** Current implementation  
**Updated:** 2026-08-22

## Revision note

Cardano Mainnet is no longer self-custody-only in source. AgentPay now implements a separate external per-agent Ed25519 custody path while retaining self custody. This guide reflects the current signer, facilitator and control-plane implementation and clarifies which service constructs, signs, verifies, submits and reconciles transactions.

## Supported Cardano networks

- `cardano:preprod`
- `cardano:mainnet`

The x402 profile is V2 `exact`. ADA is represented as `lovelace`. One explicitly configured native asset may be enabled; Mainnet USDCx must match the configured canonical Cardano asset identity.

## Service responsibilities

### AgentPay control plane: Vercel

- authenticates users and agents;
- evaluates immutable policy and trust controls;
- creates spend reservations;
- handles approvals and idempotency;
- stores payment intent, audit and reconciliation state;
- never holds Cardano private keys, testnet master secrets or Mainnet custody API credentials.

### Combined facilitator: Render

- exposes Cardano Preprod and Mainnet x402 protocol endpoints;
- dispatches `/managed-identity` and `/managed-agent-sign` to the isolated signer;
- independently decodes and verifies signed Cardano CBOR;
- enforces exact transaction shape and replay and claim rules;
- submits transactions through Blockfrost;
- polls Cardano evidence and confirmation depth;
- records durable settlement-claim transitions.

The facilitator does **not** hold the Cardano payer private key.

### Cardano signer gateway: Render web service

One public gateway starts isolated Preprod and Mainnet workers.

The signer:

- fetches UTxOs and protocol data needed for construction;
- selects bounded inputs;
- calculates fee, TTL and change;
- builds unsigned or signed CBOR;
- handles per-agent signing identity;
- does **not** submit Cardano transactions on-chain.

## Preprod custody

Preprod managed agents use a signer-only deterministic testnet secret:

```text
CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY
```

The secret must be 32 cryptographically random bytes encoded as canonical unpadded base64url. It is used only inside the Preprod signer to derive a distinct Ed25519 identity for each immutable Agent ID.

```text
Agent ID -> unique seed -> unique public key -> unique addr_test1...
```

Dedicated routes:

```text
/preprod/managed-identity
/preprod/managed-agent-sign
/preprod/unsigned
```

## Mainnet custody

Cardano Mainnet supports two parallel modes.

### Self custody

AgentPay builds the narrow unsigned transaction for the exact verified wallet. The wallet or provider signs outside AgentPay.

### External per-agent managed custody

Mainnet managed autonomy uses:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

These values exist only on the isolated Cardano signer.

Mainnet explicitly rejects deterministic managed-agent master-key custody. `CARDANO_MANAGED_AGENT_MASTER_KEY` is testnet-only.

The external adapter contract is:

```text
POST /identity
POST /sign
```

### `/identity`

Input binds the immutable Agent ID, network, Ed25519 algorithm and Cardano payment purpose.

The provider returns a stable:

```text
publicKeyHex
signerRef
```

AgentPay derives the corresponding `addr1...` payer address locally. If the provider returns a claimed payer or account address, it must equal the locally derived address.

### `/sign`

After AgentPay constructs the transaction, only the transaction-body hash is sent to the provider with the exact Agent ID, signer reference and payer address.

The returned signature is rejected if:

- it is not a valid Ed25519 signature encoding;
- signer reference changes;
- returned public key changes;
- it does not verify against the resolved public key and body hash.

Private keys never enter AgentPay.

Dedicated Mainnet routes:

```text
/mainnet/managed-identity
/mainnet/managed-agent-sign
/mainnet/unsigned
```

The generic or shared managed-sign route remains disabled. `unsigned-only` and dedicated per-agent external custody intentionally coexist.

## Cardano transaction profile

The supported direct x402 transaction is deliberately narrow:

- key-spend and phase-1 shape;
- payer-only inputs;
- exact payee;
- exact quoted amount;
- exact allowed asset;
- payer-only change;
- bounded input count;
- bounded fee and TTL;
- no scripts;
- no minting;
- no certificates;
- no withdrawals;
- no collateral;
- no bootstrap witnesses;
- no auxiliary data;
- no unrelated native assets or third-party outputs.

For an enabled native asset, token conservation must be exact.

## Resource binding

Every Cardano x402 requirement must bind the canonical paid-resource URL:

```text
resourceBinding = SHA256(canonical resource URL)
```

A transaction or requirement accepted for one resource cannot be reused for another resource merely because payee and amount happen to match.

## UTxO nonce and replay protection

Durable settlement identity includes the complete resource-bound requirement, payer and UTxO nonce. The facilitator verifies that a new claim is not a conflicting replay and that an unclaimed nonce still refers to an available input before accepting the candidate transaction.

## Submission and confirmation

The actual chain path is:

```text
Cardano signer
  -> signed CBOR
  -> Cardano facilitator
  -> independent transaction verification
  -> durable settlement claim
  -> Blockfrost /tx/submit
  -> Cardano
  -> Blockfrost transaction/latest-block evidence
  -> confirmation decision
```

The signer itself never performs `/tx/submit`.

## Ambiguous submissions

A timeout, 5xx or uncertain provider response after possible submission does not prove failure.

```text
SUBMISSION_STARTED
  -> uncertain response
  -> keep candidate transaction + claim + spend reservation
  -> SUBMISSION_UNKNOWN / payment pending
  -> independently query chain evidence
```

The system must not blindly resubmit an ambiguous transaction.

## Blockfrost usage

Blockfrost is used for two distinct purposes:

- **Signer:** address UTxOs and protocol and chain construction inputs.
- **Facilitator:** transaction submission, transaction evidence, latest block and confirmation depth.

Use separate Preprod and Mainnet project IDs for the correct networks.

## Policy and trust integrations

Before signing, the control plane may require:

- atomic spend policy;
- Pyth conservative USD valuation;
- Masumi verified counterparty, capability and payment-key evidence;
- observed Masumi escrow history and reputation;
- optional Veridian/KERIA verified credential evidence;
- human approval.

These controls live in the AgentPay control plane. The facilitator enforces protocol and transaction validity rather than re-running the organization policy engine.

## Production environment invariants

- HTTPS for production provider and custody URLs.
- Raw Cardano signing seeds prohibited in production.
- Mainnet managed-agent master key prohibited.
- Preprod and Mainnet signer API keys distinct.
- Mainnet custody API key distinct from signer and facilitator capabilities.
- Mainnet custody credentials only on the signer.
- Vercel contains no blockchain private keys or managed-agent master secrets.

## Verification before enabling a profile

For the exact release and profile being operated:

1. execute repository tests and builds on the exact release SHA;
2. deploy signer, facilitator and dashboard from that release;
3. verify `/health` and `/ready` responses;
4. configure the correct Blockfrost network credentials;
5. for Mainnet managed custody, resolve at least two Agent IDs and confirm distinct public identities and addresses;
6. fund only deliberate low-value agent addresses;
7. exercise a low-value transaction through the intended custody mode;
8. independently confirm payer, payee, asset, amount and transaction on chain;
9. exercise provider and custody failure behavior and ensure it fails closed.

## Documentation provenance

This document reflects the implementation current as of 2026-08-22, including Cardano Mainnet external per-agent custody. It removes obsolete wording that Mainnet autonomous signing is only a future design while still distinguishing source support from a demonstrated production or pilot configuration.

For Catalyst purposes, AgentPay is described conservatively as **TRL 5** until the intended Mainnet and pilot configuration has been demonstrated in a relevant environment.