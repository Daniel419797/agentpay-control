# AgentPay Documentation Index

**Updated:** 2026-08-22  
**Primary builder / repository owner:** Daniel Praise (`Daniel419797`)

> **Why this index was added:** The repository now has a large documentation set covering architecture, security, operations, testing and Catalyst material. I added this index during the repository-wide documentation synchronization so readers can distinguish current implementation documents from proposal-facing material and understand why the August 2026 update was made.

## Current implementation documents

- [`01-software-requirements-document.md`](01-software-requirements-document.md) — current product/security requirements
- [`02-software-design-document.md`](02-software-design-document.md) — implemented system architecture and trust boundaries
- [`03-screens-and-dto-specification.md`](03-screens-and-dto-specification.md) — current UI/API data contracts
- [`04-detailed-workflows.md`](04-detailed-workflows.md) — end-to-end payment/custody/reconciliation flows
- [`implementation-status.md`](implementation-status.md) — source implementation inventory
- [`cardano-production.md`](cardano-production.md) — Cardano Preprod/Mainnet transaction and custody architecture
- [`managed-signer-isolation.md`](managed-signer-isolation.md) — one-agent/one-payment-identity model
- [`threat-model.md`](threat-model.md) — current threat model

## Operations and release

- [`production-readiness.md`](production-readiness.md) — criteria for an exact release/network/custody profile
- [`production-runbook.md`](production-runbook.md) — operating/deployment procedures
- [`unified-production-deployment.md`](unified-production-deployment.md) — canonical Vercel + Render topology
- [`ci-deployment.md`](ci-deployment.md) — CI/release promotion rules
- [`testing-script.md`](testing-script.md) — current verification guide
- [`demo-script.md`](demo-script.md) — current product demo flow
- [`design-qa.md`](design-qa.md) — visual/brand QA record; not architecture evidence

## Catalyst-facing material

- [`catalyst-submission.md`](catalyst-submission.md) — long-form Catalyst narrative and disclosure
- [`catalyst/submission.md`](catalyst/submission.md) — concise proposal-facing summary
- [`catalyst/architecture.md`](catalyst/architecture.md) — Catalyst architecture
- [`catalyst/demo-script.md`](catalyst/demo-script.md) — Catalyst demo runbook
- [`catalyst/pitch.md`](catalyst/pitch.md) — pitch/judge questions
- [`catalyst/landing-page-copy.md`](catalyst/landing-page-copy.md) — public Catalyst-oriented copy
- [`catalyst/release-checklist.md`](catalyst/release-checklist.md) — release/demo/pilot evidence checklist

## Repository documentation outside this folder

- [`../README.md`](../README.md) — authoritative project overview
- [`../SECURITY.md`](../SECURITY.md) — vulnerability reporting/security boundary
- [`../cardano-signer/README.md`](../cardano-signer/README.md) — signer implementation/configuration
- [`../analytics/dune/README.md`](../analytics/dune/README.md) — Dune public analytics boundary
- [`../dashboard/packages/mcp/README.md`](../dashboard/packages/mcp/README.md) — MCP agent adapter
- [`../dashboard/integrations/agentpay-control/SKILL.md`](../dashboard/integrations/agentpay-control/SKILL.md) — agent skill/integration instructions

## Why the 2026-08-22 synchronization was necessary

The original project documentation was created around the Hedera x402 bounty MVP. Since then AgentPay has implemented a broader multi-rail architecture, including:

- Cardano Preprod isolated per-agent managed signing;
- Cardano Mainnet self custody **and** external per-agent Ed25519 custody;
- separate Cardano signer and facilitator responsibilities;
- canonical one-agent/one-payment-identity database enforcement;
- direct x402 resource binding/replay controls;
- durable ambiguous-submission reconciliation;
- Pyth policy valuation;
- Masumi counterparty trust and separate escrow/refund/result workflow;
- optional Veridian/KERIA identity constraints;
- Dune public-chain analytics;
- unified Vercel + Render deployment/runbooks.

The documentation was therefore updated to describe what is currently implemented instead of retaining obsolete Mainnet self-custody-only/Hedera-only statements.

## Provenance and Catalyst disclosure

I am **Daniel Praise**, the person behind GitHub account `Daniel419797` and the primary technical contributor. I originally built AgentPay for the **Hedera x402 bounty** and later extended it into the current multi-rail system.

For Catalyst purposes I currently describe AgentPay as **TRL 5** until the intended Mainnet/pilot profile is demonstrated in a relevant environment. The implemented Mainnet external per-agent custody path resolves the previous source limitation, but source implementation alone is not a TRL 6 demonstration.

Pilot transaction, wallet, fee and adoption targets belong to the proposal plan and must be internally consistent; they are not treated in these documents as already-achieved repository facts.