# AgentPay Control — Live Demo Script

**Target:** < 5 minutes  
**Bounty:** Hedera x402 ($1,000 prize)

## Script (4:55 target)

### 0:00-0:25 — Problem & Solution
> "AI agents need to buy data, compute, and APIs autonomously — but they can't swipe a card. HTTP 402 has been a status code without a standard. x402 changes that. AgentPay Control is a policy-controlled payment OS that lets agents spend within policy using x402 on Hedera, where settlements cost $0.001 and finalize in seconds."

Show: Dashboard login screen → overview

### 0:25-0:55 — Agent & Policy
> "Here's an existing agent with a funded testnet account and a published spending policy — per-transaction limit of 100 HBAR, daily limit of 500 HBAR, and an allowlist of trusted resource providers."

Show: Agent detail (balance, status), Policy page (limits, merchant rules)

### 0:55-2:20 — Canonical Purchase
> "Let's purchase ETH market data. The agent sends a paid request — the resource returns 402 with x402 payment requirements, policy evaluates and allows the spend, the facilitator signs and submits to Hedera, and the resource returns the data with a settlement receipt."

Show: API call (terminal or curl) → 402 response → policy allow → facilitator submission → 200 with data

### 2:20-2:55 — On-Chain Evidence
> "Every settlement has a HashScan link. Let's open it — you can see the exact transfer, the consensus timestamp, and the finality."

Show: Transaction detail in dashboard → click HashScan link → browser shows HashScan with the testnet transaction

### 2:55-3:45 — Approval Flow
> "What about over-limit requests? Let's trigger one — policy requires approval. The operator gets a notification, reviews the request, and approves it. The system settles exactly once."

Show: Request over limit → approval pending in dashboard → Approve → settled → HashScan evidence

### 3:45-4:25 — Budget Updated
> "After settlement, the daily budget reflects the spend. The agent can continue operating within its remaining policy limits."

Show: Overview dashboard showing updated spend, remaining daily budget, transaction list

### 4:25-4:45 — Deny & Pause
> "Policy can also deny — if a merchant isn't allowed, or if the agent is paused, no signing occurs and no funds move."

Show: Denied request (no transaction) → Pause agent → another request fails with agent paused error

### 4:45-4:55 — Repository & Wrap
> "The full open-source repo is at github.com/Daniel419797/agentpay-control — all the code, docs, SDK, MCP server, and LangChain tools. Built for the Hedera x402 bounty."

Show: GitHub repo page briefly

---

## Preparation Checklist

- [ ] Fund HashPack wallet on testnet (use faucet)
- [ ] Deploy/reset seed data: `npm run db:seed`
- [ ] Start facilitator: `cd apps/facilitator && npm run dev`
- [ ] Start resource server: `cd apps/resource-server && npm run dev`
- [ ] Start dashboard: `npm run dev -- -p 3100`
- [ ] Create organization and agent
- [ ] Fund agent account with testnet HBAR
- [ ] Publish policy (per-tx: 100 HBAR, daily: 500 HBAR)
- [ ] Create API key for terminal demo
- [ ] Pre-warm all services
- [ ] Record at 1080p, minimize browser chrome, hide secrets
- [ ] Keep HashScan URLs ready for close-up shots
- [ ] Total time check: < 5:00