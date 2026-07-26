# AgentPay Production Runbook

## Release gates

Every release must pass the repository CI workflow: all forward migrations against PostgreSQL 17, dashboard lint/typecheck/tests/build, facilitator typecheck/tests, and resource-server typecheck. Deploy an immutable commit SHA. Apply database migrations before shifting traffic and never edit a migration already recorded in production.

## Required production configuration

Use a managed PostgreSQL database with point-in-time recovery. Set `APP_ENV=production`, a unique 32+ character `AUTH_SECRET`, `CRON_SECRET`, and `KEY_ENCRYPTION_MASTER_KEY`, the HTTPS dashboard and facilitator URLs, a restricted facilitator API key, Hedera operator credentials held only by the facilitator, and notification credentials. Enable virtual cards only with an approved Stripe Issuing account, a restricted `rk_` key, publishable key, and signed webhook secret. Keep LI.FI and Stripe server credentials out of browser-exposed variables.

Set `HEDERA_PAYER_ACCOUNT_ID` in the dashboard to the same payer account configured in the facilitator. The dashboard uses this public account identifier to persist a Hedera transaction ID before contract submission; it never receives the payer private key. Maintenance reconciliation must remain enabled so `SUBMISSION_UNKNOWN` contract executions are resolved from mirror-node evidence without blind retries.

Run the dashboard, facilitator, and resource server as separate least-privilege services. Restrict database ingress to the dashboard and migration runner. Restrict facilitator ingress to the dashboard/resource services where the platform permits it.

## Deployment order

1. Take and checksum a database backup.
2. Deploy the facilitator and confirm `/health`.
3. Apply `npm run db:deploy` from the dashboard release artifact.
4. Deploy the dashboard and confirm `/api/v1/ready` returns ready.
5. Deploy the resource server and confirm `/health`.
6. Invoke the authenticated maintenance endpoint once and inspect failed jobs.
7. Run a low-value canary payment and verify the transaction independently in HashScan.

Roll back application containers to the previous SHA when required. Database migrations are forward-only; resolve a database regression with a new corrective migration, not a destructive rollback.

## Scheduled operations

Call `POST /api/v1/internal/maintenance` with `Authorization: Bearer <CRON_SECRET>` every five minutes. It expires stale reservations, processes retention/deletion, checks resources, marks invoices overdue, reconciles bridges, executes due/event rules, refreshes financial intelligence, and opens one deduplicated urgent incident when a payment, fiat transfer, bridge, or contract submission remains unresolved beyond 15 minutes. Run the notification outbox endpoint at least once per minute. Alert on readiness failure, dead-letter events, unknown settlements, failed automation, card-provider webhook failures, and stale maintenance runs.

Audit events are chained per organization by a PostgreSQL insertion trigger. A lock-protected `chainSequence` gives every event a deterministic order, and each event binds its immutable content to `previousHash` and `eventHash`; CSV and JSON exports include the chain evidence. Monitor migration drift and database-trigger presence because application-only audit checks are not a substitute for the database controls.

## Backup and restore

Run `scripts/backup-database.ps1` with `DATABASE_URL` set from the secret manager. Store the `.dump` and `.sha256` in encrypted, access-controlled object storage in a separate account. Retain daily, weekly, and monthly generations according to policy. Perform a restore drill at least quarterly:

```powershell
$env:DATABASE_URL = '<isolated restore target>'
./scripts/restore-database.ps1 -BackupFile ./backups/agentpay-YYYYMMDDTHHMMSSZ.dump -ConfirmDatabase
cd dashboard
npm.cmd run db:deploy
```

Validate `/api/v1/ready`, row counts for organizations/payment intents/settlements, and a read-only dashboard login before recording the drill as successful.

## Incident response

For suspected credential exposure, enable the organization kill switch, revoke agent credentials, freeze cards, rotate the affected secret, and inspect correlation IDs in audit and service logs. For an ambiguous Hedera submission, do not retry blindly: reconcile the candidate transaction ID and mirror-node evidence first. For card or fiat discrepancies, preserve the signed provider webhook and retrieve the current provider object before changing local state. For bridge delays, retain the source transaction hash and provider route ID and continue reconciliation until confirmed, failed, or refunded.

## External production prerequisites

Production launch still requires organizational accounts and approvals outside this repository: a production Hedera account/KMS policy, Stripe Issuing and Financial Accounts approval where available, production Supabase email configuration, LI.FI route availability for the selected networks/tokens, DNS/TLS, secret manager, error tracking, and an on-call owner. Testnet and sandbox success does not prove those approvals.
