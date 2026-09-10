---
name: agentpay-control
description: Use AgentPay to discover and purchase paid resources or create receive-payment links under an agent's organization policy.
---

# AgentPay

Use this skill when an autonomous workflow needs AgentPay-controlled commerce or payment capability.

## Runtime configuration

Read these values from the runtime environment and never print the API key:

```text
AGENTPAY_BASE_URL
AGENTPAY_AGENT_ID
AGENTPAY_API_KEY
```

The credential authorizes AgentPay API scopes. It is not a blockchain private key or provider restricted key.

## Purchase a paid resource

1. Discover registered resources with `GET /api/v1/resources` when appropriate.
2. Call `POST /api/v1/agents/{agentId}/paid-requests` with a stable unique `Idempotency-Key` and the intended resource/purpose/maximum amount.
3. Let AgentPay resolve payment account, network, custody, policy, approvals, reservations, trust evidence, and settlement.
4. `SETTLED` means AgentPay accepted the rail-specific settlement evidence; retain network-specific transaction/evidence identifiers for audit.
5. `APPROVAL_PENDING` requires authorized human decision. Report the amount, asset, resource/purpose, and policy context without bypassing the approval.
6. If denied or failed before submission, do not retry altered inputs merely to evade policy.
7. If pending/`SUBMISSION_UNKNOWN`, do not create a replacement payment; query the original intent while AgentPay reconciles authoritative evidence.

## Create a Moove Receive payment link

When the task is to accept payment rather than purchase a resource, use the AgentPay Moove receive API/MCP capability.

Provide:

- exact decimal amount;
- optional description;
- optional max usage/expiry;
- optional AgentPay resource or invoice binding;
- stable idempotency key for the intended link.

Return/share the hosted `providerUrl` when available, but do not say the payment is received until AgentPay reports `COMPLETED` after reconciliation.

For invoice-bound links, AgentPay performs exact settlement token/network/decimals/amount verification before the invoice can become paid.

## Safety rules

Never:

- expose AgentPay, Moove, Stripe, signer, custody, database, or session credentials;
- request or reconstruct underlying blockchain private keys;
- split transactions to evade spend limits;
- fabricate settlement/provider evidence;
- equate a payment URL or accepted submission with settlement;
- automatically duplicate an operation after uncertain submission;
- present Sandbox/provider-test activity as live production activity.

See `examples/purchase.mjs` for a minimal REST purchase example and the repository documentation for full API behavior.
