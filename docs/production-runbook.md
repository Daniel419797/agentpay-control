# AgentPay Production Runbook

**Updated:** 2026-09-10

## 1. Canonical topology

```text
Git commit / release
  |
  |-- Vercel: AgentPay control plane
  |
  |-- PostgreSQL: durable application state
  |
  `-- Render services
       |-- agentpay-facilitator
       `-- agentpay-cardano-signer
            |-- Preprod worker
            `-- Mainnet worker -> optional external per-agent custody

External providers/data systems as enabled:
Moove / Stripe / Blockfrost / Masumi / Pyth / KERIA / Dune / resource servers
```

## 2. Secret ownership

### Vercel

May hold application/session/database and provider credentials required by control-plane integrations such as Moove/Stripe according to environment design. Never place Cardano payer private keys, Cardano test derivation secrets, or Mainnet custody private keys here.

### Facilitator

Holds only network/protocol/submission capabilities required for its rails.

### Cardano signer

May hold Preprod test derivation capability and Mainnet external-custody API capability. It does not hold the external provider's managed Mainnet private keys and does not submit transactions.

### External custody/provider

Holds the underlying managed Mainnet private key material. Apply provider-side authentication, allowlists, quotas, and monitoring.

## 3. Release preparation

1. Record the exact candidate SHA.
2. Confirm required CI/security jobs completed successfully.
3. Review database migrations and backup/restore state.
4. Validate provider/network configuration against `.env.example` and service-specific contracts.
5. Confirm production credentials are stored in platform secret management, not repository files.
6. Identify which financial profiles are intentionally enabled for this release.

## 4. Database

- confirm PostgreSQL connectivity/TLS as required;
- take/verify an appropriate backup or restore point before high-impact migrations;
- apply forward migrations;
- do not bypass canonical payment-identity constraints;
- verify Moove raw-SQL table migration exists before enabling Moove;
- ensure migration tooling will not drop raw-SQL-managed tables during future schema diff/introspection;
- run identity/governance checks against the correct non-destructive environment.

## 5. Cardano signer deployment

Deploy the signer from the exact release and verify:

- root/network health/readiness;
- Preprod/Mainnet workers start only with valid network configuration;
- signer API capabilities are network-scoped;
- Blockfrost network/project IDs match;
- Preprod test derivation secret exists only when that profile is enabled;
- Mainnet has no managed-agent master signing key;
- Mainnet custody URL/key are complete as a pair and scoped to signer.

For external custody, resolve multiple Agent IDs before funding and verify stable/distinct public keys, signer references, and derived addresses.

## 6. Facilitator deployment

Deploy the combined/public facilitator from the same release. Verify `/health`, `/supported`, `/ready`, network namespaces, signer connectivity, and required submission/provider configuration.

Exercise test vectors for invalid amount/payee/network/signature/transaction shape before material-value rollout.

## 7. Vercel control plane deployment

Deploy the dashboard/API from the same release. Verify:

- public origin/session/auth configuration;
- PostgreSQL connection and migration state;
- facilitator origins/capabilities;
- enabled provider configuration;
- no signer/custody private material;
- `/api/v1/health` and `/api/v1/ready`.

A preview build should not depend on an unavailable live database for unit tests unless that preview explicitly provisions one. DB-backed tests belong in CI/test environments with a reachable test database.

## 8. Moove operations

When Moove Receive is enabled:

1. verify account credential and organization binding;
2. verify provider settlement wallet/token configuration independently;
3. configure exact settlement identity before invoice automation;
4. configure reconciliation scheduler/secret;
5. create and pay a low-value single-use link;
6. verify exactly one local `COMPLETED` event with provider token/amount/transaction evidence;
7. test uncertain create recovery in staging;
8. monitor `SUBMISSION_UNKNOWN`, failure codes, and reconciliation pages/backlog.

## 9. Stripe cards and fiat

When enabled:

- verify restricted key/webhook secret and provider account eligibility;
- test cardholder/card creation in an appropriate controlled environment;
- verify status/freeze/cancel behavior;
- verify signed webhook rejection/acceptance cases;
- verify provider display-key flow does not persist raw card data;
- test financial-account reads and inbound/outbound movement lifecycle;
- reconcile provider state before treating transfers as terminal;
- ensure Sandbox is not used for anything represented as real financial activity.

## 10. Direct x402 canary

For every enabled network/custody/asset combination:

1. use a registered low-value resource;
2. execute through normal policy/reservation/approval flow;
3. verify the exact agent/payment identity;
4. verify the facilitator's rail-specific validation;
5. independently inspect settlement evidence;
6. confirm AgentPay payment/fulfillment state matches that evidence.

## 11. Cardano canary

Additionally verify:

- signer constructs/signs but does not submit;
- facilitator independently verifies CBOR;
- Blockfrost submission happens only after durable claim;
- on-chain payer/payee/asset/amount match;
- confirmation depth/reconciliation state is correct.

## 12. Ambiguity drill

Simulate or safely exercise an uncertain provider/network response after possible submission.

Expected behavior:

- candidate/provider identifiers retained;
- reservation/claim not blindly reset;
- pending/`SUBMISSION_UNKNOWN` state;
- no duplicate mutation;
- reconciliation resolves from authoritative read evidence.

Exercise this for Cardano and any provider flow where write ambiguity is possible, including Moove create and cross-chain submission.

## 13. Policy/approval/emergency drill

Verify:

- within-policy action succeeds;
- denied action never reaches signing/provider mutation;
- approval-required action waits for valid threshold decision;
- prohibited self-approval is rejected;
- same approval cannot authorize a materially different action;
- kill switch blocks new risky operations;
- defensive reconciliation/read operations remain available as designed.

## 14. External trust integrations

When enabled, test valid and fail-closed cases for:

- Pyth freshness/confidence/price;
- Masumi registry identity/capability/payment facts;
- Masumi escrow result/refund/dispute lifecycle;
- Veridian/KERIA issuer/schema/subject/freshness/revocation/binding;
- Dune public analytics against a known transaction.

## 15. Monitoring

Monitor:

- API availability and 5xx rate;
- authentication/rate-limit anomalies;
- database failures/pool pressure;
- facilitator/signer readiness;
- provider/custody errors;
- payment denial/approval/pending/failure ratios;
- ambiguous submissions and reconciliation backlog;
- invoice/resource completion errors;
- Stripe webhook verification failures;
- automation failures/ambiguity;
- notification delivery backlog;
- kill-switch changes.

## 16. Incident handling

For suspected financial or credential compromise:

1. contain using kill switch/provider freeze/revocation/network controls;
2. rotate affected secrets/capabilities;
3. stop funding/using affected identities;
4. preserve database, audit, provider, and chain evidence;
5. reconcile uncertain operations;
6. scope impacted organizations/agents/resources;
7. deploy reviewed fix;
8. restore with readiness checks and low-value canary.

## 17. Rollback

Rollback application/service code only when database/protocol compatibility permits it. Never roll back by weakening a safety constraint, reintroducing a shared agent payment identity, discarding pending submission evidence, or accepting stale provider status.

If a provider-specific capability is unhealthy, disable that profile while preserving unrelated rails and reconciliation where possible.
