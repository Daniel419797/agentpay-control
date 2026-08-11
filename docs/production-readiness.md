# AgentPay production readiness

This document separates **repository readiness** from **external launch readiness**. A green repository can prove that AgentPay fails closed, builds, tests, and enforces its documented trust boundaries. It cannot prove that a bank/card provider has approved an account, that a blockchain account is funded, that DNS is owned, or that an external KMS/HSM is configured.

## Release decision

A release is eligible for production only when every repository gate is green and every external gate required by the enabled feature set has recorded evidence against the exact release commit SHA.

### Repository gates

- `master` release candidate passes the main CI workflow: migrations, governance invariants, lint, typecheck, tests, production builds, Playwright smoke tests, and all production container builds.
- CodeQL has no unresolved high/critical finding applicable to the release.
- Dependency review has no newly introduced high/critical vulnerable dependency.
- Production configuration parses successfully; invalid or missing required values stop startup/readiness rather than falling back to development defaults.
- `KEY_ENCRYPTION_MASTER_KEY` is the canonical unpadded base64url encoding of exactly 32 random bytes.
- Dashboard production configuration contains no Hedera or Arc private keys.
- The combined facilitator uses six unique API credentials: signing, settlement, and contract execution for Hedera, and the same three independently for Arc.
- Hedera operator and managed payer private keys are not the same credential.
- Arc payer, x402 relayer, and explicit contract-execution private keys are all present and distinct in production.
- An unconfigured Hedera mainnet is not advertised by the production network router or operator switcher; configuring its facilitator also requires a mainnet signing capability credential.
- Hedera contract automation is bound to the allowlisted `hedera:testnet` or `hedera:mainnet` route. The selected network ID is persisted before submission and is reused for reconciliation instead of being re-derived from mutable rule state.
- Mainnet contract automation has its own facilitator contract capability credential and payer account ID; it never falls back to testnet contract credentials, payer identity, or mirror-node evidence.
- Enabled resource-server networks have explicit HTTPS facilitator URLs, settlement credentials, provider/payee identifiers, and payment asset identifiers.
- Dashboard readiness validates PostgreSQL migration state plus the exact x402 network advertised by every configured facilitator.
- Unsafe request bodies are size-bounded for JSON, URL-encoded, and multipart form submissions.
- Outbound user-configurable resource fetches reject private/link-local/multicast addresses and use DNS-pinned connections in production.
- Runtime containers execute as an unprivileged user.
- Operator UI hides write actions when the active membership lacks the required role; backend role enforcement remains authoritative.

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
- `HEDERA_PAYER_ACCOUNT_ID` for testnet managed contract transaction identity
- if `HEDERA_MAINNET_FACILITATOR_URL` is configured, `HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY` is also required
- if mainnet contract automation is enabled, `HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY` and `HEDERA_MAINNET_PAYER_ACCOUNT_ID` are required and must remain independent from testnet capabilities
- Arc facilitator URL plus signing and contract capability keys and Arc RPC/provider address

Do not place `HEDERA_OPERATOR_KEY`, `HEDERA_PAYER_KEY`, `ARC_PAYER_PRIVATE_KEY`, `ARC_RELAYER_PRIVATE_KEY`, or `ARC_CONTRACT_EXECUTION_PRIVATE_KEY` in Vercel.

### Combined facilitator (Render)

Production requires the Hedera and Arc chain credentials needed by their respective facilitators plus the six generated network-scoped API capability keys defined in `render.yaml`. Generic `MANAGED_SIGNING_API_KEY`, `SETTLEMENT_API_KEY`, and `CONTRACT_EXECUTION_API_KEY` are local-development compatibility variables only.

Arc production requires three independent chain credentials:

- `ARC_PAYER_PRIVATE_KEY` for managed payer signatures;
- `ARC_RELAYER_PRIVATE_KEY` for the x402 facilitator/relayer signer;
- `ARC_CONTRACT_EXECUTION_PRIVATE_KEY` for allowlisted explicit contract calls.

Do not reuse those values. Move them to KMS/HSM/external signing before real-value launch where supported.

A Hedera mainnet facilitator is deployed separately from the default testnet Render service. If mainnet contract automation is used, expose that instance to the dashboard with its mainnet contract capability key and the public payer account ID used to pre-record transaction identity. The raw mainnet payer private key remains only in the mainnet facilitator.

### Resource server (Render)

The production start command runs a preflight before starting the HTTP server. Every network listed in `ENABLED_NETWORKS` must have an explicit HTTPS facilitator URL, settlement capability key, payee/provider identifier, and token identifier where applicable. The default blueprint enables Hedera testnet and Arc testnet, so `PROVIDER_ACCOUNT_ID` and `USDC_TOKEN_ID` must be supplied for Hedera.

The bundled `/v1/*` market, file, inference, and research resources are explicitly synthetic integration fixtures. They must not be marketed or exposed as live market data, real model inference, or live web research without replacing the fixture implementations with production providers and appropriate provider-level monitoring/SLOs.

## Release procedure

1. Open a release/hardening pull request against `master` and let every required check finish.
2. Resolve all security, dependency, build, migration, type, unit, browser, and container failures before merge.
3. Merge an immutable reviewed SHA.
4. Apply database migrations before shifting production traffic.
5. Deploy facilitator and verify `/health` and each mounted `/supported` endpoint.
6. Deploy the dashboard and require `/api/v1/ready` to return ready.
7. Deploy the resource server and verify `/health` and one test-priced x402 resource on each enabled network.
8. Run maintenance once, inspect dead-letter/unknown-submission queues, and verify monitoring.
9. Run low-value canaries for each production-enabled rail.
10. Record explorer/provider evidence and the exact release SHA.

## Rollback rule

Application containers may roll back to a previously verified SHA. Database migrations are forward-only: repair schema regressions with a new corrective migration rather than editing or destructively rolling back a migration already recorded in production.
