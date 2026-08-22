# AgentPay — Catalyst Submission

**Updated:** 2026-08-22  
**Proposer / primary builder:** Daniel Praise (`Daniel419797`)

> **Reason for update:** I synchronized this proposal-facing summary with the implementation now on `master`, especially Cardano Mainnet external per-agent custody. I also made my prior Hedera x402 involvement and contributor identity explicit and removed wording that could confuse source implementation with completed pilot evidence.

## Who I am and prior work

I am **Daniel Praise**, the owner of the GitHub account `Daniel419797` and the primary technical contributor to AgentPay.

I originally built AgentPay for the **Hedera x402 bounty**. I later extended it into a multi-rail payment control plane with a Cardano-specific implementation. I disclose that prior involvement directly. Completed Hedera work is prior work and should not be presented as new Catalyst-funded delivery.

## One-line description

AgentPay is policy-controlled financial infrastructure that lets autonomous AI agents pay other agents and services on Cardano without giving unsupervised software unrestricted wallets.

## Problem

A normal wallet answers whether a key can sign. It does not answer whether an autonomous agent **should** spend a given amount, with a given provider, in a given asset, under an organization's policy.

Organizations need budgets, approvals, verified counterparties, isolated payment identities, safe signing, replay protection, reconciliation and auditable settlement evidence.

## Implemented solution

AgentPay currently combines:

- Cardano x402 V2 `exact` payments;
- ADA and one explicitly configured native-token profile, including pinned Mainnet USDCx configuration when enabled;
- Cardano Preprod isolated per-agent managed identities;
- Cardano Mainnet self custody;
- Cardano Mainnet external per-agent Ed25519 custody;
- Pyth-backed conservative USD policy limits;
- Masumi registry/counterparty verification;
- separate Masumi escrow/refund/result-verification lifecycle;
- seller reputation derived from AgentPay-observed escrow outcomes;
- optional Veridian/KERIA credential verification;
- Blockfrost construction/submission/evidence integration;
- read-only Dune public Cardano analytics;
- AgentPay policy, approvals, reservations, idempotency, emergency stop, audit and reconciliation.

## Mainnet custody model

AgentPay does not use `CARDANO_MANAGED_AGENT_MASTER_KEY` on Cardano Mainnet and does not give autonomous agents a deployment-wide payer.

For an externally delegated Mainnet agent:

1. the isolated signer requests the exact Agent ID's Ed25519 public key and signer reference from the external custody adapter;
2. AgentPay derives the `addr1...` payer address locally;
3. the signer constructs the narrow Cardano transaction;
4. only its transaction-body hash is sent to the exact signer reference;
5. AgentPay verifies the returned Ed25519 signature locally;
6. the facilitator independently verifies the full signed transaction;
7. the facilitator submits through Blockfrost and reconciles confirmation evidence.

The private key stays in the external HSM/KMS/delegation system. Self custody remains available separately.

## Why AgentPay is different

AgentPay is not claiming to invent x402, Cardano, Masumi, Pyth, KERI or Dune. It composes those systems into an organizational treasury/control layer that answers:

> How can software act autonomously without becoming financially unrestricted?

## Demo story

The primary demo is an agent purchasing a verified resource/service:

1. agent has a Cardano policy and isolated payment identity;
2. AgentPay verifies the requested resource/counterparty;
3. optional Pyth/Masumi/KERI controls contribute to policy;
4. AgentPay allows, requires approval or denies;
5. direct x402 uses the isolated Cardano signing/facilitator path, or a separate Masumi escrow path is used;
6. final settlement/result evidence is independently reconciled;
7. public chain evidence can be shown without exposing private business context.

A deliberately oversized payment should be denied, and emergency stop should block new risky side effects.

## Current maturity

I currently state **TRL 5**.

The code now implements Mainnet external per-agent custody, so the earlier source limitation is addressed. I will only claim TRL 6 after the intended Mainnet/pilot configuration is demonstrated in a relevant environment; source code alone does not prove that milestone.

## Metrics and pilot targets

Observed metrics and proposal targets must be kept separate.

I will report actual confirmed transaction counts, distinct external wallets, network fees and other pilot outcomes from real evidence. I will not present synthetic demo activity as adoption.

Any planned wallet, transaction, fee, conversion or first-two-week target in the Catalyst form must be mathematically consistent with the stated acquisition plan and must be presented as a target, not as something the repository has already achieved.

## Requested evaluation frame

Evaluate AgentPay on whether it turns Cardano's machine-payment primitives into a safer operating model for autonomous agents: programmable financial boundaries, isolated per-agent authority, verifiable counterparties, exact settlement verification and independently reconcilable execution.