# @agentpay/langchain

LangChain-compatible tool wrappers for AgentPay.

These helpers allow an AI application to request AgentPay operations without placing blockchain keys or provider credentials in the model/tool context.

## Resource purchase tool

`createAgentPayTool(client, agentId)` exposes:

```text
agentpay_purchase_resource
```

Input includes the resource URL, purpose, and optional maximum atomic amount. AgentPay performs resource validation, policy, approvals, payment execution, settlement verification, and fulfillment.

The tool reports the resulting AgentPay state rather than fabricating payment success. `APPROVAL_PENDING` means human action is required; denied/failed states remain denied/failed; ambiguous provider/network state should be polled/reconciled rather than duplicated.

## Moove Receive tool

`createAgentPayMooveReceiveTool(client, agentId)` exposes:

```text
agentpay_create_moove_payment_link
```

Input supports:

- `toAmount`;
- `description`;
- optional `maxUsage`;
- optional `expirationDate`;
- optional `resourceListingId`;
- optional `invoiceId`;
- required stable `idempotencyKey`.

The returned provider URL can be shared with a payer. The tool does not treat link creation as payment completion; applications should query AgentPay status until `COMPLETED` or a terminal failure.

## Security model

- the tool receives only the AgentPay client/agent identity;
- provider and blockchain secrets remain server-side;
- policy/approval logic is not duplicated inside the LLM tool;
- idempotency keys are part of financial safety;
- the tool must not split/rephrase operations to evade policy;
- transaction/explorer evidence is network-specific.

See [`../sdk/README.md`](../sdk/README.md) and [`../../../docs/04-detailed-workflows.md`](../../../docs/04-detailed-workflows.md).
