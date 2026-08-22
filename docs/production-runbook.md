# AgentPay Production Runbook

## Release gates

Every release must pass the repository checks that apply to the enabled profile: forward PostgreSQL migrations, dashboard lint/typecheck/tests/build, facilitator tests/builds, Cardano signer tests/build, resource-server checks and security/dependency checks. Deploy an immutable commit SHA. Apply database migrations before shifting traffic and never edit a migration already recorded in production.

## Required production configuration

Use a managed PostgreSQL database and production secret storage. Set `APP_ENV=production`, unique 32+ character `AUTH_SECRET` and `CRON_SECRET` values, and a cryptographically random 32-byte base64url `KEY_ENCRYPTION_MASTER_KEY`.

The root `render.yaml` is the canonical Render production Blueprint. It deploys the combined facilitator and isolated Cardano signer. The Next.js dashboard/API is deployed on Vercel.

### Cardano Preprod managed custody

`CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY` belongs only on the Cardano signer. It must be a distinct 32-byte random base64url secret. It is used only to derive isolated Preprod agent identities and must never be copied to Vercel, the facilitator or a Mainnet service.

### Cardano Mainnet custody

Cardano Mainnet supports two independent modes:

- **Self custody:** AgentPay prepares an unsigned transaction for the verified wallet; the wallet owner signs it.
- **External per-agent managed custody:** the Cardano signer uses `CARDANO_MAINNET_AGENT_CUSTODY_URL` and `CARDANO_MAINNET_AGENT_CUSTODY_API_KEY` to resolve and sign with a distinct externally custodied Ed25519 identity for each immutable Agent ID.

Mainnet must not contain `CARDANO_MANAGED_AGENT_MASTER_KEY`, a raw signing seed or a deployment-wide agent payer private key. The external custody API credential belongs only on the Cardano signer.

The external custody adapter must expose:

```text
POST /identity
POST /sign
```

`/identity` returns the agent-specific Ed25519 public key and signer reference. AgentPay derives the `addr1...` address locally. `/sign` receives the selected signer reference and 32-byte Cardano transaction-body hash. AgentPay verifies every returned Ed25519 signature against the resolved public key.

### Other secrets

Configure separate signing, settlement and contract-execution facilitator credentials. Keep Hedera/Arc private keys only in their facilitator services. Enable virtual cards only with the applicable approved provider account/credentials. Keep LI.FI, Stripe and other server credentials out of browser-exposed variables.

## Deployment order

1. Confirm database backup/recovery is available for the target environment.
2. Deploy the Cardano signer and confirm `/health` reports the expected Preprod/Mainnet workers.
3. If Mainnet external custody is enabled, confirm Mainnet health reports `external-per-agent` managed identity support.
4. Deploy the facilitator and confirm `/health`, `/supported` and `/ready`.
5. Apply `npm run db:deploy` from the dashboard release artifact.
6. Deploy the dashboard and confirm `/api/v1/ready` for the selected profile.
7. Deploy/verify any resource server used by the profile.
8. Invoke the authenticated maintenance endpoint once and inspect failed jobs.
9. Provision two managed test agents where applicable and verify they resolve to distinct payment identities.
10. Run deliberately low-value transactions for each enabled network/custody/asset mode and verify them independently on-chain.

Roll back application containers to the previous SHA when required. Database migrations are forward-only; resolve a database regression with a new corrective migration rather than editing or destructively rolling back a recorded migration.

## Cardano Mainnet per-agent custody checks

Before funding a newly provisioned external-delegated agent:

1. provision the agent through the normal AgentPay API/UI;
2. verify the returned address starts with `addr1` and is unique in `PaymentAccount`;
3. provision a second test Agent ID and verify its address/public key/signer reference differ;
4. confirm no Mainnet managed-agent master key exists on the signer;
5. fund only the exact agent address with deliberately suitable UTxOs;
6. perform a low-value policy-controlled payment;
7. verify the transaction payer/payee/asset/amount on Cardano;
8. exercise custody-adapter unavailability or invalid-signature behavior and confirm AgentPay fails closed without falling back to another key.

## Scheduled operations

Call `POST /api/v1/internal/maintenance` with `Authorization: Bearer <CRON_SECRET>` on the configured schedule. It expires stale reservations, processes retention/deletion, checks resources, marks invoices overdue, reconciles supported rails, executes due/event rules and opens deduplicated incidents for unresolved financial operations. Run the notification outbox endpoint on its configured schedule.

Alert on readiness failure, dead-letter events, unknown settlements, failed automation, custody-adapter failures and stale maintenance runs.

Audit events are chained per organization by PostgreSQL controls. Monitor migration drift and database-trigger presence because application-only audit checks are not a substitute for the database invariants.

## Backup and restore

Use the repository backup tooling against the managed database and store backups/checksums in encrypted, access-controlled storage. Perform periodic restore drills into an isolated target, apply migrations and verify readiness plus representative data before recording the drill as successful.

Example:

```powershell
$env:DATABASE_URL = '<isolated restore target>'
./scripts/restore-database.ps1 -BackupFile ./backups/agentpay-YYYYMMDDTHHMMSSZ.dump -ConfirmDatabase
cd dashboard
npm.cmd run db:deploy
```

## Incident response

For suspected credential exposure, enable the organization emergency stop, revoke affected agent/capability credentials and preserve audit/provider/chain evidence before rotating secrets.

For a Cardano Mainnet external signer compromise:

1. disable the affected external signer reference/key at the custody provider;
2. keep the historical `PaymentAccount` identity and settlement evidence unchanged;
3. provision a replacement per-agent key through the controlled identity workflow;
4. update/fund the replacement identity only after uniqueness and custody checks pass;
5. do not substitute a shared hot wallet or Mainnet master key.

For an ambiguous Cardano submission, do not retry blindly. Reconcile the exact candidate transaction from Cardano evidence first. The same principle applies to other supported rails.

## Provider-specific operation

Some features require provider accounts or credentials outside the repository—for example Blockfrost, an external Mainnet custody provider, Stripe, Supabase, LI.FI, Pyth, Masumi or KERIA. Only the providers used by the selected deployment profile need to be configured. Repository source support does not itself create those external accounts.