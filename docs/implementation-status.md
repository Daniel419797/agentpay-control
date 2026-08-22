# AgentPay implementation status

This document is the release traceability map for AgentPay. **Implemented in code** means the repository contains the intended code path and regression coverage intended to exercise it. It does **not** mean every external provider account or production credential is configured for a particular deployment.

## Core platform — implemented in code

- Passwordless/operator authentication plus verified wallet identity where supported
- Multi-workspace organization roles and tenant isolation
- Agents, scoped agent credentials, policies, approvals, transactions, resources and immutable audit evidence
- x402 V2 payment header/response handling
- Hedera, Arc and Cardano payment paths
- Spend reservations, idempotency, rate limits, emergency stop, reconciliation and support incidents
- PostgreSQL forward-only migrations, migration verification, export/deletion/retention workflows, backup/restore tooling and production runbooks
- Bounded request bodies, SSRF controls, OAuth PKCE/state, cookie-origin protections and encrypted sensitive values

## Payment rails

### Hedera

- Testnet managed autonomous x402 payment is implemented.
- Testnet/mainnet self-custody identity is supported for operator-confirmed activity.
- Ambiguous settlement reconciles from exact Mirror Node evidence without blind retry.
- Production key/capability separation and confirmation-depth checks are enforced.

### Arc

- Arc testnet managed agent provisioning, x402 routing and contract automation are implemented when configured.
- Private keys remain in the facilitator boundary.
- Ambiguous x402 submissions with a pre-recorded candidate transaction hash are reconciled from exact Arc RPC receipt/log evidence after configured confirmation depth; missing, replayed, failed or mismatched evidence fails closed and remains incident-driven.
- Production self-custody cross-chain transaction export is intentionally disabled because AgentPay cannot revoke an already exported wallet payload after emergency stop.

### Cardano direct x402

