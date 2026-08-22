# AgentPay — Catalyst submission

## One-line description

AgentPay is the policy-controlled financial infrastructure that lets autonomous AI agents pay other agents and services on Cardano without giving unsupervised software unrestricted wallets.

## Problem

AI agents can increasingly discover services and make machine-to-machine payments, but an enterprise cannot safely solve that problem by handing every agent an unrestricted wallet. Organizations need enforceable budgets, vendor trust, approval thresholds, emergency controls, independent settlement evidence and an audit trail that survives provider failures.

## Solution

AgentPay places a financial control plane between an autonomous agent and payment execution. An organization can define transaction/hour/day/month limits, allowed assets and providers, approval rules and emergency-stop behavior. AgentPay supports Cardano x402 direct settlement in ADA and an explicitly whitelisted native token, with Mainnet USDCx pinned to its configured canonical Cardano asset identity.

For the Catalyst production profile, AgentPay combines:

- Cardano x402 `exact` payments
- ADA and configured Mainnet USDCx settlement
- Cardano Preprod isolated per-agent signing
- Cardano Mainnet self-custody and external per-agent HSM/KMS/delegation signing
- Pyth-backed USD-denominated policy limits
- Masumi registry identity/discovery and seller-wallet verification
- a separate Masumi escrow/refund/result-verification lifecycle
- evidence-backed seller reputation from observed escrow outcomes
- Veridian/KERI ACDC identity verification with issuer/schema policy pinning
- Dune public Cardano analytics
- Blockfrost reconciliation
- AgentPay budgets, approvals, emergency stop, idempotency, audit and incident controls

## Mainnet custody model

AgentPay does not use `CARDANO_MANAGED_AGENT_MASTER_KEY` on Mainnet and does not assign a deployment-wide payer to autonomous agents.

For an externally delegated Mainnet agent, the Cardano signer asks the configured custody adapter for a stable Ed25519 public key and opaque signer reference tied to the immutable Agent ID. AgentPay derives the `addr1...` payment address locally from that public key. When a policy-authorized transaction is ready, the adapter receives only the transaction-body hash and signer reference. AgentPay verifies the returned Ed25519 signature locally before the facilitator can submit the transaction.

The private key remains inside the external HSM/KMS/delegation boundary. Self-custody Mainnet wallets remain supported separately.

## Why this is different

AgentPay is not another x402 implementation or another agent marketplace. Cardano and Masumi already provide important payment/agent primitives. AgentPay solves the missing treasury and governance layer: **how does an organization let software act autonomously without making that software financially unrestricted?**

Masumi remains the identity/discovery and optional escrow layer. Pyth remains the market-data source. Dune remains public analytics. Veridian/KERIA remains the verifiable-identity authority. AgentPay composes those systems into enforceable financial policy and evidence.

## Demo

The primary demo is “an AI agent hires another AI agent.”

1. A research agent has a Cardano policy with a USD daily budget, per-transaction maximum, allowed Cardano assets, verified-Masumi requirement and human-approval threshold.
2. The agent discovers/calls a verified Masumi seller.
3. AgentPay verifies registry source, capability, seller Cardano payment credential and optional KERI credential.
4. Pyth values the proposed payment in USD using a bounded/fresh confidence-aware observation.
5. AgentPay allows, requires approval or denies the spend.
6. For direct x402, the isolated signer/facilitator path settles on Cardano. A Mainnet autonomous agent signs through its own external signer identity; self-custody remains a separate mode.
7. For escrow, AgentPay creates and reconciles the Masumi purchase lifecycle.
8. Result/settlement evidence is independently verified.
9. Public Cardano activity can appear in Dune; private logical-agent/provider/policy metrics remain in authenticated AgentPay analytics.
10. A deliberately oversized payment is denied and the organization emergency stop demonstrates that new AgentPay-controlled spending is blocked while reconciliation remains available.

## Security design

- no Cardano private key in the dashboard or facilitator
- no shared Cardano Mainnet managed-agent master key
- distinct external Mainnet signer identity per managed agent
- local address derivation from the custody public key
- local verification of every returned Ed25519 signature
- resource-specific replay binding
- exact payer/payee/asset/amount verification
- conservative token conservation and change rules
- ambiguous submission is never blindly retried
- independent chain reconciliation
- production provider/custody URLs require HTTPS
- Pyth, Masumi and Veridian fail closed when configured as required policy dependencies

## Measurable impact

The public Dune dashboard can report observed Cardano transaction activity. AgentPay's authenticated analytics report aggregate logical-agent/provider counts, policy denials, approval events, settlement success and latency, and verified Masumi escrow outcomes. Proposal targets must remain consistent with the stated pilot acquisition plan and actual observed results must be reported as observed results, not synthetic demo data.

## Current maturity

The repository implements the Cardano Mainnet external per-agent custody protocol and the AgentPay control-plane path that provisions and uses it. The proposal should still describe current maturity conservatively as **TRL 5** until the intended Mainnet/pilot configuration has been demonstrated in a relevant environment with the selected external custody provider and participating wallets. TRL 6 is the demonstration milestone, not a source-code claim.

## Milestones

1. Stabilize the exact release head and execute repository/security checks.
2. Exercise Cardano Preprod with isolated per-agent signing and low-value ADA/configured-token transactions.
3. Configure the external Cardano Mainnet per-agent custody provider and verify distinct agent identities plus low-value Mainnet transactions.
4. Exercise the selected Pyth, Masumi and Veridian flows and their fail-closed cases.
5. Publish/cross-check Dune analytics if included in the demonstrated profile.
6. Run the quantified pilot and report actual wallets, transactions, fees and policy outcomes.

## Requested evaluation frame

Evaluate AgentPay on whether it turns Cardano's machine-payment primitives into a safer organizational operating model for autonomous agents: measurable Cardano activity, stable-value settlement, ecosystem reuse, verifiable counterparties, programmable financial boundaries, isolated per-agent custody and independently auditable execution.