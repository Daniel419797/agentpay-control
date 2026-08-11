# AgentPay Control

AgentPay is a policy-controlled payment operating system for autonomous software agents. It applies organization roles, spending policy, approvals, audit evidence, and settlement controls around x402 payments, with Hedera and Arc testnet rails implemented in this repository.

Built originally for the Hedera x402 bounty and extended into a broader agent-payment control plane.

## Architecture

```text
agentpay-control/
├── dashboard/             Next.js operator dashboard and API (Vercel)
│   ├── src/               Pages, API routes, domain services, security controls
│   ├── prisma/            PostgreSQL schema and forward-only migrations
│   ├── packages/          SDK, MCP server, LangChain integrations
│   └── e2e/               Playwright smoke tests
├── facilitator/           Hedera x402 facilitator
├── facilitator-arc/       Arc EVM x402 facilitator
├── facilitator-combined/  Production Render service mounting /hedera and /arc
├── resource-server/       x402-protected demonstration resources
├── docs/                  Runbooks, implementation status, release guidance
├── render.yaml            Render blueprint for facilitator + resource server
└── .github/workflows/     CI, CodeQL, dependency review
```

The dashboard is **not** provisioned by `render.yaml`; it is deployed separately to Vercel. The Render blueprint provisions the combined facilitator and resource server.

## Supported networks

| Network | CAIP-2 | Role |
|---|---|---|
| Hedera Testnet | `hedera:testnet` | x402 signing/verification/settlement and test operation |
| Hedera Mainnet | `hedera:mainnet` | production-capable Hedera route when separately configured |
| Arc Testnet | `eip155:5042002` | EVM x402 and contract automation test rail |

The dashboard network switcher controls the selected Hedera network for supported operator flows. In production, mainnet is shown only when a mainnet facilitator is configured. Arc routes are available to payment/domain integrations that explicitly select Arc.

## Production safety model

AgentPay production configuration fails closed. Required production secrets, facilitator URLs, database dependencies, and payment-rail configuration must be valid before the relevant service is considered ready.

The combined facilitator uses **network-scoped, capability-scoped credentials**. Production requires six different API keys:

- Hedera managed signing
- Hedera settlement
- Hedera contract execution
- Arc managed signing
- Arc settlement
- Arc contract execution

Do not reuse these values. Hedera operator and managed payer private keys must also be separate. Arc production additionally requires three distinct chain credentials: `ARC_PAYER_PRIVATE_KEY`, `ARC_RELAYER_PRIVATE_KEY`, and `ARC_CONTRACT_EXECUTION_PRIVATE_KEY`.

The dashboard never needs Hedera/Arc private keys. Production private keys belong in the facilitator boundary and should ultimately be held by a KMS/HSM or external signing service where supported.

For the complete code and external launch gates, see [`docs/production-readiness.md`](docs/production-readiness.md) and [`docs/production-runbook.md`](docs/production-runbook.md).

## Deployment

### Dashboard → Vercel

Deploy the `dashboard` application to Vercel and configure its production environment from `.env.example` plus your actual provider values. Important production rules include:

- `APP_ENV=production`
- HTTPS `NEXT_PUBLIC_APP_URL`
- managed PostgreSQL `DATABASE_URL`
- unique `AUTH_SECRET` and `CRON_SECRET`
- exactly 32 random bytes encoded as unpadded base64url for `KEY_ENCRYPTION_MASTER_KEY`
- production Supabase configuration
- facilitator URLs and capability-specific API keys
- no Hedera or Arc private keys in the dashboard environment

Run Prisma migrations against the production database before shifting traffic to a release.

### Facilitator + resource server → Render

Create a Render Blueprint from the root `render.yaml`.

The combined facilitator serves:

```text
https://<facilitator-host>/hedera
https://<facilitator-host>/arc
https://<facilitator-host>/health
```

Supply the chain credentials requested by Render. The blueprint generates the six network/capability API credentials and wires the appropriate **settlement-only** credentials into the resource server. Arc requires three separate chain private keys in production so payer signing, x402 relaying, and explicit contract execution do not share one credential.

For the resource server, also set:

- `FACILITATOR_URL=https://<facilitator-host>/hedera`
- `ARC_FACILITATOR_URL=https://<facilitator-host>/arc`
- Hedera `PROVIDER_ACCOUNT_ID`
- Hedera `USDC_TOKEN_ID`

The resource-server container runs a production preflight before starting. An enabled network with a missing payee, asset ID, settlement credential, or HTTPS facilitator URL stops startup instead of advertising an unusable payment option.

Hedera mainnet should use a separately configured production facilitator instance and production key custody rather than reusing testnet credentials.

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

# Combined facilitator alternative
cd facilitator-combined
npm install
npm run build --workspace=@agentpay/hedera-facilitator --workspace=@agentpay/arc-facilitator
npm run dev

# Resource server
cd resource-server
npm install
npm run dev
```

Use `facilitator-combined/.env.example` for local combined-facilitator configuration. Generic shared capability keys and Arc chain-key fallback remain available for local development only; production uses the isolated credentials documented in that file.

## Verification

From the repository root, CI validates PostgreSQL migrations, governance invariants, dashboard lint/typecheck/tests/build, Hedera and Arc facilitator builds/tests, the combined facilitator, the resource server, Playwright browser smoke tests, production Docker builds, dependency risk, and CodeQL analysis.

For the dashboard directly:

```bash
cd dashboard
npm run lint
npm run typecheck
npm test
npm run build
```

## Feature status

The repository contains implemented flows for organization-scoped agents, roles, policies, approvals, audit evidence, x402 settlement, marketplace/resources, invoicing, virtual-card/fiat provider adapters, cross-chain automation, contract automation, and financial intelligence. Some rails remain dependent on external production approvals, funded accounts, KMS/HSM custody, monitoring, DNS/TLS, and recorded canary/restore/security evidence.

See [`docs/implementation-status.md`](docs/implementation-status.md) for feature traceability. **Passing repository checks means the code is eligible for launch; it does not substitute for external provider approval or operational evidence.**

## Security

Report suspected vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Never place production private keys, unrestricted provider credentials, card data, or session secrets in GitHub issues or pull requests.

## License

MIT
