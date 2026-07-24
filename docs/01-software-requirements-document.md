# AgentPay Control

## Software Requirements Document (SRD)

**Document status:** Baseline for MVP implementation and production evolution  
**Version:** 1.0  
**Date:** 2026-07-21  
**Product codename:** AgentPay Control  
**Target event:** Hedera x402 Bounty  
**Target submission:** Friday, 2026-07-31, before 11:59 PM ET  
**Delivery capacity:** Single-builder execution with Codex; scope must optimize for a reproducible vertical slice  

---

## 1. Purpose

This document defines the product, functional, non-functional, security, operational, and acceptance requirements for AgentPay Control: a policy-controlled payment operating system for autonomous software agents using x402 and Hedera.

The architecture is intended to become production-ready, but delivery is phased. The first implementation is an MVP that proves one complete, reliable, auditable transaction flow on Hedera testnet. Requirements are labeled as follows:

- **MVP:** required for the first build and bounty submission.
- **Production:** required before handling mainnet assets or external customers.
- **Future:** intentionally outside the initial roadmap unless reprioritized.

## 2. Product definition

### 2.1 Problem

Autonomous agents can discover paid APIs and digital resources, but organizations lack a simple way to let them spend safely. Raw wallet access gives an agent excessive authority; manual approval for every small purchase defeats autonomy; and traditional payment products are poorly suited to machine-to-machine micropayments.

### 2.2 Solution

AgentPay Control lets an operator create an agent payment identity, assign a Hedera account, configure spending policies, and monitor every payment. An agent may autonomously complete an x402 purchase when the request is allowed by policy. Requests outside policy are denied or routed for human approval. Every settled payment is linked to verifiable Hedera transaction evidence.

### 2.3 Product promise

> Give software agents bounded purchasing power, not unrestricted wallets.

### 2.4 MVP demonstration

The canonical MVP scenario is:

1. An operator signs in and creates an agent.
2. The system provisions a Hedera testnet payment account for the agent.
3. The operator funds the agent and configures transaction and daily limits.
4. The agent requests a paid market-data resource.
5. The resource server returns HTTP 402 with x402 payment requirements.
6. AgentPay evaluates the purchase against active policy.
7. The agent signs an allowed native Hedera payment without exposing its key to the language model.
8. A facilitator verifies, co-signs as fee payer, submits, and waits for consensus.
9. The resource server returns the resource and payment receipt.
10. The dashboard shows the payment, policy decision, remaining budget, and HashScan link.

The MVP resource catalog supports four x402 use-case types: market-data queries, protected file downloads, metered AI inference, and paid web-research results. The submission demo uses one canonical live path end to end and briefly demonstrates/configures the other resource types so breadth does not compromise settlement reliability.

### 2.5 Confirmed product decisions

- Product name: **AgentPay Control**.
- Target customers: individual agent developers, companies operating agent fleets, and API/resource providers.
- Implementation: a new, clean implementation inspired by the Cards402 concept; no Cards402 source code is assumed or reused.
- Payments: HBAR and Hedera USDC, enabled only after each asset passes end-to-end compatibility tests.
- Custody: each agent may use a platform-managed payment account or a user-controlled/external account.
- Authentication: Google OAuth is primary, six-digit email OTP is the passwordless fallback, and email magic link is secondary. Hedera wallet ownership proof is linked only after platform authentication and remains optional for basic dashboard access.
- Approvals: within-policy payments execute automatically; exceptional payments follow configurable approval rules.
- Integrations: REST API, TypeScript SDK, agent `SKILL.md`, MCP server, and LangChain tools.
- Recommended stack/deployment: Next.js, TypeScript, PostgreSQL/Prisma, Tailwind/shadcn, Hedera SDK, x402 adapters, Vercel, Supabase Postgres, and a container host for facilitator/workers.
- Initial production boundary: crypto-only; fiat cards and fiat custody remain outside scope.

## 3. Goals and success criteria

### 3.1 MVP goals

- Demonstrate an end-to-end `402 -> policy -> sign -> verify -> settle -> 200` flow.
- Make real native Hedera testnet transactions using HBAR or supported Hedera USDC.
- Ensure agent private keys never enter an LLM prompt, log, browser bundle, or API response.
- Provide operator-visible spend limits, agent balance, transaction history, and HashScan evidence.
- Provide a public, reproducible, open-source repository and a sub-five-minute technical demo.

