# AgentPay Control — Full Feature Testing Script

**Total time:** ~6:45
**Purpose:** End-to-end testing of every feature with exact pages and steps

---

## Complete Feature List

| Category | Features |
|---|---|
| **Auth** | Email OTP, Google OAuth, Hedera wallet sign-in, agent credentials (API keys) |
| **Agents** | Create, list, detail, pause/resume, archive, balances, network filter |
| **Policies** | Per-tx/daily/hourly/monthly limits, merchant allow/deny, schedule windows, cooldown, over-limit actions (DENY/REQUIRE_APPROVAL), versioning |
| **Payments** | x402 paid requests, facilitator signing/settlement, HashScan evidence, idempotency |
| **Approvals** | Approval queue, approve/reject votes, threshold-based auto-settle |
| **Transactions** | Payment intent lifecycle, wallet payments, transaction detail, HashScan links |
| **Audit** | Immutable chain-linked audit log, CSV/JSON export, event filtering |
| **Virtual Cards** | Cardholder creation, card issuance, freeze/unfreeze/cancel, ephemeral display keys, real-time authorization via Stripe webhooks |
| **Fiat Rails** | Fiat accounts, deposits/withdrawals, reconciliation, Stripe Money Management v2 |
| **Cross-Chain** | Bridge quotes, wallet-signed transfers between EVM networks |
| **Invoices** | Agent-to-agent invoicing, line items, send/pay/void, x402 collection |
| **Marketplace** | Browse verified resources, ratings, health status, reviews |
| **Resources** | Provider registration, resource listings, pricing, endpoint verification |
| **Automations** | Triggers (manual/schedule/balance/webhook/invoice), actions (contract/x402/invoice), execution log |
| **Intelligence** | 30-day spend forecasts, anomaly detection, budget recommendations |
| **Settings** | Org management, members/roles, notification endpoints, data retention, kill switch, contract allowlist |
| **Notifications** | Webhook/Slack/email delivery, outbox pattern, secret rotation |
| **SDK/MCP/LangChain** | TypeScript SDK, MCP server (4 tools), LangChain tool factory |
| **Facilitator** | Hedera + Arc chain settlement, managed signing, contract execution |
| **Resource Server** | x402-protected endpoints (market data, files, inference, research) |
| **Maintenance** | Payment retries, retention cleanup, reconciliation, Prometheus metrics |

---

## Testing Script

### 0:00–0:30 — Auth & Login

| Step | Action | Page / URL |
|---|---|---|
| 1 | Go to sign-in page | `/sign-in` |
| 2 | Sign in with email OTP or Google OAuth | `/sign-in` |
| 3 | Confirm dashboard loads with metrics | `/app/overview` |

### 0:30–1:00 — Agent Creation

| Step | Action | Page / URL |
|---|---|---|
| 4 | Create a new agent | `/app/agents/new` |
| 5 | Set name, Hedera Testnet, platform-managed, HBAR asset | `/app/agents/new` |
| 6 | Confirm status is ACTIVE, account connected | `/app/agents/[agentId]` |

### 1:00–1:30 — Policy Setup

| Step | Action | Page / URL |
|---|---|---|
| 7 | Open agent policy page | `/app/agents/[agentId]/policy` |
| 8 | Publish policy: per-tx 100 HBAR, daily 500 HBAR, over-limit = REQUIRE_APPROVAL, merchant mode = ALLOWLIST_ONLY, add trusted host | `/app/agents/[agentId]/policy` |
| 9 | Confirm policy version shows "Published v1" | `/app/agents/[agentId]` |

### 1:30–2:15 — Paid Request (x402 Flow)

| Step | Action | Page / URL |
|---|---|---|
| 10 | Open agent credentials page | `/app/agents/[agentId]/credentials` |
| 11 | Click **Create credential**, enter label, select scopes, confirm | `/app/agents/[agentId]/credentials` |
| 12 | Copy the secret (shown once), dismiss | `/app/agents/[agentId]/credentials` |
| 13 | Go to agent detail, click **Send payment** | `/app/agents/[agentId]` |
| 14 | Select resource (e.g. ETH Market Data), click **Send paid request** | `/app/agents/[agentId]/pay` |
| 15 | Confirm result shows SETTLED status with HashScan link | `/app/agents/[agentId]/pay` |
| 16 | Confirm transaction appears in list | `/app/transactions` |
| 17 | Open transaction detail, click HashScan link, verify on-chain | `/app/transactions/[transactionId]` |

### 2:15–2:45 — Budget Tracking

| Step | Action | Page / URL |
|---|---|---|
| 18 | Confirm "Remaining daily budget" shows reduced amount, "% used today" updated | `/app/overview` |

### 2:45–3:15 — Approval Flow

