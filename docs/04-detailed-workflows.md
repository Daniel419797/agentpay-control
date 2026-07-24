# AgentPay Control

## Detailed Workflows

**Version:** 1.0  
**Date:** 2026-07-21  
**Scope:** MVP execution procedures and production operational extensions  
**Delivery target:** Friday, 2026-07-31, before 11:59 PM ET; single-builder execution  

---

## 1. Workflow notation

Actors and components:

- **User:** organization owner/operator/approver.
- **Agent:** external software agent using an AgentPay API key.
- **UI:** AgentPay dashboard.
- **API:** authenticated control-plane API.
- **DB:** PostgreSQL system of record.
- **Policy:** deterministic policy engine.
- **Signer:** isolated agent-account signer.
- **Resource:** x402-protected resource server.
- **Facilitator:** Hedera x402 verifier, fee payer, submitter, and confirmer.
- **Hedera:** Hedera consensus network.
- **Mirror:** mirror-node read API/HashScan evidence source.
- **Worker:** reconciliation, outbox, and asynchronous job runner.

State changes shown in uppercase refer to the SDD state machines. Every mutation carries organization context, actor context, correlation ID, and an idempotency key where specified.

## 2. Workflow invariants

These invariants apply to every payment workflow:

1. The LLM/agent process never receives a private key.
2. No signing occurs without a current immutable quote and authorization for its exact fingerprint.
3. Policy evaluation includes active reservations and is repeated under lock before reservation.
4. Approval cannot change the quote and cannot bypass platform safety, kill switch, inactive agent, unsupported asset/network, stale quote, or insufficient balance.
5. A submitted or possibly submitted transaction is never blindly retried.
6. On-chain confirmation, not HTTP optimism, is the authority for `SETTLED`.
7. All monetary calculations use atomic integers.
8. Cross-tenant identifiers fail as not found/forbidden without leaking existence.
9. All payment state transitions and administrative actions emit audit events.
10. Mainnet is disabled in the MVP at configuration and application layers.

## 3. WF-001: First-time organization onboarding

**Phase:** MVP  
**Primary actor:** User  
**Preconditions:** User is authenticated and has no organization membership.  
**Postconditions:** Active organization exists in testnet-only mode.

### Happy path

1. User signs in with Google OAuth, a six-digit email OTP, or a secondary email magic link.
2. For wallet sign-in, API verifies challenge expiry, origin/domain, network/account, nonce single use, and signature before creating a session.
3. UI requests current session.
4. API returns authenticated user with no organization.
5. UI redirects to `/onboarding`.
6. User submits organization name and accepts the public-chain/testnet disclosure.
7. API validates name and checks the idempotency key.
8. In one DB transaction, API:
   - Creates the organization with `environmentMode=TESTNET_ONLY`.
   - Creates membership with Owner, Operator, and Approver roles for the first user.
   - Writes `ORGANIZATION_CREATED` audit event.
   - Writes onboarding outbox event.
9. API returns organization DTO.
10. After authentication, UI optionally offers to link a Hedera payment identity through HashPack/WalletConnect; skipping wallet setup still permits basic dashboard access.

### Alternate/error paths

- Duplicate submission with same idempotency key returns the original organization.
- Same key with different body returns `IDEMPOTENCY_CONFLICT`.
- Transaction failure creates neither organization nor membership.
- Testnet disclosure not accepted returns validation error.

### Verification

- One organization and one owner membership exist.
- Organization is testnet-only and kill switch is off.
- Audit event exists and contains no secret/session token.

## 4. WF-002: Create and provision an agent

**Phase:** MVP  
**Actor:** Owner or Operator  
**Preconditions:** Active organization; Hedera testnet configuration ready.  
**Postconditions:** Agent and managed or self-custody testnet payment account exist; agent remains paused/not active until funded and policy-configured.

### Happy path

1. User opens Create Agent and submits name, description, default asset, and custody mode (`MANAGED` or `SELF_CUSTODY`).
2. API authenticates, resolves organization, authorizes `agent:create`, validates input, and checks idempotency.
3. DB transaction creates Agent in `PROVISIONING` and a provisioning operation.
4. If `MANAGED`, Signer generates an ECDSA keypair within the signing boundary.
5. Signer encrypts private key material using envelope encryption and returns only:
   - Public key.
   - Encrypted key bundle/key reference.
   - Key algorithm/version.
