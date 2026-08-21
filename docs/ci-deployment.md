# AgentPay CI and production deployment

AgentPay treats GitHub as source/control plane and keeps executable release checks tied to the exact immutable commit being promoted. A blocked or skipped CI job is not release evidence.

See [`managed-signer-isolation.md`](./managed-signer-isolation.md) for the payment-identity migration and signer trust model.

## Trust boundaries

- **GitHub**: source, pull requests, commit identity and check/status aggregation.
- **CI runners**: migrations, concurrent identity-isolation verification, application/service tests, browser tests, security scans and production image builds. CI never receives production signing material.
- **Dashboard**: policy/control plane and database migrations. It never receives blockchain private keys or managed-agent master keys.
- **Combined facilitator**: Hedera/Arc service boundary and Cardano verification/settlement boundary. Testnet managed agents receive distinct identities even though this service is shared.
- **Cardano signer gateway**: Cardano transaction construction plus isolated Preprod per-agent signing identity derivation. Mainnet is unsigned/self-custody only in the checked-in deployment.
- **Resource server**: x402 resource advertisement and settlement verification calls.
- **Future mainnet HSM/KMS**: must expose a unique key reference per agent; a deployment-wide payer fallback is prohibited.

## Required repository workflow

The exact release candidate must run the repository CI on a disposable PostgreSQL 17 database and complete all of these executable gates:

1. `npm ci` and production dependency audit.
2. Prisma migration deployment.
3. `verify:identity-isolation`:
   - verifies the canonical unique payment-identity index;
   - verifies the PostgreSQL advisory-lock trigger/function;
   - performs two simultaneous cross-organization claims for the same EVM identity using different casing;
   - requires the second transaction to block until the first commits, then fail with PostgreSQL unique violation `23505`.
4. Resource endpoint invariants.
5. Governance invariants.
6. Dashboard lint, typecheck, unit tests and production build.
7. Hedera facilitator build/typecheck/tests.
8. Arc facilitator build/typecheck/tests.
9. Combined facilitator typecheck/tests/build.
10. Cardano signer tests.
11. Resource-server build/typecheck/tests.
12. Playwright browser smoke tests.
13. Production Docker image builds for facilitator, Arc facilitator, combined facilitator, resource server and Cardano signer.

Security/dependency/code-scanning workflows applicable to the release must also be green before promotion.

## Global identity migration gate

`20260821080000_payment_identity_isolation` is intentionally fail-closed. Before creating the expression-unique index it scans all `PaymentAccount` rows for duplicate canonical identities.

If legacy shared-payer agents exist, migration stops with:

```text
PAYMENT_ACCOUNT_IDENTITY_DUPLICATES_EXIST
```

Do not bypass this error by deleting the constraint or rewriting historical payer rows. Archive/reprovision legacy managed agents onto distinct identities, retain their historical settlement/audit evidence, then rerun migration.

The resulting database has two layers:

```text
BEFORE INSERT/UPDATE trigger
        ↓
pg_advisory_xact_lock(network + canonical account)
        ↓
unique canonical identity index
```

That boundary applies across organizations, concurrent HTTP requests and multiple dashboard replicas.

## Render Blueprint

`render.yaml` defines the production service topology, including:

- `agentpay-cardano-signer-preprod`;
- `agentpay-facilitator`;
- Hedera/Cardano mainnet-specific services where configured;
- `agentpay-resource-server`;
- `agentpay-dashboard`.

### Testnet managed signer secrets

Generate **three independent** values, each exactly 32 cryptographically random bytes encoded as 43-character unpadded base64url:

```text
HEDERA_MANAGED_AGENT_MASTER_KEY
ARC_MANAGED_AGENT_MASTER_KEY
CARDANO_MANAGED_AGENT_MASTER_KEY
```

Placement is strict:

- Hedera key: combined facilitator only.
- Arc key: combined facilitator only.
- Cardano key: Cardano Preprod signer only.
- None of them: dashboard/Vercel.
- None of them: any mainnet service.

Never reuse an API capability, `KEY_ENCRYPTION_MASTER_KEY`, operator key, relayer key or another rail's master key as one of these values.

### Infrastructure accounts are separate

Hedera operator/contract payer credentials and Arc relayer/contract-execution credentials remain infrastructure roles required by those service paths. They are not agent wallets and must not be copied into `PaymentAccount.accountId`.

The old Arc/Cardano public payer-address variables can remain available for compatibility with old deployments, but new managed-agent provisioning and readiness do not depend on them.

### Cardano deployment modes

Preprod signer and the Cardano child of the combined facilitator run the legacy signing interface in `unsigned-only` mode. Managed Preprod agents use dedicated `/managed-identity` and `/managed-agent-sign` routes, each bound to immutable Agent ID plus expected payer address.

Mainnet signer/facilitator also run `unsigned-only` and contain no shared payer or deterministic agent master key. `render-cardano-mainnet-free.yaml` follows the same rule.

## Dashboard/Vercel secret boundary

Dashboard production configuration may contain public account identifiers, service URLs, API capabilities and chain data-provider credentials necessary for the control plane. It must not contain:

```text
HEDERA_OPERATOR_KEY
HEDERA_PAYER_KEY
HEDERA_MANAGED_AGENT_MASTER_KEY
ARC_PAYER_PRIVATE_KEY
ARC_RELAYER_PRIVATE_KEY
ARC_CONTRACT_EXECUTION_PRIVATE_KEY
ARC_MANAGED_AGENT_MASTER_KEY
CARDANO_SIGNING_SEED_HEX
CARDANO_ED25519_SIGNER_API_KEY
CARDANO_MANAGED_AGENT_MASTER_KEY
```

`KEY_ENCRYPTION_MASTER_KEY` is a separate dashboard encryption key and must itself be exactly 32 random bytes encoded as unpadded base64url.

## Activation sequence

1. Rebase/finalize the release branch and open a pull request against the intended production branch.
2. Run all exact-head CI/security checks; inspect logs rather than treating skipped infrastructure as a pass.
3. Identify and reprovision any legacy managed agents sharing a canonical payment identity.
4. Generate the three independent testnet managed-agent master keys and store them only on the correct Render services.
5. Create/sync Render services from the reviewed Blueprint and supply required `sync: false` values.
6. Apply database migrations; confirm the payment identity trigger and unique expression index exist.
7. Deploy signer/facilitator services before enabling creation of new managed testnet agents.
8. Create at least two managed agents on each enabled testnet rail and verify their account identities differ.
9. Fund and canary the **specific agent identities** being tested. Do not fund or treat an operator/shared wallet as proof of agent isolation.
10. Deploy the dashboard from the same immutable release SHA and verify readiness/health endpoints.
11. Promote only after every repository and applicable external launch gate has evidence against that SHA.

## Mainnet release rule

Current mainnet agent spending is self-custody/wallet-confirmation. Autonomous mainnet delegation is not production-ready until the system provisions and persists a unique external HSM/KMS/delegation key reference for each agent and verifies that signer against that agent's on-chain payer identity.

Do not enable autonomous mainnet spending by restoring a shared hot wallet, shared Cardano payer or shared EVM/Hedera payer.

## External production gates

Repository CI cannot establish external facts. Applicable release evidence still includes production DNS/TLS, secrets management, monitoring/on-call, database PITR/restore drill, incident exercise, independent security assessment, provider approvals and low-value chain canaries.

Cardano Mainnet evidence must come from the exact self-custody payer (or future reviewed per-agent HSM/KMS identity), with transaction hash, payer, payee, asset, amount and confirmation independently verified.