- `cardano:preprod` and `cardano:mainnet` `exact` routing are implemented.
- ADA uses `lovelace`.
- One explicitly whitelisted native-token unit may be enabled in addition to ADA; arbitrary native tokens remain unsupported.
- Mainnet `USDCX` is pinned to the configured Circle xReserve Cardano native-asset identity in production preflight.
- Resource requirements carry SHA-256 binding to the canonical paid-resource URL.
- Same-resource retry remains idempotent while cross-resource reuse of an otherwise identical payment is rejected.
- The isolated signer builds a deliberately narrow phase-1 key-spend transaction from live UTxOs/protocol parameters.
- Cardano Preprod managed agents use a distinct Ed25519 payment identity derived inside the signer for each immutable Agent ID.
- Cardano Mainnet supports ordinary unsigned/self-custody plus autonomous per-agent external custody through `CARDANO_AGENT_CUSTODY_URL` / `CARDANO_AGENT_CUSTODY_API_KEY` (or the unified signer's `CARDANO_MAINNET_...` variables).
- The Mainnet custody adapter resolves a stable Ed25519 public key/signer reference per immutable Agent ID. AgentPay derives the payer address locally and sends only the transaction-body hash for signing.
- Mainnet deterministic `CARDANO_MANAGED_AGENT_MASTER_KEY` remains prohibited; no deployment-wide agent payer or shared private key is required.
- Every external Mainnet signature is verified locally against the resolved agent public key before transaction CBOR is returned.
- The facilitator independently verifies CBOR shape, witness, payer credential/inputs, exact payee, exact ADA/token amount, asset conservation, payer-only change, fee, TTL, network, submission/confirmation policy, resource binding, nonce and replay state.
- Scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data, unrelated assets and unrelated third-party outputs are rejected.
- Ambiguous submission is not blindly retried; the exact candidate transaction is reconciled through Blockfrost evidence.

## Catalyst production profile — implemented in source

### USDCx/native-token settlement

- Dashboard routing, resource requirements, signer construction, facilitator verification, Blockfrost evidence and reconciliation support the single explicitly whitelisted Cardano native-token path.
- Inputs may contain only lovelace plus the selected token; token/value conservation is exact; token/ADA change may return only to the payer; the payee receives exactly the quoted token amount.
- Mainnet USDCx identity is source-pinned. Preprod remains an explicitly configured test asset and is never represented as Mainnet USDCx.
- Production operation requires the selected payer/custody mode to be configured and funded for the deployment being exercised.

### Pyth USD policy

- Draft policies can add USD per-transaction, hourly, daily and monthly limits while preserving atomic-asset limits.
- ADA and USDCx use configured Pyth feed IDs.
- Observations must be positive, fresh, not from the future and within configured confidence bounds.
- Valuation uses the upper confidence edge and upward rounding so uncertainty cannot understate spend.
- Oracle policy combines with atomic policy using the most restrictive result.
- Price/confidence/exponent/publish-time and USD reservation facts are persisted.
- Oracle-governed payments fail closed on provider/staleness/confidence errors.
- Production use requires the selected Hermes endpoint/feed configuration to be valid for the deployment.

### Masumi identity/discovery

- Resource providers bind a Cardano resource to a Masumi `agentIdentifier` after provider verification and recent authentication.
- AgentPay verifies exact registry identity, trusted `RegistrySource.policyId`, online state, API base URL, capability, network and payment information.
- The seller Cardano address is decoded and its payment-credential hash is required to equal Masumi's reported 56-hex seller payment-key hash. Script-payment credentials are rejected for this trust mode.
- Direct x402 requires the actual challenge payee to equal the verified seller address.
- Binding metadata, seller key evidence, verification timestamp and expiry are persisted and rechecked before serialized authorization.

### Masumi escrow/refunds/result verification

- Masumi escrow is an explicit **separate** payment scheme and is never silently processed as direct x402.
- Scoped `payments:create` agent credentials and recent-auth Owner/Operator users can initiate a policy-controlled escrow purchase.
- MIP-003 job start/status integration validates agent identifier, purchaser identifier, seller key, canonical input hash and timing order.
- AgentPay creates a durable `MasumiEscrowPurchase`, encrypted pending input, PaymentIntent/Quote/PolicyDecision/SpendReservation and ApprovalRequest as one policy-controlled workflow.
- Approval execution dispatches by payment scheme so approved escrow does not accidentally use the direct x402 executor.
- Provider ambiguity becomes `SUBMISSION_UNKNOWN` and is reconciled by maintenance instead of blindly creating another purchase.
- Lifecycle tracking supports `FundsLockingRequested`, `FundsLocked`, `ResultSubmitted`, `Completed`, `RefundRequested`, `RefundAuthorized` and `Disputed`.
- A completed result counts as verified only when SHA-256 of the exact returned MIP-003 result string equals the purchase result hash.
- Buyer refund request and seller/provider refund authorization endpoints are implemented with role/step-up controls.
- Database reservation invariants release spend after an authorized refund and retain/consume spend for disputes.
- Pending job input is encrypted and purged after terminal completion/refund.
- Maintenance reconciles pending Masumi purchases together with other payment rails.
- Production operation requires real Registry/Payment Service credentials for the environment being used.

### Evidence-backed Masumi seller reputation

- AgentPay does not claim a native Masumi numeric reputation field that the integration cannot prove.
- A policy may require a minimum number of AgentPay-observed verified completed purchases and a minimum reputation score in basis points.
- The score is derived from cryptographically linked AgentPay-observed escrow outcomes: verified completions versus refunds, disputes and failures.
- The reputation gate is rechecked immediately before authorized escrow execution.

### Veridian / KERI / ACDC identity

- A provider resource may bind an independently verified KERI/ACDC credential to the same Masumi agent identifier.
- Cryptographic KERI/ACDC verification is delegated to a configured reviewed verification adapter; AgentPay does not implement its own KERI/CESR crypto, and HTTP success is accepted only when the adapter returns an explicit `verified: true` verdict.
- Production requires HTTPS, trusted issuer AIDs and allowed schema SAIDs.
- The resource binding stores credential SAID, subject/agent AID, issuer AID, schema SAID, claims hash, verification time, expiry and verifier evidence.
- Policy can require KERI trust and maximum verification age in addition to Masumi identity.
- The AgentPay credential profile requires a Masumi-agent identifier claim matching the resource's verified Masumi binding.

### Dune analytics

- Public SQL templates exist for overview, daily activity and recent verification samples.
- The SQL intentionally uses public Cardano chain data only and excludes private AgentPay organization/user/policy/prompt/resource-content data.
- `analytics/dune/publish.mjs` creates/updates all three public queries with real deployment parameters.
- `analytics/dune/publish-dashboard.mjs` uses the official Dune CLI to create visualizations and the public dashboard.
- `/app/analytics/cardano` displays configured Dune results and shows no synthetic fallback metrics.
- Authenticated AgentPay aggregate analytics separately expose logical agent/provider counts, policy denials/approvals, settlement success/latency and verified Masumi outcomes without publishing tenant identities.
- Catalyst live dependency verification cross-checks recent Dune transaction hashes against Blockfrost and the configured Mainnet provider address.

### Production profile checks

- `CATALYST_PRODUCTION_ENABLED=true` activates a fail-closed production contract instead of a cosmetic feature flag.
- Production profile requires the configured Cardano/USDCx, Pyth, Masumi identity, Masumi escrow, Veridian/KERI, Dune and immutable `RELEASE_SHA` dependencies selected by that profile.
- Release/canary evidence is accepted only through a dedicated capability-isolated service credential, not by arbitrary tenant owners.
- Cardano canary records require a real transaction hash plus exact payer/payee/asset/amount facts; AgentPay independently verifies Blockfrost evidence and configured confirmation depth before accepting the attestation.
- Dune evidence requires a published HTTPS dashboard and a transaction sample independently cross-checked against Blockfrost when Dune is part of the demonstrated profile.

## Catalyst submission/demo assets — implemented in repository

- `docs/catalyst/architecture.md`
- `docs/catalyst/submission.md`
- `docs/catalyst/demo-script.md`
- `docs/catalyst/landing-page-copy.md`
- `docs/catalyst/pitch.md`
- `docs/catalyst/release-checklist.md`
- `scripts/catalyst-live-demo.mjs` verifies and records externally executed canary/dependency evidence. It does **not** autonomously initiate Mainnet spend.

## Other production workflows

### Virtual cards and fiat — provider-ready

Cardholder onboarding, virtual-card issuance, spending controls, lifecycle controls, signed Stripe webhooks, fiat accounts/transfers, encrypted instruments, idempotency and ambiguous-submission reconciliation are implemented. Live use still requires applicable provider approval.

### Marketplace and invoicing — implemented

Verified marketplace catalog, provider/resource registration, health/pricing/reviews, agent invoices, approval-aware collection and invoice timelines are implemented.

### Cross-chain / contract automation — integration-ready

LI.FI quote preparation, encrypted transaction intent, source/destination verification and reconciliation exist. Production self-custody transaction export is disabled until a server-controlled broadcast design can recheck emergency stop immediately before broadcast.

### Predictive financial intelligence — implemented

Daily observations, forecasting, anomaly detection and budget recommendations are implemented. Recommendation acceptance creates a draft policy and never silently raises active spending limits.

## Synthetic fixture rule

Bundled market-data, inference, file and research resource endpoints are synthetic integration fixtures. They are labelled as such and must not be represented as live market data, live model inference or live web research.

## Current operational dependencies

The repository implements the Cardano Mainnet per-agent custody protocol, but a production deployment of that mode still needs an actual compatible external custody endpoint and credentials. The selected production profile also needs the corresponding funded wallets and provider credentials for the integrations being exercised.

See `docs/catalyst/release-checklist.md`, `docs/production-readiness.md`, `docs/cardano-production.md` and `docs/production-runbook.md`.