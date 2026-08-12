# AgentPay — Catalyst submission

## One-line description

AgentPay is the policy-controlled financial infrastructure that lets autonomous AI agents pay other agents and services on Cardano without giving unsupervised software unrestricted wallets.

## Problem

AI agents can increasingly discover services and make machine-to-machine payments, but an enterprise cannot safely solve that problem by handing every agent an unrestricted wallet. Organizations need enforceable budgets, vendor trust, approval thresholds, emergency controls, independent settlement evidence and an audit trail that survives provider failures.

## Solution

AgentPay places a financial control plane between an autonomous agent and payment execution. An organization can define transaction/hour/day/month limits, allowed assets and providers, approval rules and emergency-stop behavior. AgentPay supports Cardano x402 direct settlement in ADA and an explicitly whitelisted native token, with Mainnet USDCx pinned to its canonical Cardano asset identity.

For the Catalyst production profile, AgentPay combines:

- Cardano x402 `exact` payments
- ADA and canonical Mainnet USDCx settlement
- Pyth-backed USD-denominated policy limits
- Masumi registry identity/discovery and seller-wallet verification
- a separate Masumi escrow/refund/result-verification lifecycle
- evidence-backed seller reputation from observed escrow outcomes
- Veridian/KERI ACDC identity verification with issuer/schema policy pinning
- Dune public Cardano analytics
- Blockfrost reconciliation and release-canary verification
- AgentPay budgets, approvals, emergency stop, idempotency, audit and incident controls

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
6. For direct x402, the isolated signer/facilitator path settles on Cardano. For escrow, AgentPay creates and reconciles the Masumi purchase lifecycle.
7. Result/settlement evidence is independently verified.
8. Public Cardano activity appears in Dune; private logical-agent/provider/policy metrics remain in authenticated AgentPay analytics.
9. A deliberately oversized payment is denied.
10. The organization emergency stop demonstrates that new AgentPay-controlled spending is blocked while defensive reconciliation remains available.

## Security and production design

- no Cardano private key in the dashboard
- production signer rejects raw seed custody and delegates signature generation to an external Ed25519/HSM-style boundary
- resource-specific replay binding
- exact payer/payee/asset/amount verification
- conservative token conservation and change rules
- ambiguous submission is never blindly retried
- independent chain reconciliation
- production provider URLs require HTTPS
- Pyth, Masumi, Veridian and Dune integrations fail closed when configured as required policy dependencies
- release readiness is tied to an immutable release SHA and evidence registry
- canary evidence is independently verified against Cardano chain data before acceptance

## Measurable impact

The public Dune dashboard reports real observed Cardano transaction activity for the dedicated AgentPay provider address. The authenticated AgentPay analytics surface reports aggregate logical-agent/provider counts, policy denials, approval events, settlement success and latency, and verified Masumi escrow outcomes. No synthetic numbers are placed in the proposal as live metrics.

## Current evidence rule

A code path is described as implemented only when it exists in source and has regression coverage intended to exercise it. A production deployment is described as ready only when the exact release SHA has passing repository/security checks and all required external evidence—live provider credentials, funded canaries, signing custody, Dune publication/sample verification, monitoring/on-call, restore drill, incident exercise and independent security assessment—has been recorded.

## Milestones

1. Stabilize exact release head and execute all CI/security checks.
2. Deploy Cardano Preprod with isolated signing custody; verify ADA and configured test-token canaries.
3. Exercise real Pyth, Masumi registry/escrow and Veridian verification with failure drills.
4. Publish Dune queries/visualizations/dashboard and independently verify samples against Cardano chain evidence.
5. Deploy separately isolated Cardano Mainnet custody and verify a deliberately low-value canonical USDCx canary.
6. Record operational/security evidence and freeze the submission/demo against the immutable release SHA.

## Requested evaluation frame

Evaluate AgentPay on whether it turns Cardano's machine-payment primitives into a safer organizational operating model for autonomous agents: measurable Cardano activity, stable-value settlement, ecosystem reuse, verifiable counterparties, programmable financial boundaries, and independently auditable execution.
