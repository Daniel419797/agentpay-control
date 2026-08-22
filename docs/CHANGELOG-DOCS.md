# Documentation Synchronization — 2026-08-22

This record explains why the AgentPay documentation was updated on 2026-08-22.

## Reason

The repository evolved beyond the original Hedera x402 bounty MVP. The current implementation now includes a broader multi-rail control plane and, importantly, Cardano Mainnet external per-agent Ed25519 custody in addition to self custody. Several older documents still described the original Hedera-focused design or the previous Cardano Mainnet self-custody-only state.

## What changed in the documentation

- Identified the primary builder as **Daniel Praise** (`Daniel419797`).
- Added first-person disclosure of the project's original Hedera x402 bounty origin where proposal/provenance context requires it.
- Updated Cardano Mainnet architecture to external per-agent Ed25519 custody plus self custody.
- Clarified that the Cardano signer constructs/signs transactions but does not submit them.
- Clarified that the Cardano facilitator independently verifies, submits through Blockfrost and reconciles confirmation evidence.
- Updated the one-agent/one-payment-identity isolation model and database enforcement.
- Updated direct x402, Masumi escrow, Pyth, KERI/Veridian, Dune and ambiguous-submission documentation.
- Replaced old Hedera-only requirements/design/screens/workflows/demo/testing documents with current-state versions while retaining the old revisions in Git history.
- Kept Catalyst maturity at **TRL 5** until a relevant-environment Mainnet/pilot demonstration exists.
- Explicitly separated source implementation from real deployment/provider/pilot evidence.
- Added Catalyst checklist language requiring internally consistent wallet/transaction/fee/adoption targets instead of treating planning numbers as repository achievements.

## Files reviewed

The pass covered the root project/security documentation, every Markdown document under `docs/`, Cardano signer documentation, Dune analytics documentation, the MCP package README, the agent integration `SKILL.md`, and documentation-facing environment comments relevant to the new Mainnet custody path.

## Historical provenance

The original July 2026 Hedera-focused documents remain recoverable from Git history. The checked-in documentation now reflects the current implementation so readers do not have to infer which older statements are obsolete.
