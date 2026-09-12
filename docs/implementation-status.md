# AgentPay Implementation Status

**Status:** current source capability inventory  
**Updated:** 2026-09-10

This inventory separates implemented source capability from environment-specific provider readiness. A module listed as implemented has application logic, persistence/API surface, or service code in this repository; it may still require credentials, account eligibility, funded identities, or external infrastructure before a particular deployment can execute real financial activity.

## Control plane

Implemented:

- Next.js/TypeScript dashboard and REST API;
- PostgreSQL/Prisma system of record plus forward migrations;
- authentication/session, OAuth/email/wallet-auth challenge flows;
- organizations, workspaces, memberships and server-side RBAC;
- agent lifecycle and scoped/revocable credentials;
- payment accounts and network/custody profiles;
- immutable policy versions and policy preview/publish flow;
- threshold approvals;
- spend reservations/idempotency;
- payment intents, attempts, settlements and transaction views;
- resources, providers, health, marketplace listings/reviews;
- invoices and settlement tracking;
- audit export, notifications/outbox, usage and support;
- organization retention, export, deletion and emergency stop;
- readiness/health and internal maintenance/reconciliation endpoints.

## Direct x402

Implemented x402 paid-resource flow includes resource challenge parsing, canonical URL validation, policy/trust evaluation, authorization/approval, managed or self-custody payment execution, settlement verification, and fulfillment persistence.

Network profiles implemented in source:

- Hedera Testnet;
- Hedera Mainnet;
- Arc Testnet;
- Cardano Preprod;
- Cardano Mainnet.

Actual execution remains profile/configuration dependent.

## Managed payment identities

Implemented invariant:

```text
(network, canonical payment identity) -> one PaymentAccount -> one agent
```

Managed identity modes:

- Hedera Testnet — per-agent Ed25519 test identity;
- Arc Testnet — per-agent secp256k1 test identity;
- Cardano Preprod — per-agent Ed25519 identity derived inside isolated signer;
- Cardano Mainnet — external per-agent Ed25519 identity when configured.

Self-custody paths are modeled separately.

## Hedera facilitator

Implemented:

- standalone Hedera facilitator service;
- supported Testnet/Mainnet environment profiles;
- x402/payment request validation and settlement path;
- service health/security validation and tests;
- rail-scoped infrastructure credentials.

## Arc facilitator

Implemented:

- standalone Arc facilitator service;
- Arc Testnet profile;
- EVM payment/settlement validation;
- security/environment validation and settlement-evidence tests.

Source support does not declare an unconfigured public Arc Mainnet profile.

## Cardano

Implemented:

- Preprod and Mainnet profiles;
- x402 V2 `exact`;
- ADA/lovelace and supported configured native-asset profile;
- canonical resource binding;
- bounded key-spend transaction construction;
- independent signed-CBOR verification;
- Blockfrost UTxO/protocol/submission/confirmation integration;
- durable settlement claims and replay controls;
- ambiguous-submission reconciliation;
- self-custody transaction preparation;
- Mainnet external per-agent custody support.

### Cardano signer

Preprod:

- isolated testnet-only derivation secret;
- per-Agent-ID Ed25519 derivation;
- `addr_test1...` identity;
- managed identity/signing and unsigned preparation.

Mainnet:

- unsigned self-custody preparation;
- external `/identity` and `/sign` custody adapter;
- local `addr1...` derivation from returned public key;
- signer-reference/public-key consistency validation;
- local returned-signature verification;
- no shared managed-agent master signing key.

The signer constructs/signs but does not submit.

### Cardano facilitator

Implemented independent checks include exact payer, payee, asset, amount, supported transaction profile, value conservation, payer change, fee, TTL, resource binding, nonce/replay state, settlement claim, submission and confirmation classification.

## Moove Receive

Implemented:

- provider client with server-only API key;
- create/list/retrieve payment-link support;
- production host restriction;
- organization credential/account binding;
- durable local payment-link state;
- idempotent client create semantics;
- ambiguous create recovery without blind POST retries;
- provider listing pagination/reconciliation;
- persisted destination/token/received-amount/transaction evidence;
- resource and invoice binding;
- exact invoice settlement checks;
- transactional completion events;
- REST API, TypeScript SDK, MCP and LangChain access;
- readiness/configuration contract and tests.

