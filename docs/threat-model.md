# AgentPay Production Threat Model

This document defines the security properties AgentPay must preserve in production. It is a release contract, not a claim that external providers, keys, accounts, or infrastructure have already been approved or provisioned.

## System and trust boundaries

AgentPay consists of five security domains:

1. **Operator dashboard and API** — authenticates human operators, resolves the active organization, enforces RBAC, policy, approvals, idempotency, emergency-stop state, and persistence.
2. **Managed facilitator services** — hold blockchain signing capabilities isolated from the dashboard. Hedera and Arc signing, settlement, and contract-execution capabilities use separate API credentials. Production private signing material must live in KMS/HSM/external signing custody when the deployment platform supports it.
3. **Resource server / x402 providers** — advertise exact payment requirements, verify signatures, request settlement, and return paid-resource fulfillment evidence.
4. **External providers and chains** — Hedera Mirror Node, Arc RPC, Stripe, LI.FI/EVM chains, Supabase, Resend, Slack/webhooks, and explorers. Their responses are untrusted until schema-, identity-, amount-, network-, and finality-checked.
5. **Self-custody wallets** — independently controlled by the user. Exporting a raw transaction leaves the AgentPay control boundary. AgentPay can block new exports but cannot revoke a payload already handed to an external wallet.

## Protected assets

The highest-value assets are:

- blockchain private keys, signing capability API keys, provider restricted keys, webhook credentials, notification signing secrets, and encryption master keys;
- organization membership and role assignments;
- policy versions, approvals, spend reservations, balance snapshots, payment intents, attempts, settlement evidence, and immutable audit history;
- virtual-card and fiat-provider state;
- cross-chain transaction requests and exact source/destination verification evidence;
- child/provider/customer data stored in the application database and fulfillment payloads;
- organization tenancy boundaries and active-workspace selection.

## Actors

- **Owner** — organization administration, high-risk configuration, destructive lifecycle actions.
- **Operator** — day-to-day agent and payment operations.
- **Approver** — independent human approval for policy-gated payments.
- **Viewer** — read-only operational access.
- **Provider Admin** — marketplace/provider administration.
- **Agent credential** — scoped machine credential; never equivalent to an Owner session.
- **Internal maintenance worker** — authenticated by the cron secret and permitted to reconcile/expire/retain records.
- **Facilitator** — isolated managed signer/settler; not a general dashboard credential holder.
- **External attacker** — unauthenticated or compromised low-privilege principal attempting account takeover, SSRF, cross-tenant access, replay, settlement fraud, or secret disclosure.

## Mandatory security invariants

### Authentication and tenancy

- Every browser mutation is authenticated and origin-bound.
- The active workspace is selected only from active memberships owned by the authenticated user.
- Role checks are enforced server-side; UI hiding is never the authorization boundary.
- High-risk operations require recent authentication.
- Email/OTP/session exchange endpoints are bounded by both address/account and source-IP rate limits where practical.
- Production session cookies use `__Host-`, `Secure`, `HttpOnly`, and `SameSite=Lax`.

### Secret handling

- Dashboard production configuration contains no Hedera/Arc private keys.
- Signing, settlement, and contract-execution API credentials are capability-scoped and mutually distinct across networks.
- Hedera raw 64-hex keys require an explicit `ECDSA` or `ED25519` type.
- Arc payer, relayer, and contract-execution private keys are distinct, including in the combined facilitator.
- Stored sensitive values are encrypted; one-time secrets are never returned by ordinary list/detail APIs.
- Slack/generic webhook URLs are treated as credentials and redacted from browser/API reads and organization exports.

### Payment authorization

- A payment binds the exact canonical resource endpoint, organization, agent, network, payer, payee, asset/token, atomic amount, policy version, and quote expiry.
- Spend reservations are serialized and include unresolved/consumed/recently-settled commitments so stale balance snapshots cannot reopen spent funds.
- Human-initiated payments always record exactly one immutable initiator event. The initiating user cannot cast an approving vote for that payment; missing or inconsistent initiator evidence fails closed.
- Agent-originated requests record an explicit non-human initiator.
- The organization emergency stop is rechecked immediately before managed signing/submission boundaries.

### Settlement and reconciliation

- Any ambiguous outcome after signing or possible provider/chain submission remains reconciliation-required; spend is not released as a safe pre-submission failure.
- Hedera reconciliation uses the network-correct Mirror Node and verifies exact payer, payee, token/native asset, exact BigInt atomic amount, transaction ID, and successful consensus result.
- Mirror Node integer amounts are parsed losslessly; values above JavaScript safe-integer range are never rounded.
- Arc reconciliation requires an exact submitted hash, configured finality threshold, successful receipt, configured USDC contract, exact payer/payee, and exact atomic transfer amount.
- Arc settlement evidence is request-scoped; concurrent requests cannot overwrite one another's candidate transaction hash.
- Replay/mismatch incidents and corresponding financial-state transitions are committed atomically.
- A successful settlement with unrecoverable resource fulfillment remains settled; fulfillment failure is recorded separately and an urgent incident is opened.

