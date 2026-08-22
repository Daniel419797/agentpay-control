# AgentPay: Catalyst Submission

**Updated:** 2026-08-22  
**Proposer / primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

This proposal-facing summary reflects the current implementation, especially Cardano Mainnet external per-agent custody. It also states the prior Hedera x402 involvement and contributor identity directly and separates source implementation from completed pilot evidence.

## Proposer and prior work

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor to AgentPay.

AgentPay was originally built for the **Hedera x402 bounty** and later extended into a multi-rail payment control plane with a Cardano-specific implementation. That prior involvement is disclosed directly. Completed Hedera work is prior work and should not be presented as new Catalyst-funded delivery.

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
- Masumi registry and counterparty verification;
- separate Masumi escrow, refund and result-verification lifecycle;
- seller reputation derived from AgentPay-observed escrow outcomes;
- optional Veridian/KERIA credential verification;
- Blockfrost construction, submission and evidence integration;
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

AgentPay does not claim to invent x402, Cardano, Masumi, Pyth, KERI or Dune. It composes those systems into an organizational treasury and control layer that answers a practical question: how can software act autonomously without becoming financially unrestricted?

## Demo story

The primary demo is an agent purchasing a verified resource or service:

1. the agent has a Cardano policy and isolated payment identity;
2. AgentPay verifies the requested resource and counterparty;
3. optional Pyth, Masumi and KERI controls contribute to policy;
4. AgentPay allows, requires approval or denies;
5. direct x402 uses the isolated Cardano signing and facilitator path, or a separate Masumi escrow path is used;
6. final settlement and result evidence is independently reconciled;
7. public chain evidence can be shown without exposing private business context.

A deliberately oversized payment should be denied, and emergency stop should block new risky side effects.

## Current maturity

AgentPay is currently described as **TRL 5**.

The code now implements Mainnet external per-agent custody, so the earlier source limitation is addressed. TRL 6 should only be claimed after the intended Mainnet and pilot configuration is demonstrated in a relevant environment. Source code alone does not prove that milestone.

## Metrics and pilot targets

Observed metrics and proposal targets must be kept separate.

Actual confirmed transaction counts, distinct external wallets, network fees and other pilot outcomes must be reported from real evidence. Synthetic demo activity must not be presented as adoption.

Any planned wallet, transaction, fee, conversion or first-two-week target in the Catalyst form must be mathematically consistent with the stated acquisition plan and must be presented as a target, not as something the repository has already achieved.

## Requested evaluation frame

AgentPay should be evaluated on whether it turns Cardano's machine-payment primitives into a safer operating model for autonomous agents: programmable financial boundaries, isolated per-agent authority, verifiable counterparties, exact settlement verification and independently reconcilable execution.