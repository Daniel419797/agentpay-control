# @agentpay/mcp

MCP bridge for AI clients that interact with AgentPay through a local stdio server while delegating all financial authority to the hosted AgentPay control plane.

## Configuration

```text
AGENTPAY_BASE_URL=https://<agentpay-host>
AGENTPAY_AGENT_ID=<agent UUID>
AGENTPAY_API_KEY=<scoped agent credential>
```

The API key belongs in the MCP runtime environment and must not be printed into model output, committed, or exposed to unrelated tools.

Run the bridge:

```bash
node src/server.mjs
```

## Hosted AgentPay tools

Current tool surface includes:

```text
agentpay_get_connection_status
agentpay_list_resources
agentpay_purchase_resource
agentpay_get_payment_status
agentpay_create_moove_payment_link
agentpay_get_moove_payment_status
```

The hosted endpoint remains authoritative for the exact set of tools and schemas available to a credential.

## Purchase behavior

For resource purchases, callers provide a stable idempotency key for the intended operation. AgentPay then authenticates the agent, validates the resource, evaluates policy/trust, reserves spend, requests approval if needed, executes the configured rail/custody mode, and returns persisted settlement/fulfillment state.

Do not interpret `APPROVAL_PENDING`, `AUTHORIZED`, or ambiguous submission state as `SETTLED`.

## Moove Receive behavior

The MCP receive tool creates a Moove-hosted payment link through AgentPay. The Moove API key remains server-side. Link creation is not completion; use `agentpay_get_moove_payment_status` until AgentPay reports reconciled provider completion or a terminal state.

## Custody boundary

MCP receives an AgentPay application credential, not the underlying financial secret. Depending on the agent/profile, AgentPay may use managed test identities, self custody, external Cardano Mainnet custody, or provider-backed execution. None of those private credentials are required in the MCP client.

## Retry rules

- reuse the same idempotency key only for the same intended operation;
- do not change keys simply to bypass a pending/denied action;
- do not create a replacement payment after an ambiguous submission without first resolving the original state;
- poll at bounded intervals.

See [`../../../docs/03-screens-and-dto-specification.md`](../../../docs/03-screens-and-dto-specification.md) and [`../../../docs/moove-receive.md`](../../../docs/moove-receive.md).
