# AgentPay implementation status

This document is the release traceability map for AgentPay. “Implemented” means the repository contains the code path and automated verification intended to exercise it. It does **not** mean an external provider has approved a live account, production credentials have been moved into managed signing custody, or the current release SHA has passed every production launch gate.

## Current MVP — implemented

- Passwordless/operator authentication plus verified Hedera wallet identity
- Organization-scoped agents, credentials, policies, approvals, transactions, resources, and audit evidence
- Exact x402 payment verification and settlement through isolated Hedera and Arc facilitators
- Standard x402 V2 Base64 payment headers and Settlement Response handling
- Organization kill switch, reconciliation states, idempotency, rate limits, health/readiness, and structured errors

## Production foundation — implemented in code

- PostgreSQL schema with forward-only migrations and migration verification
- Tenant isolation, deterministic role checks, encrypted sensitive fields, one-time wallet challenges, OAuth PKCE+state, CSRF origin binding, bounded request bodies, SSRF controls, and concurrency guards
- Notification outbox, retries, dead-letter handling, maintenance jobs, metrics, retention, export, deletion, support cases, plan entitlements, backup/restore scripts, CI configuration, and production runbook
- Database-enforced immutable, SHA-256 hash-chained audit events with CSV/JSON export; retention preserves chain continuity rather than deleting historical audit rows
- Automatic urgent incidents for unresolved payment, fiat, bridge, and contract submissions
- Hedera unknown x402 payment reconciliation from exact mirror-node transaction evidence

## Production v1 workflows — implemented in code

- Owner, operator, approver, viewer, and provider-admin workflows
- Member invitation/suspension, provider onboarding, verified settlement ownership, resource pricing/publication, notification endpoints, emergency kill switch, and organization settings
- Multi-policy controls, schedules, merchant/category restrictions, velocity rules, threshold approvals, verified asset registry, and managed account isolation
- Operations UI for core production workflows with role-aware mutation affordances
- Asset/network-aware overview accounting and chain-appropriate explorer receipts

## Hedera and Arc payment rails

### Hedera

- Hedera testnet managed signing is implemented for autonomous agent x402 payments.
- Hedera testnet and mainnet self-custody wallet identity are supported for operator-confirmed wallet activity.
- Managed Hedera mainnet agent custody remains intentionally disabled; mainnet agent identity must be self-custody.
- Contract automation is network-bound and uses independent mainnet/testnet facilitator capability and payer configuration.
- Ambiguous Hedera x402 submissions reconcile from the pre-recorded transaction ID and exact payer/payee/asset/amount mirror evidence without blind retries.

### Arc

- Arc testnet managed agent provisioning and x402 payment routing are implemented when the facilitator, signing capability, public payer address, provider payee, RPC, and USDC contract are configured.
- Arc private keys stay in the facilitator; the dashboard stores only public payer identity.
- Arc browser-wallet/self-custody identity is **not** implemented and is not advertised by the UI.
- Ambiguous Arc x402 submissions remain `SUBMISSION_UNKNOWN` and incident-driven. Automatic chain reconciliation is intentionally gated until the signed authorization can be mapped deterministically to recoverable chain evidence.

## Marketplace settlement — partially multi-rail by design

- Platform-owned bundled resources can advertise configured Hedera testnet/mainnet and Arc testnet payees.
- Organization-owned marketplace providers currently use verified Hedera testnet settlement only.
- Arc/mainnet settlement for arbitrary third-party providers remains intentionally disabled until the data model supports network-specific verified settlement accounts and ownership proof. AgentPay fails closed rather than routing those funds to a global platform address.

## Virtual cards and fiat rails — provider-ready

- Cardholder onboarding, virtual-card issuance, agent/card spending controls, serialized authorization decisions, card lifecycle controls, signed Stripe webhooks, and sensitive display-key flow
- Fiat operating accounts, deposits/withdrawals, encrypted instrument recovery, provider idempotency, ambiguous-submission reconciliation, balances, and transfer history
- Confirmed provider 4xx rejection is terminal rather than repeatedly retried as an unknown submission
- Sandbox paths are testable now. Live operation still requires an approved Stripe Issuing and applicable money-management/fiat configuration.

## Marketplace and agent invoicing — implemented

- Verified marketplace catalog, provider/resource registration, resource health, pricing, tags, reviews, and purchase evidence
- Agent-to-agent invoice drafting, line items, send/view/void/overdue states, approval-aware payment, exact x402 collection, serialized settlement, and invoice timelines

## Cross-chain and smart-contract automation — integration-ready

- LI.FI quote preparation, encrypted transaction requests, source-transaction signer/target/calldata/value verification, destination receipt/token/recipient/amount validation, confirmation tracking, and reconciliation
- Manual, schedule, balance, invoice-event, and signed-webhook triggers
- x402 payment, invoice, and Hedera contract-call actions with independent approval, contract allowlists, selector/value/gas limits, runtime bytecode hash verification, pre-recorded transaction identity, and unknown-submission reconciliation
- Live canaries still require funded EVM accounts and usable routes for the selected tokens.

## Predictive financial intelligence — implemented

- Daily observations, spend forecasting, anomaly detection, budget recommendations, confidence/context metadata, owner acceptance or dismissal, and scheduled refresh
- Recommendation acceptance creates a draft policy for explicit review; intelligence never silently raises an active spending limit.

## Bundled resource server — synthetic integration fixture

The repository’s bundled market-data, file, inference, and research endpoints are synthetic fixtures for exercising x402 flows. They are labeled as such in API/catalog responses and must not be represented as live market data, real model inference, or live web research. Replacing them with real providers requires provider-specific credentials, monitoring, rate limits, provenance, error handling, and SLOs.

## Current release blockers

The code path is not considered production-launched until all applicable evidence exists:

1. The exact release head passes migrations, lint, typecheck, unit tests, browser smoke tests, facilitator/resource tests, container builds, CodeQL, dependency review, and required quality gates.
2. Stripe approves the production Issuing and applicable fiat products, followed by low-value card and fiat canaries.
3. Production LI.FI routes are verified with funded EVM accounts, source/destination explorers, and failure/refund drills.
4. Hedera and Arc production signing keys are placed in KMS/HSM/external signing custody where supported and retained only by the appropriate signing services.
5. DNS/TLS, secret manager, production Supabase redirect/email configuration, monitoring, paging, and point-in-time database recovery are enabled.
6. A restore drill, incident exercise, independent security assessment, and production x402 canary are recorded against an immutable release SHA.
7. Any CI/CodeQL/dependency-review job that fails before execution is repaired at the repository/runner/security-settings layer and rerun successfully; a missing test run is not treated as a passing test.

See `docs/production-readiness.md` for the complete release contract and `docs/production-runbook.md` for operational procedures.
