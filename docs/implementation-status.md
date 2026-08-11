# AgentPay implementation status

This document is the release traceability map for AgentPay. “Implemented” means the repository contains the code path and automated verification intended to exercise it. It does **not** mean an external provider has approved a live account, production credentials/custody are provisioned, a public analytics surface has been published, funded canaries have succeeded, or the current release SHA has passed every launch gate.

## Current MVP — implemented

- Passwordless/operator authentication plus verified Hedera wallet identity
- Organization-scoped agents, credentials, policies, approvals, transactions, resources, and audit evidence
- Exact x402 payment verification/settlement through isolated Hedera, Arc, and Cardano paths
- Standard x402 V2 Base64 payment headers and Settlement Response handling
- Organization kill switch, reconciliation states, idempotency, rate limits, health/readiness, and structured errors

## Production foundation — implemented in code

- PostgreSQL schema with forward-only migrations and migration verification
- Tenant isolation, deterministic role checks, encrypted sensitive fields, one-time wallet challenges, OAuth PKCE+state, CSRF origin binding, bounded request bodies, SSRF controls, and concurrency guards
- Notification outbox, retries, dead-letter handling, maintenance jobs, metrics, retention, export, deletion, support cases, plan entitlements, backup/restore scripts, CI configuration, and production runbook
- Database-enforced immutable, SHA-256 hash-chained audit events with CSV/JSON export; retention preserves chain continuity rather than deleting historical audit rows
- Automatic urgent incidents for unresolved payment, fiat, bridge, contract, and Cardano settlement mismatches
- Chain-evidence reconciliation for ambiguous Hedera and Cardano x402 submissions

## Production v1 workflows — implemented in code

- Owner, operator, approver, viewer, and provider-admin workflows
- Member invitation/suspension, provider onboarding, verified settlement ownership, resource pricing/publication, notification endpoints, emergency kill switch, and organization settings
- Multi-policy controls, schedules, merchant/category restrictions, velocity rules, threshold approvals, verified asset registry, and managed account isolation
- Operations UI for core production workflows with role-aware mutation affordances
- Asset/network-aware overview accounting and chain-appropriate explorer receipts

## Payment rails

### Hedera

- Hedera testnet managed signing is implemented for autonomous agent x402 payments.
- Hedera testnet and mainnet self-custody wallet identity are supported for operator-confirmed wallet activity.
- Managed Hedera mainnet agent custody remains intentionally disabled; mainnet agent identity must be self-custody.
- Contract automation is network-bound and uses independent mainnet/testnet facilitator capability and payer configuration.
- Ambiguous Hedera x402 submissions reconcile from the pre-recorded transaction ID and exact payer/payee/asset/amount mirror evidence without blind retries.

### Arc

- Arc testnet managed agent provisioning and x402 payment routing are implemented when the facilitator, signing capability, public payer address, provider payee, RPC, and USDC contract are configured.
- Arc private keys stay in the facilitator; the dashboard stores only public payer identity.
- Arc browser-wallet/self-custody identity is **not** implemented and is not advertised by the UI.
- Ambiguous Arc x402 submissions remain `SUBMISSION_UNKNOWN` and incident-driven. Automatic chain reconciliation is intentionally gated until signed authorization can be mapped deterministically to recoverable chain evidence.

### Cardano

- `cardano:preprod` and `cardano:mainnet` direct x402 `exact` routing are implemented in source, with Preprod as the default deployable Cardano rail.
- ADA uses the reserved `lovelace` identifier.
- One explicitly whitelisted Cardano native-token unit may be enabled in addition to ADA; arbitrary native tokens remain unsupported.
- Mainnet `USDCX` is pinned to the canonical Circle xReserve Cardano native-asset identity in dashboard/resource production preflight. A different policy/asset unit is rejected even if labelled “USDCx.”
- The Cardano signer builds a deliberately narrow phase-1 key-spend transaction from live UTxOs/protocol parameters. Production raw signing seeds are prohibited; a separate remote Ed25519/HSM-style boundary signs only the transaction-body hash and the gateway verifies the signature locally.
- The facilitator independently decodes the signed CBOR and checks network, signature, payer credential/inputs, exact payee, exact ADA/token amount, whitelisted asset, token/value conservation, payer-only change, fee ceiling, timeout/TTL, server-submission policy, confirmation policy, nonce and resource binding before submission.
- Scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data, unrelated assets and unrelated third-party outputs are rejected by the current Cardano rail.
- Every Cardano x402 requirement binds SHA-256 of the canonical resource URL. That resource-specific requirement participates in the durable settlement claim, allowing same-resource idempotent retry while preventing a confirmed transaction from satisfying a different endpoint with otherwise identical payment terms.
- Ambiguous submissions are not blindly resubmitted; the exact candidate transaction is reconciled from Blockfrost evidence. Confirmed mismatches/replays retain consumed spend and create urgent incidents.