6. Hedera adapter creates the testnet account or invokes the configured provisioning mechanism.
7. If `SELF_CUSTODY`, UI connects the wallet, API creates a purpose-bound nonce challenge, the wallet signs it, and API verifies account control. No private key is requested or stored.
8. For self-custody, the user may register a bounded delegated signer; otherwise the account's signing mode is `WALLET_CONFIRMATION` and unattended autonomy is disabled.
9. DB transaction creates PaymentAccount with custody/signing mode, marks it `ACTIVE`, associates it with Agent, and changes Agent to `PAUSED`.
10. Audit events record agent and account creation using public identifiers only.
11. API returns agent/account DTO and HashScan account link.
12. UI displays funding instructions and next steps: fund, publish policy, create API key, activate.

### Failure paths

- Key generation fails: operation becomes failed; no key material is logged.
- Hedera account creation fails before an account ID exists: Agent becomes `ERROR`; retry reuses operation identity and does not create duplicate agent.
- Response is lost after account creation: provisioning reconciliation searches by recorded operation/public key/transaction evidence before retry.
- Database write fails after external account creation: operation is marked for recovery; never discard the only account/key correlation.
- Wallet proof is invalid/expired/wrong network: no PaymentAccount is created; challenge cannot be replayed.
- Self-custody user cancels a required payment signature: the intent remains unsubmitted and safely retryable within quote/authorization expiry.

### Verification

- Private key is absent from API responses, UI state, logs, analytics, and audit metadata.
- Agent cannot initiate a payment while paused.
- Retrying the same create request does not provision another account.

## 5. WF-003: Fund and synchronize agent account

**Phase:** MVP  
**Actor:** User and system  
**Preconditions:** Agent payment account is active.  
**Postconditions:** Current balance read model is visible.

### Flow

1. UI displays account ID, network, funding instructions, and HashScan account link.
2. User sends testnet HBAR or the supported token from an external testnet source.
3. User selects Refresh, or scheduled synchronization runs.
4. API rate-limits refresh and invokes Hedera reader.
5. Reader queries authoritative SDK/mirror-node sources and normalizes balances.
6. API stores balance snapshots with source and `asOf` timestamp.
7. API returns balances; UI displays amount and freshness.
8. If balance crosses low-balance threshold, an audit/outbox event is emitted.

### Edge cases

- Mirror node lags: retain previous snapshot, show updating/stale state, retry later.
- Token not associated/unsupported: show actionable unsupported status; do not report zero as confirmed spendable balance without context.
- External debit occurs between policy check and settlement: facilitator settlement may fail; transaction moves through the defined failure/reconciliation path.

## 6. WF-004: Create and publish a spend policy

**Phase:** MVP  
**Actor:** Owner or Operator  
**Preconditions:** Agent exists.  
**Postconditions:** Immutable published policy version is effective.

### Flow

1. User opens Policy and enters asset, per-transaction limit, daily limit, over-limit action, and merchant rules.
2. UI performs convenience validation and sends atomic string amounts.
3. API performs authoritative schema and semantic validation.
4. API normalizes merchant hosts and rejects unsafe/malformed values.
5. API saves a draft with optimistic version control.
6. UI may send sample facts to policy preview; Policy returns decision and reason codes without creating a reservation.
7. User chooses Publish and confirms.
8. In one DB transaction, API:
   - Rechecks permissions and expected draft version.
   - Assigns the next policy version.
   - Marks it `PUBLISHED` and previous version `SUPERSEDED`.
   - Updates the Agent effective-policy pointer.
   - Writes audit/outbox events with safe before/after summary.
9. UI displays active version and publication time.

### Rules

- Editing a published policy always creates a new draft/version.
- Limits are positive atomic integers and bound to one asset in MVP.
- Denied hosts override allowed hosts.
- Policy preview never reserves budget and is labeled illustrative.

### Concurrency

If another user publishes first, expected-version mismatch returns `409`; UI reloads the current policy and preserves the user's draft for comparison.

## 7. WF-005: Issue an agent API key

**Phase:** MVP  
**Actor:** Owner or Operator  
**Preconditions:** Agent is not archived.  
**Postconditions:** Scoped credential exists; plaintext is shown once.

