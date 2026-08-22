# AgentPay CI and production deployment

AgentPay promotes one immutable Git commit through two deployment targets:

```text
GitHub commit
   |-- Vercel: AgentPay Next.js dashboard/API
   `-- Render Blueprint: exactly two services
       |-- agentpay-facilitator
       `-- agentpay-cardano-signer
```

See [`unified-production-deployment.md`](./unified-production-deployment.md) for the canonical environment mapping and rollout procedure, and [`managed-signer-isolation.md`](./managed-signer-isolation.md) for per-agent payment identity isolation.

## Release invariants

A release is not green merely because a provider created a deployment object. Executable checks must actually run. A GitHub Actions job that fails before step execution is infrastructure-blocked, not application evidence.

The exact release candidate must verify:

1. PostgreSQL migrations, including the global canonical `PaymentAccount` identity uniqueness/locking migration.
2. Concurrent cross-organization duplicate identity rejection.
3. Dashboard lint, typecheck, unit tests and production Next.js build.
4. Cardano signer syntax and unit tests.
5. Hedera facilitator typecheck, tests and build.
6. Arc facilitator typecheck, tests and build.
7. Combined multi-network facilitator typecheck, tests and build.
8. Resource server build/tests where that external demo/provider is part of the release.
9. Browser smoke tests and applicable security/dependency scanning.
10. Production container builds for the two canonical Render services.

`scripts/ci/verify-unified-topology.sh` is the provider-independent check for the signer/facilitator source graph. The Vercel dashboard build invokes it as `prebuild`, which prevents the frontend release from succeeding if the checked-in backend topology is type-invalid or its unit tests fail.

## Production trust boundaries

- **Vercel dashboard/API:** policy, tenancy, approvals, audit, reconciliation and database access. No blockchain private keys, managed-agent master keys or Mainnet custody API credentials.
- **agentpay-facilitator:** one public multi-rail service with network-scoped credentials. It serves Hedera Testnet/Mainnet, Arc Testnet and Cardano Preprod/Mainnet facilitator paths.
- **agentpay-cardano-signer:** one Render service, internally split into isolated Preprod and Mainnet workers. Preprod may derive isolated managed-agent keys. Mainnet supports unsigned self-custody plus external per-agent Ed25519 custody when configured.
- **Cardano Mainnet external custody adapter:** resolves a distinct public key/signer reference for each immutable Agent ID and signs only Cardano transaction-body hashes. Private keys stay outside AgentPay.
- **PostgreSQL/Supabase:** authoritative control-plane state and global payment-identity uniqueness.
- **External providers/resource servers:** separate from the canonical two-service Render Blueprint.

One Render Blueprint deployment does not collapse the facilitator and Cardano signer into one security process. The Mainnet custody API key exists only on the signer and the deterministic Cardano managed-agent master key remains testnet-only.

## Global payment identity migration

`20260821080000_payment_identity_isolation` fails closed if existing canonical identity duplicates exist. Do not bypass that check. Reprovision/archive legacy shared-payer managed agents while retaining historical settlement/audit evidence, then re-run migration.

The database enforces:

```text
INSERT/UPDATE PaymentAccount
        ↓
canonical blockchain identity
        ↓
pg_advisory_xact_lock
        ↓
unique canonical identity index
```

This protects against simultaneous requests across organizations and application replicas.

## Canonical Render topology

Root `render.yaml` is the production Blueprint entrypoint. It creates:

- `agentpay-cardano-signer`
- `agentpay-facilitator`

The facilitator exposes:

```text
/hedera/testnet
/hedera/mainnet
/arc/testnet
/cardano/preprod
/cardano/mainnet
```

Root `/verify` and `/settle` route by the exact network bound in both x402 requirement and payment payload. `/supported` aggregates every active child rail. `/ready` additionally verifies the Cardano signer service.

Arc public Mainnet is intentionally not declared until a public Mainnet exists and has its own asset/chain review.

## Mainnet custody rule

Network support is separate from custody mode.

- Hedera Mainnet agents remain self-custody; facilitator operator/payer keys are infrastructure identities, not agent wallets.
- Cardano Mainnet self-custody remains available through unsigned transaction preparation.
- Cardano Mainnet autonomous agents use the dedicated `/managed-identity` and `/managed-agent-sign` path backed by the external per-agent custody adapter.
- `CARDANO_MANAGED_AGENT_MASTER_KEY` and deployment-wide agent payer keys remain prohibited on Cardano Mainnet.
- The custody adapter must not return a shared key for multiple agents; AgentPay derives the payer address and database uniqueness rejects duplicate payment identities.

## Promotion sequence

1. Open/finalize the release PR.
2. Run exact-head repository checks and verify jobs actually executed.
3. Verify Vercel prebuild output includes successful Cardano signer, Hedera, Arc and combined-facilitator checks.
4. Ensure no legacy duplicate payment identities block the production migration.
5. Sync root `render.yaml` and populate required `sync: false` values for the selected profile.
6. Verify signer `/health` reports both Cardano networks.
7. If Mainnet managed custody is enabled, verify the Mainnet worker reports `external-per-agent` identity support and that two different Agent IDs resolve to different addresses.
8. Verify facilitator `/health`, `/supported` and `/ready`.
9. Configure Vercel `AGENTPAY_FACILITATOR_ORIGIN` plus matching network capability values from Render.
10. Apply database migrations before enabling new managed-agent provisioning.
11. Exercise low-value transactions for the custody/network modes being enabled.
12. Retire old per-network services only after the new topology is verified and a rollback window has passed.

Repository checks cannot manufacture external production inputs such as real custody credentials, funded accounts or provider access. Those are supplied by the deployment environment, not by source code.