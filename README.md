# AgentPay Control

AgentPay is a policy-controlled payment operating system for autonomous software agents. It applies organization roles, atomic and USD-denominated spending policy, approvals, audit evidence, reconciliation, emergency controls, and isolated signing around x402 payments across Hedera, Arc, and Cardano.

The Cardano path combines direct x402 `exact` payments with ADA and explicitly whitelisted USDCx/native-token settlement, optional Pyth-valued USD policy limits, optional Masumi registry identity/payee trust, and read-only Dune public-chain analytics. These integrations fail closed when configured for the payment plane; Dune remains outside authorization and settlement.

Built originally for the Hedera x402 bounty and extended into a broader agent-payment control plane.

## Architecture

```text
agentpay-control/
├── dashboard/             Next.js operator dashboard, policy engine and API (Vercel)
│   ├── src/               Pages, API routes, domain services, security controls
│   ├── prisma/            PostgreSQL schema and forward-only migrations
│   ├── packages/          SDK, MCP server, LangChain integrations
│   └── e2e/               Playwright smoke tests
├── facilitator/           Hedera x402 facilitator
├── facilitator-arc/       Arc EVM x402 facilitator
├── facilitator-combined/  Service mounting /hedera, /arc and /cardano
├── cardano-signer/        Isolated Cardano transaction-builder/signing gateway
├── resource-server/       x402-protected demonstration resources
├── analytics/dune/        Public Cardano analytics SQL + reproducible publisher
├── docs/                  Runbooks, implementation status, release guidance
├── render.yaml            Facilitator + resource-server deployment blueprint
├── render-cardano-signer.yaml  Separate Cardano signer deployment blueprint
└── .github/workflows/     CI, CodeQL, dependency review and signer verification
```

The dashboard is **not** provisioned by `render.yaml`; it is deployed separately to Vercel. The Cardano signing gateway is deliberately a separate deployment/trust boundary from the combined facilitator.

## Supported networks

| Network | CAIP-2 | Role |
|---|---|---|
| Hedera Testnet | `hedera:testnet` | managed x402 signing/verification/settlement and test operation |
| Hedera Mainnet | `hedera:mainnet` | separately configured production-capable Hedera route |
| Arc Testnet | `eip155:5042002` | EVM x402 and contract-automation test rail |
| Cardano Preprod | `cardano:preprod` | managed direct x402 `exact`, ADA and explicitly configured test native-token support |
| Cardano Mainnet | `cardano:mainnet` | source-supported direct x402 `exact`; requires separate production signer/custody and launch evidence |

Cardano ADA uses `lovelace`. Mainnet USDCx is pinned to the canonical Circle xReserve Cardano native-asset identity in source and production preflight; arbitrary Cardano native tokens are not accepted. Preprod token configuration is explicitly deployment-specific and must not be represented as Mainnet USDCx.

## Catalyst integrations

### x402 + Cardano

Every Cardano requirement is bound to the canonical paid-resource URL, exact network, payer, payee, asset, amount, server-submission policy, confirmation policy, and bounded timeout. The signer builds a narrow phase-1 transaction; the facilitator independently decodes and verifies the signed CBOR before submission. Ambiguous submissions remain unresolved until independent chain evidence reconciles them.

### USDCx

The Cardano rail supports exactly one configured native-token asset in addition to ADA. Mainnet `USDCX` resolves only to the canonical pinned Circle xReserve asset. Token inputs may contain only lovelace plus that asset; exact token conservation is required, the payee receives the exact quoted amount, and all change returns only to the payer.

### Pyth

Optional Pyth Hermes integration converts ADA/USDCx amounts into conservative USD micro-dollar values for policy enforcement. AgentPay uses the upper edge of the price confidence interval, rounds upward, rejects stale/future/low-confidence observations, and combines USD rules with the existing atomic policy using the most restrictive result. Oracle failure never relaxes a policy.

### Masumi

Optional Masumi integration is an **identity/discovery and direct-payee trust layer**. AgentPay verifies an online registry identity, explicitly trusted registry policy, API base URL, capability and seller wallet/payment-information facts before allowing that seller wallet to become the direct Cardano x402 payee. This repository does not claim that a direct AgentPay x402 settlement is a Masumi escrow purchase; escrow is a separate Masumi settlement flow.

### Dune

Dune is public-chain observability only. Checked-in SQL queries expose Cardano settlement activity without private organization, policy, prompt or user data. `analytics/dune/publish.mjs` can create/update the public queries when a real Dune write credential and deployment addresses are supplied. A Dune outage cannot block authorization, signing, settlement or reconciliation.

## Production safety model

AgentPay production configuration fails closed. Required production secrets, facilitator URLs, database dependencies, payment-rail configuration, oracle trust, and Masumi registry trust must be valid before the relevant feature is considered ready.

