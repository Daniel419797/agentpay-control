# Cardano Production Guide

**Updated:** 2026-09-10

## Supported profiles

AgentPay implements:

- `cardano:preprod`;
- `cardano:mainnet`.

The direct x402 profile uses V2 `exact`. ADA is represented as `lovelace`; an explicitly configured supported native-asset profile may also be enabled. Network/asset configuration must match the deployed environment exactly.

## Service responsibilities

### AgentPay control plane

Authenticates human/agent callers, resolves tenant and payment account, evaluates immutable policy/trust controls, handles approvals/reservations/idempotency, and stores intent/audit/reconciliation state. It does not hold Cardano payer private keys.

### Combined facilitator

- dispatches Preprod/Mainnet Cardano routes;
- calls the isolated signer for managed identity/signing or unsigned preparation;
- independently decodes/verifies signed CBOR;
- enforces supported transaction shape, payer/payee/asset/amount, conservation, change, fee, TTL, resource binding, replay and settlement-claim rules;
- submits through Blockfrost;
- verifies transaction/latest-block evidence and confirmation depth.

### Cardano signer

- resolves exact payer identity;
- fetches UTxO/protocol inputs needed for transaction construction;
- selects bounded payer inputs;
- calculates outputs, fee, TTL, and payer change;
- builds unsigned/signed CBOR;
- signs only according to the selected custody profile;
- never submits the transaction on-chain.

## Preprod managed custody

Preprod can use a signer-only test derivation secret to deterministically derive a different Ed25519 identity for each immutable Agent ID.

```text
Agent ID -> unique test seed -> public key -> addr_test1...
```

Relevant signer routes are namespaced under `/preprod/`, including health, managed identity/signing, and unsigned preparation.

## Mainnet self custody

AgentPay prepares the exact bounded unsigned transaction for the verified payer. The wallet/custody provider signs outside AgentPay. The returned signed transaction is still independently verified by the facilitator before submission.

## Mainnet external per-agent custody

The isolated Mainnet signer may be configured with:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

The external custody contract resolves a stable per-Agent-ID:

```text
POST /identity -> publicKeyHex + signerRef
POST /sign     -> Ed25519 signature for exact body hash
```

AgentPay derives the expected `addr1...` address locally from the public key. During signing, only the transaction-body hash is sent with the exact agent/signer/payer context. Returned signature and identity consistency are verified locally.

Private keys remain in the external custody/HSM/KMS boundary.

Mainnet does not accept a deterministic deployment-wide managed-agent master key or another agent's signer identity as fallback.

## Supported transaction profile

The transaction profile is deliberately narrow:

- key-spend transaction shape;
- payer-owned inputs only;
- exact payer and payee;
- exact authorized amount and asset;
- payer-only change;
- exact value/native-token conservation;
- bounded input count, fee, and TTL;
- canonical resource binding;
- no minting, scripts, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data, unrelated third-party outputs, or unrelated native assets.

Unsupported complexity is rejected rather than passed through to a generic transaction signer.

## Resource binding

Cardano x402 requirements bind the canonical paid-resource URL:

```text
resourceBinding = SHA256(canonical resource URL)
```

A proof intended for one resource cannot be reused for a different resource solely because price/payee happen to match.

## Replay and settlement claims

Before submission, the facilitator validates nonce/UTxO state and creates a durable claim for the authorized candidate. Competing/conflicting claims are rejected.

## Submission and confirmation

```text
signer -> signed CBOR
 -> facilitator independent verification
 -> durable settlement claim
 -> mark submission started
 -> Blockfrost /tx/submit
 -> Cardano
 -> Blockfrost transaction + latest block evidence
 -> confirmation decision
```

## Ambiguous submission

If a timeout/transport error occurs after submission could have happened:

- keep the candidate transaction identifier/CBOR evidence;
- retain the settlement claim and spend reservation as required;
- mark pending/`SUBMISSION_UNKNOWN`;
- query independent chain evidence;
- do not blindly construct or submit a second payment.

## Blockfrost usage

The signer uses the correct network project for construction inputs such as UTxOs/protocol data. The facilitator uses the correct network project for submission and confirmation evidence. Preprod and Mainnet credentials must not be mixed.

## Policy and trust before signing

The control plane can require:

- atomic spend policy;
- Pyth conservative USD valuation;
- Masumi counterparty/capability/payment identity evidence;
- observed Masumi escrow history/reputation;
- optional Veridian/KERIA credential evidence;
- human approval.

The facilitator validates transaction/protocol correctness rather than rerunning the complete organization policy engine.

## Secret placement

- Vercel: no Cardano payer private keys, test derivation secrets, or Mainnet custody credentials.
- Cardano signer: network-scoped signer capability; Preprod test secret if enabled; Mainnet custody API capability if enabled.
- Facilitator: protocol/submission capabilities, never Cardano payer private key.
- External custody: managed Mainnet private keys.

Production provider/custody endpoints must use HTTPS and scoped credentials.

## Readiness checklist

Before enabling a profile:

1. run exact-commit tests/build/security gates;
2. apply required database migrations;
3. deploy signer and facilitator from the same reviewed release;
4. verify network-specific `/health`/`/ready` paths;
5. verify Blockfrost network mapping;
6. for Mainnet managed custody, resolve multiple Agent IDs and confirm distinct stable identities;
7. fund only deliberately selected low-value payer identities;
8. execute a canary using normal AgentPay policy/approval flow;
9. independently verify payer, payee, asset, amount, and transaction on-chain;
10. test provider/custody failure and ambiguous submission behavior.

See [`production-runbook.md`](production-runbook.md) for operational rollout.
