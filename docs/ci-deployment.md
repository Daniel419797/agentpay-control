# AgentPay CI and Deployment

**Status:** Current release pipeline description  
**Updated:** 2026-08-22

## Revision note

The release documentation reflects the current Cardano Mainnet external per-agent custody implementation and the Vercel plus two-service Render topology. It also preserves the rule that a GitHub Actions job failing before executable steps are created is infrastructure-blocked, not evidence that application tests failed.

## Release topology

One immutable Git commit is promoted to:

```text
GitHub commit
  |-- Vercel: dashboard/API
  `-- Render Blueprint
      |-- agentpay-facilitator
      `-- agentpay-cardano-signer
```

External providers, PostgreSQL and paid-resource servers are configured around that release but are not collapsed into these two Render services.

## Required repository gates

The applicable exact-head release checks include:

1. PostgreSQL migration validation.
2. Concurrent global payment-identity isolation verification.
3. Dashboard lint, typecheck, unit tests and production build.
4. Cardano signer syntax, tests and image build.
5. Hedera facilitator typecheck, tests and build.
6. Arc facilitator typecheck, tests and build.
7. Combined facilitator typecheck, tests and build.
8. Resource-server tests and build when included in the release profile.
9. Browser smoke tests where required.
10. CodeQL, dependency review and other configured security gates.
11. Production container build verification.

A deployment object or workflow status is not enough; the expected executable checks must actually run.

## Infrastructure-blocked workflow rule

If GitHub Actions creates no executable job steps and marks a run failed before those steps exist, classify the run as **workflow or infrastructure blocked**. Do not claim that application tests passed, and do not misreport it as a code-test failure without step or log evidence.

## Production trust boundaries

### Vercel dashboard and API

Policy, tenancy, approvals, spend reservations, audit, reconciliation and database access. No blockchain private keys, managed-agent master keys or Cardano Mainnet custody API credentials.

### `agentpay-facilitator`

Public multi-rail service for Hedera Testnet and Mainnet, Arc Testnet, and Cardano Preprod and Mainnet. The Cardano path independently verifies transactions, manages replay and claim state, submits via Blockfrost and confirms settlement.

### `agentpay-cardano-signer`

Isolated Cardano transaction and signing service with separate Preprod and Mainnet workers. Preprod supports per-agent deterministic testnet identities. Mainnet supports unsigned self custody plus external per-agent Ed25519 custody when configured.

### External Cardano Mainnet custody

Resolves a distinct public key and signer reference per Agent ID and signs only Cardano transaction-body hashes. Private keys stay outside AgentPay.

### PostgreSQL

Authoritative control-plane state and global canonical payment-identity uniqueness.

## Mainnet custody release rule

Network support and custody support are separate dimensions.

Cardano Mainnet currently supports:

- self-custody unsigned transaction preparation;
- external per-agent autonomous custody through dedicated managed identity and signing routes.

The following remain prohibited:

- Cardano Mainnet managed-agent master key;
- deployment-wide autonomous-agent payer;
- silent fallback to a shared key if external custody fails.

## Release promotion sequence

1. finalize release changes;
2. run exact-head repository checks and confirm steps actually executed;
3. verify migration and identity-isolation state;
4. deploy or sync `agentpay-cardano-signer` and required secrets;
5. verify Preprod and Mainnet signer worker health;
6. for enabled Mainnet managed custody, verify multiple Agent IDs resolve to distinct identities;
7. deploy `agentpay-facilitator`;
8. verify `/health`, `/supported` and `/ready`, including Cardano signer connectivity;
9. deploy and configure Vercel dashboard and API with matching facilitator capabilities;
10. apply required production migrations before new managed-agent provisioning;
11. exercise deliberately low-value transactions for enabled custody and network modes;
12. cross-check resulting Cardano evidence independently;
13. retain rollback capability until the new release is stable.

## CI source truth versus external deployment inputs

Repository CI can validate source, migrations, containers and deterministic test behavior. It cannot manufacture:

- real production custody credentials;
- funded Mainnet agent wallets;
- external provider accounts;
- a successful relevant-environment pilot;
- public Dune query IDs unless supplied;
- production DNS, TLS or provider state.

Those are deployment facts and should be reported as such.

## Catalyst note

The source now implements the Mainnet external per-agent custody path that was previously absent. For Catalyst purposes, AgentPay remains **TRL 5** until the intended Mainnet and pilot profile is demonstrated in a relevant environment. CI and source implementation should not be used to fabricate that demonstration.

## Related documents

- [`unified-production-deployment.md`](unified-production-deployment.md)
- [`production-readiness.md`](production-readiness.md)
- [`production-runbook.md`](production-runbook.md)
- [`managed-signer-isolation.md`](managed-signer-isolation.md)
- [`cardano-production.md`](cardano-production.md)