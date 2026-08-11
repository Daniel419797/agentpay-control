# AgentPay Cardano signer

This service is the isolated Cardano transaction-builder/signing gateway used by the combined x402 facilitator. It deliberately has no application database access and no AgentPay operator/session credentials.

## Trust boundary

The dashboard sends only public Cardano payer identity and policy-approved payment requirements to the facilitator. The facilitator calls this signer with the exact `cardano:*` network, exact payer, exact payee, exact `lovelace` amount, timeout, and `submissionMode: server`.

The signer:

1. fetches live protocol parameters, latest slot, and payer UTxOs from Blockfrost;
2. ignores every UTxO containing a non-ADA native asset;
3. constructs a simple phase-1 ADA-only transaction with one exact payee output and payer-only change;
4. calculates the minimum linear fee from current protocol parameters;
5. hashes the transaction body with true BLAKE2b-256;
6. obtains an Ed25519 signature;
7. verifies that signature locally against the configured public key;
8. returns signed CBOR plus the first consumed UTxO as the x402 nonce.

The combined facilitator independently decodes and verifies the returned CBOR before it can submit anything. A compromised signer therefore cannot add a third-party output, move native tokens, change the payee/amount/network, exceed the configured fee ceiling, or extend the TTL outside the payment requirement without the facilitator rejecting it.

## Production custody

Production **rejects `CARDANO_SIGNING_SEED_HEX`**. Configure a separate remote Ed25519 signing boundary instead:

- `CARDANO_PAYMENT_PUBLIC_KEY_HEX`: 32-byte raw Ed25519 verification key, hex encoded.
- `CARDANO_ED25519_SIGNER_URL`: HTTPS remote signer/HSM gateway.
- `CARDANO_ED25519_SIGNER_API_KEY`: capability credential used only between this service and that signer.

The remote endpoint receives:

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

Optional limits are `CARDANO_MIN_OUTPUT_LOVELACE` (default `1000000`), `CARDANO_MIN_CHANGE_LOVELACE` (default `2000000`), `CARDANO_MAX_INPUTS` (default `20`), and `PORT` (default `8791`).

The payer address must use a key payment credential. For the current AgentPay Cardano rail, fund it with **ADA-only UTxOs**. Token-bearing UTxOs are intentionally ignored rather than risk moving an unrelated native asset during an ADA payment.

## Endpoints

`GET /health` reports only non-secret service/network state. `POST /sign` (and `POST /`) requires `Authorization: Bearer <CARDANO_SIGNER_API_KEY>` and accepts the internal facilitator request shape.

## Validation

Run:

```bash
cd cardano-signer
npm run typecheck
npm test
```

The repository also contains `.github/workflows/cardano-signer.yml`, which syntax-checks, tests, and builds the production image. A release must not enable Cardano merely because the code exists: the exact release SHA still needs a funded low-value canary and independent explorer verification on each enabled Cardano network.