## Catalyst-aligned Cardano integrations — implemented in code

### USDCx/native-token settlement

- Dashboard routing, resource requirements, signer transaction construction, facilitator verification, Blockfrost evidence, reconciliation, UI asset handling and production preflight support the explicitly whitelisted Cardano native-token path.
- Exact token conservation is required. Inputs may contain only lovelace plus the selected token, token/ADA change can return only to the payer, and the payee receives the exact quoted token amount with ADA carried by the token output.
- Mainnet USDCx identity is source-pinned; Preprod remains an explicitly configured test asset and must not be presented as Mainnet USDCx.
- Live Mainnet USDCx operation remains gated on a funded payer, production signer custody and a recorded low-value canary.

### Pyth USD policy

- Draft policy versions can add Pyth-valued USD per-transaction, hourly, daily and monthly limits while preserving existing atomic-asset limits.
- Hermes observations are bound to configured feed IDs, must be positive/fresh, reject future timestamps, and enforce a maximum confidence width.
- AgentPay values spend using the **upper confidence bound** and upward rounding so oracle uncertainty cannot understate autonomous spend.
- Oracle outcomes combine with atomic policy using the most restrictive decision. Provider outage/stale/malformed/uncertain observations fail closed for oracle-governed payments.
- The exact price/confidence/exponent/publish time and USD spend facts are persisted with the spend reservation.
- Database triggers make Catalyst policy extensions immutable once their parent policy version leaves `DRAFT`.
- Live use still requires real authenticated Pyth access and verified production feed IDs.

### Masumi identity/discovery trust

- Resource providers can bind a Cardano resource to a Masumi `agentIdentifier` after recent authentication and provider verification.
- AgentPay queries the registry and payment-information surfaces, checks an exact online identity, API base URL, capability, network, seller address and trust-relevant metadata, and persists a short-lived binding.
- Production requires an authenticated HTTPS registry plus an explicit allowlist of trusted `RegistrySource.policyId` values; AgentPay does not trust every registry source merely because the endpoint is authenticated.
- A Masumi-governed payment requires the x402 payee to match the seller address in the verified binding, and the binding is rechecked during serialized authorization before spend is reserved.
- This integration is **Masumi identity/discovery/direct-payee trust**, not a claim that AgentPay direct x402 settlement is Masumi escrow. Masumi escrow has a separate purchase lifecycle and remains outside this direct-payment path.
- Stronger cryptographic address-to-reported-payment-key derivation is not currently counted as implemented; production trust remains based on the authenticated/trusted registry/payment-information response plus exact seller-address/payment binding.

### Dune public analytics

- Read-only runtime integration fetches only completed configured Dune query results and cannot authorize/sign/settle a payment.
- Public SQL templates under `analytics/dune/` target Cardano transaction data and intentionally avoid private AgentPay organization/user/policy/prompt/resource-content data.
- The overview query uses the current `input_count` / `output_count` Cardano transaction fields.
- `analytics/dune/publish.mjs` reproducibly creates or updates the public overview/activity queries when a real Dune write credential and public deployment values are supplied.
- Query IDs, dashboard URL and a published dashboard are deployment facts; they are not fabricated in source control. Runtime analytics should use a read-scoped key after publishing.

## Marketplace settlement — partially multi-rail by design

- Platform-owned bundled resources can advertise configured Hedera, Arc, and Cardano payment requirements.
- Organization-owned generic marketplace providers currently use verified Hedera testnet settlement unless an explicit Cardano Masumi resource binding supplies the verified seller-wallet path.
- Other arbitrary network/provider combinations fail closed rather than routing funds to a global fallback address.