### Flow

1. User submits label, scopes, and optional expiry.
2. API authorizes and generates a cryptographically random secret.
3. API derives a non-secret prefix and secure verification hash.
4. DB transaction stores credential metadata/hash and audit event.
5. API returns credential DTO plus plaintext secret once.
6. UI displays a secret-once panel and copy action.
7. After navigation/close, UI cannot retrieve the secret again.

### Revocation

1. User confirms revoke.
2. API marks credential revoked and emits audit/security event.
3. Authentication cache is invalidated or bounded so revocation becomes effective immediately/within documented seconds.
4. Future agent calls return unauthorized.

## 8. WF-006: Activate or pause an agent

**Phase:** MVP  
**Actor:** Owner or Operator  

### Activation preconditions

- Payment account `ACTIVE`.
- Effective policy published.
- At least one active payment credential recommended/required by product rule.
- Organization kill switch off.
- Supported network/asset configuration healthy.

### Activation flow

1. User chooses Activate.
2. API checks conditions and current status.
3. DB transaction changes `PAUSED -> ACTIVE`, emits audit/outbox.
4. UI updates persistent status.

### Pause flow

1. User chooses Pause and confirms reason.
2. API changes `ACTIVE -> PAUSED` and emits audit immediately.
3. New payment intake fails.
4. Pending approval requests remain visible but cannot execute while paused.
5. Already submitted transactions continue to reconciliation; pausing cannot reverse an on-chain submission.

## 9. WF-007: Successful autonomous x402 purchase

**Phase:** MVP canonical flow  
**Actors:** Agent, API, Policy, Signer, Resource, Facilitator, Hedera  
**Preconditions:** Active agent, valid API key, funded account, active policy, kill switch off, supported resource/payment option.  
**Postconditions:** Resource returned once, transaction settled, spend recorded, reservation consumed, HashScan evidence available.

### Sequence

```text
Agent -> API: POST paid-requests + Idempotency-Key
API -> Resource: initial resource request
Resource -> API: 402 + PAYMENT-REQUIRED
API -> Policy/DB: normalize quote, evaluate and reserve
Policy/DB -> API: ALLOW + authorization
API -> Signer: canonical exact-transfer command
Signer -> API: opaque signed payment payload
API -> Resource: retry + PAYMENT-SIGNATURE
Resource -> Facilitator: verify/settle
Facilitator -> Hedera: co-sign fee + submit
Hedera -> Facilitator: consensus result
Facilitator -> Resource: settlement response
Resource -> API: 200 resource + PAYMENT-RESPONSE
API -> DB: SETTLED + evidence + audit/outbox
API -> Agent: resource + payment intent summary
```

### Detailed steps

1. Agent calls `POST /api/v1/agents/:agentId/paid-requests` with scoped API key, `Idempotency-Key`, resource URL, purpose, and maximum amount constraint.
2. API authenticates credential, checks credential agent matches path agent, rate-limits, validates URL/method/headers, and canonicalizes the request.
3. API creates/reuses `PaymentIntent(CREATED)` by organization, agent, and idempotency key.
4. API performs SSRF-safe request to Resource with timeout and redirects disabled/revalidated.
5. If Resource returns non-402 success, API records free-resource outcome and returns it subject to response limits.
6. On 402, x402 adapter decodes `PAYMENT-REQUIRED`, validates protocol version/size/freshness, and selects only a supported Hedera exact payment option.
7. Adapter produces immutable `PaymentQuote` and fingerprint over canonical network, scheme, payer, payee, asset, amount, resource, and expiry.
8. DB stores quote and changes intent to `QUOTED`.
9. Application starts serialized reservation transaction and locks the agent/asset budget scope.
10. It rechecks credential status, organization kill switch, agent status, effective policy, current balance, settled/submitted spend, and active reservations.
11. Policy evaluates facts. If `ALLOW`, application writes immutable decision, active reservation, single-use authorization, and `AUTHORIZED` state atomically.
12. API invokes Signer using server-derived command fields only.
13. Signer revalidates command, authorization, fingerprint, status, expiry, destination, asset, amount, and hard cap.
14. For managed custody, Signer loads/decrypts key internally, signs the exact transfer/payment payload, marks command used or returns an idempotent prior signature reference, and zeroizes temporary material where possible. For self-custody, API presents the same canonical authorized command to the verified wallet/delegated signer and validates the returned signature without accessing the private key.
15. API stores signature fingerprint (not raw secret/signature for UI), creates `PaymentAttempt`, and moves to `SIGNING`/signed state.
16. API retries Resource with `PAYMENT-SIGNATURE`.
17. Resource validates request/challenge binding and asks Facilitator to verify.
18. Facilitator ensures the signed transfer exactly matches the payment requirement and supported Hedera network.
19. Resource asks Facilitator to settle before returning the paid data.
20. Facilitator adds fee-payer signature, submits to Hedera, waits for consensus, and returns settlement evidence.
21. Resource returns `200` with paid resource and `PAYMENT-RESPONSE`.
22. API validates response/evidence, then in one DB transaction:
    - Stores settlement and Hedera transaction ID.
    - Changes attempt to `CONFIRMED` and intent to `SETTLED`.
    - Changes reservation to `SETTLED`.
    - Stores only permitted resource metadata/body according to retention policy.
    - Writes transaction/audit/outbox events.