Moove payment completion is determined by provider evidence, not customer navigation/redirect state.

## Masumi

Implemented registry/trust features:

- agent/capability/network validation;
- seller payment identity evidence;
- freshness/online requirements;
- observed-history/reputation policy input.

Implemented escrow features:

- purchase creation and provider reconciliation;
- funds-locking lifecycle;
- result-hash verification;
- completion/refund/dispute state;
- refund authorization and mutation claims;
- incident/reconciliation handling;
- observed terminal outcomes for local seller reputation.

## Pyth

Implemented optional policy valuation:

- Hermes observation fetch;
- positive price/freshness/confidence validation;
- conservative USD-micro valuation;
- transaction/hour/day/month USD limits;
- fail-closed required observation behavior.

## Veridian/KERI

Implemented optional credential-verification integration validates configured issuer, schema, subject, freshness, revocation, and identity-binding evidence returned from the external verifier.

## Virtual cards

Implemented provider abstraction:

- Stripe and Sandbox adapters;
- cardholder creation;
- virtual-card issuance;
- provider card status changes;
- spending-limit/category/country controls;
- provider-authorized display-key flow;
- card authorization records and Stripe webhook signature verification.

Real card issuance requires an eligible/configured Stripe environment. Sandbox cards are development-only and do not expose usable card details.

## Fiat accounts and transfers

Implemented adapter surface:

- Stripe financial-account create/read;
- available/pending balance normalization;
- inbound/outbound transfer create/read;
- idempotent provider mutation requests;
- local transfer state/reconciliation support;
- Sandbox development adapter.

Provider availability depends on account and API capability.

## Cross-chain

Implemented control-plane surfaces include:

- network discovery;
- route quote persistence;
- transfer preparation;
- transfer submission;
- durable transfer status and source-verification data;
- ambiguity-safe automation/submission recovery primitives.

Real routes depend on configured provider/network support.

## Invoicing and commerce

Implemented:

- invoice lifecycle, items, sequences, events, settlement records;
- send/collect/pay/void API flows;
- provider/resource catalog;
- marketplace resources and reviews;
- paid resource fulfillment;
- optional Moove invoice/resource binding;
- optional Masumi/Veridian resource identity bindings.

## Automation

Implemented:

- automation rules;
- manual execution route;
- webhook trigger route;
- durable execution records/status;
- execution decisions;
- submission-recovery fields and operational state;
- integration with emergency-stop and financial authorization boundaries.

## Financial intelligence

Implemented application/data surfaces include:

- financial observation aggregates;
- summary endpoint;
- anomaly records and review/update flow;
- spend forecasts;
- budget recommendations and recommendation state.

These are advisory and do not independently authorize payments.

## Notifications, support, and organization operations

Implemented:

- notification endpoint registration and delivery records;
- durable outbox events;
- support cases/messages;
- usage and entitlement records;
- organization emergency stop;
- retention policy;
- bounded data export/stream/completion;
- deletion request lifecycle;
- internal maintenance/metrics/reconciliation endpoints.

## Dune analytics

Implemented checked-in Cardano analytics SQL and publishing helpers. Dune is read-only relative to AgentPay's financial authorization path.

## CI and security

Implemented repository gates include:

- workspace lint/typecheck/tests/build verification;
- Cardano signer tests;
- dependency/security scanning;
- npm audit and OSV analysis;
- Semgrep and Gitleaks;
- CodeQL;
- container builds;
- lockfile regeneration/checking;
- immutable release-evidence tooling.

## Deployment-dependent facts

The following must be verified from the target environment rather than inferred from source code:

- which provider/network profiles are enabled;
- funded production payment identities;
- valid external custody configuration;
- Moove, Stripe, Masumi, Pyth, KERIA, Blockfrost and analytics credentials;
- provider account eligibility/limits;
- exact deployed commit/migration state;
- live reconciliation/notification scheduling;
- real customer or transaction activity.

Use `/api/v1/ready`, service readiness checks, deployment configuration, and provider dashboards/evidence to establish those facts.