### Fiat and cards

- New card/fiat provisioning and fiat submission are blocked by the emergency stop.
- Fiat responses are classified conservatively: only responses that prove pre-submission rejection are terminal; idempotency, throttling, validation ambiguity, network, malformed-response, and provider failures remain reconciliation-required.
- Organization deletion is a retryable saga. Local access is suspended first; provider-backed cards are not reported fully deleted until provider cancellation succeeds.
- Provider cancellation failures leave deletion `PROCESSING` and open an urgent support case.

### Cross-chain

- Quotes are short-lived and bind source/destination networks, tokens, source/destination addresses, exact input, minimum output, and route transaction request.
- Source transaction verification checks exact signer, target, calldata, value, receipt success, and configured confirmations.
- Destination verification checks configured finality plus exact recipient/token/minimum output.
- Exporting a self-custody transaction requires recent authentication and explicit acknowledgement that the external wallet controls the payload after export.
- Emergency stop blocks new self-custody transaction exports but does not claim to revoke an already-exported payload. Evidence ingestion/reconciliation remains active after a stop.

### Marketplace and SSRF

- Resource URLs are validated against SSRF-sensitive/private address classes in production.
- New resource endpoints are stored in canonical URL form and resource registration is serialized by canonical endpoint.
- Pre-launch canonicalization must report zero legacy collisions before traffic is enabled.
- The resource server advertises only rails with complete asset, payee, facilitator, and Hedera fee-payer configuration.

### Audit and operations

- Audit events are immutable and hash chained at the database layer.
- Financial/audit evidence is never removed merely to satisfy payload-retention windows.
- Internal maintenance endpoints require a constant-time checked cron bearer credential.
- Readiness fails when required database migrations or facilitator network support are unavailable.
- Ambiguous submissions older than the operational threshold open idempotent urgent support incidents.

## Primary abuse cases and required defenses

| Threat | Required defense |
|---|---|
| Cross-tenant object access | organization-scoped queries + active membership resolution + server RBAC |
| Operator self-approves payment | immutable initiator evidence + four-eyes approval check |
| Double spend using stale balance | serialized reservation accounting + unresolved/recent settlement deductions |
| Settlement timeout causes duplicate retry | `SUBMISSION_UNKNOWN`, exact candidate evidence, reconciliation before retry |
| Concurrent Arc requests swap hashes | request-scoped `AsyncLocalStorage` settlement evidence |
| Hedera large amount rounds in JS | lossless amount parsing + `BigInt` verification |
| Malformed 2xx facilitator response treated as safe failure | classify as settlement unknown |
| SSRF through marketplace/provider URL | safe URL validation, DNS/IP restrictions, canonical endpoint identity |
| Kill switch bypass | recheck organization state at external side-effect boundaries; fail-closed UI |
| Already-exported self-custody transaction after stop | explicit trust-boundary acknowledgement; keep reconciliation active |
| Workspace deletion reports success before Stripe cancellation | `PROCESSING` deletion saga + provider retry + urgent incident |
| Webhook/Slack credential disclosure | encrypted signing secret + destination redaction in reads/exports |
| Misspelled production environment enables dev defaults | invalid explicit `APP_ENV` is fatal |

## Release evidence required

A production release is not approved until all applicable evidence exists for the immutable release SHA:

1. migrations apply cleanly to PostgreSQL 17 and there are no unfinished Prisma migrations;
2. `npm run verify` passes for the dashboard;
3. facilitator, Arc facilitator, combined facilitator, and resource-server tests/builds pass;
4. container builds pass;
5. `npm run db:resources:check` reports zero canonicalization changes/collisions after any required `db:resources:canonicalize` maintenance window;
6. CI, CodeQL, dependency review, and project quality gates are green or each finding is explicitly dispositioned by a qualified reviewer;
7. secrets are provisioned from an approved secret manager and signing keys are in KMS/HSM/external-signer custody where supported;
8. DNS/TLS, monitoring, paging/on-call ownership, database PITR, and a recorded restore drill are in place;
9. Stripe/financial-provider approvals exist before live card/fiat flags are enabled;
10. funded low-value Hedera/Arc/x402 and applicable cross-chain/fiat canaries are independently verified against provider/explorer evidence;
11. an independent security assessment has reviewed the trust boundaries and invariants in this document.

## Incident response priorities

If compromise or ambiguity is suspected:

1. activate the organization emergency stop and provider-side freeze/revocation controls;
2. preserve audit, provider, and chain evidence;
3. rotate affected capability/session/provider credentials;
4. reconcile ambiguous submissions before any retry;
5. keep spend consumed when successful-chain evidence mismatches the authorized quote;
6. open an urgent support incident and record remediation against the immutable release SHA.