### 3.2 MVP measurable outcomes

- At least one successful paid request settles on Hedera testnet.
- At least one over-limit request is blocked before signing.
- At least one approval-required request can be approved and resumed without duplicate payment.
- A transaction appears in the dashboard within 15 seconds of settlement confirmation under normal testnet conditions.
- Every settled transaction has a valid Hedera transaction ID and working HashScan testnet URL.
- A fresh evaluator can follow the README and reproduce the happy path.

### 3.3 Production goals

- Support multiple organizations, users, roles, agents, wallets, assets, merchants, and environments.
- Provide strong key custody, policy enforcement, auditability, observability, disaster recovery, and operational controls.
- Support reliable retry, reconciliation, webhooks, approval escalation, and incident response.
- Preserve a non-custodial or narrowly delegated authority model wherever possible.

### 3.4 Non-goals

The MVP will not:

- Issue Visa or other fiat cards.
- Handle mainnet funds.
- Claim regulatory approval, banking functionality, or deposit protection.
- Provide exchange, bridging, fiat on-ramp, lending, or yield products.
- Support arbitrary smart-contract execution by agents.
- Implement a general-purpose agent runtime.
- Guarantee merchant quality or correctness of purchased data.

## 4. Stakeholders and users

### 4.1 Stakeholders

- Product owner: owns scope, risk posture, and release decisions.
- Engineering team: implements and operates the platform.
- Security owner: approves key custody and mainnet readiness.
- Organization operator: configures agents and policies.
- Approver: reviews exceptional payment requests.
- Agent developer: integrates an agent through REST/SDK/skill interfaces.
- Resource provider: publishes an x402-protected resource.
- Auditor/support operator: investigates transactions and incidents.

### 4.2 Personas

#### Individual agent developer

Creates one or more personal agents, chooses a custody model, applies a simple budget, and integrates through the SDK, MCP, LangChain, or `SKILL.md` without operating blockchain infrastructure.

#### Company agent-fleet operator

Runs multiple agents for a team, separates operator and approver responsibilities, applies organization-wide controls, and needs audit, reconciliation, and incident tooling.

#### API/resource provider

Publishes market data, files, AI inference, research, or another digital resource behind x402; configures prices and settlement accounts; and monitors paid access without invoices or user accounts.

#### Organization owner

Creates the workspace, controls billing and security settings, assigns roles, and can suspend all agents.

#### Agent operator

Creates agents, funds accounts, defines spending limits, monitors activity, and rotates API credentials.

#### Approver

Accepts or rejects requests that require human authorization. The approver must see the merchant, resource, asset, amount, reason, policy trigger, and expiration.

#### Agent developer

Needs a small, deterministic integration surface that hides blockchain details and returns machine-readable outcomes.

#### Auditor

Needs immutable business audit events correlated with on-chain evidence, without access to signing keys.

## 5. Assumptions and constraints

- The MVP uses Hedera **testnet only**.
- USDC is the preferred accounting asset where supported by the selected Hedera x402 package/facilitator; HBAR must be supported as the reference/fallback asset.
- Payment amounts are stored in atomic units as integers; floating-point arithmetic is prohibited.
- The MVP offers two account modes: `MANAGED` (platform-provisioned encrypted testnet key) and `SELF_CUSTODY` (connected external Hedera wallet or delegated external signer). Managed signing occurs in an isolated signer; self-custody signing occurs in the user's wallet/provider and private keys never enter AgentPay.
- The production custody design must be reviewed before mainnet activation and should use KMS/HSM-backed keys or external delegated wallet infrastructure.
- The x402 and Hedera packages are evolving; versions must be pinned and protocol compatibility recorded.
- The facilitator sponsors Hedera network fees and may only settle the exact transfer signed by the payer.
- The MVP targets one organization per user interface session but the database is multi-tenant from day one.

## 6. Scope by release

### 6.1 MVP