23. API returns outcome `PAYMENT_SETTLED`, resource content, intent ID, amount, and safe settlement summary.
24. Dashboard/read model displays the record and HashScan link.

### Required protections

- Agent maximum constraint must be equal to or stricter than policy; it cannot loosen policy.
- If quote exceeds agent-provided maximum, deny without approval unless a new agent request is made.
- Signing command uses DB quote, never a client-resubmitted quote.
- The paid response has size/content-type controls to avoid memory/log abuse.
- Idempotent replay returns original result and never settles again.

## 10. WF-008: Policy denial

**Phase:** MVP  
**Trigger:** Merchant denied/not allowed, explicit deny action, unsupported platform condition, or other non-approvable rule.

### Flow

1. WF-007 proceeds through quote normalization.
2. Policy returns `DENY` with safe reason codes.
3. DB transaction stores decision, marks intent `DENIED`, and emits audit event.
4. No reservation, signer call, or facilitator call occurs.
5. API returns `PAYMENT_DENIED` and safe explanation.
6. Dashboard transaction detail shows the policy rule category and confirms no funds moved.

### Verification

- Mock signer/facilitator invocation count remains zero.
- Agent balance and active reservations are unchanged.

## 11. WF-009: Approval-required purchase

**Phase:** MVP  
**Trigger:** Quote exceeds configured limit and policy action is `REQUIRE_APPROVAL`.  
**Postconditions:** Request waits without signature until approved; approved request executes once.

### Request phase

1. WF-007 proceeds through current-facts policy evaluation.
2. Policy returns `REQUIRE_APPROVAL`.
3. DB transaction creates:
   - Immutable policy decision.
   - `ApprovalRequest(PENDING)` bound to quote fingerprint.
   - A provisional reservation if product chooses to hold budget; MVP should reserve the requested amount to prevent approval queue oversubscription.
   - Intent state `APPROVAL_PENDING`.
   - Audit/outbox event.
4. API returns `202`, outcome `APPROVAL_REQUIRED`, intent ID, approval ID, and expiry.
5. Agent stores/polls the intent; it does not create a new payment request.
6. Approver notification appears in dashboard; production sends configured channels.

### Approve phase

1. Approver opens detail and sees exact amount, asset, destination, resource, agent, spend context, trigger, purpose, and expiry.
2. Approver chooses Approve, confirms, and optionally adds note.
3. API authenticates Approver, checks idempotency and `PENDING` expected state.
4. Under DB lock, API rechecks:
   - Approval not expired/decided.
   - Quote unchanged and still fresh.
   - Agent active, kill switch off, account/asset supported.
   - Balance sufficient.
   - Platform non-overridable rules.
5. API creates `ApprovalDecision(APPROVED)`, a single-use authorization, updates intent `AUTHORIZED`, and emits audit/outbox.
6. Execution worker or synchronous service resumes WF-007 at signer step using stored quote.
7. On successful submission, approval becomes `CONSUMED` and cannot authorize another attempt.
8. Agent polling returns pending until settlement, then returns final outcome/resource retrieval mechanism.

### Reject phase

1. Approver chooses Reject and confirms.
2. Under lock, API stores decision, marks approval `REJECTED`, intent `REJECTED`, releases reservation, and writes audit/outbox.
3. Agent polling returns final rejected outcome; no signing occurs.

