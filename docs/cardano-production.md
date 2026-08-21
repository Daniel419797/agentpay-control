# Cardano x402 production guide

AgentPay supports the Cardano Foundation x402 `exact` scheme on `cardano:preprod` and `cardano:mainnet`. ADA is `lovelace`. A deployment may additionally enable one exact USDCx Cardano native-asset unit; arbitrary native-token payments remain unsupported.

See [`managed-signer-isolation.md`](./managed-signer-isolation.md) for the cross-chain payment-identity invariant.

## Architecture

The Cardano path has separate trust boundaries:

1. **Dashboard / control plane** — policy, approvals, spend reservations, exact resource/payee/amount binding, durable settlement claims and reconciliation. It never stores a Cardano signing secret or managed-agent master key.
2. **Resource server** — advertises exact Cardano requirements, including `extra.resourceBinding`, the SHA-256 binding to the canonical paid-resource URL.
3. **Combined facilitator** — validates signed CBOR, payer inputs, outputs, whitelisted asset, amount, fee, TTL, resource binding, nonce/replay state and settlement evidence before submission.
4. **Cardano signer gateway** — builds the deliberately narrow transaction shape using current chain/protocol data. On Preprod it can also derive a distinct managed-agent payment key/address from an immutable Agent ID. On Mainnet it is unsigned/self-custody only in the checked-in deployment.
5. **Blockfrost** — independent chain/protocol/evidence provider used for construction and reconciliation.
6. **Pyth / Masumi / Dune** — optional policy, seller-trust and observability integrations outside the signer custody boundary.

A shared signer **service** does not imply a shared payer. Every managed Preprod agent has its own address/key. Mainnet has no deployment-wide agent payer.

## Payment identity and custody

### Managed Cardano Preprod

`CARDANO_MANAGED_AGENT_MASTER_KEY` is a signer-only testnet secret. It must be exactly 32 random bytes encoded as 43-character unpadded base64url.

For each immutable Agent ID, the signer derives a distinct Ed25519 payment key and corresponding `addr_test...` address. Provisioning returns only the public address/public key/signer reference to the dashboard. The derived private key never leaves the signer process.

A managed signing request is bound to all of:

- Agent ID;
- expected payer address stored on that agent's `PaymentAccount`;
- exact network;
- exact x402 requirement;
- server submission mode.

The combined facilitator independently verifies the resulting signed transaction before accepting the payload.

The legacy deployment-wide `/managed-sign` flow is disabled in production. Preprod is deployed with `CARDANO_SIGNING_MODE=unsigned-only` for legacy routes while the dedicated `/managed-identity` and `/managed-agent-sign` paths handle isolated testnet managed agents.

### Self custody

For self-custody agents, `/prepare` builds an unsigned transaction for the exact verified wallet address. The wallet signs it. This applies to Cardano Mainnet and may also be used on Preprod.

### Mainnet

`CARDANO_MANAGED_AGENT_MASTER_KEY` is prohibited on Mainnet. `CARDANO_SIGNING_SEED_HEX` is also prohibited in production.

The checked-in Mainnet Blueprint uses:

```text
CARDANO_NETWORK=mainnet
CARDANO_SIGNING_MODE=unsigned-only
```

There is no `CARDANO_PAYER_ADDRESS`, no shared payment public key and no deterministic managed-agent master key. Autonomous Mainnet custody must remain disabled until a separately provisioned **per-agent** external HSM/KMS/delegation identity is implemented and reviewed.

## Supported payment invariants

### ADA

- x402 scheme `exact`;
- asset `lovelace`;
- phase-1 key-spend transaction only;
- payer inputs belong to the exact payer address carried by the payment payload;
- every consumed UTxO is ADA-only;
- exactly the quoted ADA amount goes to the payee;
- change returns only to that payer.

### USDCx

- x402 scheme `exact`;
- asset equals the exact configured `CARDANO_USDCX_ASSET_ID` for that network;
- dashboard symbol is `USDCX`, not generic `USDC`;
- consumed UTxOs contain only lovelace plus that exact asset;
- payee receives exactly the quoted token amount plus the required ADA carried by the output;
- token conservation is exact: no mint, burn or unrelated asset leakage;
- token/ADA change returns only to the payer.

For both modes, scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data and unrelated third-party outputs are rejected. TTL and fee ceilings are enforced before submission.

## Resource replay binding

Every Cardano requirement contains `extra.resourceBinding`, SHA-256 of the canonical paid-resource URL. Durable settlement state binds the complete requirement to the transaction.

