# AgentPay Control

A policy-controlled payment operating system for autonomous software agents using the **x402 payment standard** on **Hedera network** and **Arc Blockchain** rails.

Built for the [Hedera x402 Bounty](https://hedera.com/x402-bounty).

## Repository Structure

```
agentpay-control/
├── dashboard/           → Vercel (Next.js app)
│   ├── src/             API routes, pages, components
│   ├── prisma/          Database schema + migrations
│   ├── packages/        SDK, MCP server, LangChain tools
│   ├── e2e/             Playwright tests
│   └── package.json     Dashboard dependencies
├── facilitator/         → Render (Hono server)
│   └── src/index.ts     Hedera x402 facilitator: verify, settle, sign
├── facilitator-arc/     → Render (Hono server)
│   └── src/index.ts     Arc EVM x402 facilitator: verify, settle, sign
├── facilitator-combined/ → Render (Hono server)
│   └── src/index.ts     One server mounting both facilitators (/hedera, /arc)
├── resource-server/     → Render (Hono server)
│   └── src/index.ts     Demo resources: market-data, files, AI, research
├── docs/                Design docs, demo script, assets
├── render.yaml          Render deployment blueprint
└── README.md
```

## Supported Networks

| Network | Chain | CAIP-2 | Facilitator |
|---------|-------|--------|-------------|
| Hedera Testnet | Hedera | `hedera:testnet` | `facilitator/` |
| Hedera Mainnet | Hedera | `hedera:mainnet` | `facilitator/` (production) |
| Arc Testnet | Arc (EVM, Circle L1) | `eip155:5042002` | `facilitator-arc/` |

The dashboard includes a **network switcher** (topbar and sidebar) to toggle between Hedera testnet and mainnet. Selection persists via URL (`?network=hedera:mainnet`) and localStorage. The agent list, creation form, wallet connection, and resource-server routing all follow the selected network.

`facilitator-combined/` runs both facilitators on **one Render server**: the Hedera app is mounted at `/hedera/*` and the Arc app at `/arc/*` (paths configurable via `HEDERA_BASE_PATH` / `ARC_BASE_PATH`). Each facilitator also remains runnable standalone for local development.

## Deploy

### Production stack → Render

Create a Render Blueprint from the root `render.yaml`. It provisions the dashboard,
the combined facilitator, and the resource server in one region, deploys only
after GitHub checks pass, wires capability credentials between services, and runs
Prisma migrations before the dashboard starts.

Render prompts for every external credential. Generate `KEY_ENCRYPTION_MASTER_KEY`
as exactly 32 random bytes encoded with base64url; a general random string is not a
valid encryption key. Production uses separate signing, settlement, and
contract-execution credentials—never reuse one key across capabilities.

### Combined Facilitator (Hedera + Arc) → Render

Use the root `render.yaml` Blueprint. It builds `facilitator-combined/Dockerfile`
into one service that serves both networks: Hedera under `https://<svc>.onrender.com/hedera`
and Arc under `https://<svc>.onrender.com/arc`, with an overall `/health` endpoint.

Because Render can only copy raw values from other services, the two URL variables
that include the path suffix are prompted once during Blueprint creation:

- Dashboard `FACILITATOR_URL` = `https://agentpay-facilitator.onrender.com/hedera`
- Dashboard `ARC_FACILITATOR_URL` = `https://agentpay-facilitator.onrender.com/arc`
- Resource server `FACILITATOR_URL` = the same `/hedera` URL
- Resource server `ARC_FACILITATOR_URL` = the same `/arc` URL

Replace the hostname with the service's actual URL shown by Render after creation
if it differs. All other credentials are wired automatically: signing, settlement,
and contract-execution keys plus `HEDERA_PAYER_ID` and `ARC_PROVIDER_ADDRESS`.

Provide the prompted Hedera operator/payer credentials (`HEDERA_OPERATOR_ID`,
`HEDERA_OPERATOR_KEY`, `HEDERA_PAYER_ID`, `HEDERA_PAYER_KEY`) and Arc payer
(`ARC_PAYER_PRIVATE_KEY`, `ARC_PROVIDER_ADDRESS`) through Render's secret
environment UI.

Deploy a separate instance for mainnet with a different `HEDERA_NETWORK` value
and point the dashboard's `HEDERA_MAINNET_FACILITATOR_URL` at its `/hedera` URL.

### Resource Server → Render

The Blueprint enables Hedera testnet and Arc testnet by default. Change
`ENABLED_NETWORKS` only to a comma-separated subset of `hedera:testnet`,
`hedera:mainnet`, and `eip155:5042002`; startup fails on unsupported values.
Facilitator URLs and capability-scoped settlement keys are wired from their owning
services. Render prompts only for the external provider settlement accounts.

## Local Development

```bash
# Start PostgreSQL
docker compose up -d

# Dashboard (terminal 1)
cd dashboard
npm install
npm run dev -- -p 3100

# Hedera Facilitator (terminal 2)
cd facilitator
npm install
npm run dev

# Arc Facilitator (terminal 3)
cd facilitator-arc
npm install
npm run dev

# Combined facilitators on one port (terminal 2 alternative)
cd facilitator-combined
npm install
npm run build --workspace=@agentpay/hedera-facilitator --workspace=@agentpay/arc-facilitator
npm run dev

# Resource Server (terminal 4)
cd resource-server
npm install
npm run dev
```

To run the combined facilitator locally, create `facilitator-combined/.env` from
`.env.example` and fill in the Hedera and Arc credentials; it serves both networks
on one port (`/hedera`, `/arc`). The dashboard's `FACILITATOR_URL` then becomes
`http://localhost:8787/hedera` and `ARC_FACILITATOR_URL` becomes
`http://localhost:8787/arc`.

Set the network via URL param: `http://localhost:3100/app/agents?network=hedera:mainnet`
Or use the network switcher dropdown in the topbar.

## Demo Script

See [docs/demo-script.md](docs/demo-script.md) for the full <5 min bounty submission script.

## Verification

```bash
cd dashboard
npm run lint
npm run typecheck
npm test
npm run build
```

Production deployment, recovery, monitoring, and incident procedures are documented in [docs/production-runbook.md](docs/production-runbook.md).
Roadmap-to-release traceability is maintained in [docs/implementation-status.md](docs/implementation-status.md).

## License

MIT
