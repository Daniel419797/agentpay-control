---
name: agentpay-control
description: Discover and purchase x402 resources using a policy-controlled Hedera payment agent.
---

# AgentPay Control

Use this skill when a task needs paid market data, files, AI inference, or web research through AgentPay Control.

1. Read `AGENTPAY_BASE_URL`, `AGENTPAY_AGENT_ID`, and `AGENTPAY_API_KEY` from the runtime environment. Never print the API key.
2. Discover resources with `GET /api/v1/resources`.
3. Call `POST /api/v1/agents/{agentId}/paid-requests` with a unique `Idempotency-Key` header and JSON `{ "resourceUrl", "purpose", "maxAmountAtomic" }`.
4. If status is `SETTLED`, use the returned resource result and retain its Hedera transaction ID for audit.
5. If status is `APPROVAL_PENDING`, tell the operator what amount, asset, resource, and policy rule require review. Poll the payment-intent endpoint only at a reasonable interval.
6. If status is `DENIED`, do not retry unchanged input. Report the reason codes.
7. Never bypass limits, split purchases to evade policy, invent settlement IDs, or claim a demo settlement is on-chain.

See `examples/purchase.mjs` for a minimal REST call.
