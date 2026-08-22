---
name: agentpay-control
description: Discover and purchase x402 resources through a policy-controlled AgentPay payment agent across supported rails.
---

# AgentPay Control

**Updated:** 2026-08-22

Use this skill when a task needs a paid resource through an AgentPay-controlled agent.

1. Read `AGENTPAY_BASE_URL`, `AGENTPAY_AGENT_ID`, and `AGENTPAY_API_KEY` from the runtime environment. Never print the API key.
2. Discover resources with `GET /api/v1/resources`.
3. Call `POST /api/v1/agents/{agentId}/paid-requests` with a unique `Idempotency-Key` header and JSON `{ "resourceUrl", "purpose", "maxAmountAtomic" }`.
4. Let AgentPay select/enforce the agent's configured network, payment account, custody mode, policy, approvals and trust controls. Do not attempt to choose or bypass a private signing key from the skill.
5. If status is `SETTLED`, use the returned resource result and retain the returned **network-specific transaction/settlement identifier** for audit. Do not assume it is always a Hedera transaction ID.
6. If status is `APPROVAL_PENDING`, tell the operator what amount, asset, resource and policy reason require review. Poll the payment-intent/status endpoint only at a reasonable interval.
7. If status is denied or failed before submission, do not retry unchanged input to evade policy. Report the reason codes.
8. If status is `SUBMISSION_UNKNOWN` or otherwise pending after possible submission, do not create a replacement payment merely because the response is uncertain. AgentPay reconciles independent settlement evidence to avoid blind duplicate payment.
9. Never bypass limits, split purchases to evade policy, invent settlement IDs, fabricate chain confirmation, expose credentials, or claim a synthetic/demo settlement is real external adoption.

## Custody boundary

The skill receives only a scoped AgentPay application credential. Blockchain private keys, managed-agent master secrets and Cardano Mainnet external-custody credentials remain outside the skill/LLM context.

Depending on the configured agent, AgentPay may use:

- isolated managed testnet signing;
- self-custody wallet/provider signing;
- Cardano Mainnet external per-agent Ed25519 custody.

The skill should treat those as internal AgentPay payment-authority modes and rely on the API outcome/evidence rather than attempting to reproduce signing behavior.

See `examples/purchase.mjs` for a minimal REST call.

Primary builder: **Daniel Praise** (`Daniel419797`).