### Expiration

1. Worker finds `PENDING` approvals past expiry.
2. Under lock, marks approval/intent `EXPIRED`, releases pre-signing reservation, and emits events.
3. Late decision returns conflict and cannot revive the request.

### Race cases

- Two approvers decide simultaneously: row lock/conditional update allows one; other receives current state.
- Agent paused after approval but before signing: signer/application recheck stops execution; authorization remains unusable until product-defined retry or is canceled. MVP should expire/cancel it and require a new request.
- Quote expires during review: approval action fails as expired and new request is required.

## 12. WF-010: Insufficient balance

### Flow

1. Policy fact gathering determines spendable balance is below amount plus required operational reserve where applicable.
2. Decision is non-approvable `DENY` with `INSUFFICIENT_BALANCE`.
3. Intent becomes `DENIED` or specialized failed-before-signing state.
4. UI/agent receives account ID and safe funding guidance, never key material.
5. After funding, the agent creates a new request because price/challenge freshness may have changed.

If balance becomes insufficient only during settlement, follow WF-012 rather than claiming policy denial.

## 13. WF-011: Facilitator failure before possible submission

**Examples:** connection refused before request, `/supported` mismatch, verify returns invalid, deterministic validation failure.

### Flow

1. Payment attempt records failure stage and safe error code.
2. If evidence proves no network submission occurred:
   - Mark attempt `FAILED`.
   - Mark intent `FAILED_BEFORE_SUBMISSION` when no safe automatic retry remains.
   - Release reservation.
3. For transient pre-submission failure, application may retry the same signed payload/attempt with bounded backoff if protocol rules allow and expiry remains valid.
4. Never generate a different transfer or quote during retry.
5. Return a retryable external-dependency error only when no submission could have occurred.

## 14. WF-012: Timeout or failure after possible submission

**Critical rule:** Absence of an HTTP response does not prove absence of an on-chain transaction.

### Flow

1. Facilitator call times out or connection drops after submission may have begun.
2. Application marks attempt `UNKNOWN`, intent `SUBMISSION_UNKNOWN`, and reservation `CONSUMED`/held.
3. API returns `202` or `409 PAYMENT_SUBMISSION_UNKNOWN` with polling guidance; it never tells the agent to pay again.
4. Worker begins reconciliation using known transaction ID if available, facilitator request ID, payment fingerprint, payer/payee/amount/time window, and mirror-node evidence.
5. If confirmed, worker records settlement and changes intent `SETTLED`.
6. If authoritative failure is found, worker changes intent `SETTLEMENT_FAILED` and releases reservation according to ledger rules.
7. If unresolved past operational threshold, create an incident/alert and keep funds reserved until manual resolution.

### Manual reconciliation

Authorized user selects Reconcile. API queues the same idempotent reconciliation job; it does not submit a new transfer.

## 15. WF-013: Resource fulfillment failure after confirmed settlement

### Flow

1. Hedera payment confirms.
2. Resource computation/storage retrieval fails before paid content is returned.
3. Resource/API must not label payment failed; payment is already settled.
4. Intent records `SETTLED` plus `RESOURCE_FULFILLMENT_FAILED` sub-outcome/event.
5. MVP displays incident guidance and supports manual resource redelivery where safe.
6. Production applies merchant-specific redelivery, credit, or refund policy with a separately auditable transaction.

The MVP deterministic resource server should precompute/check data availability before settlement to avoid this path.

## 16. WF-014: Reconcile balances and transactions

**Phase:** MVP basic; Production continuous  

### Scheduled flow

1. Worker claims due agents/unknown transactions.
2. For each record, it queries Hedera/mirror-node adapter with bounded concurrency.
3. It compares network evidence to internal settlement ledger.
4. Under DB transaction, it updates balance snapshots and resolves permitted state transitions.
5. Discrepancies produce a reconciliation record and alert; they are never silently overwritten.
6. Worker emits `RECONCILIATION_COMPLETED` or `RECONCILIATION_DISCREPANCY` audit/metric events.

### Discrepancy examples

