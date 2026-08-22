# AgentPay: Current Product Demo Script

**Status:** Current implementation demo  
**Updated:** 2026-08-22  
**Presenter/builder:** Daniel Praise (`Daniel419797`)

## Revision note

The previous script was the original Hedera x402 bounty demo and no longer represented the current product. This version covers the current multi-rail and Cardano implementation without presenting planning targets or unconfigured external providers as live evidence.

## Demo objective

Show one coherent story: an autonomous agent can request a paid service while AgentPay enforces policy, isolates payment identity, controls signing authority, verifies settlement and preserves audit and reconciliation evidence.

## 0:00-0:30: Introduction

Suggested narration:

AgentPay was originally built for the Hedera x402 bounty and later extended into a multi-rail financial control plane for autonomous agents. The current system supports Hedera, Arc and Cardano, with Cardano-specific policy, identity, signing, reconciliation and ecosystem integrations.

Show the dashboard overview.

## 0:30-1:00: Agent identity and policy

Open an active agent and show:

- immutable Agent ID;
- selected network and payment account;
- custody mode;
- current policy;
- transaction, daily or other configured limits;
- approval behavior;
- relevant trust controls.

Explain that managed payment identity is isolated per agent and the agent does not receive the unrestricted signing key.

## 1:00-1:40: Cardano custody modes

For Cardano show the implemented distinction:

### Preprod managed

- unique `addr_test1...` per Agent ID;
- signing derives inside the isolated signer from a testnet-only master secret.

### Mainnet self custody

- AgentPay prepares the narrow transaction;
- wallet or provider signs externally.

### Mainnet external per-agent managed custody

- one external Ed25519 public key and signer reference per Agent ID;
- AgentPay derives the `addr1...` address locally;
- only transaction-body hash is sent to the external signer;
- returned signature is verified locally;
- no Mainnet managed-agent master key or shared platform payer.

If the external custody provider is not actually configured in the demo environment, describe the implemented source path rather than claiming a live Mainnet managed signing demonstration.

## 1:40-2:40: Direct x402 purchase

Use a registered x402 resource.

Show and narrate:

1. resource returns HTTP 402 requirements;
2. AgentPay verifies exact resource, network, payee, asset and amount;
3. policy evaluates the request;
4. spend reservation is created;
5. signing or preparation uses the selected custody mode;
6. Cardano signer constructs the transaction;
7. facilitator independently verifies the signed transaction;
8. facilitator submits via Blockfrost;
9. settlement is confirmed and reconciled;
10. paid resource response and transaction evidence are shown.

For Cardano point out the SHA-256 resource binding and exact payer, payee, asset and amount verification.

## 2:40-3:10: Policy denial

Submit a request that intentionally violates the active policy.

Expected result:

```text
DENY
no signing
no on-chain submission
```

Do not change the policy just to make the demo pass.

## 3:10-3:40: Human approval

Submit a request that requires approval.

Show:

- `APPROVAL_PENDING`;
- approver context;
- approve and reject control;
- initiator separation where configured;
- execution resumes once after valid approval.

## 3:40-4:15: Trust controls

Show only integrations actually configured in the environment.

Possible evidence:

- Pyth price, confidence and freshness used for USD policy;
- Masumi registry identity, capability and seller payment-key evidence;
- Masumi escrow lifecycle and result-hash evidence;
- Veridian/KERIA verified credential evidence.

If an integration is not live, identify it as implemented or configurable rather than demonstrating synthetic data as production evidence.

## 4:15-4:45: Ambiguous settlement safety

Explain or safely demonstrate the failure behavior.

A network timeout after possible submission is not automatically treated as failure. AgentPay retains the candidate transaction and spend state and reconciles independent chain evidence rather than blindly retrying.

Show `SUBMISSION_UNKNOWN` or reconciliation state if available.

## 4:45-5:15: Emergency stop and audit

Enable the organization emergency stop and demonstrate a new risky action being blocked while reconciliation and evidence access remains available.

Open audit or transaction detail and show the decision and settlement trail.

## 5:15-5:40: Public evidence and analytics

Show:

- Cardano chain, explorer or Blockfrost-backed transaction evidence;
- Dune public dashboard only if real query and dashboard IDs are configured.

Explain that Dune is read-only and receives only public-chain facts, not private AgentPay policy, prompts or credentials.

## 5:40-6:00: Closing

AgentPay gives agents bounded financial autonomy. Policy and approvals live in the control plane, signing is isolated, Cardano Mainnet managed agents can use separate external signer identities, the facilitator independently verifies and submits transactions, and ambiguous outcomes are reconciled from chain evidence.

## Preparation checklist

- [ ] Use the exact release SHA being demonstrated.
- [ ] Verify Vercel and Render services are from the intended release.
- [ ] Verify database migrations are current.
- [ ] Use low-value funded accounts for the network and custody mode shown.
- [ ] Verify Blockfrost credentials for the correct Cardano network.
- [ ] If Mainnet external custody is shown live, verify its signer-only URL and API key and distinct agent identities first.
- [ ] Configure only the Pyth, Masumi, KERIA and Dune integrations actually shown.
- [ ] Hide API keys, private credentials and sensitive tenant data.
- [ ] Keep chain evidence links ready.
- [ ] Do not use proposal targets as if they were observed metrics.

## Provenance

This script supersedes the old Hedera-bounty-only demo script. That original remains in Git history. The update is necessary because the current repository includes Cardano Preprod and Mainnet, external per-agent Mainnet custody, Masumi, Pyth and KERI integrations, stronger policy and reconciliation controls, and a unified multi-rail facilitator.