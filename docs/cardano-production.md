# Cardano x402 production guide

AgentPay supports the Cardano Foundation x402 `exact` scheme on `cardano:preprod` and `cardano:mainnet`. ADA is represented by the reserved identifier `lovelace`. A deployment may additionally enable **one exact USDCx Cardano native-asset unit**; arbitrary native-token payments remain unsupported.

## Architecture

The Cardano path is split across four payment trust boundaries and three external policy/observability integrations:

1. **Dashboard / control plane** — atomic policy evaluation, optional Pyth-valued USD limits, optional Masumi identity/payee trust, approvals, spend reservations, exact resource/payee/amount binding, durable settlement claims, and independent Blockfrost reconciliation. It never stores a Cardano signing secret.
2. **Resource server** — advertises an exact Cardano payment requirement. Every Cardano requirement includes `extra.resourceBinding`, a SHA-256 binding to the canonical paid-resource URL.
3. **Combined facilitator** — receives signed Cardano transaction CBOR, independently validates signatures, payer inputs, outputs, whitelisted asset, amount, fee, TTL, resource binding, nonce/replay state, and submits verified CBOR to Blockfrost.
4. **Cardano signer gateway** — builds the narrow ADA or explicitly whitelisted USDCx transaction from current chain/protocol data and requests an Ed25519 signature from a separate production signing boundary. It cannot settle the payment by itself.
5. **Pyth Hermes** — optional fail-closed oracle source for USD-denominated policy limits. Oracle values can only make a policy more restrictive; they never relax the existing atomic limits.
6. **Masumi Registry Service** — optional agent identity/discovery trust. AgentPay binds the resource to the exact registry identity, API base URL, capability and seller wallet returned by Masumi payment information before that wallet may become the x402 payee.
7. **Dune** — public Cardano settlement analytics only. It is deliberately outside the payment critical path.

This split is intentional. A dashboard compromise does not expose the signing key; a signer compromise cannot alter a transaction without the facilitator detecting it; a lost HTTP response after submission is reconciled from immutable chain evidence instead of resubmitting blindly; and analytics failure cannot block settlement.

## Supported payment invariants

### ADA

- x402 scheme `exact`
- asset `lovelace`
- phase-1 key-spend transaction only
- payer inputs must all belong to the configured payer address
- every consumed UTxO must be ADA-only
- exactly the quoted ADA amount goes to the payee
- change may only return to the payer

### USDCx

- x402 scheme `exact`
- asset must equal the exact `CARDANO_USDCX_ASSET_ID` configured for that single-network signer/facilitator deployment
- the dashboard asset symbol is deliberately `USDCX`, not generic `USDC`
- consumed UTxOs may contain only lovelace plus that exact configured asset
- the payee receives exactly the quoted token amount and the configured ADA carried with a native-token output
- token conservation is exact: the transaction cannot mint, burn, or leak USDCx
- any token change and ADA change may only return to the payer
- any unrelated Cardano native asset causes the UTxO/transaction to be rejected

For both modes, scripts, minting fields, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data and unrelated third-party outputs are rejected. The transaction body must carry a bounded TTL compatible with the x402 timeout and the configured fee ceiling is enforced before submission.

## Resource replay binding

A Cardano requirement must contain `extra.resourceBinding`, calculated by the resource server as SHA-256 of the canonical paid-resource URL. The facilitator includes the complete requirement in its durable transaction binding.

This provides two required properties:

- an idempotent retry for the **same resource and same signed transaction** resolves to the same durable claim;
- the same confirmed transaction presented to a **different endpoint**, even when network/payee/asset/amount happen to match, produces a different binding and is rejected as replay.

The earlier one-shot claim seal has been removed because it prevented legitimate same-resource retries. Resource-specific binding is now the replay boundary.

## Pyth policy valuation

When `PYTH_POLICY_ENABLED=true`, a draft policy version may add USD-denominated per-transaction/hourly/daily/monthly limits. The policy records `maxPriceAgeSeconds` and `maxConfidenceBps`.

For a payment decision AgentPay:

1. fetches the configured ADA/USD or USDC/USD feed from Hermes;
2. requires a fresh, positive observation whose confidence interval is within policy;
3. values the payment using the **upper edge of the confidence interval**;
4. rounds USD micro-dollar spend upward;
5. combines the result with the existing atomic policy using the most restrictive outcome;
6. persists the exact price/confidence/exponent/publish-time and USD amount used for the reservation.

If Pyth is unavailable, stale, malformed or outside the configured confidence bound, an oracle-governed payment fails closed. Existing atomic limits never depend on Pyth and are never loosened by it.

Catalyst extension controls may be changed only while the parent `PolicyVersion` is `DRAFT`. Database triggers seal them after publication.

## Masumi identity and seller-wallet binding

Masumi trust is configured on a draft policy and on a resource binding. A provider administrator/owner first binds a resource to a Masumi `agentIdentifier`. AgentPay then queries the registry and payment-information endpoints and persists only trust-relevant facts: network, registry policy, API base URL, capability, payment type, seller wallet, pricing snapshot hash/facts and verification expiry.

