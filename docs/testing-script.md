# AgentPay Verification Guide

**Updated:** 2026-09-10

The objective is to prove both deterministic source behavior and the external evidence paths required by each enabled financial profile.

## 1. Repository verification

Install with the pinned supported Node/npm versions and run the repository verification commands from the exact candidate revision.

Typical dashboard checks:

```bash
npm run lint --workspace=agentpay-control
npm run typecheck --workspace=agentpay-control
npm test --workspace=agentpay-control
npm run build --workspace=agentpay-control
```

Also run Hedera, Arc, combined facilitator, resource-server, and Cardano signer checks through the repository CI scripts/workspace commands.

## 2. Test database

DB-backed tests require a reachable disposable/test PostgreSQL instance with the expected migrations. Never point destructive/integration verification at an unreviewed production database.

Verify:

- migrations apply cleanly;
- concurrent payment-identity claims enforce uniqueness;
- transactional completion/outbox state is consistent;
- idempotency conflict behavior works;
- cleanup is bounded to test-owned records.

Vercel preview builds should not fail because a DB-backed unit/integration test inherited an unreachable external production database; keep that class of test in an environment that provisions its database deliberately.

## 3. Authentication/RBAC/tenancy

Test invalid/expired/revoked sessions and agent credentials, missing scopes, role boundaries, guessed cross-tenant IDs, workspace membership changes, and privileged organization actions.

## 4. Policy and approvals

Verify:

- within-policy authorization;
- deny behavior;
- approval-required behavior;
- merchant/resource/category/network/asset constraints;
- schedule/velocity/cooldown;
- immutable published versions;
- threshold/separation rules;
- approval cannot be reused for a different operation;
- kill switch blocks new risky side effects.

## 5. Reservations/idempotency

Test identical retry, conflicting retry, concurrent spend near limits, failed-before-submission release behavior, and ambiguous post-submission retention. Verify no duplicate side effect occurs merely because the original response is lost.

## 6. Direct x402

With a controlled resource server:

```text
GET -> 402 requirements -> canonical validation -> policy/trust
 -> reserve/approve -> sign/prepare -> verify/settle
 -> paid response -> persisted fulfillment
```

Test SSRF/private-network rejection, redirects, malformed requirements, amount/payee/network mismatch, oversized responses, and resource-binding mismatch.

## 7. Hedera

Exercise configured Testnet/Mainnet profiles with low-value accounts. Test exact payer/payee/amount/network validation, credential/custody failures, settlement evidence, and managed Testnet identity isolation.

## 8. Arc

Exercise Arc Testnet with controlled accounts/contracts. Test network/contract/amount/payee mismatches and settlement evidence. Do not interpret source support as an unconfigured Mainnet profile.

## 9. Cardano

### Preprod managed

Provision multiple agents and verify distinct `addr_test1...` identities. Test transaction construction, independent facilitator CBOR verification, supported asset profile, Blockfrost submission, and chain evidence.

### Mainnet self custody

With low-value verified wallet, prepare unsigned transaction, sign externally, return signed CBOR, and verify facilitator rejects any mutated transaction.

### Mainnet external custody

Test distinct/stable agent identity, local address derivation, body-hash-only signing, signerRef/publicKey consistency, local Ed25519 signature verification, and fail-closed provider outage/invalid signature.

### Transaction negatives

Reject unsupported scripts/minting/certificates/withdrawals/collateral/bootstrap witnesses/auxiliary data, unrelated assets/outputs, excessive fee/inputs, invalid TTL, conservation mismatch, and replay.

### Ambiguous submission

Force an uncertain Blockfrost response after possible submission and verify pending state, retained claim/reservation, independent reconciliation, and no blind resubmit.

## 10. Moove Receive

Unit/integration tests should cover:

- API-key header and provider schema validation;
- safe read retries;
- no blind create retry;
- durable idempotency/conflict;
- ambiguous create marker recovery;
- account-list pagination limits;
- tenant/agent/resource/invoice ownership;
- exact decimal/atomic conversion;
- invoice settlement token/network/decimals/amount mismatch;
- serialized completion preventing duplicate events.

Controlled provider smoke:

1. create low-value single-use link;
2. pay through hosted page;
3. refresh/reconcile;
4. verify `COMPLETED`, destination/token/received amount/transaction evidence;
5. verify one completion event;
6. repeat with invoice binding after generic flow succeeds.

## 11. Stripe cards and fiat

### Sandbox

Verify cardholder/card/account/transfer orchestration without claiming real provider activity. Confirm sandbox display-key request is unavailable.

### Stripe-controlled environment

When eligible/configured, test cardholder creation, virtual-card issue/status, spending controls, ephemeral display-key flow, valid/invalid webhook signatures, financial account reads, inbound/outbound movement, and status reconciliation. Confirm AgentPay logs/database contain no raw PAN/CVC.

## 12. Cross-chain

Test supported network discovery, quote persistence, expiry/mismatch, prepare state, submit idempotency, source/destination binding, and uncertain-provider response recovery. Real-value test only on explicitly enabled routes.

## 13. Invoices/resources/marketplace

Test provider/resource ownership, canonical endpoint, health state, price listing, marketplace discovery/reviews, invoice item/sequence/lifecycle events, send/collect/pay/void rules, payment association, and fulfillment only after validated settlement.

## 14. Masumi

Test registry identity/capability/payment facts and freshness. Separately test escrow funds-lock/result-hash/completion/refund/dispute/reconciliation behavior.

## 15. Pyth

Test valid observation plus stale, future, non-positive, and wide-confidence inputs. Required observation failure must never relax base policy.

## 16. Veridian/KERIA

Test trusted credential plus untrusted issuer/schema, wrong subject/binding, stale/expired/revoked evidence, and verifier failure.

## 17. Automation

Test manual/webhook triggers, disabled rules, durable execution state, financial policy/approval participation, irreversible boundary checkpoint, decision route, kill switch, and duplicate-trigger/idempotency behavior.

## 18. Financial intelligence

Test aggregation/forecast/anomaly/recommendation computation from controlled observations. Confirm intelligence output cannot directly bypass policy or mutate payment authority.

## 19. Audit/notifications/data lifecycle

Test audit integrity/export, outbox retry, endpoint authorization, support case tenancy, usage/entitlements, organization export, retention and deletion authorization. Verify sensitive values are redacted/excluded.

## 20. Security pipeline

Run/inspect npm audit policy, OSV, Semgrep, Gitleaks, CodeQL, container builds, and dependency lock checks. A newly discovered high/critical issue must be resolved or handled by a narrowly reviewed exception with explicit evidence.

## 21. Final production canary

For each enabled real financial profile:

- [ ] exact release SHA recorded
- [ ] CI/security green
- [ ] migration/readiness green
- [ ] scoped provider/network credentials verified
- [ ] low-value positive path succeeds
- [ ] key negative/fail-closed path succeeds
- [ ] external settlement/provider evidence independently checked
- [ ] no sensitive data exposed
- [ ] reconciliation handles an ambiguous case safely
