# AgentPay Control

AgentPay is a policy-controlled payment operating system for autonomous software agents. It applies organization roles, immutable spending policy, approvals, audit evidence, reconciliation, emergency controls, trust verification, and isolated signing around autonomous payments.

The Cardano path combines x402 `exact` payments, ADA and explicitly whitelisted Cardano native-token settlement, conservative Pyth-valued USD controls, Masumi registry identity plus escrow/refund/reputation workflows, optional Veridian/KERI credential trust, and read-only Dune public-chain analytics. Payment-critical integrations fail closed; Dune remains outside authorization and settlement.

Built originally for the Hedera x402 bounty and extended into a multi-rail agent-payment control plane.

## Architecture

```text
agentpay-control/
├── dashboard/             Next.js operator dashboard, policy engine and API (Vercel)
│   ├── src/               Pages, APIs, payment/trust/reconciliation services
│   ├── prisma/            PostgreSQL schema and forward-only migrations
│   ├── packages/          SDK, MCP server and LangChain integrations
│   └── e2e/               Playwright smoke tests
├── facilitator/           Hedera x402 facilitator
├── facilitator-arc/       Arc EVM x402 facilitator
├── facilitator-combined/  Root dispatcher plus /hedera, /arc and /cardano apps
├── cardano-signer/        Isolated Cardano transaction-builder/signing gateway
├── resource-server/       x402-protected demonstration resources
├── analytics/dune/        Public Cardano analytics SQL + reproducible publisher
├── docs/                  Runbooks, release evidence and submission material
├── render.yaml            Preprod signer + facilitator + resource-server Blueprint
├── render-cardano-signer.yaml  Standalone signer Blueprint for isolated rollouts
└── .github/workflows/     CI, CodeQL, dependency review and signer verification
```

The dashboard is not provisioned by `render.yaml`; deploy it separately to Vercel. The Cardano signer is a separate service/trust boundary from the combined facilitator even when both are declared in the same Render Blueprint. Mainnet must use separately scoped custody and deployment credentials.

## Supported networks

| Network | CAIP-2 | Role |
|---|---|---|
| Hedera Testnet | `hedera:testnet` | managed x402 signing/verification/settlement and test operation |
| Hedera Mainnet | `hedera:mainnet` | separately configured production-capable Hedera route |
| Arc Testnet | `eip155:5042002` | EVM x402 and contract-automation test rail |
| Cardano Preprod | `cardano:preprod` | managed x402 `exact`, ADA and explicitly configured test native-token support |
| Cardano Mainnet | `cardano:mainnet` | source-supported x402 `exact`; requires separate production custody and launch evidence |

Cardano ADA uses `lovelace`. Mainnet `USDCX` is pinned in source/preflight to the canonical configured Circle xReserve Cardano native-asset identity; arbitrary Cardano native tokens are not accepted. Preprod token configuration is deployment-specific and must not be represented as Mainnet USDCx.

## Catalyst integrations

### Cardano x402

Each Cardano payment requirement is bound to the canonical paid-resource URL with a SHA-256 `resourceBinding`, exact network, payer, payee, asset, amount, server-submission policy, confirmation policy and bounded timeout. The signer builds a narrow phase-1 transaction; the facilitator independently decodes and verifies signed CBOR, witness, inputs, outputs, fee, TTL and nonce before submission.

Durable settlement claims bind the transaction hash to the complete resource-bound requirement, payer and UTxO nonce. Same-resource retries remain idempotent, while a transaction cannot unlock a second resource that happens to have the same price/payee. Ambiguous submission remains unresolved until independent chain evidence reconciles it.

### ADA and USDCx

ADA is the default Cardano asset. The Cardano rail can additionally support exactly one explicitly configured native-token unit. Token-bearing inputs/outputs are constrained to lovelace plus that unit, exact token conservation is required, the payee receives the exact quote and change can return only to the payer.

Preprod token support is disabled in the root production Blueprint until the exact unit, funded payer and low-value canary are verified. Mainnet requires an independent deployment/custody gate.

### Pyth

Optional Pyth Hermes integration converts supported asset amounts into conservative USD micro-dollar values for policy enforcement. AgentPay uses the upper edge of the confidence interval, rounds upward, rejects stale/future/low-confidence/non-positive observations and combines USD limits with atomic limits using the more restrictive outcome. Oracle failure never relaxes policy.

