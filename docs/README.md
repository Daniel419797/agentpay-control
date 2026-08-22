# AgentPay Documentation Index

**Updated:** 2026-08-22  
**Primary builder / repository owner:** Daniel Praise (`Daniel419797`)

This index separates current implementation documents, operational material and Catalyst-facing material. It was added during the August 2026 documentation synchronization after the project expanded beyond the original Hedera x402 MVP.

## Current implementation documents

- [`01-software-requirements-document.md`](01-software-requirements-document.md) - current product and security requirements
- [`02-software-design-document.md`](02-software-design-document.md) - implemented system architecture and trust boundaries
- [`03-screens-and-dto-specification.md`](03-screens-and-dto-specification.md) - current UI and API data contracts
- [`04-detailed-workflows.md`](04-detailed-workflows.md) - end-to-end payment, custody and reconciliation flows
- [`implementation-status.md`](implementation-status.md) - source implementation inventory
- [`cardano-production.md`](cardano-production.md) - Cardano Preprod and Mainnet transaction and custody architecture
- [`managed-signer-isolation.md`](managed-signer-isolation.md) - one-agent, one-payment-identity model
- [`threat-model.md`](threat-model.md) - current threat model

## Operations and release

- [`production-readiness.md`](production-readiness.md) - criteria for an exact release, network and custody profile
- [`production-runbook.md`](production-runbook.md) - operating and deployment procedures
- [`unified-production-deployment.md`](unified-production-deployment.md) - canonical Vercel + Render topology
- [`ci-deployment.md`](ci-deployment.md) - CI and release promotion rules
- [`testing-script.md`](testing-script.md) - current verification guide
- [`demo-script.md`](demo-script.md) - current product demo flow
- [`design-qa.md`](design-qa.md) - visual and brand QA record; not architecture evidence

## Catalyst-facing material

- [`catalyst-submission.md`](catalyst-submission.md) - long-form Catalyst narrative and disclosure
- [`catalyst/submission.md`](catalyst/submission.md) - concise proposal-facing summary
- [`catalyst/architecture.md`](catalyst/architecture.md) - Catalyst architecture
- [`catalyst/demo-script.md`](catalyst/demo-script.md) - Catalyst demo runbook
- [`catalyst/pitch.md`](catalyst/pitch.md) - pitch and judge questions
- [`catalyst/landing-page-copy.md`](catalyst/landing-page-copy.md) - public Catalyst-oriented copy
- [`catalyst/release-checklist.md`](catalyst/release-checklist.md) - release, demo and pilot evidence checklist

## Repository documentation outside this folder

- [`../README.md`](../README.md) - authoritative project overview
- [`../SECURITY.md`](../SECURITY.md) - vulnerability reporting and security boundary
- [`../cardano-signer/README.md`](../cardano-signer/README.md) - signer implementation and configuration
- [`../analytics/dune/README.md`](../analytics/dune/README.md) - Dune public analytics boundary
- [`../dashboard/packages/mcp/README.md`](../dashboard/packages/mcp/README.md) - MCP agent adapter
- [`../dashboard/integrations/agentpay-control/SKILL.md`](../dashboard/integrations/agentpay-control/SKILL.md) - agent skill and integration instructions

## Why the 2026-08-22 synchronization was necessary

The original project documentation was created around the Hedera x402 bounty MVP. AgentPay now implements a broader multi-rail architecture, including:

- Cardano Preprod isolated per-agent managed signing
- Cardano Mainnet self custody and external per-agent Ed25519 custody
- separate Cardano signer and facilitator responsibilities
- canonical one-agent, one-payment-identity database enforcement
- direct x402 resource binding and replay controls
- durable ambiguous-submission reconciliation
- Pyth policy valuation
- Masumi counterparty trust and separate escrow, refund and result workflows
- optional Veridian/KERIA identity constraints
- Dune public-chain analytics
- unified Vercel + Render deployment and runbooks

The documentation was updated to describe what is currently implemented instead of retaining obsolete Mainnet self-custody-only or Hedera-only statements.

## Provenance and Catalyst disclosure

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor. AgentPay was originally built for the **Hedera x402 bounty** and later extended into the current multi-rail system.

For Catalyst purposes, AgentPay is described as **TRL 5** until the intended Mainnet and pilot profile is demonstrated in a relevant environment. The implemented Mainnet external per-agent custody path resolves the previous source limitation, but source implementation alone is not a TRL 6 demonstration.

Pilot transaction, wallet, fee and adoption targets belong to the proposal plan and must be internally consistent. They are not treated in these documents as already-achieved repository facts.