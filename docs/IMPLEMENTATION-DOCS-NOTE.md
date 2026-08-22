# AgentPay Documentation Alignment Note

This repository's documentation was synchronized on **2026-08-22** with the current AgentPay implementation.

The reason for the synchronization is that the project evolved from its original Hedera x402 bounty MVP into a multi-rail financial control plane. The current code includes Cardano Preprod managed per-agent signing, Cardano Mainnet self custody and external per-agent Ed25519 custody, a unified facilitator, isolated Cardano signer workers, one-agent/one-payment-identity enforcement, Pyth/Masumi/KERI integrations and reconciliation controls that older documentation did not fully describe.

The detailed rationale and file categories are recorded in [`CHANGELOG-DOCS.md`](CHANGELOG-DOCS.md).

Primary builder: **Daniel Praise** (`Daniel419797`).
