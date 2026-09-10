# AgentPay Cardano Signer

Isolated Cardano transaction-construction and signing gateway used by AgentPay's Cardano facilitator.

The service deliberately has no AgentPay organization/session database role and does not submit Cardano transactions on-chain.

## Topology

The production gateway hosts isolated network contexts for:

```text
cardano:preprod
cardano:mainnet
```

Network-prefixed routes include health, managed identity/signing, and unsigned transaction preparation.

## Responsibilities

The signer:

1. validates the requested network/payment construction context;
2. fetches payer UTxOs and protocol inputs from the correct Blockfrost network;
3. filters unsupported/unrelated assets;
4. selects bounded payer inputs;
5. creates the exact payee output plus payer-only change;
6. calculates fee/TTL/minimum output requirements;
7. hashes the transaction body;
8. signs using the configured profile when managed signing is requested;
9. verifies external Mainnet signatures locally;
10. returns signed/unsigned CBOR and transaction/nonce information.

The combined facilitator then independently parses/verifies the returned transaction, creates the durable settlement claim, submits, and checks confirmation evidence.

## Preprod managed identity

Preprod may use the signer-only test derivation secret to derive one deterministic Ed25519 identity per immutable Agent ID:

```text
Agent ID -> unique test seed -> public key -> addr_test1...
```

This derivation mechanism is test-profile-only.

## Mainnet self custody

Unsigned mode constructs the exact supported transaction for an externally controlled payer. The wallet/provider signs outside AgentPay.

## Mainnet external per-agent custody

The Mainnet worker may receive:

```text
CARDANO_AGENT_CUSTODY_URL
CARDANO_AGENT_CUSTODY_API_KEY
```

from the gateway's Mainnet-specific environment mapping.

Identity flow:

```text
POST /identity
 -> stable publicKeyHex + signerRef for exact Agent ID
 -> derive addr1... locally
```

Signing flow:

```text
build transaction
 -> BLAKE2b-256 transaction-body hash
 -> POST /sign with exact agent/signer/payer/message
 -> Ed25519 signature
 -> local signature verification
 -> signed CBOR
```

The private key remains in the external custody/HSM/KMS boundary. Mainnet fails closed on invalid identity, address mismatch, signer-ref/public-key drift, invalid signature, or provider outage. There is no shared-key fallback.

## Supported transaction shape

The signer is intentionally not a generic transaction API. It supports the bounded x402 payment profile documented in [`../docs/cardano-production.md`](../docs/cardano-production.md) and rejects unrelated scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data, third-party outputs, or unrelated native assets.

## Secrets

Use network-scoped Blockfrost/signer configuration. Keep Preprod derivation material and Mainnet custody capability isolated to this service. Production raw signing seeds and deployment-wide Mainnet managed-agent master keys are prohibited.

## Verification

Run the checked-in signer tests for the exact release and, for Mainnet external custody, verify multiple distinct agents plus invalid/unavailable custody responses before funding material value.

See [`../docs/managed-signer-isolation.md`](../docs/managed-signer-isolation.md), [`../docs/cardano-production.md`](../docs/cardano-production.md), and [`../docs/production-readiness.md`](../docs/production-readiness.md).
