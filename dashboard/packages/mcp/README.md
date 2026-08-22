# @agentpay/mcp

**Updated:** 2026-08-22

> **Reason for update:** The MCP bridge is network-agnostic and now fronts the current multi-rail AgentPay control plane rather than a Hedera-only product. This README was synchronized so AI clients understand that they receive scoped AgentPay credentials, while custody/signing details remain behind the same policy-controlled API regardless of the selected rail.

AgentPay MCP bridge for AI clients that prefer a local stdio server.

The bridge forwards MCP JSON-RPC messages to the hosted AgentPay MCP endpoint, so local and remote clients use the same authentication, policy, approval, reservation, payment and settlement logic.

## Required environment

```bash
export AGENTPAY_BASE_URL="https://your-agentpay-deployment.example"
export AGENTPAY_AGENT_ID="<agent-id>"
export AGENTPAY_API_KEY="<agent-credential>"
```

PowerShell:

```powershell
$env:AGENTPAY_BASE_URL = "https://your-agentpay-deployment.example"
$env:AGENTPAY_AGENT_ID = "<agent-id>"
$env:AGENTPAY_API_KEY = "<agent-credential>"
```

Run the bridge from this package:

```bash
node src/server.mjs
```

When published to a registry it can also be invoked through its `agentpay-mcp` binary.

## Tools

The hosted AgentPay MCP endpoint provides:

- `agentpay_get_connection_status`
- `agentpay_list_resources`
- `agentpay_purchase_resource`
- `agentpay_get_payment_status`

Purchases require a stable `idempotencyKey`; reuse the same value only when retrying the same intended purchase.

## Security and custody boundary

The MCP client receives an AgentPay application credential, **not** an underlying blockchain private key.

AgentPay evaluates the agent's published policy and payment-account configuration before a payment can be signed or settled. Depending on the agent/network, the actual payment authority may be:

- an isolated managed testnet identity;
- a self-custody wallet/provider;
- Cardano Mainnet external per-agent Ed25519 custody.

Those signing details stay behind AgentPay's server-side payment flow. An MCP client must not ask for, store or attempt to reconstruct blockchain private keys, managed-agent master secrets or external custody credentials.

## Payment outcomes

Clients should treat AgentPay states accurately:

- `SETTLED`: confirmed payment/resource outcome returned by AgentPay;
- `APPROVAL_PENDING`: operator/approver action is required;
- denied/failed-before-submission: do not retry unchanged input merely to evade policy;
- `SUBMISSION_UNKNOWN`/pending: possible side effect is being reconciled; do not create a second payment with a new idempotency key unless the operator intentionally wants a separate purchase.

Transaction/network evidence is rail-specific. Do not assume every settlement has a Hedera transaction ID; Cardano and Arc use their own network identifiers/evidence.

## Current architecture reference

The MCP bridge is only an agent-facing adapter. It does not reimplement policy, custody or settlement logic.

See the repository `README.md`, `docs/04-detailed-workflows.md` and `docs/managed-signer-isolation.md` for the current implementation.

Primary builder: **Daniel Praise** (`Daniel419797`).