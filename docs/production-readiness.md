# AgentPay production readiness

AgentPay has been deployed and exercised in its supported environments. This document defines the additional release and operational checks used to decide whether a specific build, network and custody profile is ready for production operation. It does not imply that AgentPay is undeployed or untested.

See [`managed-signer-isolation.md`](./managed-signer-isolation.md) for the payment-identity invariant and custody model.

## Release decision

A release is eligible for production operation when:

1. the repository gates required by the enabled feature set are green on the exact immutable release SHA;
2. enabled public services are deployed from that SHA or a recorded image digest derived from it;
3. the real credentials/custody/providers required by that production profile are configured and exercised; and
4. `/api/v1/ready` reports ready for that profile.

An older green preview or canary is not evidence for a newer commit.

## Repository gates

The exact release candidate must pass:

- forward-only PostgreSQL migrations and migration-state verification;
- global payment-identity isolation verification, including a concurrent cross-organization duplicate claim;
- resource endpoint/canonicalization invariants;
- governance invariants;
- dashboard lint, typecheck, unit tests and production build;
- Playwright/browser smoke tests required by the release workflow;
- Hedera and Arc facilitator tests/builds;
- combined facilitator tests/build;
- Cardano signer tests and image build;
- resource-server tests/build/image build;
- CodeQL and dependency review with no unresolved release-blocking finding.

A workflow that exits before executable steps are created is **not a pass**.

## Payment identity isolation

A shared facilitator/signer **service** is permitted. A shared agent wallet or private key is not.

The production database enforces:

```text
(network, canonical account identity) -> one PaymentAccount -> one agent
```

EVM identities are canonicalized to lowercase. The migration creates both a global transaction-scoped PostgreSQL advisory-lock trigger and a unique canonical identity index. Legacy duplicate identities must be archived/reprovisioned rather than rewriting historical payer evidence.

Managed identity modes are:

- Hedera Testnet: distinct Ed25519 key and Hedera account per agent;
- Arc Testnet: distinct secp256k1 key/address per agent;
- Cardano Preprod: distinct Ed25519 payment key/address per agent derived inside the isolated signer;
- Cardano Mainnet: distinct externally custodied Ed25519 identity per agent when the Mainnet custody adapter is configured; self-custody remains available in parallel.

`HEDERA_MANAGED_AGENT_MASTER_KEY`, `ARC_MANAGED_AGENT_MASTER_KEY` and `CARDANO_MANAGED_AGENT_MASTER_KEY` are testnet-only secrets. They must never enter Vercel/dashboard configuration or a Mainnet service.

Cardano Mainnet autonomous custody does not use a deterministic master key. The signer resolves one public key/signer reference per immutable Agent ID through the configured external HSM/KMS/delegation adapter, derives the Cardano payer address locally, and verifies every returned signature before returning transaction CBOR.

Infrastructure accounts such as a Hedera operator/contract payer, Arc relayer or contract executor are service principals. They must never be copied into `PaymentAccount.accountId` as an agent wallet.

## Common control-plane invariants

Production configuration must fail closed. In particular:

- HTTPS is required for production public/payment/custody service URLs;
- `KEY_ENCRYPTION_MASTER_KEY` is exactly 32 random bytes encoded as canonical unpadded base64url;
- production dashboard configuration contains no raw blockchain private keys and no managed-agent master keys;
- payment, settlement, contract-execution, claim-store and signer capabilities remain independently scoped;
- OAuth uses PKCE and one-time state; unsafe cookie-authenticated mutations require the configured application origin;
- agent API credentials are scoped and revocable;
- user-controlled outbound resource fetches are body-bounded and SSRF-protected;
- secret/ciphertext/signing material is not returned by ordinary read APIs;
- audit rows remain immutable/hash-chain protected;
- containers run as an unprivileged user;
- emergency stop blocks new risky side effects while preserving defensive actions, evidence ingestion and reconciliation;
- stale balance snapshots cannot reopen spend represented by active/consumed/recently settled reservations;
- ambiguous post-sign/submission outcomes are held for reconciliation instead of becoming retryable pre-submission failures.

## Cardano direct x402 invariants

For an enabled Cardano rail:

- x402 scheme is `exact` and the CAIP-2 network is exact (`cardano:preprod` or `cardano:mainnet`);
- ADA is `lovelace`; optional native-token support is limited to the explicitly configured unit;
- the requirement includes the SHA-256 `resourceBinding` of the canonical paid-resource URL;
- durable settlement claims bind transaction hash to the complete resource-bound requirement, payer and UTxO nonce;
- the facilitator independently parses signed CBOR and verifies witness, exact payer inputs, exact payee, exact amount, supported asset set, conservation, payer-only change, fee ceiling, TTL/network, resource binding and nonce before submission;
- scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data and unrelated third-party outputs are rejected by the supported payment profile;
- possible submission records durable state before network submission so a timeout cannot cause blind resubmission;
- confirmation and mismatch/replay decisions use independent Blockfrost evidence and configured confirmation depth;
- production raw signing seeds are rejected.

### Cardano custody modes

**Preprod managed agent:** the Cardano signer derives a key/address specific to the immutable Agent ID. `/managed-identity` returns public identity material and `/managed-agent-sign` signs for that exact payer.

**Self custody (Preprod/Mainnet):** `CARDANO_SIGNING_MODE=unsigned-only` prepares the narrow transaction shape for the exact verified wallet and returns it for wallet signing.

