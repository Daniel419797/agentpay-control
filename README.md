# AgentPay Control

A policy-controlled payment operating system for autonomous software agents using the **x402 payment standard** on **Hedera testnet** rails.

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
│   └── src/index.ts     x402 facilitator: verify, settle, sign
├── resource-server/     → Render (Hono server)
│   └── src/index.ts     Demo resources: market-data, files, AI, research
├── docs/                Design docs, demo script, assets
├── vercel.json          Vercel deployment config
└── README.md
```

## Deploy

### Dashboard → Vercel

```bash
cd dashboard
npx vercel --prod
```

Set environment variables from `.env.example`.

### Facilitator → Render

1. Connect your `facilitator/` directory as a Web Service
2. Build command: `npm install`
3. Start command: `npm run start`
4. Set env vars: `HEDERA_NETWORK`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_PAYER_ID`, `HEDERA_PAYER_KEY`

### Resource Server → Render

1. Connect your `resource-server/` directory as a Web Service
2. Build command: `npm install`
3. Start command: `npm run start`
4. Set env vars: `FACILITATOR_URL`, `PROVIDER_ACCOUNT_ID`, `PORT`

## Local Development

```bash
# Start PostgreSQL
docker compose up -d

# Dashboard (terminal 1)
cd dashboard
npm install
npm run dev -- -p 3100

# Facilitator (terminal 2)
cd facilitator
npm install
npm run dev

# Resource Server (terminal 3)
cd resource-server
npm install
npm run dev
```

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

## License

MIT