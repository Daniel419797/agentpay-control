# AgentPay production readiness

This document separates **repository readiness** from **external launch readiness**. A green repository can prove that AgentPay fails closed, builds, tests, and enforces its documented trust boundaries. It cannot prove that a bank/card provider has approved an account, that a blockchain account is funded, that DNS is owned, or that an external KMS/HSM is configured.

## Release decision

A release is eligible for production only when every repository gate is green and every external gate required by the enabled feature set has recorded evidence against the exact release commit SHA.

### Repository gates

- `master` release candidate passes the main CI workflow: migrations, governance invariants, lint, typecheck, tests, production builds, Playwright smoke tests, and all production container builds.
- CodeQL has no unresolved high/critical finding applicable to the release.
- Dependency review has no newly introduced high/critical vulnerable dependency.
- Sonar/quality analysis required by repository policy is green or every remaining issue has an explicit reviewed disposition.
- Production configuration parses successfully; invalid or missing required values stop startup/readiness rather than falling back to development defaults.
- `KEY_ENCRYPTION_MASTER_KEY` is the canonical unpadded base64url encoding of exactly 32 random bytes.
- Dashboard production configuration contains no Hedera or Arc private keys.
- The combined facilitator uses six unique API credentials: signing, settlement, and contract execution for Hedera, and the same three independently for Arc.
- Hedera operator and managed payer private keys are not the same credential.
- Arc payer, x402 relayer, and explicit contract-execution private keys are all present and distinct in production.
- Agent API credentials issued in production use the `ap_live_` prefix; non-production credentials use `ap_test_`. New credentials use collision-resistant lookup prefixes while legacy shorter prefixes remain readable during migration.
- OAuth uses PKCE plus one-time state bound to an HttpOnly host cookie.
- Unsafe cookie-authenticated API mutations require the exact configured application origin.
- An unconfigured Hedera mainnet is not advertised by the production network router or operator switcher; configuring its facilitator also requires a mainnet signing capability credential.
- Arc appears in the operator network selector only when its facilitator, signing capability, and public managed payer address are configured. Arc browser-wallet/self-custody flows are not advertised as implemented.
- Hedera contract automation is bound to the allowlisted `hedera:testnet` or `hedera:mainnet` route. The selected network ID is persisted before submission and is reused for reconciliation instead of being re-derived from mutable rule state.
- Mainnet contract automation has its own facilitator contract capability credential and payer account ID; it never falls back to testnet contract credentials, payer identity, or mirror-node evidence.
- x402 payment creation binds the exact registered resource endpoint, quoted network, network-matched payment account, payer identity, asset/token identifier, amount, and verified payee. Same-slug endpoint fallback is prohibited.
- Current x402 V2 HTTP headers use Base64-encoded JSON for `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`. Temporary raw-JSON decoding is compatibility-only and is not emitted by AgentPay.
- The bundled resource server advertises all fully configured enabled payment rails in one x402 challenge; callers do not need a private network-selection header before receiving a 402 challenge.
- After signing, ambiguous settlement outcomes never become safe-to-retry pre-submission failures. Network errors, facilitator 5xx/unknown settlement, malformed success evidence, oversized responses, or missing transaction evidence leave the payment `SUBMISSION_UNKNOWN` and keep spend reserved.
- When the Arc facilitator broadcasts an EIP-3009 transfer but confirmation becomes uncertain, it retains and returns the exact transaction hash as **candidate evidence**, never as proof of success. The resource server and dashboard preserve that candidate for reconciliation.
- Hedera `SUBMISSION_UNKNOWN` payments with a pre-recorded candidate transaction ID are reconciled automatically from the correct mirror node against the exact payer, payee, asset/token ID, and atomic amount. Proven failures release spend; successful transfer mismatches/replays retain spend and open an urgent incident.
- Arc `SUBMISSION_UNKNOWN` payments with an exact broadcast transaction hash are reconciled from the configured Arc RPC only after required confirmations. Confirmation requires a successful receipt plus an exact USDC `Transfer` from the managed payer to the quoted payee for the quoted atomic amount. Reverts release spend; transfer mismatches/replays retain spend and open an urgent incident. Ambiguous Arc payments without a recoverable hash remain held for investigation and are never blindly resubmitted.
- A confirmed chain settlement whose paid-resource response could not be recovered remains `SETTLED`; fulfillment is marked unavailable and an operational support case is opened instead of pretending the purchase never happened.
- Human operator-initiated payments that require approval enforce four-eyes review: the same user who initiated the payment cannot cast an approving vote. Rejection by the initiator remains allowed. Agent-credential-initiated payments do not fabricate a human initiator.
- Organization emergency stop blocks new autonomous x402 signing, cross-chain quote/signature preparation, fiat transfer submission, cardholder/card/fiat-account provisioning, card reactivation, agent credential creation, and new automation side effects. Defensive card freeze/cancel, evidence ingestion, and reconciliation remain available.
- Automation activation requires Owner access plus recent authentication. Scheduled/event workers skip emergency-stopped organizations rather than failing the whole maintenance cycle, while already-submitted contract reconciliation continues.
- Organization-owned marketplace providers currently publish paid resources only on verified Hedera testnet settlement. Arc/mainnet third-party settlement remains disabled until a network-specific provider settlement-account model and ownership verification exist. Platform-owned bundled resources may use deployment-configured payees on enabled rails.
- Enabled resource-server networks have explicit HTTPS facilitator URLs, settlement credentials, provider/payee identifiers, and payment asset identifiers.
- Dashboard readiness validates PostgreSQL migration state plus the exact x402 network advertised by every configured facilitator.
- Hedera account snapshots store the selected asset balance: native HBAR uses tinybar balance and token assets use the selected token relationship. Arc managed agents store the configured USDC contract balance.
- Payment authorization subtracts unresolved reservations and settlements newer than the last chain balance snapshot, preventing stale balance snapshots from reopening already-spent funds.
- Card authorization spend windows are serialized and period-bounded; equal provider timestamps cannot bypass cumulative limits.
- Definitive fiat-provider 4xx rejection is terminal `FAILED`; only network/5xx/malformed-submission uncertainty becomes `SUBMISSION_UNKNOWN` and is reconciled with the same idempotency key.
- Notification webhook signing secrets are encrypted at rest and only returned at creation/rotation. Slack and generic webhook destination URLs are treated as credentials and are redacted from browser/API read responses and server-rendered settings HTML.
- Automation action ciphertext and webhook secret hashes are not returned in normal browser/API reads.
- Unsafe request bodies are size-bounded for JSON, URL-encoded, and multipart form submissions.
- Outbound user-configurable resource fetches reject private/link-local/multicast addresses and use DNS-pinned connections in production.
- Audit events remain immutable and hash-chain continuous. Retention maintenance may redact fulfillment bodies and delete eligible notification deliveries but does not delete audit-chain rows until a checkpointed externally verifiable archival protocol exists.
- Runtime containers execute as an unprivileged user.
- Operator UI hides write actions when the active membership lacks the required role; server-rendered settings reads apply the same role boundary instead of bypassing API authorization.
- Overview accounting never sums atomic amounts across different assets/decimal scales; settled spend and budget utilization are asset/network aware and explorer links follow the actual settlement rail.