**Mainnet autonomous managed agent:** the Mainnet signer uses `CARDANO_AGENT_CUSTODY_URL` and `CARDANO_AGENT_CUSTODY_API_KEY` (or the `CARDANO_MAINNET_...` equivalents on the unified signer) to resolve a unique external Ed25519 identity per Agent ID and sign only the transaction-body hash. `CARDANO_MANAGED_AGENT_MASTER_KEY` remains prohibited on Mainnet.

The generic `unsigned-only` setting and the dedicated managed-agent endpoints intentionally coexist: it disables deployment-wide/shared signing without disabling the per-agent external custody route.

### Cardano service topology

Root `render.yaml` declares the unified Cardano signer and combined facilitator. The signer contains separate Preprod and Mainnet workers with distinct Blockfrost credentials and signer capabilities.

- Preprod worker: deterministic per-agent testnet identity plus self-custody preparation.
- Mainnet worker: self-custody preparation plus optional external per-agent custody.
- Mainnet never receives the Preprod managed-agent master key.

`render-cardano-mainnet-free.yaml` exposes the same Mainnet separation in a standalone grant-stage topology.

## Cardano USDCx/native-token profile

- only the configured policy-id + asset-name unit is supported in addition to lovelace;
- Mainnet USDCx identity is pinned by production preflight to the configured canonical Cardano asset identity;
- Preprod token configuration may not be represented as Mainnet USDCx;
- token-bearing inputs may contain only lovelace plus the allowed unit;
- exact token conservation is required;
- the payee receives exactly the quoted token amount;
- token/ADA change may return only to the payer.

## Pyth, Masumi, Veridian and Dune

When enabled, these integrations remain additional fail-closed policy/evidence layers:

- **Pyth:** positive/fresh/bounded-confidence observations; USD limits may only make atomic policy more restrictive; valuation evidence is persisted.
- **Masumi registry:** exact network/agent/policy/seller-wallet binding; direct Cardano payee must match verified seller evidence when required.
- **Masumi escrow:** remains a separate settlement workflow from direct x402; lifecycle, result hash, refund and dispute evidence are reconciled explicitly.
- **Veridian/KERI/ACDC:** cryptographic verification is delegated to the configured verifier with issuer/schema/revocation/expiry trust pinned by policy.
- **Dune:** read-only observability; never authorizes/signs/settles and cannot become an availability dependency for payment.

## Organization data lifecycle

- Owner-only redacted export requires recent authentication;
- workspace deletion requires exact confirmations and immediately applies containment controls;
- REQUESTED deletion can be canceled, PROCESSING cannot be falsely canceled;
- final completion is not reported before required external cleanup succeeds;
- cancellation does not reconstruct revoked credentials or silently reactivate disabled destinations.

## Operational production checks

These checks depend on the production profile being enabled; they are not claims that the software has never been deployed or tested.

### Common platform

- production DNS/TLS for public services;
- deployment secret management and credential rotation;
- monitoring/error tracking/metrics;
- database backup/restore capability;
- production authentication/email redirect verification;
- incident-response procedure;
- security review appropriate to the release risk.

### Managed identities

- master keys, where used on testnet, exist only on the relevant signer/facilitator service;
- two different Agent IDs resolve to different managed payment identities;
- funding/canary is performed against the specific agent identity rather than an operator/shared wallet;
- legacy shared-payer agents are reprovisioned before the unique-identity migration is promoted.

### Cardano Mainnet autonomous custody

- `CARDANO_MAINNET_AGENT_CUSTODY_URL` and its capability key are present only on the Cardano signer;
- the adapter returns a stable, unique Ed25519 public key/signer reference for each Agent ID;
- AgentPay-derived `addr1...` payer identity matches the external public key;
- returned signatures verify locally against the resolved public key;
- no Mainnet managed-agent master key or deployment-wide payer key exists;
- a low-value end-to-end Mainnet transaction is exercised for each enabled asset/custody mode.

## Dashboard (Vercel) environment rules

At minimum production requires the control-plane/service connectivity appropriate to enabled features:

- `APP_ENV=production`, HTTPS `NEXT_PUBLIC_APP_URL`, managed `DATABASE_URL`;
- unique `AUTH_SECRET`, `CRON_SECRET` and canonical `KEY_ENCRYPTION_MASTER_KEY`;
- production Supabase configuration;
- enabled facilitator URLs and scoped capability keys;
- provider/payee/asset identifiers required by enabled resources;
- Cardano Blockfrost and claim-store configuration when Cardano is enabled;
- optional Pyth/Masumi/KERIA/Dune configuration only when those features are enabled.

Do **not** put any of the following in Vercel:

```text
HEDERA_OPERATOR_KEY
HEDERA_PAYER_KEY
HEDERA_MANAGED_AGENT_MASTER_KEY
ARC_PAYER_PRIVATE_KEY
ARC_RELAYER_PRIVATE_KEY
ARC_CONTRACT_EXECUTION_PRIVATE_KEY
ARC_MANAGED_AGENT_MASTER_KEY
CARDANO_SIGNING_SEED_HEX
CARDANO_ED25519_SIGNER_API_KEY
CARDANO_MANAGED_AGENT_MASTER_KEY
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

The Mainnet custody URL/API key belong to the isolated Cardano signer, not the dashboard or facilitator.

## Operational reconciliation

- reconciliation continues while emergency stop is active;
- unknown Hedera/Cardano/Arc submissions resolve only from exact network evidence;
- ambiguous provider submissions retain idempotency/evidence;
- chain-confirmed payment with lost resource response remains settled and opens a fulfillment incident rather than being retried as unpaid;
- settlement mismatch/replay keeps spend consumed/held and creates an incident;
- external dependency failures are surfaced rather than silently changing payment state.