- Google OAuth, six-digit email OTP, and email magic-link authentication. Hedera wallet ownership proof is a separate post-login payment identity step; it is required only when a self-custody workflow needs it, not for basic dashboard access.
- One organization with Owner and Operator behavior; Approver may be the same user.
- Create, rename, activate, pause, and archive an agent.
- Let the operator choose a platform-managed Hedera testnet account or a connected self-custody Hedera account per agent.
- Display HBAR and configured token balances.
- Create per-transaction and daily spending limits.
- Optional merchant allowlist and denylist.
- Generate and revoke agent API keys.
- Execute x402 `exact` payment flows through a resource-provider interface covering market data, protected files, AI inference, and paid web research; at least one canonical provider must settle live in the Friday submission demo.
- Provide REST, TypeScript SDK, `SKILL.md`, MCP, and LangChain integration surfaces over the same versioned payment API.
- Block denied transactions and queue approval-required transactions.
- Approve/reject an approval request.
- List transactions and open HashScan evidence.
- Minimal overview metrics and audit log.
- Idempotency, reconciliation, structured logs, and essential health checks.

### 6.2 Production v1

- Full organization membership and RBAC.
- Passwordless email plus wallet connection and optional enterprise SSO.
- KMS/HSM or external wallet signing, key rotation, recovery, and break-glass controls.
- Multiple policies with deterministic precedence, schedules, merchant/category controls, and velocity rules.
- Multiple supported assets and verified asset registry.
- Multi-approver and threshold approval rules.
- Notifications by email, webhook, Slack, or other configured channels.
- Background reconciliation against mirror nodes.
- Immutable exportable audit trails and retention policies.
- Usage metering, plan enforcement, support tools, data export, and account deletion.
- Mainnet readiness review, compliance controls, security audit, and incident runbooks.
- Provider onboarding, pricing/resource registration, settlement-account verification, and provider analytics.

### 6.3 Future

- Fiat cards and card lifecycle management.
- Cross-chain routing.
- Merchant marketplace and resource discovery.
- Agent-to-agent invoicing.
- Predictive budget recommendations.
- Programmable smart-contract actions beyond payments.

## 7. Functional requirements

Each requirement has a stable ID for traceability.

### 7.1 Identity, tenancy, and access

- **FR-IAM-001 [MVP]:** The system shall authenticate dashboard users before exposing organization data.
- **FR-IAM-002 [MVP]:** Every domain record shall carry an `organizationId` or be globally immutable reference data.
- **FR-IAM-003 [MVP]:** The API shall reject cross-organization identifiers even when the identifier exists.
- **FR-IAM-004 [MVP]:** The system shall support Owner, Operator, Approver, and Viewer authorization semantics, even if one MVP user holds all roles.
- **FR-IAM-005 [MVP]:** Sensitive mutations shall require Owner or Operator privileges; approval decisions shall require Approver privileges.
- **FR-IAM-006 [Production]:** Owners shall invite, suspend, and remove organization members.
- **FR-IAM-007 [Production]:** The system shall support step-up authentication for key, payout, mainnet, and security changes.

### 7.2 Agent lifecycle

- **FR-AGT-001 [MVP]:** An authorized operator shall create an agent with name, description, environment, and default asset.
- **FR-AGT-002 [MVP]:** Agent states shall be `PROVISIONING`, `ACTIVE`, `PAUSED`, `ERROR`, or `ARCHIVED`.
- **FR-AGT-003 [MVP]:** Only `ACTIVE` agents may initiate payment attempts.
- **FR-AGT-004 [MVP]:** Pausing an agent shall immediately prevent new payment authorization.
- **FR-AGT-005 [MVP]:** Archiving shall revoke active agent credentials but preserve historical transactions and audit events.
- **FR-AGT-006 [MVP]:** An agent shall have a stable public identifier that is not a secret.
- **FR-AGT-007 [Production]:** Agent configuration changes shall support maker-checker review when required by organization policy.
- **FR-AGT-008 [MVP]:** Agent creation shall require a custody mode of `MANAGED` or `SELF_CUSTODY`, and the custody mode shall be visible wherever payment authority is configured.

### 7.3 Credentials and agent API access

- **FR-KEY-001 [MVP]:** Operators shall create an agent API key whose plaintext is shown exactly once.
- **FR-KEY-002 [MVP]:** Only a cryptographic hash and non-secret prefix of an API key shall be persisted.
- **FR-KEY-003 [MVP]:** API keys shall support labels, scopes, creation time, last-used time, expiry, and revocation.
- **FR-KEY-004 [MVP]:** Revoked, expired, or organization-mismatched credentials shall fail closed.
- **FR-KEY-005 [Production]:** API key creation and revocation shall support notification and SIEM events.