### External launch gates

These cannot be completed by source-code changes alone:

- Production domain/DNS and TLS are active for every public service.
- Production database uses managed backups and point-in-time recovery; a restore drill is recorded.
- Production secrets are stored in the deployment platform secret manager and have a documented rotation owner.
- Hedera production signing material is moved to a KMS/HSM or external signing service where supported; application services do not persist raw production keys.
- Arc/EVM payer, relayer, and contract-execution signing material have equivalent managed-key custody before real-value operation.
- Stripe Issuing and any required money-management/fiat products are approved before `VIRTUAL_CARDS_ENABLED=true`; a low-value card and fiat canary succeeds.
- LI.FI routes are exercised with funded test/production-approved accounts for every enabled source/destination token pair, including failure/refund reconciliation.
- Supabase production redirect URLs and email delivery are configured and verified.
- Error tracking, metrics, paging, and an on-call owner are configured; maintenance and notification workers are monitored for staleness/dead letters.
- Incident-response and credential-rotation exercises have been run.
- An independent security assessment has no unresolved release-blocking finding.
- A low-value production x402 payment is verified independently in the relevant explorer and recorded against the release SHA.

## Environment rules

### Dashboard (Vercel)

The dashboard is deployed separately from the Render blueprint. At minimum production requires:

- `APP_ENV=production`
- HTTPS `NEXT_PUBLIC_APP_URL`
- managed `DATABASE_URL`
- unique `AUTH_SECRET` and `CRON_SECRET`
- canonical unpadded base64url `KEY_ENCRYPTION_MASTER_KEY` representing exactly 32 random bytes
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Hedera testnet facilitator URL plus signing, settlement, and contract capability keys
- `HEDERA_PAYER_ACCOUNT_ID` for the public managed Hedera payer identity
- `HEDERA_PROVIDER_ACCOUNT_ID` for platform-owned Hedera testnet resources
- if `HEDERA_MAINNET_FACILITATOR_URL` is configured, `HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY` is also required
- if Hedera mainnet platform resources are enabled, `HEDERA_MAINNET_PROVIDER_ACCOUNT_ID` must identify their payee
- if mainnet contract automation is enabled, `HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY` and `HEDERA_MAINNET_PAYER_ACCOUNT_ID` are required and must remain independent from testnet capabilities
- Arc facilitator URL plus signing and contract capability keys, Arc RPC URL/provider address, public `ARC_PAYER_ADDRESS`, and configured `ARC_USDC_ADDRESS`
- when production seed data for the bundled fixture provider is installed, HTTPS `RESOURCE_SERVER_URL` pointing to the deployed resource server

