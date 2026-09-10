# AgentPay Unified Facilitator

Public multi-rail facilitator used by AgentPay to expose the supported Hedera, Arc, and Cardano execution profiles behind one service boundary.

## Network namespaces

The deployed service mounts the configured child applications for:

```text
/hedera/testnet
/hedera/mainnet
/arc/testnet
/cardano/preprod
/cardano/mainnet
```

Capability discovery/health/readiness endpoints allow the control plane and operators to verify the exact profile that is configured.

## Responsibilities

For Hedera and Arc, the combined service delegates to the corresponding rail application.

For Cardano it additionally:

- calls the isolated Cardano signer for managed identity/signing or unsigned preparation;
- independently decodes and validates returned transaction CBOR;
- checks exact payer/payee/asset/amount, supported transaction shape, value conservation, payer change, fee, TTL, resource binding, nonce/replay state;
- maintains durable settlement-claim state;
- submits through Blockfrost;
- classifies confirmation, rejection, or ambiguous submission using independent chain evidence.

The facilitator does not hold the Cardano payer private key.

## Cardano signer relationship

```text
AgentPay control plane
 -> unified facilitator
 -> Cardano signer (construct/sign)
 -> unified facilitator (independent verify)
 -> Blockfrost submit/confirm
 -> AgentPay reconciliation
```

Network-scoped signer capability credentials and settlement capabilities are infrastructure authorization keys, not agent wallets.

## Ambiguous submission

If external submission may have occurred but the response is uncertain, retain the candidate/claim and return a pending/ambiguous result. Do not blindly submit a second transaction.

## Configuration

Use `.env.example` as the source configuration contract and keep each network/provider credential scoped to the minimum required capability.

See [`../docs/cardano-production.md`](../docs/cardano-production.md) and [`../docs/unified-production-deployment.md`](../docs/unified-production-deployment.md).