Capability-scoped credentials are separated by rail and function. Cardano additionally separates:

- dashboard/control-plane credentials
- facilitator managed-signing capability
- facilitator settlement capability
- durable settlement-store capability
- signer-gateway capability
- remote Ed25519/HSM signing capability

The production Cardano signer rejects raw signing seeds. It sends only the Cardano transaction-body hash to the remote signing boundary and verifies the returned Ed25519 signature locally. Preprod and Mainnet must not share signer deployments or custody credentials.

The dashboard never needs Hedera, Arc or Cardano production private signing material. For the complete code and external launch gates, see [`docs/production-readiness.md`](docs/production-readiness.md), [`docs/cardano-production.md`](docs/cardano-production.md), and [`docs/production-runbook.md`](docs/production-runbook.md).

## Deployment

### Dashboard → Vercel

Deploy `dashboard` to Vercel and configure its production environment from `.env.example` plus actual provider values. Important production rules include:

- `APP_ENV=production`
- HTTPS `NEXT_PUBLIC_APP_URL`
- managed PostgreSQL `DATABASE_URL`
- unique `AUTH_SECRET` and `CRON_SECRET`
- exactly 32 random bytes encoded as unpadded base64url for `KEY_ENCRYPTION_MASTER_KEY`
- production Supabase configuration
- network/capability-specific facilitator credentials
- Cardano Blockfrost/provider/payer configuration when a Cardano rail is enabled
- Pyth API/feed configuration when oracle USD policy is enabled
- Masumi API and explicit trusted registry-policy IDs when Masumi policy is enabled
- verified Dune query IDs/read credential only when Dune analytics is enabled
- no payment private keys or raw Cardano signing seed in the dashboard environment

Run Prisma migrations against the production database before shifting traffic to a release.

### Facilitator + resource server → Render

Create a Render Blueprint from root `render.yaml`.

The combined facilitator serves:

```text
https://<facilitator-host>/hedera
https://<facilitator-host>/arc
https://<facilitator-host>/cardano
https://<facilitator-host>/health
```

For Cardano, separately deploy `render-cardano-signer.yaml` and point the facilitator's `CARDANO_SIGNER_URL` at that HTTPS signer gateway. Production signer configuration requires a separate remote Ed25519/HSM-style signing boundary and public verification key.

The resource-server container runs a production preflight before starting. An enabled network with a missing payee, asset ID, settlement credential, HTTPS facilitator URL, or inconsistent Mainnet USDCx identity stops startup instead of advertising an unusable payment option.

Mainnet rails must use independently scoped production custody and credentials rather than reusing testnet/Preprod values.

## Local development

```bash
# PostgreSQL
docker compose up -d

# Dashboard
cd dashboard
npm install
npm run dev -- -p 3100

# Hedera facilitator
cd facilitator
npm install
npm run dev

# Arc facilitator
cd facilitator-arc
npm install
npm run dev

# Combined facilitator
cd facilitator-combined
npm install
npm run build --workspace=@agentpay/hedera-facilitator --workspace=@agentpay/arc-facilitator
npm run dev

# Cardano signer syntax/tests
cd cardano-signer
npm run typecheck
npm test

# Resource server
cd resource-server
npm install
npm run dev
```

Use the service-specific `.env.example` files for local configuration. Development fallbacks are not production custody patterns.

## Verification

Repository workflows are intended to validate PostgreSQL migrations, governance/resource invariants, dashboard lint/typecheck/tests/build, Hedera/Arc/Cardano facilitator paths, the Cardano signer, resource server, browser smoke tests, production container builds, dependency risk, and CodeQL. A workflow that never executes its steps is not considered a pass.

For the dashboard directly:

```bash
cd dashboard
npm run lint
npm run typecheck
npm test
npm run build
```

## Feature status

The repository contains implemented code paths for organization-scoped agents, roles, policies, approvals, audit evidence, multi-rail x402 settlement, Cardano ADA/whitelisted-token settlement, Pyth-valued policy controls, Masumi seller-identity trust, Dune public analytics, marketplace/resources, invoicing, virtual-card/fiat provider adapters, cross-chain automation, contract automation, and financial intelligence.

“Implemented in code” is not the same as “production launched.” Real credentials, provider access, funded wallets, remote signing custody, monitoring, backups/restore evidence, exact-head CI/deployment, canaries and independent security evidence remain deployment gates where applicable.

See [`docs/implementation-status.md`](docs/implementation-status.md) for feature traceability.

## Security

Report suspected vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Never place production private keys, unrestricted provider credentials, card data, session secrets, HSM credentials or write-scoped analytics credentials in GitHub issues or pull requests.

## License

MIT