### 7.4 Hedera accounts and balances

- **FR-WAL-001 [MVP]:** The system shall let an operator provision a managed Hedera testnet account or connect and verify a self-custody Hedera account for an agent.
- **FR-WAL-002 [MVP]:** Private key material shall be encrypted and accessible only to the signer process.
- **FR-WAL-003 [MVP]:** The dashboard shall display the Hedera account ID, network, account status, and last synchronized balances.
- **FR-WAL-004 [MVP]:** Balance data shall include an `asOf` timestamp and source.
- **FR-WAL-005 [MVP]:** The system shall provide copyable account and HashScan account links for funding and inspection.
- **FR-WAL-006 [MVP]:** A payment shall be rejected before signing when the known spendable balance is insufficient.
- **FR-WAL-007 [Production]:** Balance reconciliation shall account for pending reservations, settled debits, fees, and external transfers.
- **FR-WAL-008 [Production]:** Key rotation shall not erase the connection between historical transactions and the agent.
- **FR-WAL-009 [MVP]:** Self-custody account connection shall require a wallet signature proving control of the account and shall never request or store the wallet private key.
- **FR-WAL-010 [MVP]:** A self-custody payment shall use an explicit wallet signature or a separately authorized delegated signer/session; the system shall never imply autonomous authority that the user has not granted.

### 7.5 Policy management

- **FR-POL-001 [MVP]:** Each active agent shall have one effective policy version.
- **FR-POL-002 [MVP]:** A policy shall support maximum amount per transaction and maximum cumulative amount per UTC day, per asset.
- **FR-POL-003 [MVP]:** A policy may define merchant/resource-host allowlists and denylists.
- **FR-POL-004 [MVP]:** A policy shall define an over-limit action of `DENY` or `REQUIRE_APPROVAL`.
- **FR-POL-005 [MVP]:** Policy evaluation shall be deterministic and shall return a decision, reason codes, policy version, and evaluated facts.
- **FR-POL-006 [MVP]:** Policy edits shall create a new immutable policy version.
- **FR-POL-007 [MVP]:** Spend calculations shall include settled amounts and active reservations to prevent concurrent-limit bypass.
- **FR-POL-008 [Production]:** Policies shall support weekly/monthly limits, asset rules, time windows, endpoint patterns, merchant categories, velocity rules, and risk scores.
- **FR-POL-009 [Production]:** Policy precedence shall be explicit: platform safety rules, organization rules, agent rules, then request-specific constraints.

### 7.6 x402 discovery and purchase

- **FR-X42-001 [MVP]:** The agent client shall issue an HTTP request to a configured resource URL.
- **FR-X42-002 [MVP]:** The client shall parse a valid x402 `PAYMENT-REQUIRED` challenge and reject malformed, unsupported, expired, or oversized challenges.
- **FR-X42-003 [MVP]:** The client shall select only an explicitly supported `(scheme, network, asset)` combination.
- **FR-X42-004 [MVP]:** The MVP shall support the x402 `exact` scheme over the configured Hedera testnet identifier.
- **FR-X42-005 [MVP]:** The platform shall normalize the payment challenge into an internal quote before policy evaluation.
- **FR-X42-006 [MVP]:** The system shall bind authorization to the exact destination, asset, amount, resource, network, and expiration.
- **FR-X42-007 [MVP]:** The signer shall produce only the payment authorized by the policy decision or approval grant.
- **FR-X42-008 [MVP]:** The client shall retry the resource request with `PAYMENT-SIGNATURE` and capture `PAYMENT-RESPONSE`.
- **FR-X42-009 [MVP]:** The system shall persist attempt state before external side effects.
- **FR-X42-010 [MVP]:** The system shall use an idempotency key to prevent duplicate business attempts and a payment fingerprint to detect replay.
- **FR-X42-011 [MVP]:** The resource shall not be reported as purchased until settlement confirmation or an explicitly modeled pending state.
- **FR-X42-012 [Production]:** Resource providers shall be able to register endpoints and pricing metadata.
- **FR-X42-013 [MVP]:** The reference resource server shall expose provider adapters for market data, protected files, AI inference, and paid web research behind a common priced-resource contract.
- **FR-X42-014 [MVP]:** HBAR and USDC shall be represented as separate verified asset configurations; the system shall reject either asset when the active facilitator does not advertise compatible support.

### 7.6A Developer and agent integrations

