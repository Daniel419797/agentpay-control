# AgentPay production readiness

This document separates **repository readiness** from **external launch readiness**. A green repository proves that AgentPay builds, tests and enforces its documented trust boundaries. It cannot manufacture funded wallets, live provider credentials, DNS ownership, monitoring, restore evidence, HSM/KMS custody or an independent security assessment.

See [`managed-signer-isolation.md`](./managed-signer-isolation.md) for the payment-identity threat model, migration rules and testnet/mainnet custody split.

## Release decision

A release is eligible for production only when:

1. every repository gate required by the enabled feature set is green on the exact immutable release SHA;
2. every enabled public service is deployed from that SHA or a recorded image digest derived from it;
3. every external gate required by the enabled feature set has evidence against the same release SHA; and
4. `/api/v1/ready` reports ready for that production profile.

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
- CodeQL and dependency review with no unresolved release-blocking finding;
- fresh review on the stabilized final head.

A workflow that exits before executable steps are created is **not a pass**.

## Payment identity isolation

A shared facilitator/signer **service** is permitted. A shared agent wallet or private key is not.

The production database enforces the invariant:

```text
(network, canonical account identity) -> one PaymentAccount -> one agent
```

EVM identities are canonicalized to lowercase. The migration creates both:

- a global transaction-scoped PostgreSQL advisory-lock trigger on payment identity claims; and
- a unique canonical identity index as the final database constraint.

The migration aborts when legacy duplicate identities already exist. Those agents must be archived/reprovisioned before rollout; historical payer evidence must not be rewritten.

Managed autonomous identities are currently **testnet only**:

- Hedera Testnet: distinct Ed25519 key and Hedera account per agent;
- Arc Testnet: distinct secp256k1 key/address per agent;
- Cardano Preprod: distinct Ed25519 payment key/address per agent.

`HEDERA_MANAGED_AGENT_MASTER_KEY`, `ARC_MANAGED_AGENT_MASTER_KEY` and `CARDANO_MANAGED_AGENT_MASTER_KEY` are signer/facilitator-only testnet secrets. They must be independent 32-byte random values encoded as unpadded base64url and must never enter Vercel/dashboard configuration.

Mainnet must not use these deterministic master keys. Current mainnet agent custody is self-custody/wallet confirmation. Future autonomous mainnet custody requires a separately provisioned **per-agent** HSM/KMS/delegation identity with no deployment-wide payer fallback.

Infrastructure accounts such as a Hedera operator/contract payer, Arc relayer or contract executor are service principals. They must never be copied into `PaymentAccount.accountId` as an agent wallet.

## Common control-plane invariants

Production configuration must fail closed. In particular:

- HTTPS is required for production public/payment service URLs;
- `KEY_ENCRYPTION_MASTER_KEY` is exactly 32 random bytes encoded as canonical unpadded base64url;
- production dashboard configuration contains no raw blockchain private keys and no managed-agent master keys;
- payment, settlement, contract-execution, claim-store and signer capabilities remain independently scoped;
- OAuth uses PKCE and one-time state; unsafe cookie-authenticated mutations require the configured application origin;
- agent API credentials are scoped, revocable and environment-prefixed;
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

**Preprod managed agent:** the Cardano signer derives a key/address specific to the immutable Agent ID. The combined facilitator's `/cardano/managed-agent-sign` route binds the Agent ID, expected payer address and payment requirement, then independently verifies the resulting transaction before it can be submitted.

**Self custody (Preprod/Mainnet):** the gateway uses `CARDANO_SIGNING_MODE=unsigned-only`, prepares the narrow transaction shape for the exact verified wallet and returns it for wallet signing. There is no deployment-wide agent payer.

**Future autonomous Mainnet:** must use a separate per-agent external HSM/KMS/delegation identity. `CARDANO_MANAGED_AGENT_MASTER_KEY` is prohibited on Mainnet.

### Cardano service topology

Root `render.yaml` declares the Preprod signer, combined facilitator and resource server. The signer is a separate process/trust boundary. The combined facilitator exposes explicit `/hedera`, `/arc`, `/cardano` mounts plus root verification/settlement dispatch.

The Preprod signer and Cardano child are intentionally configured with the legacy signing mode disabled while the dedicated per-agent managed endpoints remain available. Mainnet is unsigned/self-custody only in the checked-in Blueprint.

`render-cardano-mainnet-free.yaml` is a grant-stage self-custody deployment and deliberately contains neither a shared payer nor a managed-agent master key.

## Cardano USDCx/native-token profile

- only the configured policy-id + asset-name unit is supported in addition to lovelace;
- Mainnet USDCx identity is pinned by production preflight to the canonical configured Circle xReserve Cardano asset identity;
- Preprod token configuration is deployment-specific and may not be represented as Mainnet USDCx;
- token-bearing inputs may contain only lovelace plus the allowed unit;
- exact token conservation is required;
- the payee receives exactly the quoted token amount;
- token/ADA change may return only to the payer;
- token advertisement stays disabled until the exact asset, funded test identity and canary are verified.

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

## External launch gates

These require real operational evidence against the exact release SHA.

### Common platform

- production DNS/TLS for every public service;
- deployment secret manager and credential-rotation owner;
- monitoring/error tracking/metrics/paging and named on-call;
- managed database PITR plus a recorded restore drill;
- production authentication/email redirect verification;
- incident-response and credential-rotation exercise;
- independent security assessment with no unresolved release blocker.

### Managed testnet identities

- independent signer master keys for Hedera, Arc and Cardano Preprod;
- signer master keys present only on the relevant Render service;
- proof that two newly created managed agents receive different payment identities;
- funding/canary performed against the specific agent identity rather than an operator/shared wallet;
- legacy shared-payer agents reprovisioned before the unique-identity migration is promoted.

### Cardano Mainnet

- real Blockfrost credential and production-approved rate capacity;
- verified user/self-custody payer with appropriate UTxOs;
- independently explorer-verified low-value Mainnet canary for every enabled asset;
- separate per-agent external HSM/KMS custody review before any autonomous Mainnet delegation is enabled.

### Other enabled integrations

- real Pyth/Masumi/Veridian/Dune credentials and evidence when those features are enabled;
- Stripe/fiat provider approval before live card/fiat features;
- funded/approved cross-chain routes and failure/refund drills before enabling those routes;
- low-value x402 canary for each production-enabled rail.

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
```

Legacy public payer-address variables may remain in the schema for compatibility, but managed-agent readiness does not depend on them and provisioning must never assign them to an agent.

## Operational reconciliation

- run the authenticated internal maintenance endpoint on schedule;
- reconciliation continues while emergency stop is active;
- unknown Hedera/Cardano/Arc submissions resolve only from exact network evidence;
- ambiguous provider submissions retain idempotency/evidence;
- chain-confirmed payment with lost resource response remains settled and opens a fulfillment incident rather than being retried as unpaid;
- settlement mismatch/replay keeps spend consumed/held and creates an urgent incident;
- dead letters, unknown submissions, stale maintenance and external dependency failures page an accountable operator in production.