- Internal `SUBMITTED`, chain confirmed: mark `SETTLED`.
- Internal `SETTLED`, transaction absent temporarily: retain settled, flag delayed evidence; do not reverse automatically.
- Amount/payee differs from stored quote: critical security incident.
- External account transfer not initiated by AgentPay: reflect balance, record external activity if detectable, do not create a fictitious AgentPay purchase.

## 17. WF-015: Global kill switch

**Phase:** MVP  
**Actor:** Owner  

### Activate

1. Owner opens Organization Settings and chooses Enable kill switch.
2. UI explains that new signing stops but submitted transactions cannot be reversed.
3. Owner enters reason and confirms.
4. API reauthenticates/authorizes, updates organization under transaction, and emits high-severity audit/outbox/security metric.
5. Caches are invalidated.
6. New payment intake denies.
7. Signer/application performs a final kill-switch check and rejects commands not already submitted.
8. Pending approvals remain visible but cannot execute.

### Deactivate

1. Owner confirms remediation reason.
2. API records deactivation and audit event.
3. Existing expired quotes/approvals remain expired; they do not resume automatically.

## 18. WF-016: Credential compromise response

**Phase:** MVP operational procedure; Production automated support  

1. Operator identifies credential by prefix/last-used activity.
2. Operator revokes credential immediately.
3. System invalidates caches and emits security audit/notification.
4. Operator pauses affected agent if malicious requests may still be processing.
5. Operator reviews transactions, denials, unknown submissions, and audit logs by time/correlation.
6. Unknown submissions are reconciled; submitted transactions cannot be canceled by credential revocation.
7. Operator creates a new least-privilege credential and updates the trusted agent runtime.
8. Production security owner documents incident, scope, root cause, and follow-up controls.

## 19. WF-017: Agent signing-key rotation

**Phase:** Production; design-required before mainnet  

1. Owner initiates rotation with step-up authentication and maker-checker approval.
2. System pauses new payments and waits for in-flight signing to finish or reach known state.
3. Signer/KMS creates a new non-exportable key and public identity.
4. Depending on Hedera account key-update strategy, authorized transaction updates the account key or a new account is provisioned and funded.
5. System verifies network state and switches active key reference atomically.
6. Old key is disabled after rollback window and evidence review.
7. Historical transaction references remain unchanged.
8. Audit records include key versions/public identifiers but no private material.
9. Failed rotation triggers documented rollback or incident response.

## 20. WF-018: Organization/user offboarding

### User removal (Production)

1. Owner removes/suspends membership.
2. Sessions and organization-scoped tokens are revoked.
3. Pending approvals assigned solely to that user remain available to other approvers or escalate.
4. Historical audit actor identity is retained subject to privacy/legal policy.

### Organization closure (Production)

1. Owner passes step-up and resolves active/unknown transactions.
2. Agents are paused; credentials revoked; webhooks disabled.
3. Asset disposition is completed using an authorized non-agent withdrawal process.
4. Export is offered; retention/deletion schedule starts.
5. Public Hedera transactions remain public and cannot be deleted.

## 21. WF-019: Webhook delivery

**Phase:** Production  

1. Business transaction writes outbox event atomically.
2. Worker claims event and constructs versioned webhook body.
3. Worker signs `{timestamp}.{rawBody}` with organization webhook secret.
4. HTTPS request includes event ID, timestamp, signature, and delivery attempt.
5. 2xx marks delivered. Retryable failures use exponential backoff and jitter.
6. Permanent failure/dead-letter is visible and alertable.
7. Receiver deduplicates by event ID and rejects timestamps outside replay window.
8. Secret rotation supports overlapping verification keys for a bounded period.

## 22. WF-020: MVP local setup and live testnet verification

**Phase:** MVP engineering  

### Setup

1. Install pinned Node/package-manager versions.
2. Copy `.env.example` to local environment and supply testnet-only secrets.
3. Start PostgreSQL and apply migrations.
4. Start facilitator with a funded ECDSA Hedera testnet fee-payer account.
5. Start the priced-resource server with market-data, protected-file, AI-inference, and web-research adapters.
6. Start web/control plane and worker/reconciliation process.
7. Verify `/health`, `/ready`, facilitator `/supported`, and resource catalog.

### Canonical verification

