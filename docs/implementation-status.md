# AgentPay implementation status

This document is the release traceability map for the roadmap in the software requirements document. “Implemented” means the repository contains the production path and automated verification; it does not mean an external provider has approved a live account.

## Current MVP — implemented

- Passwordless operator authentication and optional Hedera wallet identity
- Organization-scoped agents, credentials, policies, approvals, transactions, resources, and audit evidence
- Exact x402 payment verification and settlement through the isolated Hedera facilitator
- HashScan evidence, reconciliation, idempotency, rate limits, health, readiness, and structured errors

## Production foundation — implemented

- PostgreSQL 17 schema with 22 forward-only migrations and fresh/upgrade verification
- Tenant isolation, deterministic role checks, encrypted sensitive fields, one-time wallet challenges, CSRF protection, bounded request bodies, SSRF controls, and concurrency guards
- Notification outbox, retries, dead-letter handling, maintenance jobs, metrics, retention, export, deletion, support cases, plan entitlements, backup/restore scripts, CI, and production runbook
- Database-enforced immutable, SHA-256 hash-chained audit events with CSV/JSON export
- Automatic, idempotent urgent incidents for unresolved Hedera, fiat, bridge, and contract submissions

## Production v1 — implemented

- Owner, operator, approver, viewer, and provider-admin workflows
- Member invitation and suspension, provider onboarding, verified settlement accounts, resource pricing/publication, notification endpoints, emergency kill switch, and organization settings
- Multi-policy controls, schedules, merchant/category restrictions, velocity rules, threshold approvals, verified asset registry, and managed account isolation
- Operations UI for the dashboard’s core production workflows

## Virtual cards and fiat rails — provider-ready

- Cardholder onboarding, virtual card issuance, agent/card spending controls, authorization decisions, card lifecycle controls, signed Stripe webhooks, and sensitive display-key flow
- Fiat operating accounts, deposits/withdrawals, encrypted instrument recovery, provider idempotency, ambiguous-submission reconciliation, balances, and transfer history
- Sandbox paths are testable now. Live operation requires an approved Stripe Issuing and Financial Accounts configuration.

## Marketplace and agent invoicing — implemented

- Verified marketplace catalog, provider/resource registration, resource health, pricing, tags, reviews, and purchase evidence
- Agent-to-agent invoice drafting, line items, send/view/void/overdue states, approval-aware payment, exact x402 collection, serialized settlement, and invoice timelines

## Cross-chain and smart-contract automation — integration-ready

- LI.FI quote preparation, encrypted transaction requests, source-transaction verification, destination receipt validation, confirmation tracking, and reconciliation
- Manual, schedule, balance, invoice-event, and signed-webhook triggers
- x402 payment, invoice, and Hedera contract-call actions with independent approval, contract allowlists, selector/value/gas limits, runtime bytecode hash verification, pre-recorded transaction identity, and unknown-submission reconciliation
- Live canaries require funded EVM test accounts and routes for the selected tokens.

## Predictive financial intelligence — implemented

- Daily observations, spend forecasting, anomaly detection, budget recommendations, confidence/context metadata, owner acceptance or dismissal, and scheduled refresh
- Recommendation acceptance creates a draft policy for explicit review; intelligence never silently raises an active spending limit.

## Remaining launch evidence

The code path is not considered fully launched until all of the following external evidence exists:

1. Stripe approves the production Issuing and applicable fiat products, followed by a low-value card and fiat canary.
2. Production LI.FI routes are verified with funded EVM accounts, source/destination explorers, and failure/refund drills.
3. Hedera production keys are placed in KMS/HSM or an external signer and retained only by the facilitator.
4. DNS/TLS, secret manager, production Supabase redirect/email configuration, monitoring, paging, and point-in-time database recovery are enabled.
5. A restore drill, incident exercise, independent security assessment, and production canary payment are recorded against an immutable release SHA.
