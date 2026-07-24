# AgentPay Control

A policy-controlled payment operating system for autonomous software agents using the **x402 payment standard** on **Hedera testnet** rails.

Built for the [Hedera x402 Bounty](https://hedera.com/x402-bounty). Enables AI agents, MCP tools, and automated systems to pay per-use for resources — market data, files, AI inference, and web research — with on-chain settlement in HBAR or USDC.

## Architecture

```
Agent / SDK / MCP / LangChain
        |
        v
  AgentPay Control Plane (Next.js)
        |                           \
        v                            v
  Policy Engine ----> x402 Facilitator (Hono)
        |                            |
        v                            v
  PostgreSQL          Hedera Testnet + Mirror Node
        |
        v
  Resource Server (Hono)
    - Market Data  (/v1/market-data/:symbol)
    - Files        (/v1/files/:fileId)
    - AI Inference (/v1/inference/:model)
    - Web Research (/v1/research)
```

## Quick Start

### Prerequisites
- Node.js >= 22
- PostgreSQL 17 (or Docker for local)

### 1. Setup

```powershell
npm install
Copy-Item .env.example .env
# Edit .env with your credentials
docker compose up -d   # starts PostgreSQL
npm run db:deploy
npm run db:seed
```

### 2. Start the facilitator (separate terminal)

```powershell
cd apps/facilitator
Copy-Item .env.example .env
# Edit .env with Hedera testnet credentials
npm install
npm run dev
```

### 3. Start the resource server (separate terminal)

```powershell
cd apps/resource-server
Copy-Item .env.example .env
# Edit .env with facilitator URL and provider account
npm install
npm run dev
```

### 4. Start the dashboard

```powershell
npm run dev -- -p 3100
```

Open http://localhost:3100/sign-in

## Demo Flow (for bounty submission)

### Prerequisites
1. A funded HashPack wallet on Hedera testnet (use the [Hedera faucet](https://portal.hedera.com/faucet))
2. Wallet connected and agent created in the dashboard
3. Policy published with transaction limits

### Canonical purchase
1. Agent calls `POST /api/v1/agents/:id/paid-requests` with a resource URL
2. System returns 402 with x402 payment requirements
3. Policy evaluates and allows the spend
4. Facilitator signs and submits to Hedera testnet
5. Resource returns paid data with HashScan transaction link

### Live demo script (under 5 min)
1. **0:00-0:25** — Problem: AI agents need to pay for resources autonomously
2. **0:25-0:55** — Show existing agent account, testnet balance, policy limits
3. **0:55-2:20** — Agent requests ETH price market data; show 402 → policy allow → settlement → returned data
4. **2:20-2:55** — Open transaction detail and HashScan evidence
5. **2:55-3:45** — Trigger over-limit request; show approval queue and approve
6. **3:45-4:25** — Approved request settles once; budget updates
7. **4:25-4:45** — Show denied/paused control and architecture diagram
8. **4:45-4:55** — Repository link and conclusion

## Repository

**Public repo:** https://github.com/Daniel419797/agentpay-control

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## License

MIT