1. Create organization and agent.
2. Fund agent testnet account.
3. Publish limits and create agent key.
4. Run a below-limit canonical purchase and record intent/transaction/HashScan.
5. Confirm the catalog exposes all four resource categories and their HBAR/USDC options as supported by the facilitator.
6. Run over-limit deny and confirm no chain transfer.
7. Configure approval action, request over limit, approve, and confirm exactly one chain transfer.
8. Create/connect one agent in each custody mode and verify correct signer behavior.
9. Exercise the same safe request through REST/SDK plus smoke calls from MCP and LangChain adapters.
10. Pause agent and confirm request rejection.
11. Review dashboard, audit trail, and mobile layout.
12. Save non-secret transaction IDs for submission evidence.

## 23. WF-021: CI/CD deployment

**Phase:** MVP and Production  

1. Pull request runs formatting, lint, strict typecheck, unit/integration tests, migration checks, dependency/secret/license scans, and build.
2. Reviewer checks requirement IDs, security-sensitive changes, and schema/API compatibility.
3. Merge produces immutable artifact and deploys preview/staging.
4. Staging applies migrations using a controlled job.
5. Smoke tests verify authentication, health/readiness, policy deny, mock settlement, and core pages.
6. MVP testnet release runs live settlement test manually/securely.
7. Production deployment requires approval, migration/rollback plan, maintenance assessment, and change record.
8. Post-deploy verifies error rate, latency, signer/facilitator health, reconciliation lag, and one safe smoke flow.
9. On regression, roll back application when schema-compatible or roll forward with corrective migration; never destructively reverse financial history.

## 24. WF-022: Incident response for payment anomaly

**Phase:** Production requirement; MVP manual baseline  

### Triggers

- Amount/payee mismatch.
- Duplicate on-chain payment.
- Unexpected mainnet request.
- Signer authorization bypass/repeated rejection.
- Reconciliation discrepancy.
- Suspected key or facilitator compromise.

### Procedure

1. Alert creates incident with correlation/payment/account identifiers but no secrets.
2. Incident commander assesses whether to enable global kill switch and isolate signer/facilitator.
3. Preserve logs, audit events, database snapshots, and chain evidence.
4. Reconcile affected transaction/account independently.
5. Rotate/revoke credentials or keys as required.
6. Communicate status through defined internal/customer channels.
7. Restore service with conservative hard caps and heightened monitoring.
8. Complete root-cause analysis, corrective actions, and control/test updates.

## 25. WF-023: Mainnet enablement ceremony

**Phase:** Production only  
**Preconditions:** All SRD production gates satisfied.

1. Legal, security, operations, and product owners sign readiness record.
2. Verify artifact hashes, dependency versions, production configuration, supported assets/token IDs, facilitator, mirror-node, and HashScan network mappings.
3. Verify KMS/HSM keys are non-exportable and access policies are least privilege.
4. Restore a recent backup into isolated environment and pass reconciliation checks.
5. Exercise kill switch, signer isolation, key rotation, and incident paging.
6. Enable mainnet server-side for an internal allowlisted organization only.
7. Set low platform/organization/agent hard caps.
8. Execute controlled low-value transaction and independently verify on-chain fields.
9. Observe for defined soak period.
10. Expand access/caps gradually with explicit approvals and rollback criteria.

## 26. Demo workflow under five minutes

The bounty demo should show technology and on-chain proof, not every production feature.

Suggested timeline:

1. **0:00-0:25:** Problem and one-sentence solution.
2. **0:25-0:55:** Existing agent account, testnet balance, and policy limits.
3. **0:55-2:20:** Agent requests one canonical paid resource; show 402, policy allow, settlement, returned data.
4. **2:20-2:55:** Open transaction detail and HashScan evidence.
5. **2:55-3:45:** Trigger an over-limit request; show approval queue and approve.
6. **3:45-4:25:** Show approved request settles once and budget updates.
7. **4:25-4:45:** Show denied/paused control and architecture diagram.
8. **4:45-4:55:** Repository and concise conclusion.

Record a stable scripted path, pre-fund accounts, pre-warm services, hide all secrets, and keep the final video below five minutes.

The catalog can briefly show market data, files, AI inference, and web research, but only one should consume the live-demo time needed to prove the complete on-chain flow reliably.

## 27A. WF-024: Resource-provider registration and fulfillment

**Phase:** MVP reference configuration; Production provider self-service  
**Actor:** API/resource provider  