- **FR-INT-001 [MVP]:** The REST API shall be the authoritative integration contract for paid requests, status polling, and agent metadata.
- **FR-INT-002 [MVP]:** A TypeScript SDK shall provide typed wrappers for authentication, idempotent paid requests, approvals-pending outcomes, and polling.
- **FR-INT-003 [MVP]:** The repository shall provide an agent `SKILL.md` describing safe discovery, payment, approval, retry, and secret-handling behavior.
- **FR-INT-004 [MVP]:** An MCP server shall expose least-privilege tools for listing supported resources, requesting purchases, and checking payment status.
- **FR-INT-005 [MVP]:** LangChain tools shall wrap the same operations and shall not bypass policy, approval, or signer boundaries.
- **FR-INT-006 [MVP]:** All integration surfaces shall return consistent business outcome codes and share the same idempotency and authorization semantics.

### 7.6B Resource-provider capabilities

- **FR-PRV-001 [MVP]:** The reference server shall define a common provider interface for resource description, price quote, availability check, and fulfillment.
- **FR-PRV-002 [MVP]:** At least one provider in each category—market data, file, inference, and research—shall be configurable in the MVP catalog; deterministic demo providers are acceptable when third-party access is unavailable.
- **FR-PRV-003 [Production]:** External providers shall onboard, verify settlement accounts, register/version resources, set prices, pause listings, and view settlement/access analytics.

### 7.7 Approvals

- **FR-APR-001 [MVP]:** A `REQUIRE_APPROVAL` decision shall create one approval request associated with the immutable payment quote.
- **FR-APR-002 [MVP]:** An approval shall show agent, merchant, endpoint, description, asset, amount, triggering rule, request reason, and expiration.
- **FR-APR-003 [MVP]:** An Approver may approve or reject a pending request with an optional note.
- **FR-APR-004 [MVP]:** Approval shall not permit changes to destination, asset, amount, or resource; a changed quote requires a new approval.
- **FR-APR-005 [MVP]:** Approval decisions shall be idempotent and auditable.
- **FR-APR-006 [MVP]:** Expired, rejected, canceled, or already consumed approvals shall not authorize signing.
- **FR-APR-007 [MVP]:** An approved request shall resume through a single-use execution token or server-side job, not through client-supplied mutation of the quote.
- **FR-APR-008 [Production]:** Organizations shall configure one-of-N, M-of-N, and amount-based approval rules.

### 7.8 Transactions and reconciliation

- **FR-TXN-001 [MVP]:** A transaction record shall track business request, x402 challenge, policy decision, signature lifecycle, settlement, and resource response.
- **FR-TXN-002 [MVP]:** Transaction states shall be defined in the SDD and enforced as valid transitions.
- **FR-TXN-003 [MVP]:** A settled transaction shall store Hedera transaction ID, consensus timestamp when available, payer, payee, asset, atomic amount, and HashScan URL.
- **FR-TXN-004 [MVP]:** The dashboard shall filter transactions by agent, status, asset, and date.
- **FR-TXN-005 [MVP]:** A transaction detail view shall show a chronological event timeline without exposing secrets or raw signatures.
- **FR-TXN-006 [MVP]:** A reconciliation job or endpoint shall resolve ambiguous `SUBMITTED` transactions through Hedera network/mirror-node evidence.
- **FR-TXN-007 [MVP]:** The system shall distinguish `FAILED_BEFORE_SUBMISSION`, `SUBMISSION_UNKNOWN`, and `SETTLEMENT_FAILED`.
- **FR-TXN-008 [Production]:** Reconciliation shall run continuously and create incidents for unresolved discrepancies.

### 7.9 Dashboard and reporting

- **FR-UI-001 [MVP]:** The overview shall display total settled spend, active agents, pending approvals, recent transactions, and network environment.
- **FR-UI-002 [MVP]:** Every asynchronous screen shall define loading, empty, error, retry, and success states.
- **FR-UI-003 [MVP]:** Testnet shall be visibly labeled throughout the product.
- **FR-UI-004 [MVP]:** Monetary values shall display asset symbol and appropriate decimal precision without losing atomic accuracy.
- **FR-UI-005 [MVP]:** Destructive or security-sensitive actions shall require confirmation.
- **FR-UI-006 [Production]:** Reports shall support CSV/JSON export and scheduled delivery.

