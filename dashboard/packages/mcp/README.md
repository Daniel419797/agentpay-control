# @agentpay/mcp

AgentPay MCP bridge for AI clients that prefer a local stdio server.

The bridge forwards MCP JSON-RPC messages to the AgentPay hosted MCP endpoint, so local and remote clients use the same policy, authentication, payment, approval, and settlement logic.

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

When the package is published to a registry it can also be invoked through its `agentpay-mcp` binary.

## Tools

The hosted AgentPay MCP endpoint provides:

- `agentpay_get_connection_status`
- `agentpay_list_resources`
- `agentpay_purchase_resource`
- `agentpay_get_payment_status`

Purchases require a stable `idempotencyKey`; reuse the same value only when retrying the same intended purchase.

The MCP client receives an AgentPay application credential, not the underlying chain signing key. AgentPay evaluates the published policy before a payment can be signed or settled.
