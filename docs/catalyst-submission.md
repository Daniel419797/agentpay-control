# AgentPay Catalyst Submission Package

**Status:** Current proposal-support narrative  
**Updated:** 2026-08-22  
**Proposer / primary builder:** Daniel Praise (`Daniel419797`)

> **Why I updated this document:** The earlier Catalyst narrative predated the completed Cardano Mainnet external per-agent custody path and identified me only by my GitHub handle. I updated it to state my identity and prior Hedera program involvement plainly, to reflect the current code, and to keep TRL/adoption claims separate from unproven planning assumptions.

## Required disclosure

I am **Daniel Praise**, GitHub account [`Daniel419797`](https://github.com/Daniel419797), repository owner and primary technical contributor.

I originally built AgentPay for the **Hedera x402 bounty** and later extended it into the current multi-rail control plane. I therefore disclose that prior program involvement explicitly. I do not present previously completed Hedera work as new Catalyst-funded delivery; Catalyst scope should cover the Cardano-specific/pilot work that remains.

## Current maturity

I describe the current project conservatively as **TRL 5** for Catalyst purposes.

The repository now implements Cardano Mainnet external per-agent custody in addition to self-custody. That removes the earlier source-code limitation under which Mainnet was unsigned/self-custody-only. However, source implementation alone is not the same as a completed relevant-environment pilot/demonstration, so I do not use the code change by itself to claim TRL 6.

## One-line product

**AgentPay is a policy, trust and settlement control plane that lets autonomous software agents spend on Cardano without giving the agent unrestricted wallet authority.**

## Problem

Autonomous agents can discover services and initiate work, but organizations still need controls around money movement:

- deterministic spend limits;
- human approvals where required;
- counterparty identity/trust;
- isolated payment identities/signing authority;
- exact resource/payment binding;
- replay protection;
- safe treatment of ambiguous submissions;
- escrow/result/refund evidence where direct payment is insufficient;
- private organizational policy off-chain with auditable public settlement evidence.

## Solution

AgentPay places a deterministic policy/trust layer between an autonomous agent and payment execution.

On Cardano it supports two separate settlement modes:

1. **Direct x402 `exact`:** resource challenge -> policy/reservation -> signing/preparation -> independent facilitator verification -> Blockfrost submission -> Cardano confirmation/reconciliation -> paid resource response.
2. **Masumi escrow:** verified Masumi identity -> AgentPay policy -> purchase/job lifecycle -> result-hash verification -> completion/refund/dispute evidence.

Pyth may express policy ceilings in conservative USD values. Optional Veridian/KERIA evidence can further constrain counterparty identity. Dune is read-only public analytics and is never an authorization dependency.

## Implemented architecture

```text
Autonomous agent / operator
        |
        v
AgentPay control plane (Vercel)
 policy / approvals / reservations / audit / trust
        |
   +----+----------------------+
   |                           |
Direct x402                Masumi escrow
   |                           |
x402 resource             Masumi Payment Service
   |                           |
   +----------+----------------+
              |
      Unified facilitator (Render)
 Hedera / Arc / Cardano Preprod+Mainnet
              |
      Cardano signer gateway (Render)
         /                 \
 Preprod per-agent      Mainnet self custody
 derived signer         + external per-agent custody
                              |
                       HSM/KMS/delegation provider
                              |
                       private key stays external

Cardano facilitator -> Blockfrost -> Cardano
                         |
                    reconciliation
```

## Cardano Mainnet managed custody

The implemented Mainnet path does **not** use a shared/deployment-wide managed-agent master key.

For each immutable Agent ID:

```text
external custody /identity
 -> publicKeyHex + signerRef
 -> AgentPay derives addr1... locally
 -> exact transaction constructed
 -> transaction body hashed
 -> external custody /sign exact signerRef
 -> returned Ed25519 signature verified locally
 -> signed CBOR independently verified by facilitator
 -> facilitator submits via Blockfrost
```

The external custody provider is a deployment dependency; its private keys are not stored by AgentPay.

Self-custody remains available in parallel.

## Security properties implemented

- dashboard has no Cardano private signing key;
- one managed payment identity per agent;
- database canonical identity uniqueness and concurrent claim protection;
- testnet deterministic master secrets prohibited on Mainnet;
- external Mainnet signer identity bound to immutable Agent ID;
- local payer-address derivation from custody public key;
- body-hash-only external signing;
- local Ed25519 signature verification;
- independent facilitator transaction verification;
- signer constructs/signs but does not submit Cardano transactions;
- facilitator submits and confirms through Blockfrost;
- canonical resource SHA-256 binding;
- exact payer/payee/asset/amount/conservation/change validation;
- durable settlement claims and UTxO nonce replay controls;
- ambiguous submissions retained for reconciliation rather than blindly retried;
- Pyth/Masumi/KERI required evidence fails closed;
- Dune cannot authorize or settle payments;
- emergency stop blocks new risky side effects while defensive reconciliation remains available.

## Demo evidence rules

When I present a demo as evidence, I will identify what is actually live in that exact environment.

Minimum Cardano evidence for a specific demonstrated profile should include:

1. exact release SHA;
2. deployed dashboard/facilitator/signer endpoints;
3. deliberately funded payer for the custody mode shown;
4. real Blockfrost network credentials;
5. for autonomous Mainnet custody, a real configured external per-agent custody adapter;
6. low-value transaction confirmed independently on Cardano;
7. real Pyth/Masumi/KERIA configuration only if those integrations are shown as live;
8. real Dune query/dashboard IDs only if Dune is shown as published evidence.

Synthetic resource fixtures may demonstrate payment plumbing but must be called synthetic.

## Suggested demo sequence

### 1. Agent and policy

Show the agent's immutable payment identity, custody mode and published financial/trust policy.

### 2. Counterparty trust

Show Masumi seller/capability/payment-key evidence and optional KERI evidence if actually configured.

### 3. Direct x402

Show 402 challenge, policy result, signing path, facilitator verification/submission, chain confirmation and paid resource response.

### 4. Approval/denial

Show one deliberately over-policy request being denied or routed to approval.

### 5. Mainnet custody failure safety

If Mainnet external custody is part of the environment, demonstrate or explain that an unavailable/invalid custody response blocks signing rather than falling back to a shared key.

### 6. Escrow

If real Masumi escrow is configured, show purchase/job/result evidence and a separate refund path where appropriate.

### 7. Public evidence

Show Cardano transaction evidence and Dune only when real public query IDs exist.

## Metrics and adoption claims

I will report **observed** metrics from actual stored/published evidence separately from **proposal targets**.

Useful observed metrics include:

- settled Cardano transaction count;
- distinct external wallets actually used;
- actual network fees from confirmed transactions;
- policy-denied/approval-required counts;
- confirmation latency where recorded;
- verified Masumi completion/refund/dispute outcomes;
- public Dune sample cross-checks.

I will not infer customer counts, transaction volume, fees, revenue, uptime or adoption from synthetic fixtures.

Any Catalyst pilot target for wallets, transactions, fees or first-two-week adoption must be internally consistent with the actual acquisition model written in the proposal. Those planning commitments belong in the proposal/pilot plan; this repository does not invent them as completed facts.

## Suggested short pitch

> “I built AgentPay to give autonomous agents bounded financial authority instead of unrestricted wallets. On Cardano, AgentPay applies immutable policy, approvals and counterparty trust before payment. Preprod managed agents use isolated per-agent identities, while Mainnet can use self custody or a distinct external Ed25519 signer identity for each agent. AgentPay constructs the payment, verifies returned signatures locally, independently verifies the final Cardano transaction in the facilitator, submits through Blockfrost and reconciles chain evidence. For jobs needing stronger buyer protection, the same control plane can use Masumi escrow, with optional Pyth-valued budgets and KERI identity constraints.”

## Production/readiness wording

A safe current statement is:

> AgentPay has been deployed and exercised in supported environments. The repository implements policy-controlled Cardano x402, Preprod per-agent managed signing, Mainnet self custody and external per-agent Ed25519 custody, Pyth-valued policy, Masumi trust/escrow/refunds/reputation, optional KERI identity and Dune observability. Readiness for a specific production/pilot profile depends on the exact release and external configuration being operated.

For Catalyst I keep the current maturity at **TRL 5** until the intended Mainnet/pilot configuration is demonstrated in a relevant environment.

## Update summary

Updated 2026-08-22 to:

- identify me as Daniel Praise, not only `Daniel419797`;
- disclose the Hedera x402 origin in first person;
- record Cardano Mainnet external per-agent custody as implemented;
- remove obsolete Mainnet self-custody-only implications;
- keep TRL 5 until relevant-environment demonstration;
- separate real observed evidence from proposal targets and synthetic fixtures;
- clarify signer construction versus facilitator submission responsibilities.