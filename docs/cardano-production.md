# Cardano x402 production guide

AgentPay supports the Cardano Foundation x402 `exact` scheme on `cardano:preprod` and `cardano:mainnet`. The first supported asset is native ADA, represented by the reserved asset identifier `lovelace` with 6 decimals.

## Architecture

The Cardano path is split across four trust boundaries:

1. **Dashboard / control plane** — policy evaluation, approvals, spend reservations, exact resource/payee/amount binding, durable settlement claims, and independent Blockfrost reconciliation. It never stores a Cardano signing secret.
2. **Resource server** — advertises an exact Cardano payment requirement and delegates verification/settlement to the facilitator.
3. **Combined facilitator** — receives signed Cardano transaction CBOR, independently validates signatures, payer inputs, outputs, asset, amount, fee, TTL, nonce/replay state, and submits verified CBOR to Blockfrost.
4. **Cardano signer gateway** — builds the ADA-only transaction from current chain/protocol data and requests an Ed25519 signature from a separate production signing boundary. It cannot settle the payment by itself.

This split is intentional. A dashboard compromise does not expose the signing key; a signer compromise cannot alter a transaction without the facilitator detecting it; a lost HTTP response after submission is reconciled from immutable chain evidence instead of resubmitting blindly.

## Supported payment invariant

The current Cardano rail is deliberately narrower than general Cardano transaction support:

- scheme: `exact`
- networks: `cardano:preprod`, `cardano:mainnet`
- asset: ADA only (`lovelace`)
- phase-1 key-spend transaction only
- payer inputs must all belong to the configured payer address
- every consumed UTxO must be ADA-only
- exactly the quoted ADA amount may go to the payee
- any remaining output may only return to the payer
- multi-asset outputs, scripts, minting, certificates, withdrawals, collateral, auxiliary data, bootstrap witnesses, and unrelated third-party outputs are rejected
- the transaction body must carry a bounded TTL compatible with the x402 timeout
- the configured fee ceiling is enforced before submission

Adding Cardano native-token payments later requires a separate policy/asset design and tests; do not weaken the ADA-only invariant to add them implicitly.

## Preprod rollout

Preprod is the only Cardano rail intended for the default AgentPay deployment. Before enabling it, configure:

### Dashboard

- `CARDANO_SETTLEMENT_STORE_API_KEY`
- `CARDANO_PREPROD_FACILITATOR_URL`
- `CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY`
- `CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY`
- `CARDANO_PREPROD_PAYER_ADDRESS`
- `CARDANO_PREPROD_PROVIDER_ADDRESS`
- `CARDANO_PREPROD_BLOCKFROST_URL`
- `CARDANO_PREPROD_BLOCKFROST_PROJECT_ID`

### Combined facilitator

- `CARDANO_NETWORK=preprod`
- `CARDANO_PAYER_ADDRESS`
- `CARDANO_BLOCKFROST_URL`
- `CARDANO_BLOCKFROST_PROJECT_ID`
- `CARDANO_SIGNER_URL`
- `CARDANO_SIGNER_API_KEY`
- `CARDANO_SETTLEMENT_STORE_URL`
- `CARDANO_SETTLEMENT_STORE_API_KEY`
- `CARDANO_MANAGED_SIGNING_API_KEY`
- `CARDANO_SETTLEMENT_API_KEY`

`CARDANO_SETTLEMENT_STORE_URL` must be the deployed dashboard internal settlement-claim endpoint. All production URLs must be HTTPS and capability/custody/store secrets must be distinct.

### Isolated signer gateway

- `APP_ENV=production`
- `CARDANO_NETWORK=preprod`
- `CARDANO_PAYER_ADDRESS`
- `CARDANO_BLOCKFROST_URL`
- `CARDANO_BLOCKFROST_PROJECT_ID`
- `CARDANO_SIGNER_API_KEY`
- `CARDANO_PAYMENT_PUBLIC_KEY_HEX`
- `CARDANO_ED25519_SIGNER_URL`
- `CARDANO_ED25519_SIGNER_API_KEY`

Production must not define `CARDANO_SIGNING_SEED_HEX`. The remote signer/HSM gateway holds the signing material and signs only the 32-byte Cardano transaction-body hash. The signer gateway verifies the returned Ed25519 signature before returning the CBOR to the facilitator.

## Mainnet rollout

Mainnet support exists in the code but is **not a continuation of the Preprod custody instance**. Use a separate signer/facilitator deployment and independently scoped credentials, payer address, provider address, Blockfrost project, monitoring, and signing custody.

Do not enable `cardano:mainnet` in the dashboard or resource server until all of these are true:

- independent production signing custody is provisioned and reviewed;
- the exact Mainnet payer/public key relationship is verified;
- the payer is funded with deliberately selected ADA-only UTxOs;
- the production provider payee is independently verified;
- Blockfrost/evidence credentials are live and alerting is configured;
- the durable settlement-claim store is reachable from the facilitator;
- a low-value end-to-end x402 canary succeeds;
- the exact transaction hash, payer, payee, amount, and confirmation depth are independently verified in a Cardano explorer;
- the canary is recorded against the immutable application/facilitator/signer release SHA;
- failure drills cover provider rejection, submission timeout, pending confirmation, evidence mismatch, replay, and signer unavailability.

## Ambiguous submission and reconciliation

Before the facilitator crosses the Cardano submission boundary it durably claims the transaction hash and records `SUBMISSION_STARTED`. After that point it never assumes a timeout is safe to retry.

A missing/5xx/timeout result becomes an ambiguous settlement with the exact candidate transaction hash. Dashboard maintenance checks Blockfrost for that hash. Confirmation requires the exact network, valid transaction evidence, sufficient block depth, exact payer inputs, ADA-only input/output amounts, exact payee amount, and no unrelated output. A mismatch or replay keeps the spend consumed and opens an urgent support incident.

If the chain confirms a payment but the original paid HTTP response was lost, AgentPay records the payment as settled and records fulfillment as unavailable rather than releasing spend or pretending the content was recovered.

## Operational release gate

Source code support is not sufficient to call the Cardano rail production-ready. The release must also have successful repository checks on the exact head SHA, a tested deployment of dashboard/resource/facilitator/signer services, production secret management, monitoring/paging ownership, database backup/restore evidence, a funded canary, explorer verification, and an independent security assessment appropriate to the release.