### Registration

1. Provider authenticates and creates a provider profile.
2. Provider connects a Hedera settlement account and signs a nonce-bound ownership proof.
3. Provider registers a resource category, endpoint/adapter, description, input schema, HBAR/USDC price options, and availability behavior.
4. API validates HTTPS/egress policy, asset support, atomic prices, settlement account, and category-specific limits.
5. Resource is created as `DRAFT`; a verification job probes its safe health/availability contract.
6. Provider activates it after checks; catalog exposes normalized metadata.

### Purchase/fulfillment

1. Agent discovers listing through catalog/SDK/MCP.
2. Resource server generates an authoritative x402 challenge using current active listing version and supported asset.
3. AgentPay follows WF-007.
4. After settlement, provider adapter receives `SettledPaymentContext` and fulfills the category-specific resource.
5. Access and settlement analytics update without storing restricted response content by default.

### Category behavior

- Market data: validate symbol/query; deterministic/live provider returns bounded JSON.
- File: validate file ID; issue short-lived signed download or bounded content response.
- AI inference: validate model/input/token ceiling; preflight availability before settlement.
- Web research: validate query/domain limits; return bounded structured result with source metadata.

## 27B. WF-025: Agent framework integration

**Phase:** MVP  

1. Developer creates an agent API key and stores it in the runtime secret store.
2. REST, TypeScript SDK, MCP server, or LangChain tool calls the same `/paid-requests` endpoint with a generated/stable idempotency key.
3. The adapter maps response into `settled`, `approval_required`, `denied`, `pending`, or `failed` without hiding ambiguity.
4. On approval/pending, the adapter polls the existing intent; it never changes idempotency key to force a second payment.
5. `SKILL.md` instructs the reasoning agent to respect maximum spend, avoid secret disclosure, and surface human approval requests.
6. Contract tests replay identical fixtures through every adapter and assert matching normalized outcomes.

## 27. Workflow-to-requirement traceability

| Workflow | Primary SRD areas |
|---|---|
| WF-001 | IAM, tenancy, audit |
| WF-002/003 | Agent lifecycle, wallets, balances, key security |
| WF-004 | Policy management, versioning |
| WF-005 | Agent credentials |
| WF-006/015 | Agent safety, kill switch |
| WF-007 | x402 purchase, Hedera settlement, transactions |
| WF-008/010 | Policy deny, balance safety |
| WF-009 | Approval lifecycle |
| WF-011/012/013/014 | Reliability, failure, reconciliation |
| WF-016/017/022/023 | Security operations and production readiness |
| WF-020/021 | Verification and delivery |
| WF-024 | Resource-provider onboarding and all four resource categories |
| WF-025 | REST, SDK, SKILL.md, MCP, and LangChain parity |

## 28. MVP implementation order

1. Repository, configuration validation, PostgreSQL schema, auth/tenant shell.
2. Agent/account provisioning and balance reader.
3. Policy engine with money primitives and concurrency-safe reservations.
4. Agent credentials and paid-request API.
5. x402 priced-resource server, client adapter, isolated signer, and facilitator integration; prove one canonical resource first, then add the other three adapters.
6. Transaction ledger/state machine and live Hedera testnet settlement.
7. Approval queue and resume execution.
8. Overview/agent/transaction/audit screens and responsive states.
9. Reconciliation, idempotency, health/readiness, logs/metrics.
10. SDK, `SKILL.md`, MCP and LangChain thin adapters; automated tests, security review, deployment, reproducibility runbook, and demo.

### Friday critical path

Because one builder must reach a Friday submission, implementation order is strict:

1. Live Hedera testnet `402 -> policy -> sign -> settle -> 200` with HBAR.
2. Transaction detail and valid HashScan evidence.
3. Deny and approval paths with idempotency/reservation safety.
4. USDC compatibility path, enabled only if the pinned facilitator supports it reliably.
5. Managed custody canonical demo; self-custody connection/signing proof.
6. Four-category catalog using the common provider contract.
7. Thin SDK/MCP/LangChain/skill adapters.
8. Responsive polish, README, reproducibility, and sub-five-minute recording.

If time pressure occurs, no item may be claimed complete without working evidence. Breadth may use deterministic providers, but the canonical on-chain path, HashScan proof, and security invariants cannot be mocked.