## Virtual cards and fiat rails — provider-ready

- Cardholder onboarding, virtual-card issuance, agent/card spending controls, serialized authorization decisions, card lifecycle controls, signed Stripe webhooks, and sensitive display-key flow
- Fiat operating accounts, deposits/withdrawals, encrypted instrument recovery, provider idempotency, ambiguous-submission reconciliation, balances, and transfer history
- Confirmed provider 4xx rejection is terminal rather than repeatedly retried as an unknown submission
- Sandbox paths are testable now. Live operation still requires approved Stripe Issuing and applicable money-management/fiat configuration.

## Marketplace and agent invoicing — implemented

- Verified marketplace catalog, provider/resource registration, resource health, pricing, tags, reviews, and purchase evidence
- Agent-to-agent invoice drafting, line items, send/view/void/overdue states, approval-aware payment, exact x402 collection, serialized settlement, and invoice timelines

## Cross-chain and smart-contract automation — integration-ready

- LI.FI quote preparation, encrypted transaction requests, source-transaction signer/target/calldata/value verification, destination receipt/token/recipient/amount validation, confirmation tracking, and reconciliation
- Manual, schedule, balance, invoice-event, and signed-webhook triggers
- x402 payment, invoice, and Hedera contract-call actions with independent approval, contract allowlists, selector/value/gas limits, runtime bytecode hash verification, pre-recorded transaction identity, and unknown-submission reconciliation
- Live canaries still require funded EVM accounts and usable routes for the selected tokens.

## Predictive financial intelligence — implemented

- Daily observations, spend forecasting, anomaly detection, budget recommendations, confidence/context metadata, owner acceptance or dismissal, and scheduled refresh
- Recommendation acceptance creates a draft policy for explicit review; intelligence never silently raises an active spending limit.

## Bundled resource server — synthetic integration fixture

The repository’s bundled market-data, file, inference, and research endpoints are synthetic fixtures for exercising x402 flows. They are labeled as such in API/catalog responses and must not be represented as live market data, real model inference, or live web research. Replacing them with real providers requires provider-specific credentials, monitoring, rate limits, provenance, error handling, and SLOs.

## Current release blockers

The code path is not considered production-launched until all applicable evidence exists:

1. The **exact final release head** passes migrations, lint, typecheck, unit tests, Cardano signer tests, browser smoke tests, facilitator/resource tests, container builds, CodeQL, dependency review, required quality gates and a fresh code review.
2. Cardano Preprod is deployed with real HTTPS dashboard/resource/facilitator/signer endpoints, real Blockfrost credentials, deliberately funded payer UTxOs, distinct capability credentials and reviewed remote signing custody; low-value ADA and enabled-token canaries are independently explorer-verified and recorded against the release SHA.
3. Cardano Mainnet uses a separate signer/facilitator/custody deployment, canonical USDCx configuration, funded production UTxOs, monitoring/paging and a separate low-value Mainnet canary. Preprod credentials/custody must not be reused.
4. Pyth production access/feed IDs and Masumi authenticated registry/trusted-policy configuration are exercised against real providers when those controls are enabled; failure drills confirm each dependency fails closed.
5. Dune queries are created/executed using a real account, sample results are independently checked against Cardano explorer evidence, and any public dashboard URL shown by AgentPay points to an actually published dashboard.
6. Stripe approves the production Issuing and applicable fiat products, followed by low-value card/fiat canaries for those enabled rails.
7. Production LI.FI routes are verified with funded EVM accounts, source/destination explorers, and failure/refund drills when cross-chain operation is enabled.
8. Production signing keys are held only by reviewed KMS/HSM/external-signing boundaries where applicable. DNS/TLS, secret manager, production Supabase redirects/email, monitoring, paging, named on-call ownership and point-in-time database recovery are enabled.
9. A restore drill, incident exercise, independent security assessment, and all applicable production x402 canaries are recorded against an immutable release SHA.
10. Any CI/CodeQL/dependency-review job that fails before execution is repaired at the repository/runner/security-settings layer and rerun successfully; a missing test run is not treated as a passing test.

See `docs/production-readiness.md`, `docs/cardano-production.md`, and `docs/production-runbook.md` for the release contract and operational procedures.
