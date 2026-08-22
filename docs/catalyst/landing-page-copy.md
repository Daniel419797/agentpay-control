# AgentPay Landing-Page Copy — Catalyst

**Updated:** 2026-08-22

> **Reason for update:** The copy now reflects the implemented Cardano Mainnet external per-agent custody model, current service responsibilities and transparent project provenance. It avoids obsolete self-custody-only wording and does not present proposal targets or unconfigured providers as achieved results.

## Hero

### Financial infrastructure for autonomous AI agents on Cardano

Give software agents the ability to pay without giving them unrestricted wallets. AgentPay combines Cardano x402 settlement, policy-controlled budgets, approvals, counterparty trust, isolated signing and independent reconciliation.

**Primary CTA:** See the Cardano demo  
**Secondary CTA:** Review the architecture

## Builder / provenance

### Built by Daniel Praise

I am **Daniel Praise** (`Daniel419797`), the repository owner and primary technical contributor. I originally built AgentPay for the Hedera x402 bounty, then extended it into the current multi-rail control plane and Cardano implementation.

## Problem

### Autonomy needs a financial boundary

An autonomous agent may need to buy data, inference, research or another agent's service in seconds. A wallet answers whether a key can sign. It does not decide whether that agent should spend that amount, with that provider, in that asset, under the organization's policy.

AgentPay makes that decision before money moves and reconciles what happened afterward.

## Control layer

### Programmable financial boundaries per agent

Configure and enforce:

- per-transaction/hour/day/month limits;
- approval thresholds;
- merchant/resource rules;
- transaction velocity/cooldown;
- emergency stop;
- optional Pyth-valued USD ceilings;
- verified Masumi counterparties/capabilities;
- observed escrow history/reputation requirements;
- optional KERI issuer/schema/freshness requirements.

Published policy is server-side and cannot be rewritten by the autonomous agent.

## Cardano direct settlement

### Exact x402 with resource binding

AgentPay's Cardano path binds the payment to the exact resource, network, payer, payee, asset and amount. The supported transaction shape is deliberately narrow and independently verified before submission.

ADA is supported as `lovelace`. An explicitly configured native asset may be enabled; Mainnet USDCx must match the configured canonical asset identity.

## Mainnet custody

### Autonomous Mainnet agents without a shared platform wallet

Cardano Mainnet supports both self custody and external per-agent managed custody.

For an externally managed agent:

1. the custody provider resolves a distinct Ed25519 public key/signer reference for that Agent ID;
2. AgentPay derives the `addr1...` payer address locally;
3. the Cardano signer constructs the transaction;
4. only the transaction-body hash is sent to the external signer;
5. AgentPay verifies the returned signature locally;
6. the facilitator independently verifies the signed transaction;
7. the facilitator submits through Blockfrost and reconciles confirmation evidence.

There is no Cardano Mainnet managed-agent master key or deployment-wide autonomous-agent payer. Private keys remain inside the external HSM/KMS/delegation system.

## Masumi escrow

### Separate escrow when direct payment is not enough

AgentPay treats Masumi escrow as a separate purchase/job lifecycle. It can track funds locking, result submission, verified completion, refunds and disputes. Verified result hashes and observed terminal outcomes can feed AgentPay's policy-level seller reputation signal.

## Identity and trust

### Know which provider you are paying

AgentPay can verify Masumi registry source, agent identifier, capability, seller Cardano payment facts and freshness. Organizations can additionally require configured Veridian/KERIA credential evidence from trusted issuers/schemas.

## Pyth-valued policy

### Business budgets in USD, settlement on Cardano

Where enabled, AgentPay uses a fresh confidence-bounded Pyth observation to calculate a conservative USD value before authorizing spend. Oracle failure cannot silently make policy less restrictive.

## Safety

### Ambiguity is not automatically failure

A timeout after possible Cardano submission does not prove the payment failed. AgentPay preserves the candidate transaction and reconciles independent chain evidence instead of blindly retrying.

Other controls include:

- one managed payment identity per agent;
- spend reservations/idempotency;
- exact transaction verification;
- replay/resource binding;
- emergency stop;
- immutable audit evidence;
- fail-closed custody/provider behavior.

## Analytics

### Public settlement facts, private business context

Dune may expose public Cardano chain facts. AgentPay's private analytics can track logical agent/provider/policy outcomes without publishing tenant identities, prompts, credentials or private resource content.

Dune is never an authorization/signing/settlement dependency.

## Current maturity

For Catalyst I currently state **TRL 5**. The repository implements Cardano Mainnet external per-agent custody, but the TRL 6 milestone requires the intended Mainnet/pilot configuration to be demonstrated in a relevant environment.

## Evidence discipline

Observed transaction counts, external-wallet counts, fees and adoption metrics should come from real activity. Proposal targets should be clearly labelled as targets and should be mathematically consistent with the stated acquisition plan; synthetic demo activity is not customer adoption.

## Closing CTA

### Let agents act. Keep the financial boundary.

**Explore AgentPay on Cardano** · **Review the architecture** · **Inspect public settlement evidence when available**