# AgentPay Product Demonstration

This walkthrough presents AgentPay as an autonomous-finance control system. Use only capabilities configured in the demonstration environment and clearly label Sandbox/provider test environments.

## 1. Start with the organization

Show the authenticated dashboard and explain that financial authority belongs to the organization, not the AI runtime. Demonstrate members/RBAC, workspace context, and organization status.

## 2. Create or inspect an agent

Show the agent's stable identity, network/payment-account configuration, status, and scoped AgentPay credential. Emphasize that the credential authorizes AgentPay APIs and does not reveal an underlying blockchain private key or provider restricted key.

## 3. Show policy

Open the published policy and demonstrate:

- transaction/day/month limits;
- merchant/resource/network/asset controls;
- approval behavior;
- optional Pyth/Masumi/Veridian trust constraints.

Explain that published versions are immutable and that reservations protect concurrent spend.

## 4. Direct paid-resource purchase

Use a controlled x402 resource.

```text
agent request -> resource 402 -> policy -> reserve
 -> optional approval -> payment execution
 -> verified settlement -> paid resource
```

Show the payment intent, amount/asset/network/payee, settlement evidence, fulfillment, and audit record.

## 5. Approval path

Trigger a request that requires human approval. Show `APPROVAL_PENDING`, have an authorized approver decide it, and demonstrate that execution resumes only after the threshold is satisfied.

## 6. Network execution

When configured, show one low-value settlement from an enabled rail and its evidence. For Cardano, explain the signer/facilitator split and show that the signer constructs/signs while the facilitator independently verifies/submits/confirms.

## 7. Moove Receive

Create a single-use low-value receive link for an agent/resource or invoice.

Show:

- stable AgentPay idempotency key;
- hosted payment URL;
- local `ACTIVE` state before payment;
- payer completing the hosted flow;
- AgentPay refresh/reconciliation;
- `COMPLETED` with provider token/destination/received amount/transaction evidence;
- resource completion event or exact invoice `PAID` transition where applicable.

Point out that the URL itself is not treated as payment proof.

## 8. Cards and fiat

Only show this section when an appropriate provider environment is enabled.

Demonstrate provider-backed cardholder/card metadata and status controls without exposing raw card data. If using Sandbox, label it plainly as a development simulation.

For fiat, show account/transfer state and explain the distinction between submitted/processing and terminal provider success.

## 9. Invoices and marketplace

Show a resource/provider listing, price, invoice/items, and how payment evidence is linked to commercial state rather than inferred from the UI.

## 10. Automation

Show an automation rule and execution record. Demonstrate that the automation still passes the same policy/approval/provider-readiness rules and that its irreversible boundary is checkpointed.

## 11. Financial intelligence

Show summary/forecast/anomaly/recommendation views. Explain that these are advisory outputs built from financial observations and cannot independently authorize a payment.

## 12. Reconciliation

Open an intentionally pending/ambiguous example if available. Explain why AgentPay keeps candidate/provider evidence and checks authoritative external state instead of automatically retrying an uncertain financial side effect.

## 13. Audit and emergency control

Show audit events for policy/payment/provider actions. Enable the kill switch in a safe environment and demonstrate that a new risky action is blocked while defensive reconciliation remains possible.

## 14. Agent integration

Show one agent-facing integration:

- REST/TypeScript SDK;
- MCP;
- LangChain.

Demonstrate that all adapters converge on the same AgentPay policy and settlement state.

## 15. Close with architecture

Summarize the system as:

```text
agent intent
 -> organization identity/policy/approval
 -> bounded execution rail/provider
 -> evidence-based settlement
 -> audit + reconciliation + operations
```

Do not use fixture or Sandbox output as evidence of a live provider transaction. When showing a real payment, use low-value controlled funds and redact sensitive identifiers where appropriate.
