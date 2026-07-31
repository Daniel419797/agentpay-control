# Overview

AgentPay Control is a multi-tenant financial control plane for autonomous agents. The Next.js dashboard exposes operator and agent APIs, stores authorization and financial state in PostgreSQL, and coordinates x402 purchases, approvals, virtual cards, fiat transfers, invoices, cross-chain transfers, smart-contract automation, and predictive financial operations. Separate Hono services act as Hedera and Arc payment facilitators and as an x402-protected resource server.

The highest-value assets are private signing keys, facilitator API credentials, operator sessions, agent API credentials, encrypted financial instruments, tenant-scoped policy and approval state, transaction identifiers, provider webhook authenticity, immutable audit evidence, and the integrity of budget reservations and settlement state.

# Threat Model, Trust Boundaries, and Assumptions

Primary trust boundaries:

- Internet users and browsers to the Next.js proxy, authentication callbacks, API routes, and server-rendered pages.
- Autonomous agents holding API credentials to paid-request and resource APIs.
- Authenticated organization members to role-gated tenant data and financial controls.
- Next.js application to PostgreSQL, Supabase, Stripe, LI.FI, mirror nodes, RPC providers, notification endpoints, and facilitator services.
- Dashboard and resource server to the Hedera and Arc facilitators over bearer-authenticated HTTP.
- Facilitators to blockchain networks while holding or accessing signing keys.
- Stripe and other external providers to signed webhook receivers.
- Scheduled job callers to internal maintenance, reconciliation, notification, entitlement, and metrics endpoints.
- Build and deployment systems to secret managers, container registries, Vercel, and Render.

Attacker-controlled inputs include HTTP headers, cookies, query parameters, route parameters, JSON bodies, agent credentials, resource URLs, marketplace/provider fields, webhook bodies and headers, wallet signatures, contract addresses and calldata, cross-chain transaction identifiers, invoice data, notification webhook targets, and OAuth callback parameters.

Operator-controlled inputs include organization settings, policies, allowlists, provider configuration, contract automation rules, retention settings, and production environment variables. Developer-controlled inputs include migrations, deployment manifests, package dependencies, seed data, CI workflows, and Docker build contexts.

Security invariants:

- Authentication tokens must be cryptographically verified, short-lived where appropriate, securely transported, and revocable through membership or credential state.
- Every tenant-owned read and mutation must be scoped to the authenticated organization and checked against the required role.
- API credentials and wallet challenges must be one-way stored or single-use, bounded, and resistant to replay.
- Private signing keys, Stripe secrets, encryption keys, and facilitator bearer tokens must never reach browsers, logs, responses, source control, or LLM context.
- Every payment, card authorization, fiat transfer, invoice payment, bridge, and contract execution must preserve exact amount, destination, asset, network, idempotency, approval, kill-switch, and reservation invariants.
- No paid resource may be fulfilled before the configured settlement guarantee.
- External URLs must resist SSRF, redirects to private networks, DNS rebinding, credential-bearing URLs, and unbounded responses.
- Provider webhooks must be verified over the exact raw body, replay-resistant, idempotent, and fail closed.
- Unknown external submission outcomes must be reconciled instead of retried blindly.
- Audit events must remain tenant-scoped, immutable, ordered, hash-chained, and exportable without spreadsheet injection.
- Production services must fail closed on missing secrets, use least privilege, run as non-root, expose meaningful health/readiness, and deploy only from verified immutable artifacts.

Assumptions:

- Managed PostgreSQL provides encryption, backups, point-in-time recovery, and restricted network access.
- Production DNS, TLS, secret storage, paging, provider accounts, and blockchain RPC availability are configured outside this repository and require live verification.
- Mainnet or real-money features are not safe merely because code paths exist; KMS/HSM or reviewed delegated signing and provider approvals are launch prerequisites.
- Tests, demos, and generated clients are not primary runtime surfaces unless they are packaged or executed in CI/deployment.

# Attack Surface, Mitigations, and Attacker Stories