### 7.10 Audit and notifications

- **FR-AUD-001 [MVP]:** Security, policy, credential, approval, and payment actions shall emit append-only audit events.
- **FR-AUD-002 [MVP]:** Audit events shall contain actor type/id, organization, action, target, timestamp, request correlation ID, result, and redacted metadata.
- **FR-AUD-003 [MVP]:** Audit records shall not contain secrets, private keys, full API keys, authentication tokens, or raw sensitive signatures.
- **FR-AUD-004 [Production]:** Audit logs shall be exportable, integrity-protected, retained by policy, and suitable for SIEM ingestion.
- **FR-NOT-001 [Production]:** Notifications shall support approval requested, payment settled, payment failed, low balance, credential change, and suspicious activity.

### 7.11 Administration and safety

- **FR-ADM-001 [MVP]:** An operator shall be able to pause a single agent.
- **FR-ADM-002 [MVP]:** An owner shall be able to activate an organization-wide payment kill switch.
- **FR-ADM-003 [MVP]:** Kill-switch checks shall occur immediately before signing as well as at request intake.
- **FR-ADM-004 [Production]:** Operations users shall have read-only support tooling with audited impersonation prohibited by default.

## 8. Business rules

- **BR-001:** Money is represented as `{assetId, atomicAmount}`; `atomicAmount` is a base-10 integer string at API boundaries and an exact numeric type internally.
- **BR-002:** An authorization is valid for one immutable payment fingerprint only.
- **BR-003:** Deny rules take precedence over allow rules.
- **BR-004:** Platform and organization kill switches take precedence over all approvals.
- **BR-005:** Archived or paused agents cannot create or resume payments.
- **BR-006:** Daily budget uses UTC boundaries in the MVP; production may support organization time zones while retaining the UTC ledger.
- **BR-007:** Active spend is `settled + submitted + reserved`, less reservations conclusively released.
- **BR-008:** A reservation expires automatically if signing has not begun; submitted reservations remain until reconciliation determines an outcome.
- **BR-009:** Approval does not bypass insufficient balance, unsupported asset, stale challenge, kill switch, or platform safety rules.
- **BR-010:** A transaction is `SETTLED` only when authoritative network evidence confirms it.
- **BR-011:** The resource URL must use HTTPS outside local development.
- **BR-012:** Redirects to a different host invalidate the merchant/resource binding unless explicitly allowed and re-evaluated.

## 9. Non-functional requirements

### 9.1 Security

- **NFR-SEC-001 [MVP]:** TLS shall protect all non-local network traffic.
- **NFR-SEC-002 [MVP]:** Secrets shall come from environment/secret management and never be committed.
- **NFR-SEC-003 [MVP]:** Private keys shall be encrypted at rest with envelope encryption and separately authorized decryption.
- **NFR-SEC-004 [MVP]:** Signing shall run server-side in an isolated module/process with an allowlisted transaction schema.
- **NFR-SEC-005 [MVP]:** API input shall be schema-validated; URLs shall be protected against SSRF, private network access, unsupported schemes, and unsafe redirects.
- **NFR-SEC-006 [MVP]:** Authentication and payment endpoints shall be rate-limited.
- **NFR-SEC-007 [MVP]:** Logs and error responses shall be redacted.
- **NFR-SEC-008 [MVP]:** Dependencies shall be pinned and scanned for known vulnerabilities.
- **NFR-SEC-009 [Production]:** Mainnet signing keys shall use KMS/HSM or an independently reviewed delegated signer; database-only encryption is insufficient.
- **NFR-SEC-010 [Production]:** Independent penetration testing and threat-model review are release gates.

### 9.2 Reliability and consistency

- **NFR-REL-001 [MVP]:** All payment mutations shall be idempotent.
- **NFR-REL-002 [MVP]:** Database writes shall use transactions for quote, decision, reservation, and attempt creation.
- **NFR-REL-003 [MVP]:** External retries shall use bounded exponential backoff and distinguish safe from unsafe operations.
- **NFR-REL-004 [MVP]:** Unknown submission outcomes shall be reconciled before another payment with the same fingerprint is attempted.
- **NFR-REL-005 [Production]:** Monthly API availability target shall be at least 99.9%, excluding announced maintenance.
- **NFR-REL-006 [Production]:** Recovery point objective shall be 15 minutes or less; recovery time objective shall be 2 hours or less.

