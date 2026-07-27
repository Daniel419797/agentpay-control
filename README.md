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
├── resource-server/     → Render (Hono server)
│   └── src/index.ts     Demo resources: market-data, files, AI, research
├── docs/                Design docs, demo script, assets
├── vercel.json          Vercel deployment config
└── README.md
```

## Supported Networks

| Network | Chain | CAIP-2 | Facilitator |
|---------|-------|--------|-------------|
| Hedera Testnet | Hedera | `hedera:testnet` | `facilitator/` |
| Hedera Mainnet | Hedera | `hedera:mainnet` | `facilitator/` (production) |
| Arc Testnet | Arc (EVM, Circle L1) | `eip155:5042002` | `facilitator-arc/` |

The dashboard includes a **network switcher** (topbar and sidebar) to toggle between Hedera testnet and mainnet. Selection persists via URL (`?network=hedera:mainnet`) and localStorage. The agent list, creation form, wallet connection, and resource-server routing all follow the selected network.

## Deploy

### Dashboard → Vercel

```bash
cd dashboard
npx vercel --prod
```

Set environment variables from `.env.example`. For multi-network support, additionally configure `HEDERA_MAINNET_FACILITATOR_URL`, `HEDERA_MAINNET_FACILITATOR_API_KEY`, `HEDERA_MAINNET_MIRROR_NODE_URL`.

### Facilitator (Hedera) → Render

1. Connect your `facilitator/` directory as a Web Service
2. Build command: `npm install`
3. Start command: `npm run start`
4. Set env vars: `HEDERA_NETWORK`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_PAYER_ID`, `HEDERA_PAYER_KEY`

Deploy separate instances for testnet and mainnet with different `HEDERA_NETWORK` values.

### Facilitator (Arc) → Render

1. Connect your `facilitator-arc/` directory as a Web Service
2. Build command: `npm install`
3. Start command: `npm run start`
4. Set env vars: `ARC_PAYER_PRIVATE_KEY`, `ARC_RPC_URL`, `ARC_USDC_ADDRESS`, `ARC_PROVIDER_ADDRESS`

### Resource Server → Render

1. Connect your `resource-server/` directory as a Web Service
2. Build command: `npm install`
3. Start command: `npm run start`
4. Set env vars: `FACILITATOR_URL`, `HEDERA_MAINNET_FACILITATOR_URL`, `ARC_FACILITATOR_URL`, `PROVIDER_ACCOUNT_ID`, `PORT`

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

# Resource Server (terminal 4)
cd resource-server
npm install
npm run dev
```

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