This permits idempotent retry for the same resource/signed transaction but rejects use of the same confirmed transaction against a different resource even if network/payee/asset/amount happen to match.

## Preprod deployment

### Dashboard / Vercel

Required control-plane values for an enabled Preprod rail include:

- `CARDANO_SETTLEMENT_STORE_API_KEY`;
- `CARDANO_PREPROD_FACILITATOR_URL`;
- `CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY`;
- `CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY`;
- `CARDANO_PREPROD_PROVIDER_ADDRESS`;
- `CARDANO_PREPROD_BLOCKFROST_URL`;
- `CARDANO_PREPROD_BLOCKFROST_PROJECT_ID`;
- optional verified `CARDANO_PREPROD_USDCX_ASSET_ID` and `CARDANO_USDCX_ENABLED=true` only after asset/canary verification.

`CARDANO_PREPROD_PAYER_ADDRESS` is not required for isolated managed agents and must not be treated as an agent identity. `CARDANO_MANAGED_AGENT_MASTER_KEY` must never be placed in Vercel.

### Combined facilitator

Use:

```text
APP_ENV=production
CARDANO_NETWORK=preprod
CARDANO_SIGNING_MODE=unsigned-only
CARDANO_BLOCKFROST_URL=...
CARDANO_BLOCKFROST_PROJECT_ID=...
CARDANO_SIGNER_URL=...
CARDANO_SIGNER_API_KEY=...
CARDANO_SETTLEMENT_STORE_URL=...
CARDANO_SETTLEMENT_STORE_API_KEY=...
CARDANO_MANAGED_SIGNING_API_KEY=...
CARDANO_SETTLEMENT_API_KEY=...
```

Optional exact USDCx asset configuration may also be supplied. No shared payer address is required.

### Cardano signer

Use:

```text
APP_ENV=production
CARDANO_NETWORK=preprod
CARDANO_SIGNING_MODE=unsigned-only
CARDANO_MANAGED_AGENT_MASTER_KEY=<32 random bytes, base64url>
CARDANO_BLOCKFROST_URL=...
CARDANO_BLOCKFROST_PROJECT_ID=...
CARDANO_SIGNER_API_KEY=...
```

The master key belongs only to this signer service. New managed agents are intentionally unfunded; fund the specific agent address after provisioning.

## Mainnet deployment

`render-cardano-mainnet-free.yaml` and the Mainnet services in `render.yaml` intentionally use unsigned/self-custody mode. Before enabling `cardano:mainnet`:

- verify the exact user/self-custody wallet and network;
- configure real Blockfrost credentials and capacity;
- independently verify the Mainnet provider/Masumi seller payee;
- independently verify the canonical USDCx asset when USDCx is enabled;
- fund the exact user wallet with deliberately suitable UTxOs;
- verify a low-value end-to-end x402 canary for every enabled asset;
- record transaction hash, payer, payee, asset, amount and confirmation depth against the immutable release SHA;
- test provider rejection, submission timeout, pending confirmation, evidence mismatch, cross-resource replay and signer unavailability;
- provision and review a unique per-agent HSM/KMS/delegation identity before enabling autonomous Mainnet custody.

Do not solve Mainnet autonomy by adding a shared hot wallet or by setting `CARDANO_MANAGED_AGENT_MASTER_KEY` on a Mainnet service.

## Database identity invariant

The dashboard database globally prevents duplicate payment identities across organizations and app instances. For EVM-style networks identities are lowercased for uniqueness; Cardano addresses retain exact representation.

The payment-identity migration installs a transaction advisory-lock trigger and unique canonical identity index. It aborts if legacy duplicate rows already exist. Old shared-payer managed agents therefore have to be archived/reprovisioned rather than silently migrated in place.

## Pyth, Masumi and Dune

Pyth valuation can only make spending policy more restrictive and persists the exact price evidence used. Masumi seller-wallet trust can require the x402 payee to equal the verified seller address. Dune remains read-only observability and is never a signing/settlement availability dependency.

## Ambiguous submission and reconciliation

Before submission the facilitator durably claims the transaction hash and records submission state. A timeout or missing provider response is ambiguous and is never assumed safe to retry blindly.

Maintenance resolves the exact candidate transaction using chain evidence. A confirmed payment with a lost paid-resource HTTP response remains settled; fulfillment becomes an operational incident rather than releasing spend and repaying.

## Release gate

Source support is not production evidence. The exact release must pass migrations, the concurrent identity-isolation verification, dashboard/service tests and builds, Cardano signer tests/image build, browser smoke tests, security/dependency gates, operational readiness, and real low-value canaries for enabled live rails.