### 9.3 Performance

- **NFR-PERF-001 [MVP]:** Non-chain dashboard API p95 latency shall be under 500 ms in the target region under expected demo load.
- **NFR-PERF-002 [MVP]:** Policy evaluation p95 shall be under 100 ms excluding database contention.
- **NFR-PERF-003 [MVP]:** User interfaces shall acknowledge long-running settlement immediately and show progress.
- **NFR-PERF-004 [Production]:** The system shall scale stateless API instances horizontally; signer concurrency shall be separately controlled.

### 9.4 Accessibility and responsive behavior

- **NFR-A11Y-001 [MVP]:** Core flows shall meet WCAG 2.1 AA intent for keyboard access, labels, contrast, focus, and status announcements.
- **NFR-A11Y-002 [MVP]:** Status shall never be conveyed by color alone.
- **NFR-A11Y-003 [MVP]:** Core dashboards shall work without horizontal page overflow at 390 px viewport width.
- **NFR-A11Y-004 [MVP]:** Transaction tables shall transform into readable record cards on small screens.

### 9.5 Privacy and compliance readiness

- **NFR-PRV-001 [MVP]:** The system shall collect only data needed for authentication, operation, security, and audit.
- **NFR-PRV-002 [MVP]:** Public blockchain addresses and transaction details shall be clearly identified as public and non-deletable from Hedera.
- **NFR-PRV-003 [Production]:** Retention, export, correction, and deletion workflows shall be documented and implemented where legally applicable.
- **NFR-CMP-001 [Production]:** Mainnet launch requires legal review covering custody, money transmission, sanctions, AML/KYC, consumer protection, and supported jurisdictions.

### 9.6 Observability

- **NFR-OBS-001 [MVP]:** Every request shall have a correlation ID propagated through API, policy, signer, facilitator, and job logs where possible.
- **NFR-OBS-002 [MVP]:** Metrics shall cover request count/error rate/latency, policy outcomes, approval age, signing errors, settlement outcomes, reconciliation lag, and low fee-payer balance.
- **NFR-OBS-003 [MVP]:** `/health` shall report process health; `/ready` shall validate required dependencies without exposing secrets.
- **NFR-OBS-004 [Production]:** Alerting shall define owners, severity, runbook, and escalation for every actionable alert.

### 9.7 Maintainability

- **NFR-MNT-001 [MVP]:** Domain, policy, signing, Hedera, x402, persistence, and UI concerns shall be separated behind typed interfaces.
- **NFR-MNT-002 [MVP]:** Public APIs and DTOs shall be versioned.
- **NFR-MNT-003 [MVP]:** Database schema changes shall use forward migrations with tested rollback or roll-forward procedures.
- **NFR-MNT-004 [MVP]:** Critical domain state transitions shall have automated tests.

## 10. Data requirements

The system shall persist at minimum:

- Organizations, users, memberships, and roles.
- Agents, agent credentials, payment accounts, and encrypted key references.
- Assets and network metadata.
- Policies and immutable policy versions.
- Payment intents, normalized quotes, policy decisions, spend reservations, and attempts.
- Approval requests and decisions.
- Settlement records and on-chain evidence.
- Audit events, webhook deliveries, and reconciliation records.

Detailed entities and DTOs are defined in the SDD and Screens/DTO specification.

## 11. External interfaces

### 11.1 Hedera

- Native Hedera testnet transfer submission through the selected x402 Hedera facilitator.
- Mirror-node or SDK queries for account balances and transaction reconciliation.
- HashScan URLs for human-verifiable evidence.

### 11.2 x402

- `402 Payment Required` response.
- Base64-encoded `PAYMENT-REQUIRED` challenge.
- Base64-encoded `PAYMENT-SIGNATURE` payment payload.
- Base64-encoded `PAYMENT-RESPONSE` settlement response.
- Facilitator `/supported`, `/verify`, and `/settle` capabilities as implemented by the pinned Hedera package.

### 11.3 Resource server

The MVP includes a priced-resource server with free discovery/health endpoints and paid adapters for market data, protected files, AI inference, and web research. The resource must never return paid data before the configured settlement guarantee is satisfied. Deterministic providers are permitted for reproducibility; at least one provider must use a real live settlement in the demo.

## 12. Error and recovery requirements

