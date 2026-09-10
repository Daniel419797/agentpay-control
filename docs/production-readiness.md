# Production Readiness

**Updated:** 2026-09-10

Production readiness is evaluated for an exact source revision and an exact enabled capability profile. The repository may contain more integrations than a deployment has credentials, eligibility, funding, or operational support to enable.

## Release decision

A release is eligible for production promotion when:

1. required CI/security checks pass on the exact commit;
2. forward database migrations have been reviewed/applied safely;
3. required services/images are built from the same release;
4. every enabled provider/network has valid scoped credentials and readiness configuration;
5. high-value trust boundaries have been exercised with deliberate low-value canaries or safe provider tests;
6. reconciliation/notification/maintenance paths are operational;
7. `/api/v1/ready` and service readiness endpoints agree with the intended profile;
8. rollback/containment procedures are understood.

## Repository gates

The exact-head pipeline should cover, as applicable:

- workspace dependency/lock validation;
- dashboard lint, typecheck, unit tests, production build;
- database-backed identity isolation/governance checks;
- Hedera/Arc/combined facilitator typecheck, tests and build;
- Cardano signer tests;
- resource-server tests/build;
- production service/container builds;
- npm production dependency audit, OSV, Semgrep, Gitleaks, CodeQL;
- browser smoke/e2e where configured;
- immutable release evidence.

A workflow that never executes its required steps is not a pass.

## Common control-plane readiness

Verify:

- production `APP_ENV`/origin/session settings;
- strong application/session/encryption secrets;
- PostgreSQL availability, migration state, backup/restore plan;
- tenant/RBAC/credential scope enforcement;
- immutable policy publishing and approval separation;
- spend reservation/idempotency behavior;
- rate limiting and SSRF controls;
- audit/outbox integrity;
- emergency kill switch;
- organization export/retention/deletion authorization;
- alerting/monitoring for payment and reconciliation failures.

## Managed identity readiness

For every managed blockchain profile:

```text
(network, canonical identity) -> one PaymentAccount -> one agent
```

Run the concurrent identity-isolation verification and provision multiple agents to prove distinct canonical identities. Infrastructure accounts must not appear as agent wallets.

## Hedera readiness

Verify the intended Testnet/Mainnet profile, facilitator health, account/custody mode, exact payment verification behavior, and low-value settlement evidence. Do not assume Testnet managed identity configuration applies to Mainnet.

## Arc readiness

Verify the Arc Testnet profile, network identity, relayer/executor configuration, contract restrictions, and low-value settlement evidence. Source code must not be used to imply a network profile that is not configured/supported.

## Cardano readiness

### Preprod managed

Verify network-specific Blockfrost credentials, signer API capability, per-agent `addr_test1...` derivation, bounded transaction construction, independent facilitator verification, and chain evidence.

### Mainnet self custody

Verify the unsigned preparation path for an exact payer and independent validation of externally signed CBOR.

### Mainnet external custody

Verify:

- custody URL/API key exist only on signer boundary;
- HTTPS and provider-side access controls;
- multiple Agent IDs resolve to distinct stable public identities/addresses;
- returned signatures verify locally;
- identity/signature drift fails closed;
- no deployment-wide managed-agent master key or shared fallback.

For all Cardano profiles test ambiguous Blockfrost submission and reconciliation.

## Moove readiness

When enabled:

- API credential has the minimum create/read scopes;
- credential is bound to the intended AgentPay organization;
- production API origin is reviewed/pinned;
- account settlement wallet/token is verified independently;
- reconciliation schedule/secret is configured;
- a low-value link reaches `COMPLETED` through provider reconciliation;
- uncertain create recovery does not duplicate the provider link;
- invoice automation has exact settlement network/symbol/decimals and amount checks.

## Cards and fiat readiness

When Stripe-backed card/fiat capability is enabled:

- account/product eligibility is confirmed with the provider;
- restricted API key and webhook secret use minimum required scope;
- webhook signature validation is exercised;
- cardholder/card lifecycle works with non-production or controlled provider accounts;
- raw card data is not logged/persisted;
- financial-account and inbound/outbound transfer statuses are reconciled rather than inferred from request acceptance;
- Sandbox mode is disabled for any feature represented as real provider activity.

## Cross-chain readiness

Verify the exact configured source/destination networks, provider, quote expiry, prepare/submit semantics, idempotency, and reconciliation. Exercise quote expiry/mismatch and uncertain submission in a safe environment.

## Masumi readiness

For registry/trust, verify counterparty identity/capability/payment facts and freshness. For escrow, exercise funds locking, result evidence, completion, refund/dispute, and reconciliation separately.

## Pyth readiness

Verify fresh valid observations and stale/future/non-positive/wide-confidence failure cases. Required price evidence must fail closed and never relax atomic policy.

## Veridian/KERIA readiness

Verify trusted verifier endpoint and configured issuer/schema/subject/binding requirements. Test stale, revoked, expired, untrusted, and mismatched evidence.

## Invoicing/resource readiness

Verify resource ownership/canonical endpoints, price configuration, invoice lifecycle, payment association, and that fulfillment/`PAID` state occurs only after valid settlement evidence.

## Automation readiness

Verify trigger authentication, durable execution state, policy/approval participation, irreversible-boundary checkpointing, emergency-stop behavior, and ambiguous-action recovery.

## Observability readiness

Monitor at minimum:

- control-plane availability/error rate;
- database connectivity/pool pressure;
- facilitator and signer readiness;
- provider/custody failures;
- denied/approval/pending/failed settlement rates;
- submission-unknown and reconciliation backlog;
- webhook signature failures;
- notification delivery backlog;
- emergency-stop events.

Dune, when enabled, is additional public-chain observability and never a payment readiness dependency.

## Go-live checklist

- [ ] exact commit/release evidence recorded
- [ ] CI/security gates green
- [ ] migrations applied and verified
- [ ] backup/recovery plan checked
- [ ] provider/network readiness green
- [ ] scoped secrets in correct service boundaries
- [ ] low-value canary succeeds for each enabled financial profile
- [ ] negative/fail-closed cases exercised
- [ ] monitoring and reconciliation active
- [ ] rollback/kill-switch procedure verified