### Masumi registry, escrow, refunds and reputation

Masumi has two intentionally separate roles:

1. **Registry/payee trust for direct x402.** AgentPay verifies the expected Masumi network, trusted registry policy, online API base URL, capability, seller wallet and payment-key facts before a seller wallet can become a trusted Cardano payee.
2. **Masumi escrow purchase flow.** AgentPay can create a Masumi purchase, lock funds, start the seller job, reconcile provider state, verify the returned result hash, record completion, request refunds and allow an authorized seller workspace to authorize a refund.

Escrow input is encrypted at rest. Payment state and result evidence are reconciled independently rather than inferred from HTTP success. Seller reputation is derived only from AgentPay-observed Masumi escrow outcomes: verified completions, authorized refunds, disputes and failures. A published policy can require a minimum number of verified completions and/or a minimum reputation score before new spend is authorized.

Direct x402 settlement is never mislabeled as Masumi escrow.

### Veridian / KERI / ACDC

Optional Veridian/KERIA integration binds a cryptographically verified ACDC credential to an already verified Masumi resource identity. AgentPay delegates KERI/ACDC cryptographic verification to the configured KERIA authority, then enforces deployment-level trusted issuer/schema sets, revocation/expiry evidence, subject identity and a credential claim matching the Masumi agent identifier.

Published policies can further narrow the deployment trust set with issuer AID and schema SAID allowlists plus a maximum verification age. A stale, expired, revoked, untrusted or identity-mismatched credential fails closed.

### Dune

Dune is public-chain observability only. Checked-in SQL exposes Cardano settlement activity without organization, user, prompt, policy or private resource-content data. `analytics/dune/publish.mjs` creates/updates the public queries, and `analytics/dune/publish-dashboard.mjs` creates the visualizations/dashboard when a real Dune write credential and query IDs are supplied.

A Dune outage cannot block authorization, signing, settlement or reconciliation. Publication is a release-evidence gate, not a payment dependency.

## Policy controls

A published policy version can constrain:

- per-transaction, hourly, daily and monthly atomic spend
- DENY versus REQUIRE_APPROVAL over-limit behavior
- merchant allowlist/denylist and merchant categories
- approval and rejection thresholds
- maximum transactions per hour and payment cooldown
- activation/expiry plus UTC weekday/time windows
- Pyth-valued USD transaction/hour/day/month limits
- Masumi registry identity, capabilities, freshness and online requirement
- minimum Masumi verified-completion history and reputation
- Veridian/KERI issuer/schema trust and credential freshness

All selected controls are attached while a new policy version is still DRAFT, then the complete version is published atomically. Existing published versions are immutable and become SUPERSEDED when a new version is published.

## Production safety model

AgentPay production configuration fails closed. Required production secrets, HTTPS endpoints, database dependencies, payment-rail configuration, oracle trust and identity/escrow dependencies must be valid before an enabled feature is considered ready.

Capability-scoped credentials are separated by rail and function. Cardano additionally separates:

- dashboard/control-plane credentials
- facilitator managed-signing capability
- facilitator settlement capability
- durable settlement-store capability
- signer-gateway capability
- remote Ed25519/HSM signing capability

The production Cardano signer rejects raw signing seeds. It sends only the transaction-body hash to the remote signing boundary and verifies the returned Ed25519 signature locally. Preprod and Mainnet must not share signer deployments or custody credentials.

`/api/v1/ready` and Catalyst release evidence are designed to report enabled-but-incomplete external dependencies rather than turning source support into a false production-ready claim.

For the full code and launch gates, see [`docs/production-readiness.md`](docs/production-readiness.md), [`docs/cardano-production.md`](docs/cardano-production.md), [`docs/production-runbook.md`](docs/production-runbook.md), and [`docs/catalyst-submission.md`](docs/catalyst-submission.md).

## Deployment

### Dashboard → Vercel

Deploy `dashboard` to Vercel and configure its production environment from `.env.example` plus real provider values. Important rules include:

