# AgentPay Cardano Signer

**Status:** Current implementation  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

This service is the isolated Cardano transaction-builder/signing gateway used by the combined x402 facilitator. It deliberately has no application database access and no AgentPay operator/session credentials.

## Service topology

The canonical production service is a Render **web-service gateway**. It starts separate internal workers for:

```text
cardano:preprod
cardano:mainnet
```

The public gateway exposes network-prefixed routes such as:

```text
/preprod/health
/preprod/managed-identity
/preprod/managed-agent-sign
/preprod/unsigned

/mainnet/health
/mainnet/managed-identity
/mainnet/managed-agent-sign
/mainnet/unsigned
```

The workers use distinct network-scoped Blockfrost and signer credentials.

## Trust boundary

The control plane sends policy-authorized payment requirements through the facilitator. For Cardano, the signer receives the exact network, payer, payee, asset/amount, resource-bound requirement and `submissionMode: server` needed to construct the supported transaction.

The signer supports deliberately narrow transaction shapes:

- **ADA:** x402 asset `lovelace`; eligible payer inputs are ADA-only.
- **Configured native token:** exactly the configured `CARDANO_USDCX_ASSET_ID` unit plus lovelace; unrelated native assets are not eligible.

The signer:

1. fetches protocol/chain construction data and payer UTxOs from Blockfrost;
2. filters UTxOs so unrelated assets cannot be consumed;
3. selects bounded payer inputs;
4. creates one exact payee transfer plus payer-only change;
5. calculates fee, TTL and required output/change values;
6. hashes the transaction body with BLAKE2b-256;
7. obtains the appropriate Ed25519 signature when managed signing is used;
8. verifies external signatures locally;
9. returns signed or unsigned CBOR plus the consumed UTxO nonce/transaction identity.

**The signer does not submit Cardano transactions on-chain.** The combined facilitator independently decodes/verifies the returned CBOR, manages replay/settlement claims, submits through Blockfrost and reconciles confirmation evidence.

## Cardano Preprod managed custody

Managed Preprod identities use a signer-only testnet secret:

```text
CARDANO_MANAGED_AGENT_MASTER_KEY
```

In the unified production gateway it is supplied from:

```text
CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY
```

A unique Ed25519 payment identity is deterministically derived from the immutable Agent ID:

```text
Agent ID -> unique seed -> public key -> addr_test1...
```

This deterministic master-key mechanism is testnet-only.

## Cardano Mainnet custody

Mainnet supports two parallel modes.

### Self custody

`CARDANO_SIGNING_MODE=unsigned-only` prepares the exact narrow transaction. The wallet/provider signs outside AgentPay.

### External per-agent managed custody

The Mainnet worker receives these child-process values from the unified gateway:

```text
CARDANO_AGENT_CUSTODY_URL
CARDANO_AGENT_CUSTODY_API_KEY
```

The gateway obtains them from:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

There is no Mainnet `CARDANO_MANAGED_AGENT_MASTER_KEY` and no deployment-wide managed-agent payer private key.

### Identity resolution

The signer calls:

```text
POST <CARDANO_AGENT_CUSTODY_URL>/identity
```

with the immutable Agent ID, `cardano:mainnet`, Ed25519 algorithm and Cardano-payment purpose.

The adapter returns a stable per-agent identity:

```json
{
  "publicKeyHex": "<32-byte Ed25519 public key>",
  "signerRef": "<provider-specific per-agent key reference>"
}
```

AgentPay derives `addr1...` locally from `publicKeyHex`. If the provider also returns `payerAddress`/`accountId`, it must match the locally derived address.

### Body-hash signing

After the transaction is built, the signer calls:

```text
POST <CARDANO_AGENT_CUSTODY_URL>/sign
```

with:

```json
{
  "network": "cardano:mainnet",
  "agentId": "<immutable Agent ID>",
  "signerRef": "<resolved signer reference>",
  "payerAddress": "<locally derived addr1...>",
  "algorithm": "Ed25519",
  "messageHex": "<32-byte transaction-body hash>",
  "purpose": "cardano-transaction-body"
}
```

The adapter returns an Ed25519 signature. If it repeats `signerRef` or `publicKeyHex`, those values must match the identity already resolved for the Agent ID. AgentPay verifies the returned signature locally before accepting the signed CBOR.

The private key never enters AgentPay.

## Fail-closed Mainnet rules

Managed Mainnet signing is rejected when:

- the custody URL/key pair is incomplete;
- the external identity/public key is invalid;
- the provider-claimed address differs from AgentPay's local derivation;
- the signer reference changes;
- the public key changes;
- the returned signature is invalid;
- the provider is unavailable.

There is no fallback to a shared hot wallet, another agent identity or deterministic Mainnet master key.

## Legacy non-agent remote signer

The generic non-agent `/sign` path can still use an explicitly configured isolated remote signer:

```text
CARDANO_PAYMENT_PUBLIC_KEY_HEX
CARDANO_ED25519_SIGNER_URL
CARDANO_ED25519_SIGNER_API_KEY
```

This is separate from the per-agent Mainnet custody model. Production rejects raw `CARDANO_SIGNING_SEED_HEX`.

## Required environment

All worker deployments require:

```text
APP_ENV
CARDANO_NETWORK
CARDANO_BLOCKFROST_URL
CARDANO_BLOCKFROST_PROJECT_ID
CARDANO_SIGNER_API_KEY
```

Additional values depend on the selected mode:

- Preprod managed agent: `CARDANO_MANAGED_AGENT_MASTER_KEY`.
- Mainnet external managed agent: `CARDANO_AGENT_CUSTODY_URL` + `CARDANO_AGENT_CUSTODY_API_KEY`.
- self custody: no managed private-key source is required.
- optional native token: `CARDANO_USDCX_ASSET_ID`.

Transaction limits include:

```text
CARDANO_MIN_OUTPUT_LOVELACE
CARDANO_TOKEN_OUTPUT_LOVELACE
CARDANO_MIN_CHANGE_LOVELACE
CARDANO_MAX_INPUTS
```

Do not guess the Mainnet native-asset identity. Treat it as a verified deployment fact.

## Funding guidance

Fund only the specific agent/self-custody address intended for a test or operation. ADA payments should use eligible ADA-only UTxOs. Token payments should use UTxOs containing only lovelace plus the exact configured native asset; UTxOs containing additional native assets are ignored.

## Validation

Run the checked-in signer tests and build path for the exact release. The repository also contains the Cardano signer GitHub Actions workflow and production image build.

For a Mainnet external-custody profile, additionally verify at least two Agent IDs resolve to distinct stable public keys/signer references/addresses and exercise an invalid/unavailable custody response to confirm fail-closed behavior.

See [`../docs/cardano-production.md`](../docs/cardano-production.md), [`../docs/managed-signer-isolation.md`](../docs/managed-signer-isolation.md) and [`../docs/production-readiness.md`](../docs/production-readiness.md).