| Step | Action | Page / URL |
|---|---|---|
| 19 | Go to Send payment page, select a resource that exceeds per-tx limit | `/app/agents/[agentId]/pay` |
| 20 | Click **Send paid request**, confirm APPROVAL_PENDING result | `/app/agents/[agentId]/pay` |
| 21 | Confirm pending approval appears in queue | `/app/approvals` |
| 22 | Review detail, click **Approve** | `/app/approvals/[approvalId]` |
| 23 | Confirm new SETTLED transaction from approved request | `/app/transactions` |

### 3:15–3:45 — Deny & Pause

| Step | Action | Page / URL |
|---|---|---|
| 24 | Go to Send payment, enter a custom URL for a host NOT in the allowlist | `/app/agents/[agentId]/pay` |
| 25 | Click **Send paid request**, confirm DENIED result | `/app/agents/[agentId]/pay` |
| 26 | Confirm DENIED status in transactions | `/app/transactions` |
| 27 | Click **Pause** on agent | `/app/agents/[agentId]` |
| 28 | Try to send another request, confirm agent paused error | `/app/agents/[agentId]/pay` |
| 29 | Click **Resume** on agent | `/app/agents/[agentId]` |

### 3:45–4:15 — Virtual Cards (Sandbox)

| Step | Action | Page / URL |
|---|---|---|
| 30 | Open cards & fiat page | `/app/cards` |
| 31 | Create cardholder (name, email, address) | `/app/cards` |
| 32 | Issue virtual card (select agent, currency, spending limit) | `/app/cards` |
| 33 | Confirm card appears with status ACTIVE | `/app/cards` |
| 34 | Freeze card, confirm FROZEN status | `/app/cards` |
| 35 | Unfreeze, confirm ACTIVE again | `/app/cards` |

### 4:15–4:30 — Fiat Accounts

| Step | Action | Page / URL |
|---|---|---|
| 36 | Open fiat account section | `/app/cards` |
| 37 | Create fiat account (USD) | `/app/cards` |
| 38 | Submit deposit, confirm PENDING status | `/app/cards` |

### 4:30–4:45 — Automations

| Step | Action | Page / URL |
|---|---|---|
| 39 | Open automations page | `/app/automations` |
| 40 | Create rule: trigger = "Schedule (daily)", action = "x402 payment" | `/app/automations` |
| 41 | Activate rule, confirm status changes to ACTIVE | `/app/automations` |

### 4:45–5:00 — Invoices

| Step | Action | Page / URL |
|---|---|---|
| 42 | Create invoice: issuer agent, recipient agent, line items | `/app/invoices/new` |
| 43 | Send invoice | `/app/invoices/[invoiceId]` |
| 44 | Pay invoice, confirm settlement | `/app/invoices/[invoiceId]` |

### 5:00–5:15 — Marketplace & Resources

| Step | Action | Page / URL |
|---|---|---|
| 45 | Browse resources, confirm prices and health shown | `/app/marketplace` |
| 46 | View owned resources | `/app/resources` |

### 5:15–5:30 — Intelligence

| Step | Action | Page / URL |
|---|---|---|
| 47 | Confirm forecasts, anomalies, recommendations visible | `/app/intelligence` |

### 5:30–5:45 — Audit Log

| Step | Action | Page / URL |
|---|---|---|
| 48 | Confirm events logged for all actions above | `/app/audit` |
| 49 | Export CSV, confirm download | `/app/audit` |

### 5:45–6:00 — Settings

| Step | Action | Page / URL |
|---|---|---|
| 50 | Toggle kill switch ON, confirm payments blocked | `/app/settings` |
| 51 | Toggle kill switch OFF | `/app/settings` |
| 52 | Add notification endpoint (webhook URL) | `/app/settings` |
| 53 | Invite member with VIEWER role | `/app/settings` |

### 6:00–6:15 — Cross-Chain

| Step | Action | Page / URL |
|---|---|---|
| 54 | Create bridge quote, confirm route displayed | `/app/cross-chain` |

### 6:15–6:30 — SDK & MCP (Terminal)

| Step | Action | Command |
|---|---|---|
| 55 | Run SDK tests | `cd dashboard/packages/sdk && npm test` |
| 56 | Start MCP server, confirm tools listed | `cd dashboard/packages/mcp && node src/server.mjs` |

### 6:30–6:45 — Health & Metrics

| Step | Action | Command |
|---|---|---|
| 57 | Health check | `curl http://localhost:3100/api/v1/health` |
| 58 | Readiness check | `curl http://localhost:3100/api/v1/ready` |
| 59 | Prometheus metrics | `curl http://localhost:3100/api/v1/internal/metrics` |

---

## Preparation Checklist

- [ ] Fund HashPack wallet on testnet (use faucet)
- [ ] Deploy/reset seed data: `npm run db:seed`
- [ ] Start facilitator: `cd facilitator && npm run dev`
- [ ] Start resource server: `cd resource-server && npm run dev`
- [ ] Start dashboard: `cd dashboard && npm run dev -- -p 3100`
- [ ] Set `VIRTUAL_CARDS_ENABLED=true` and `CARD_PROVIDER=SANDBOX` in `.env` for card testing
- [ ] Pre-warm all services
- [ ] Total time check: < 6:45
