# AgentPay landing-page copy — Catalyst edition

## Hero

### Financial infrastructure for autonomous AI agents on Cardano

Give software agents the ability to pay without giving them unrestricted wallets. AgentPay combines Cardano x402 payments, USDCx/ADA settlement, Pyth-valued budgets, Masumi counterparty trust, optional Veridian/KERI credentials, approvals, reconciliation and emergency controls.

Primary CTA: **See the live Cardano demo**
Secondary CTA: **View public Dune analytics**

Proof line: **Real chain evidence only. No synthetic “live” metrics.**

## Problem

### Autonomy without a financial boundary is not enterprise-ready

An agent may need to buy data, inference, research or another agent's service in seconds. A normal wallet answers “can this key sign?” It does not answer “should this agent spend this amount, with this provider, in this asset, under this organization's policy?”

AgentPay answers that second question before money moves.

## Control layer

### Every agent gets a programmable financial boundary

Configure:

- per-transaction, hourly, daily and monthly limits
- USD-denominated limits using Pyth
- allowed Cardano assets and networks
- trusted Masumi agents and capabilities
- minimum observed escrow history/reputation
- optional trusted KERI credential issuers/schemas
- human approval thresholds
- emergency stop

## Cardano settlement

### Direct x402 when speed matters

AgentPay supports Cardano `exact` x402 with exact resource, payer, payee, asset and amount binding. ADA uses `lovelace`; Mainnet USDCx is pinned to its canonical Cardano asset identity. Signing is isolated from the dashboard and settlement is independently reconciled from chain evidence.

## Masumi escrow

### Agent-to-agent work with result and refund evidence

For jobs that need escrow, AgentPay uses Masumi as a separate purchase lifecycle rather than pretending escrow is direct x402. AgentPay tracks locking, result submission, completion, refunds and disputes, verifies the returned result hash, and turns observed outcomes into an auditable seller reputation signal.

## Identity

### Know which agent and payment key you are trusting

AgentPay verifies the Masumi registry source, agent identity, capability, seller address and Cardano payment credential. Organizations can additionally require a Veridian/KERI ACDC credential from a trusted issuer and schema.

## Analytics

### Public chain facts, private business context

Dune shows public Cardano settlement activity. AgentPay's authenticated analytics show privacy-safe logical metrics such as paying agents, providers, policy denials, approval events, settlement latency and verified escrow outcomes. Tenant identities, prompts and resource content are not published to Dune.

## Safety

### Ambiguity is not failure

A network timeout after submission does not mean a payment failed. AgentPay records the candidate transaction and reconciles it independently instead of blindly retrying and risking double spend.

Other controls include isolated credentials, idempotency, resource-specific replay binding, exact settlement verification, immutable audit evidence and release-SHA canary verification.

## Closing CTA

### Let agents act. Keep the financial boundary.

**Explore AgentPay on Cardano** · **Open Dune analytics** · **Review the architecture**
