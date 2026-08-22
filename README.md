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
├── docs/                  Runbooks, release and submission material
├── render.yaml            Unified Cardano signer + facilitator Blueprint
├── render-cardano-signer.yaml  Standalone signer Blueprint for isolated rollouts
└── .github/workflows/     CI, CodeQL, dependency review and signer verification
```

A signer/facilitator deployment may be shared infrastructure; an agent payment identity is never shared. Managed identities are isolated per agent. Cardano Mainnet autonomous agents use a separate external Ed25519 signer identity per immutable Agent ID rather than a deployment-wide payer or derivation secret. The database globally enforces one canonical payment identity per `PaymentAccount`, including concurrent claims from different organizations/app replicas.

The dashboard is deployed separately to Vercel and never receives managed-agent master keys or blockchain private keys. Cardano Mainnet supports both self-custody and external per-agent HSM/KMS/delegation signing; private keys remain outside the dashboard and facilitator.

See [`docs/managed-signer-isolation.md`](docs/managed-signer-isolation.md) for the custody and migration model.

## Supported networks

| Network | CAIP-2 | Role |
|---|---|---|
| Hedera Testnet | `hedera:testnet` | isolated per-agent managed wallets plus self-custody test operation |
| Hedera Mainnet | `hedera:mainnet` | self-custody production route; no deterministic managed-agent master key |
| Arc Testnet | `eip155:5042002` | isolated per-agent EVM managed wallets plus self custody |
| Cardano Preprod | `cardano:preprod` | isolated per-agent managed x402 `exact`, ADA and configured test native-token support |
| Cardano Mainnet | `cardano:mainnet` | x402 `exact` with self-custody plus external per-agent HSM/KMS/delegation signing; no shared managed-agent master key |

Cardano ADA uses `lovelace`. Mainnet `USDCX` is pinned in source/preflight to the configured Circle xReserve Cardano native-asset identity; arbitrary Cardano native tokens are not accepted. Preprod token configuration is deployment-specific and must not be represented as Mainnet USDCx.

## Payment identity isolation

Managed identities currently include:

- Hedera Testnet: unique Ed25519 identity/account per immutable Agent ID.
- Arc Testnet: unique secp256k1 identity/address per immutable Agent ID.
- Cardano Preprod: unique Ed25519 payment identity/address per immutable Agent ID derived inside the isolated signer.
- Cardano Mainnet: unique externally custodied Ed25519 public key/signer reference per immutable Agent ID when the Mainnet custody adapter is configured. AgentPay derives the `addr1...` address locally and verifies every returned signature.

The signer-side deterministic master secrets are testnet-only:

```text
HEDERA_MANAGED_AGENT_MASTER_KEY
ARC_MANAGED_AGENT_MASTER_KEY
CARDANO_MANAGED_AGENT_MASTER_KEY
```

Each is exactly 32 cryptographically random bytes encoded as 43-character unpadded base64url. They must be independent and must exist only on the appropriate testnet signer/facilitator service. Never place them in Vercel or on a Mainnet service.

Cardano Mainnet managed agents instead use the signer-only external custody configuration:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

The external adapter resolves a stable public key/signer reference for each Agent ID and signs only the transaction-body hash. The private key never enters AgentPay.

The database migration `20260821080000_payment_identity_isolation` adds a canonical unique identity index and a transaction-scoped PostgreSQL advisory-lock trigger. The migration intentionally aborts if legacy duplicate/shared-payer identities still exist. Those managed agents must be archived/reprovisioned rather than having historical payer evidence rewritten.

Infrastructure accounts such as a Hedera operator/contract payer or Arc relayer/contract executor remain separate service principals. They are not agent wallets.

## Catalyst integrations

### Cardano x402

Each Cardano payment requirement is bound to the canonical paid-resource URL with a SHA-256 `resourceBinding`, exact network, payer, payee, asset, amount, server-submission policy, confirmation policy and bounded timeout. The transaction builder creates a narrow phase-1 transaction; the facilitator independently decodes and verifies signed CBOR, witness, inputs, outputs, fee, TTL and nonce before submission.

Durable settlement claims bind the transaction hash to the complete resource-bound requirement, payer and UTxO nonce. Same-resource retries remain idempotent, while a transaction cannot unlock a second resource that happens to have the same price/payee. Ambiguous submission remains unresolved until independent chain evidence reconciles it.

### ADA and USDCx

ADA is the default Cardano asset. The Cardano rail can additionally support exactly one explicitly configured native-token unit. Token-bearing inputs/outputs are constrained to lovelace plus that unit, exact token conservation is required, the payee receives the exact quote and change can return only to the payer.

Preprod token support stays disabled until the exact unit and a funded agent-specific payer are verified. Mainnet uses the same narrow asset rules for either self-custody or external per-agent managed custody.

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

Dune is public-chain observability only. Checked-in SQL exposes Cardano settlement activity without organization, user, prompt, policy or private resource-content data. A Dune outage cannot block authorization, signing, settlement or reconciliation.

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

Budgets and reservations are per agent for every custody mode. Sharing a facilitator deployment does not create a shared organization treasury.

## Production safety model

AgentPay production configuration fails closed. Required production secrets, HTTPS endpoints, database dependencies, payment-rail configuration, oracle trust and identity/escrow dependencies must be valid before an enabled feature is considered ready.

Capability-scoped credentials remain separated by rail and function. Agent signer identities are additionally isolated from infrastructure operator, relayer, contract-execution and settlement accounts.

Cardano Preprod keeps the legacy generic managed-signing route disabled while dedicated per-agent `/managed-identity` and `/managed-agent-sign` paths handle autonomous agents. Cardano Mainnet keeps the generic route `unsigned-only` for self-custody and uses those same dedicated per-agent routes for external HSM/KMS/delegation custody when configured. Mainnet has no deployment-wide agent payer or managed-agent master key.

`/api/v1/ready` reports incomplete dependencies for the selected production profile rather than turning source support into a false readiness claim.

For the full code and operational checks, see [`docs/managed-signer-isolation.md`](docs/managed-signer-isolation.md), [`docs/production-readiness.md`](docs/production-readiness.md), [`docs/cardano-production.md`](docs/cardano-production.md), [`docs/production-runbook.md`](docs/production-runbook.md), and [`docs/catalyst-submission.md`](docs/catalyst-submission.md).

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
- Cardano Blockfrost/provider configuration when a Cardano rail is enabled
- Pyth/Masumi/Veridian/Dune configuration only when those features are enabled
- no blockchain private keys, HSM credentials or managed-agent master keys in the dashboard environment

Run Prisma migrations against the production database before shifting traffic to a release. The payment-identity migration will refuse legacy duplicate identities; reprovision them first rather than bypassing the constraint.

### Signer/facilitator services → Render

Create a Render Blueprint from root `render.yaml`. The key isolation placement is:

```text
combined facilitator:
  HEDERA_MANAGED_AGENT_MASTER_KEY
  ARC_MANAGED_AGENT_MASTER_KEY