- `APP_ENV=production`
- HTTPS `NEXT_PUBLIC_APP_URL`
- managed PostgreSQL `DATABASE_URL`
- unique `AUTH_SECRET` and `CRON_SECRET`
- exactly 32 random bytes encoded as unpadded base64url for `KEY_ENCRYPTION_MASTER_KEY`
- production Supabase configuration
- network/capability-specific facilitator credentials
- Cardano Blockfrost/provider/payer configuration when a Cardano rail is enabled
- Pyth API/feed configuration when Pyth policy is enabled
- Masumi registry/payment-node configuration when the corresponding feature is enabled
- Veridian/KERIA verifier URL plus explicit deployment issuer/schema trust sets when identity policy is enabled
- verified Dune query IDs/read credential only when Dune analytics is enabled
- no production payment private key or raw Cardano signing seed in dashboard environment

Run Prisma migrations against the production database before shifting traffic to a release.

### Preprod services → Render

Create a Render Blueprint from root `render.yaml`. It declares:

- `agentpay-cardano-signer-preprod`
- `agentpay-facilitator`
- `agentpay-resource-server`

The signer gateway API capability, signer URL, Cardano payer/asset configuration and Blockfrost configuration are wired into the facilitator with Render service references. The actual Ed25519 custody service remains external and receives only a transaction-body hash.

The combined facilitator serves both a network-bound root dispatcher and explicit namespaced endpoints:

```text
https://<facilitator-host>/verify
https://<facilitator-host>/settle
https://<facilitator-host>/supported
https://<facilitator-host>/hedera/*
https://<facilitator-host>/arc/*
https://<facilitator-host>/cardano/*
https://<facilitator-host>/health
```

Root `/verify` and `/settle` require `paymentRequirements.network` to exactly match `paymentPayload.accepted.network` before dispatch, so one public service URL can be safely used by the resource server while rail credentials remain scoped.

`render-cardano-signer.yaml` remains available for a separately managed signer rollout. Mainnet should use a separate Blueprint/service/custody boundary rather than reusing Preprod.

## Organization data lifecycle

Owners can generate the redacted organization export from Settings. Credential-bearing notification destinations and encrypted secret material are omitted/redacted by the export API.

Owners can also schedule workspace deletion with exact slug and phrase confirmation plus recent authentication. Requesting deletion immediately activates containment controls (including emergency stop/agent credential revocation as implemented by the deletion saga). A REQUESTED deletion can be canceled; processing cannot be falsely reported complete before required provider cleanup succeeds.

## Local development

```bash
# PostgreSQL
docker compose up -d

# Dashboard
cd dashboard
npm install
npm run dev -- -p 3100

# Combined facilitator
cd facilitator-combined
npm install
npm run build --workspace=@agentpay/hedera-facilitator --workspace=@agentpay/arc-facilitator
npm test
npm run dev

# Cardano signer
cd cardano-signer
npm run typecheck
npm test

# Resource server
cd resource-server
npm install
npm test
npm run dev
```

Use the service-specific `.env.example` files for local configuration. Development fallbacks are not production custody patterns.

## Verification

Repository workflows are intended to validate PostgreSQL migrations, governance/resource invariants, dashboard lint/typecheck/tests/build, Hedera/Arc/Cardano facilitator paths, the Cardano signer, resource server, browser smoke tests, production container builds, dependency risk and CodeQL. A workflow that never executes its steps is not considered a pass.

For the dashboard directly:

```bash
cd dashboard
npm run lint
npm run typecheck
npm test
npm run build
```

For a release, validation must be tied to the exact immutable commit SHA. An older successful preview is not evidence for a newer head.

## Feature status

The repository contains source paths for organization-scoped agents and roles; immutable spend/approval policy; audit evidence; multi-rail x402; Cardano ADA/allowlisted-token settlement; isolated Cardano signing; Pyth-valued policy; Masumi registry trust; Masumi escrow/refund/result-hash/reputation workflows; Veridian/KERI identity binding; Dune public analytics; marketplace/resources; invoicing; virtual-card/fiat adapters; cross-chain automation; contract automation; organization export/deletion; and financial intelligence.

“Implemented in code” is not the same as “production launched.” Real credentials, provider access, funded wallets, remote signing custody, monitoring, backups/restore evidence, exact-head CI/deployment, canaries and independent security evidence remain release gates where applicable.

See [`docs/implementation-status.md`](docs/implementation-status.md) for feature traceability.

## Security

Report suspected vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Never place production private keys, unrestricted provider credentials, card data, session secrets, HSM credentials or write-scoped analytics credentials in GitHub issues or pull requests.

## License

MIT
