# AgentPay Cardano signer

This service is the isolated Cardano transaction-builder/signing gateway used by the combined x402 facilitator. It deliberately has no application database access and no AgentPay operator/session credentials.

## Trust boundary

The dashboard sends only public Cardano payer identity and policy-approved payment requirements to the facilitator. The facilitator calls this signer with the exact `cardano:*` network, exact payer, exact payee, exact asset/amount, timeout, and `submissionMode: server`.

The signer supports two deliberately narrow transaction shapes:

- **ADA:** x402 asset `lovelace`. Inputs must be ADA-only.
- **USDCx:** exactly one configured Cardano native-asset unit in `CARDANO_USDCX_ASSET_ID`. Inputs may contain only lovelace plus that exact token. No other native asset is eligible.

The signer:

1. fetches live protocol parameters, latest slot, and payer UTxOs from Blockfrost;
2. filters UTxOs so unrelated native assets can never be consumed;
3. constructs a simple phase-1 transaction with one exact payee asset amount and payer-only change;
4. for token payments, adds only the configured minimum ADA to the payee output and returns token change only to the payer;
5. calculates the minimum linear fee from current protocol parameters and pays that fee only in ADA;
6. hashes the transaction body with true BLAKE2b-256;
7. obtains an Ed25519 signature;
8. verifies that signature locally against the expected public key;
9. returns signed CBOR plus the first consumed UTxO as the x402 nonce.

The combined facilitator independently decodes and verifies the returned CBOR before it can submit anything. A compromised signer therefore cannot add a third-party output, introduce an unapproved native asset, change the payee/amount/network, mint assets, exceed the configured fee ceiling, or extend the TTL outside the payment requirement without the facilitator rejecting it.

## Per-agent custody

### Cardano Preprod

Managed Preprod identities use `CARDANO_MANAGED_AGENT_MASTER_KEY` inside the isolated signer. A unique Ed25519 payment identity is deterministically derived from the immutable Agent ID. This master-key mechanism is testnet-only and remains prohibited on Mainnet.

### Cardano Mainnet

Mainnet supports both self-custody and autonomous per-agent external custody.

Ordinary self-custody remains `CARDANO_SIGNING_MODE=unsigned-only`: AgentPay prepares the transaction and the wallet owner signs it.

Autonomous Mainnet managed agents use a separate external custody adapter configured with:

- `CARDANO_AGENT_CUSTODY_URL`: HTTPS base URL of the HSM/KMS/delegation adapter.
- `CARDANO_AGENT_CUSTODY_API_KEY`: signer-only capability credential, distinct from `CARDANO_SIGNER_API_KEY`.

There is no Mainnet `CARDANO_MANAGED_AGENT_MASTER_KEY` and no deployment-wide payer private key.

For identity resolution AgentPay sends:

```json
{
  "network": "cardano:mainnet",
  "agentId": "<immutable Agent ID>",
  "algorithm": "Ed25519",
  "purpose": "cardano-payment"
}
```

to `POST <CARDANO_AGENT_CUSTODY_URL>/identity`. The adapter must return a stable, agent-specific identity:

```json
{
  "publicKeyHex": "<32-byte Ed25519 public key>",
  "signerRef": "<provider-specific per-agent key reference>"
}
```

`payerAddress` or `accountId` may also be returned. When present it must match the Cardano address AgentPay derives locally from `publicKeyHex`.

For signing, AgentPay sends only the already-built transaction-body hash plus the resolved agent identity to `POST <CARDANO_AGENT_CUSTODY_URL>/sign`:

```json
{
  "network": "cardano:mainnet",
  "agentId": "<immutable Agent ID>",
  "signerRef": "<resolved signer reference>",
  "payerAddress": "<derived Cardano address>",
  "algorithm": "Ed25519",
  "messageHex": "<32-byte Cardano transaction-body hash>",
  "purpose": "cardano-transaction-body"
}
```

The adapter returns:

```json
{ "signatureHex": "<64-byte Ed25519 signature>" }
```

It may repeat `signerRef` and `publicKeyHex`; if it does, AgentPay requires them to match the identity resolved for that Agent ID. AgentPay then verifies the Ed25519 signature locally before returning transaction CBOR. The private key never enters AgentPay.

## Legacy single-payer remote signer

The generic non-agent `/sign` path still supports the existing isolated remote signer configuration when explicitly enabled:

- `CARDANO_PAYMENT_PUBLIC_KEY_HEX`
- `CARDANO_ED25519_SIGNER_URL`
- `CARDANO_ED25519_SIGNER_API_KEY`

Production rejects `CARDANO_SIGNING_SEED_HEX`. This legacy path is separate from per-agent Mainnet custody and is not used to derive or share agent identities.

## Required environment

All deployments require `APP_ENV`, `CARDANO_NETWORK`, `CARDANO_BLOCKFROST_URL`, `CARDANO_BLOCKFROST_PROJECT_ID`, and `CARDANO_SIGNER_API_KEY`.

Additional custody configuration is network/mode specific:

- Preprod managed agents: `CARDANO_MANAGED_AGENT_MASTER_KEY`.
- Mainnet autonomous managed agents: `CARDANO_AGENT_CUSTODY_URL` and `CARDANO_AGENT_CUSTODY_API_KEY`.
- Mainnet self-custody only: neither Mainnet managed custody variable is required.
- Legacy shared `/sign` mode: `CARDANO_PAYER_ADDRESS`, `CARDANO_PAYMENT_PUBLIC_KEY_HEX`, `CARDANO_ED25519_SIGNER_URL`, and `CARDANO_ED25519_SIGNER_API_KEY`.

Optional asset/limits:

- `CARDANO_USDCX_ASSET_ID`: exact lower-case policy-id + asset-name unit. When absent, this deployment remains ADA-only.
- `CARDANO_MIN_OUTPUT_LOVELACE`: ADA payment minimum, default `1000000`.
- `CARDANO_TOKEN_OUTPUT_LOVELACE`: ADA carried with a USDCx payee output, default `2000000`.
- `CARDANO_MIN_CHANGE_LOVELACE`: minimum payer change, default `2000000`.
- `CARDANO_MAX_INPUTS`: default `20`.
- `PORT`: default `8791`.

Do not guess or copy `CARDANO_USDCX_ASSET_ID` from an unverified source. Treat the exact asset unit as a deployment fact that must be independently verified for the selected network before enabling USDCx.

## Funding the payer

For ADA payments, use ADA-only UTxOs. For USDCx payments, fund the specific agent or self-custody payer with UTxOs containing only ADA plus the exact configured USDCx asset. UTxOs containing any additional native asset are ignored rather than risk moving unrelated property.

## Endpoints

`GET /health` reports only non-secret service/network state plus the allowed asset identifiers and whether a per-agent managed identity source is enabled.

Internal authenticated endpoints include:

- `POST /unsigned` — build an unsigned self-custody transaction.
- `POST /managed-identity` — resolve the payment identity for one immutable Agent ID.
- `POST /managed-agent-sign` — build and sign for that exact agent identity.
- `POST /sign` / `POST /` — legacy non-agent signing path when explicitly enabled.

Every signing endpoint requires `Authorization: Bearer <CARDANO_SIGNER_API_KEY>`.

## Validation

Run:

```bash
cd cardano-signer
npm run typecheck
npm test
```

The repository also contains `.github/workflows/cardano-signer.yml`, which syntax-checks, tests, and builds the production image.