Authentication and session surfaces include Supabase OTP/magic-link and OAuth callbacks, wallet challenge verification, JWT session cookies, proxy CSRF checks, and membership lookup. Relevant threats include callback substitution, open redirects, token replay, wallet challenge replay, session fixation, weak cookie attributes, stale membership access, and denial of service through authentication endpoints. Existing mitigations include HS256 algorithm pinning, secure production cookies, one-time wallet challenge persistence, CSRF origin checks, and active membership checks.

Tenant and authorization surfaces span API routes for agents, policies, approvals, resources, marketplace, cards, fiat, invoices, automations, intelligence, support, audit, and organization controls. The dominant threat is IDOR or privilege escalation where a route queries by attacker-selected ID without organization and role predicates. Existing helpers centralize current workspace and role checks, but every route and service must preserve those predicates through nested operations.

Payment and signing surfaces include x402 requirement parsing, policy evaluation, spend reservation, managed signing, facilitator verification/settlement, contract execution, and reconciliation. Threats include requirement substitution, amount or destination mismatch, double spend under concurrency, replay, signer confused-deputy behavior, key disclosure, and fulfillment before finality. Existing controls include canonical fingerprints, integer atomic amounts, serializable retries, transaction candidate recording, facilitator bearer authentication, contract allowlists, and reconciliation states.

Network and integration surfaces include resource fetching, notification webhooks, LI.FI and RPC requests, mirror-node queries, Stripe API calls, OAuth and Supabase calls, and browser-exposed wallet integrations. Threats include SSRF, unsafe redirects, DNS rebinding, response-body exhaustion, provider impersonation, insecure TLS assumptions, and leaked credentials. URL validation and bounded request helpers exist, but validation must remain coupled to the actual resolved connection and each redirect.

Provider webhook surfaces accept unauthenticated internet traffic by design. A realistic attacker can send arbitrary bodies and spoof headers; signature verification, timestamp tolerance, body limits, event idempotency, and provider-object reconciliation must prevent unauthorized financial state transitions.

Operational surfaces include cron-authenticated maintenance and notification endpoints, metrics, exports, deletion, backup/restore scripts, migrations, CI, Dockerfiles, and Render/Vercel configuration. Threats include over-privileged internal bearer tokens, public metrics, destructive restore mistakes, supply-chain compromise, secrets in build context, non-reproducible images, and deploying before checks pass. Existing controls include dedicated cron secrets, local-only governance verification, forward migrations, checksummed backups, non-root service images, ignored secret files, and checks-pass deployment configuration.

Out-of-scope attacker stories include compromise of correctly configured cloud KMS/HSM, managed database, Stripe, Supabase, LI.FI, Hedera, Arc, Vercel, or Render themselves. Misconfiguration of those systems remains a production risk and must be validated during deployment even when it is not a source-code vulnerability.

# Severity Calibration (Critical, High, Medium, Low)

Critical findings include unauthenticated extraction of signing keys or master encryption keys, arbitrary blockchain transfers or contract execution using facilitator authority, cross-tenant control of many organizations, remote code execution in an internet-facing production service, or systemic bypass of settlement and budget invariants.

High findings include practical tenant isolation bypass exposing financial data, role bypass enabling payment/card/fiat/automation mutations, replayable provider webhooks causing financial state transitions, exploitable SSRF reaching cloud metadata or internal facilitator controls, or authenticated confused-deputy signing outside approved amount/destination/network bounds.

Medium findings include scoped data exposure, denial of service through bounded but meaningful resource exhaustion, missing security headers or session controls with realistic exploit preconditions, incomplete audit integrity, unsafe spreadsheet export, or operational endpoint exposure without direct fund movement.

Low findings include limited metadata disclosure, hardening omissions with substantial deployment preconditions, developer-only unsafe defaults that fail closed in production, or defense-in-depth gaps that do not independently cross a trust boundary.

Repository: sha256:5979b31e119f3734bea76c1e018148cd2fc15c56d48bd7de89973828b9f58e0c
Version: codex-security-snapshot/v1:sha256:69508e3e924b9768b44767b535f27371d78f93583d56197a473c04cd473a5ae1

