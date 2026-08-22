# Cardano x402 production guide

AgentPay supports the Cardano Foundation x402 `exact` scheme on `cardano:preprod` and `cardano:mainnet`. ADA is `lovelace`. A deployment may additionally enable one exact USDCx Cardano native-asset unit; arbitrary native-token payments remain unsupported.

See [`managed-signer-isolation.md`](./managed-signer-isolation.md) for the cross-chain payment-identity invariant.

## Architecture

The Cardano path has separate trust boundaries:

1. **Dashboard / control plane** — policy, approvals, spend reservations, exact resource/payee/amount binding, durable settlement claims and reconciliation. It never stores a Cardano signing secret or managed-agent master key.
2. **Resource server** — advertises exact Cardano requirements, including `extra.resourceBinding`, the SHA-256 binding to the canonical paid-resource URL.
3. **Combined facilitator** — validates signed CBOR, payer inputs, outputs, whitelisted asset, amount, fee, TTL, resource binding, nonce/replay state and settlement evidence before submission.
4. **Cardano signer gateway** — builds the deliberately narrow transaction shape using current chain/protocol data. On Preprod it derives a distinct managed-agent payment key/address from an immutable Agent ID. On Mainnet it supports unsigned self-custody plus autonomous per-agent signing through an external custody adapter; it never uses a Mainnet deployment-wide derivation key.
5. **External Mainnet custody adapter** — resolves one stable Ed25519 public key/signer reference per immutable Agent ID and signs only transaction-body hashes. The private key remains inside the external HSM/KMS/delegation boundary.
6. **Blockfrost** — independent chain/protocol/evidence provider used for construction and reconciliation.
7. **Pyth / Masumi / Dune** — optional policy, seller-trust and observability integrations outside the signer custody boundary.

A shared signer **service** does not imply a shared payer. Every managed agent has its own Cardano address. Mainnet has no deployment-wide agent payer or managed-agent master key.

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

The legacy deployment-wide `/managed-sign` flow is disabled in production. Preprod is deployed with `CARDANO_SIGNING_MODE=unsigned-only` for legacy routes while the dedicated `/managed-identity` and `/managed-agent-sign` paths handle isolated managed agents.

### Self custody

For self-custody agents, `/prepare` builds an unsigned transaction for the exact verified wallet address. The wallet signs it. This remains available on Cardano Mainnet and may also be used on Preprod.

### Autonomous Cardano Mainnet

`CARDANO_MANAGED_AGENT_MASTER_KEY` is prohibited on Mainnet. `CARDANO_SIGNING_SEED_HEX` is also prohibited in production.

The checked-in Mainnet deployment keeps:

```text
CARDANO_NETWORK=mainnet
CARDANO_SIGNING_MODE=unsigned-only
```

for the generic/shared signing route. That does **not** disable the dedicated per-agent routes. Mainnet `/managed-identity` and `/managed-agent-sign` use the external custody adapter configured on the signer with:

```text
CARDANO_AGENT_CUSTODY_URL=https://...
CARDANO_AGENT_CUSTODY_API_KEY=...
```

In the unified production signer these are supplied as:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL=https://...
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY=...
```

The gateway passes them only to the Mainnet child signer.

Identity resolution is `POST /identity` on the custody adapter. The adapter returns a stable Ed25519 `publicKeyHex` and `signerRef` for the immutable Agent ID. AgentPay derives the `addr1...` payer address locally from that public key and rejects a provider-supplied address if it does not match.

Signing is `POST /sign` on the custody adapter. The request contains the exact Agent ID, resolved signer reference, derived payer address and the 32-byte Cardano transaction-body hash. AgentPay verifies the returned Ed25519 signature against the resolved public key before returning signed CBOR.

The external adapter therefore supplies custody, not transaction policy. It does not receive a raw AgentPay master key, and AgentPay does not receive the private key.

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

`render-cardano-mainnet-free.yaml` and the Mainnet worker inside `render.yaml` keep ordinary wallet signing in unsigned/self-custody mode while enabling the dedicated external per-agent custody path.

Required Mainnet custody configuration for autonomous managed agents:

- a custody adapter that exposes the documented `/identity` and `/sign` contract;
- a unique external Ed25519 key/signer reference for each immutable Agent ID;
- `CARDANO_AGENT_CUSTODY_URL` + `CARDANO_AGENT_CUSTODY_API_KEY` on the standalone Mainnet signer, or the `CARDANO_MAINNET_...` equivalents on the unified signer;
- capability credentials isolated from the facilitator and Blockfrost credentials;
- no `CARDANO_MANAGED_AGENT_MASTER_KEY`, shared hot-wallet seed or deployment-wide payer private key.

Operational checks for an enabled Mainnet rail include:

- verify the exact self-custody or managed agent wallet and network;
- configure real Blockfrost credentials and capacity;
- independently verify the Mainnet provider/Masumi seller payee;
- independently verify the canonical USDCx asset when USDCx is enabled;
- fund the exact agent/user wallet with deliberately suitable UTxOs;
- verify a low-value end-to-end x402 canary for every enabled asset/custody mode;
- test provider rejection, submission timeout, pending confirmation, evidence mismatch, cross-resource replay, signer unavailability and custody-adapter failure.

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

The repository implements both Mainnet self-custody and external per-agent managed custody. Production operation of a specific custody provider still depends on its real endpoint/credentials, funded agent wallet and successful end-to-end checks for the exact deployment.