Do not place `HEDERA_OPERATOR_KEY`, `HEDERA_PAYER_KEY`, `ARC_PAYER_PRIVATE_KEY`, `ARC_RELAYER_PRIVATE_KEY`, or `ARC_CONTRACT_EXECUTION_PRIVATE_KEY` in Vercel.

### Combined facilitator (Render)

Production requires the Hedera and Arc chain credentials needed by their respective facilitators plus the six generated network-scoped API capability keys defined in `render.yaml`. Generic `MANAGED_SIGNING_API_KEY`, `SETTLEMENT_API_KEY`, and `CONTRACT_EXECUTION_API_KEY` are local-development compatibility variables only.

Arc production requires three independent chain credentials:

- `ARC_PAYER_PRIVATE_KEY` for managed payer signatures;
- `ARC_RELAYER_PRIVATE_KEY` for the x402 facilitator/relayer signer;
- `ARC_CONTRACT_EXECUTION_PRIVATE_KEY` for allowlisted explicit contract calls.

Do not reuse those values. Move them to KMS/HSM/external signing before real-value launch where supported. Expose only the payer's public address to the dashboard as `ARC_PAYER_ADDRESS`.

A Hedera mainnet facilitator is deployed separately from the default testnet Render service. If mainnet contract automation is used, expose that instance to the dashboard with its mainnet contract capability key and the public payer account ID used to pre-record transaction identity. The raw mainnet payer private key remains only in the mainnet facilitator.

### Resource server (Render)

The production start command runs a preflight before starting the HTTP server. Every network listed in `ENABLED_NETWORKS` must have an explicit HTTPS facilitator URL, settlement capability key, payee/provider identifier, and token identifier where applicable. The default blueprint enables Hedera testnet and Arc testnet, so `PROVIDER_ACCOUNT_ID`, Hedera `USDC_TOKEN_ID`, and `ARC_PROVIDER_ADDRESS`/`ARC_USDC_ADDRESS` must be supplied for those advertised requirements.

The resource server emits current x402 V2 Base64 payment headers and advertises every fully configured enabled rail in its 402 challenge. Legacy raw-JSON payment-signature input is accepted only as a migration compatibility path.

The bundled `/v1/*` market, file, inference, and research resources are explicitly synthetic integration fixtures. Production seeding uses `RESOURCE_SERVER_URL`; localhost endpoints are prohibited when `APP_ENV=production`. These fixtures must not be marketed or exposed as live market data, real model inference, or live web research without replacing the fixture implementations with production providers and appropriate provider-level monitoring/SLOs.

## Operational reconciliation

- Run `POST /api/v1/internal/maintenance` on the documented schedule with the internal service credential.
- Hedera unknown x402 submissions are reconciled from mirror-node evidence before unresolved-submission incident escalation.
- Arc unknown x402 submissions with a captured transaction hash are reconciled from exact Arc receipt/log evidence before incident escalation. Unknown Arc submissions without a recoverable hash stay held and incident-driven; do not retry settlement blindly.
- Fiat ambiguous submissions are retried only through the provider's stable idempotency key.
- Hedera contract unknown submissions reconcile against the network ID persisted before submission.
- A confirmed payment whose paid resource response was lost is recorded as settled, keeps spend settled, marks fulfillment unavailable, and opens an operational support case rather than pretending the purchase never happened.
- A successful chain transaction whose transfer evidence does not match the signed quote is a settlement mismatch: spend remains consumed and an urgent incident is opened.
- Emergency stop does not disable reconciliation. Operators must be able to account for transactions that may have been submitted before the stop became active.

## Release procedure

1. Open a release/hardening pull request against `master` and let every required check finish.
2. Resolve all security, dependency, build, migration, type, unit, browser, container, and quality-gate failures before merge.
3. Merge an immutable reviewed SHA.
4. Apply database migrations before shifting production traffic.
5. Deploy facilitator and verify `/health` and each mounted `/supported` endpoint.
6. Deploy the dashboard and require `/api/v1/ready` to return ready.
7. Deploy the resource server and verify `/health` plus the standard x402 402/payment flow on each enabled network.
8. Run maintenance once, inspect dead-letter/unknown-submission/reconciliation queues, and verify monitoring.
9. Run low-value canaries for each production-enabled rail.
10. Record explorer/provider evidence and the exact release SHA.

## Rollback rule

Application containers may roll back to a previously verified SHA. Database migrations are forward-only: repair schema regressions with a new corrective migration rather than editing or destructively rolling back a migration already recorded in production.
