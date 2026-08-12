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
8. verifies that signature locally against the configured public key;
9. returns signed CBOR plus the first consumed UTxO as the x402 nonce.

The combined facilitator independently decodes and verifies the returned CBOR before it can submit anything. A compromised signer therefore cannot add a third-party output, introduce an unapproved native asset, change the payee/amount/network, mint assets, exceed the configured fee ceiling, or extend the TTL outside the payment requirement without the facilitator rejecting it.

## Production custody

Production **rejects `CARDANO_SIGNING_SEED_HEX`**. Configure a separate remote Ed25519 signing boundary instead:

- `CARDANO_PAYMENT_PUBLIC_KEY_HEX`: 32-byte raw Ed25519 verification key, hex encoded.
- `CARDANO_ED25519_SIGNER_URL`: HTTPS remote signer/HSM gateway.
- `CARDANO_ED25519_SIGNER_API_KEY`: capability credential used only between this service and that signer.

The remote endpoint receives only the 32-byte transaction-body hash:

```json
{
  "algorithm": "Ed25519",
  "messageHex": "<32-byte Cardano transaction-body hash>",
  "purpose": "cardano-transaction-body"
}
```

and must return:

```json
{ "signatureHex": "<64-byte Ed25519 signature>" }
```

AgentPay verifies the signature before returning signed transaction CBOR. Keep the gateway credential distinct from `CARDANO_SIGNER_API_KEY`.

For local/test development only, `CARDANO_SIGNING_SEED_HEX` may contain one raw 32-byte Ed25519 seed. Never place this variable in a production dashboard, facilitator, or signer deployment.

## Required environment

`APP_ENV`, `CARDANO_NETWORK`, `CARDANO_PAYER_ADDRESS`, `CARDANO_BLOCKFROST_URL`, `CARDANO_BLOCKFROST_PROJECT_ID`, and `CARDANO_SIGNER_API_KEY` are required. Production also requires the public key and remote Ed25519 signer variables above.

Optional asset/limits:

- `CARDANO_USDCX_ASSET_ID`: exact lower-case policy-id + asset-name unit. When absent, this deployment remains ADA-only.
- `CARDANO_MIN_OUTPUT_LOVELACE`: ADA payment minimum, default `1000000`.
- `CARDANO_TOKEN_OUTPUT_LOVELACE`: ADA carried with a USDCx payee output, default `2000000`.
- `CARDANO_MIN_CHANGE_LOVELACE`: minimum payer change, default `2000000`.
- `CARDANO_MAX_INPUTS`: default `20`.
- `PORT`: default `8791`.

Do not guess or copy `CARDANO_USDCX_ASSET_ID` from an unverified source. Treat the exact asset unit as a deployment fact that must be independently verified for the selected network before enabling USDCx.

## Funding the payer

For ADA payments, use ADA-only UTxOs. For USDCx payments, fund the same key-controlled payer with UTxOs containing only ADA plus the exact configured USDCx asset. UTxOs containing any additional native asset are ignored rather than risk moving unrelated property.

## Endpoints

`GET /health` reports only non-secret service/network state plus the allowed asset identifiers. `POST /sign` (and `POST /`) requires `Authorization: Bearer <CARDANO_SIGNER_API_KEY>` and accepts the internal facilitator request shape.

## Validation

Run:

```bash
cd cardano-signer
npm run typecheck
npm test
```

The repository also contains `.github/workflows/cardano-signer.yml`, which syntax-checks, tests, and builds the production image. A release must not enable Cardano or USDCx merely because the code exists: the exact release SHA still needs a funded low-value canary and independent explorer verification on each enabled network/asset.
