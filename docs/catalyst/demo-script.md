# AgentPay Catalyst Live Demo Runbook

**Updated:** 2026-08-22  
**Presenter / primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

This script reflects the Cardano Mainnet external per-agent custody implementation. It describes the current signer and facilitator flow, identifies the primary builder correctly, and distinguishes live evidence from source or configuration support.

## Demo objective

Prove that an autonomous agent can purchase a service on Cardano while AgentPay keeps enforceable control over budget, counterparty trust, custody identity, approvals, settlement state and emergency shutdown.

## Preconditions

Use the exact release being demonstrated and real credentials only for integrations claimed as live.

For a live Cardano Mainnet managed-agent demonstration:

- configure the external per-agent custody adapter on the isolated signer;
- provision and fund only the exact `addr1...` identity for the demonstrated Agent ID;
- do not configure `CARDANO_MANAGED_AGENT_MASTER_KEY` on Mainnet;
- use deliberately low-value funds.

## Scene 1: Introduce the project

Suggested narration:

AgentPay was originally built for the Hedera x402 bounty and later extended into a multi-rail control plane, including the Cardano implementation shown here.

Show the AgentPay dashboard and active Cardano agent.

## Scene 2: Agent and policy

Show:

- immutable Agent ID;
- network and custody mode;
- per-agent payment account;
- active policy;
- transaction, daily or configured USD limits;
- approval threshold;
- optional Masumi, Pyth or KERI requirements.

Explain that the agent requests spend but cannot alter the published policy or retrieve the payment private key.

## Scene 3: Mainnet custody identity

If demonstrating external Mainnet custody live, show the agent's distinct `addr1...` address.

Explain:

1. the signer resolves a public Ed25519 key and signer reference for the exact Agent ID;
2. AgentPay derives `addr1...` locally;
3. only a transaction-body hash is sent for signing;
4. returned signatures are verified locally;
5. the private key remains in the external HSM/KMS/delegation boundary;
6. there is no deployment-wide Mainnet agent master key or shared payer.

If the external provider is not live in the demo environment, describe this as implemented source capability rather than claiming a completed Mainnet managed demo.

## Scene 4: Verify the counterparty

Where configured, show real Masumi evidence:

- agent identifier;
- trusted registry source and policy;
- capability;
- seller Cardano address and payment-key facts;
- verification freshness.

If KERI is part of the live profile, show non-secret credential evidence such as issuer, schema, SAID and validity state.

## Scene 5: Direct x402 purchase

Run a deliberately low-value registered resource request.

Narrate:

```text
Resource returns 402
 -> AgentPay verifies exact requirement/resource binding
 -> policy + trust evaluation
 -> spend reservation
 -> signing/preparation
 -> Cardano signer constructs transaction
 -> external/Preprod signer signs exact body hash as applicable
 -> facilitator independently verifies signed CBOR
 -> facilitator submits through Blockfrost
 -> Cardano confirmation evidence
 -> resource fulfillment
```

Show the resulting transaction ID and chain evidence.

## Scene 6: Policy denial

Submit a request deliberately outside policy.

Expected:

```text
DENY
no signing
no settlement side effect
```

## Scene 7: Human approval

Submit a request configured to require approval.

Show:

- `APPROVAL_PENDING`;
- a valid approver reviewing the request;
- no self-approval where separation is enforced;
- execution continuing once after valid approval.

## Scene 8: Custody failure safety

For Mainnet managed custody, safely demonstrate or explain an adapter failure or invalid signature case.

Expected: managed signing fails closed. AgentPay must not fall back to a shared key, another agent's signer identity or a deployment-wide payer.

## Scene 9: Masumi escrow

Only if a real escrow environment is configured, show the separate lifecycle:

```text
PREPARED
 -> FundsLockingRequested
 -> FundsLocked
 -> ResultSubmitted
 -> Completed
```

At completion show result-hash verification. Use a separate eligible purchase for a refund demonstration where appropriate.

## Scene 10: Ambiguous settlement safety

Explain or show that an uncertain post-submission response stays pending or reconciliation-required. The candidate transaction is preserved and checked against independent chain evidence instead of being blindly retried.

## Scene 11: Emergency stop

Enable the organization emergency stop through normal authenticated controls. Attempt a new payment and show it is blocked. Confirm defensive reconciliation and evidence access still works.

## Scene 12: Analytics and public evidence

Show chain evidence and, only if actually published and configured, the Dune dashboard.

Dune is read-only and must not contain private prompts, credentials, organization policy or private resource content.

## Closing line

AgentPay lets agents remain autonomous without becoming financially unrestricted. Policy controls the decision, each managed agent has isolated payment authority, Cardano carries settlement, and AgentPay independently verifies and reconciles what actually happened.

## Evidence discipline

- Do not substitute proposal targets for observed numbers.
- Do not describe synthetic resources as live customer or market evidence.
- Do not claim an external provider is active if only its integration code or configuration exists.
- Do not claim TRL 6 solely because the Mainnet custody source path is implemented.

For Catalyst purposes, AgentPay remains **TRL 5** until the intended Mainnet and pilot configuration is demonstrated in a relevant environment.