- Validation errors shall return stable machine codes and safe human messages.
- Policy denials shall include reason codes but not sensitive policy internals that enable evasion.
- Insufficient balance, unsupported payment option, stale challenge, approval required, rate limit, facilitator unavailable, and settlement unknown shall be distinct outcomes.
- A failed dashboard fetch shall preserve layout and offer retry.
- A payment with unknown submission status shall not be blindly retried.
- Operators shall be able to inspect and reconcile a transaction without database access.

## 13. Acceptance criteria

### 13.1 MVP release gate

- [ ] Public repository includes license, setup, architecture, environment template, and security notes.
- [ ] A clean installation can create an operator and organization.
- [ ] An agent can be created, funded, activated, paused, and archived.
- [ ] API key plaintext is displayed once and revocation works.
- [ ] Per-transaction and daily policy rules pass automated boundary tests.
- [ ] Concurrent requests cannot exceed a budget through race conditions.
- [ ] An allowed canonical resource purchase produces a real Hedera testnet transaction.
- [ ] The resource catalog exposes market-data, file, AI-inference, and web-research resource types through a common contract.
- [ ] HBAR and USDC configurations are visible, and unsupported facilitator/asset combinations fail closed.
- [ ] Managed and self-custody agents can be created; each mode proves the correct ownership/signing behavior.
- [ ] REST, TypeScript SDK, `SKILL.md`, MCP, and LangChain integrations exercise the same policy-controlled API contract.
- [ ] An over-limit purchase is denied without a signature or transfer.
- [ ] An approval-required request can be approved, executed once, and displayed.
- [ ] A rejected/expired approval cannot execute.
- [ ] Transaction detail includes correct HashScan link and settlement evidence.
- [ ] Secrets do not appear in client bundles, logs, database dumps, or API responses.
- [ ] Unit, integration, end-to-end, lint, typecheck, and production build checks pass.
- [ ] Core UI works at desktop and 390 px mobile width.
- [ ] Demo video is under five minutes and shows the end-to-end flow and HashScan proof.

### 13.2 Production release gate

- [ ] Legal/compliance review completed for target jurisdictions and operating model.
- [ ] Mainnet custody design independently reviewed and tested.
- [ ] Threat model, penetration test, dependency/SBOM review, and incident exercises completed.
- [ ] Backup restore, disaster recovery, reconciliation, and key recovery drills passed.
- [ ] SLOs, dashboards, alerts, on-call ownership, and runbooks active.
- [ ] Data retention, privacy, export, and deletion controls operational.
- [ ] Load, failure-injection, and concurrency tests meet documented targets.

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| x402/Hedera packages change during development | Build breakage or protocol mismatch | Pin exact versions; record compatibility; wrap packages behind adapters |
| Agent prompt accesses key material | Loss of funds | Isolated signer; opaque key reference; transaction allowlist; redacted logs |
| Concurrent requests bypass budget | Overspend | Serializable/locked reservation transaction; include active reservations |
| Verify succeeds but settle fails | Resource delivered without payment | Settle before fulfillment for MVP; explicitly model unknown states; reconcile |
| Facilitator compromised | Invalid or unavailable settlement | Client signs exact bounded transfer; verify facilitator behavior; rate limits; replaceable adapter |
| Testnet behavior differs from mainnet | Production failure | Mainnet readiness environment and staged launch; no automatic network switch |
| SSRF through arbitrary resource URLs | Internal service exposure | URL validation, DNS/IP checks, egress controls, redirect revalidation |
| Public chain leaks sensitive metadata | Privacy harm | Store only necessary memo/data; disclose public nature; avoid PII on-chain |
| Scope exceeds bounty timeline | Missed deadline | Deliver canonical vertical slice first; defer marketplace/cards/advanced policies |

## 15. Requirements traceability

Implementation issues and tests shall reference requirement IDs. The SDD maps system components to requirements; the Screens/DTO document maps user interfaces and API contracts; the Workflow document maps runtime sequences and failure recovery. A requirement is complete only when implementation evidence and its designated verification exist.

## 16. References

- Hedera x402 Bounty: https://hedera.com/x402-bounty/
- x402 specification repository: https://github.com/x402-foundation/x402
- Hedera x402 pay-per-use reference: https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use
- Hedera financial-data reference: https://github.com/matevszm/x402-hedera-example
- Hedera documentation: https://docs.hedera.com/