For every payment whose policy requires Masumi:

- the Cardano network must match the Masumi network;
- the agent identifier/capability must satisfy the policy allowlists;
- the resource URL must be under the verified Masumi API base URL;
- the registry binding must be fresh and, when required, still online;
- the x402 `payTo` must equal the seller wallet returned by verified Masumi payment information;
- the same seller wallet and metadata hash are rechecked inside the serializable authorization transaction before spend is reserved.

A Masumi identity passing validation while the challenge pays another wallet is therefore rejected.

## Dune analytics

Dune is read-only observability. Templates are under `analytics/dune/` and intentionally expose only public Cardano settlement activity. Query IDs and dashboard URLs are production facts and are not fabricated in source control.

The AgentPay API reads only latest completed Dune query results. Dune degradation is reported by readiness metadata but never takes the payment plane offline.

## Preprod rollout

Preprod is the default Cardano rail. Before enabling it, configure the base Cardano values plus any optional Catalyst integrations.

### Dashboard

- `CARDANO_SETTLEMENT_STORE_API_KEY`
- `CARDANO_PREPROD_FACILITATOR_URL`
- `CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY`
- `CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY`
- `CARDANO_PREPROD_PAYER_ADDRESS`
- `CARDANO_PREPROD_PROVIDER_ADDRESS`
- `CARDANO_PREPROD_BLOCKFROST_URL`
- `CARDANO_PREPROD_BLOCKFROST_PROJECT_ID`
- optional verified `CARDANO_PREPROD_USDCX_ASSET_ID`
- `CARDANO_USDCX_ENABLED=true` only when that exact asset has been independently verified and funded
- Pyth/Masumi/Dune variables from `.env.example` when those integrations are enabled

### Combined facilitator

- `CARDANO_NETWORK=preprod`
- `CARDANO_PAYER_ADDRESS`
- optional `CARDANO_USDCX_ASSET_ID`
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
- optional exact `CARDANO_USDCX_ASSET_ID`
- `CARDANO_BLOCKFROST_URL`
- `CARDANO_BLOCKFROST_PROJECT_ID`
- `CARDANO_SIGNER_API_KEY`
- `CARDANO_PAYMENT_PUBLIC_KEY_HEX`
- `CARDANO_ED25519_SIGNER_URL`
- `CARDANO_ED25519_SIGNER_API_KEY`

Production must not define `CARDANO_SIGNING_SEED_HEX`. The remote signer/HSM gateway holds signing material and signs only the 32-byte Cardano transaction-body hash. The signer gateway verifies the returned Ed25519 signature before returning CBOR to the facilitator.

## Mainnet rollout

Mainnet support exists in code but is **not a continuation of the Preprod custody instance**. Use a separate signer/facilitator deployment and independently scoped credentials, payer address, provider address, Blockfrost project, monitoring and signing custody.

Do not enable `cardano:mainnet` until all applicable items are true:

- independent production signing custody is provisioned and reviewed;
- the exact Mainnet payer/public key relationship is verified;
- the payer is funded with deliberately selected ADA-only UTxOs and, when USDCx is enabled, UTxOs containing only ADA plus the exact verified USDCx asset;
- the exact USDCx asset unit is independently verified before configuration;
- production provider or Masumi seller payee is independently verified;
- Pyth feed IDs/API authentication are configured and tested if USD policies are enabled;
- Masumi registry identity/seller-wallet binding is tested if Masumi trust is enabled;
- Blockfrost/evidence credentials are live and alerting is configured;
- the durable settlement-claim store is reachable from the facilitator;
- a low-value end-to-end x402 canary succeeds for every enabled asset;
- exact transaction hash, payer, payee, asset, amount and confirmation depth are independently explorer-verified;
- canaries are recorded against the immutable application/facilitator/signer release SHA;
- failure drills cover provider rejection, submission timeout, pending confirmation, evidence mismatch, cross-resource replay, signer unavailability, Pyth failure and Masumi registry failure where applicable.

## Ambiguous submission and reconciliation

Before crossing the Cardano submission boundary the facilitator durably claims the transaction hash and records `SUBMISSION_STARTED`. After that point it never assumes a timeout is safe to retry.

A missing/5xx/timeout result becomes ambiguous settlement with the exact candidate transaction hash. Dashboard maintenance checks Blockfrost for that hash. Confirmation requires the exact network, valid transaction evidence, sufficient block depth, exact payer inputs, exact whitelisted asset behavior, exact payee amount and no unrelated output. A mismatch or replay keeps spend consumed and opens an urgent support incident.

If the chain confirms a payment but the original paid HTTP response was lost, AgentPay records the payment as settled and records fulfillment as unavailable rather than releasing spend or pretending the content was recovered.

## Operational release gate

Source support is not sufficient to call the stack production-ready. The exact release must also have successful repository checks, deployed dashboard/resource/facilitator/signer services, production secret management, HSM/remote signing custody, monitoring/paging ownership, database backup/restore evidence, funded canaries, explorer verification, real Pyth/Masumi/Dune credentials where enabled, and an independent security assessment appropriate to the release.
