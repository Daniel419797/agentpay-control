# Security Policy

**Updated:** 2026-08-22

> **Reason for update:** AgentPay now implements Cardano Mainnet external per-agent Ed25519 custody in addition to self custody. This policy was synchronized with the current multi-rail trust boundaries so vulnerability reporting and production-security requirements cover the actual signer, facilitator and external-custody architecture.

AgentPay controls payment credentials, spending policy, approvals, settlement workflows and multiple blockchain/provider boundaries. Security reports should be handled privately and should include enough evidence to reproduce and assess the issue without exposing real credentials or funds.

## Supported versions

Security fixes are applied to the current `master` branch and the latest production release derived from it. Older unreleased commits are not maintained as separate supported versions.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability, leaked secret, authentication bypass, cross-tenant access issue, signing weakness, payment-identity collision, settlement ambiguity, SSRF path, webhook-verification issue, external-custody weakness, or other security-sensitive defect.

Use GitHub's private vulnerability reporting / repository security advisory flow when it is enabled for this repository. If that private flow is unavailable, contact the repository owner privately through GitHub and provide only the minimum information needed to establish a secure reporting channel.

A useful report includes:

- affected route, component, network or workflow;
- attacker prerequisites and expected trust boundary;
- reproducible steps using test accounts and non-production/low-value funds;
- concrete impact and relevant logs or transaction identifiers with secrets removed;
- suggested remediation when known.

Never include private keys, API keys, session cookies, managed-agent master keys, external HSM/KMS/delegation credentials, raw card data, unrestricted provider credentials or other live secrets in an issue, pull request, screenshot or report attachment.

## Current high-value trust boundaries

### Control plane — Vercel

Holds organization/policy/payment state. It must not receive blockchain private keys, testnet managed-agent master secrets or Cardano Mainnet custody API credentials.

### Unified facilitator — Render

Holds rail-scoped protocol/infrastructure capabilities. On Cardano it independently verifies signed transactions, manages settlement claims/replay state, submits via Blockfrost and checks confirmation evidence. It does not hold the Cardano payer private key.

### Cardano signer — Render

Constructs Cardano transactions and performs the selected signing path. It may hold the Preprod testnet-only derivation secret and, when configured, the Mainnet external-custody API capability. It does not submit Cardano transactions on-chain.

### External Cardano Mainnet custody

Holds the managed-agent Mainnet private keys. AgentPay receives only a per-agent public key/signer reference and sends only the transaction-body hash for signing. Returned signatures are verified locally.

### PostgreSQL

Enforces organization/payment state and the canonical one-payment-identity-per-agent invariant.

## Payment-identity security requirement

A shared service deployment is permitted; a shared managed-agent payment identity is not.

```text
(network, canonical payment identity) -> one PaymentAccount -> one agent
```

Duplicate identities, including concurrent cross-organization claims, must fail closed.

## Cardano Mainnet custody requirements

- `CARDANO_MANAGED_AGENT_MASTER_KEY` is prohibited on Mainnet.
- A deployment-wide autonomous-agent payer/private key is prohibited.
- Mainnet external custody must resolve a stable per-Agent-ID Ed25519 identity.
- AgentPay must derive the Cardano payer address locally from the returned public key.
- Only the exact transaction-body hash may be sent for external signing.
- Returned public-key/signer-reference changes must fail closed.
- Returned Ed25519 signatures must verify locally.
- Custody failure must not fall back to another agent, shared key or platform payer.
- Custody API credentials must be signer-only and distinct from other signer/facilitator capabilities.

## Response and remediation

Security reports are triaged by exploitability and impact. Payment authorization, cross-tenant access, credential disclosure, payment-identity collision, signature/settlement integrity, custody isolation and arbitrary contract execution are high-priority classes.

A validated vulnerability should be fixed on a dedicated branch, covered by a regression test when practical, reviewed and deployed from an immutable commit SHA.

If active compromise is suspected:

1. use the organization emergency stop and provider-side revocation/freeze controls where applicable;
2. rotate/disable affected credentials or custody capability;
3. stop funding/using affected payment identities;
4. preserve audit, provider and chain evidence;
5. reconcile ambiguous blockchain/fiat submissions before retrying;
6. restore service only after the affected trust boundary has been reviewed.

## Production security requirements

Production releases should execute the repository checks required by the enabled profile, including relevant CI, CodeQL, dependency review, migrations, identity-isolation checks, unit/browser tests and container builds. A workflow that fails before executable steps are created is infrastructure-blocked and is not a successful security validation.

Production configuration must fail closed when required payment/custody dependencies are absent. Signing, settlement, contract-execution, settlement-claim and custody capabilities must remain scoped and separated.

Where managed Mainnet private keys are used, they remain in an external HSM/KMS/delegated custody system rather than ordinary AgentPay application configuration.

## Project contact/provenance

The repository owner and primary technical contributor is **Daniel Praise** (`Daniel419797`).

See [`docs/threat-model.md`](docs/threat-model.md), [`docs/managed-signer-isolation.md`](docs/managed-signer-isolation.md) and [`docs/production-readiness.md`](docs/production-readiness.md) for the current detailed security model.