Cardano signer, Preprod worker:
  CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY

Cardano signer, Mainnet worker:
  CARDANO_MAINNET_AGENT_CUSTODY_URL
  CARDANO_MAINNET_AGENT_CUSTODY_API_KEY

dashboard/Vercel:
  none of the above

Mainnet services:
  no deterministic managed-agent master key
```

The combined facilitator serves a network-bound root dispatcher and explicit namespaced endpoints:

```text
https://<facilitator-host>/verify
https://<facilitator-host>/settle
https://<facilitator-host>/supported
https://<facilitator-host>/hedera/*
https://<facilitator-host>/arc/*
https://<facilitator-host>/cardano/*
https://<facilitator-host>/health
```

Root `/verify` and `/settle` require `paymentRequirements.network` to match `paymentPayload.accepted.network` before dispatch. Dedicated managed-agent identity/signing routes additionally bind the immutable Agent ID and expected payer identity.

Cardano Mainnet self-custody and external per-agent managed custody are separate modes. The external custody adapter is configured only on the Cardano signer and cannot replace the payment-policy or facilitator verification layers.

## Organization data lifecycle

Owners can generate the redacted organization export from Settings. Credential-bearing notification destinations and encrypted secret material are omitted/redacted by the export API.

Owners can also schedule workspace deletion with exact slug and phrase confirmation plus recent authentication. Requesting deletion immediately activates containment controls. A REQUESTED deletion can be canceled; processing cannot be falsely reported complete before required provider cleanup succeeds.

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
node --test server.test.mjs

# Resource server
cd resource-server
npm install
npm test
npm run dev
```

Use the service-specific `.env.example` files for local configuration. Development fallbacks are not production custody patterns.

## Verification

Repository CI validates PostgreSQL migrations, the real concurrent payment-identity isolation invariant, governance/resource checks, dashboard lint/typecheck/tests/build, Hedera/Arc/combined facilitator paths, Cardano signer tests, resource server, browser smoke tests, production container builds, dependency risk and CodeQL/security gates. A workflow that never executes its steps is not a pass.

For the dashboard directly:

```bash
cd dashboard
npm run lint
npm run typecheck
npm test
npm run build
```

The database isolation check is:

```bash
cd dashboard
npm run verify:identity-isolation
```

It is intentionally restricted to a disposable local database because it creates competing transactions to prove the lock/unique constraint.

For a release, validation must be tied to the exact immutable commit SHA. An older successful preview is not evidence for a newer head.

## Feature status

The repository contains source paths for organization-scoped agents and roles; immutable spend/approval policy; audit evidence; multi-rail x402; per-agent managed testnet identities; Cardano Mainnet external per-agent custody; Cardano ADA/allowlisted-token settlement; Pyth-valued policy; Masumi registry trust; Masumi escrow/refund/result-hash/reputation workflows; Veridian/KERI identity binding; Dune public analytics; marketplace/resources; invoicing; virtual-card/fiat adapters; cross-chain automation; contract automation; organization export/deletion; and financial intelligence.

Implemented source support and a configured production profile are separate facts. Real provider credentials, funded agent-specific wallets and the operational checks for an enabled profile must match the deployment being operated.

See [`docs/implementation-status.md`](docs/implementation-status.md) for feature traceability.

## Security

Report suspected vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Never place production private keys, managed-agent master keys, unrestricted provider credentials, card data, session secrets, HSM credentials or write-scoped analytics credentials in GitHub issues or pull requests.

## License

MIT