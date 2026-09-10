# AgentPay

AgentPay is a policy-controlled financial operating system for autonomous software agents. It gives software agents practical payment and commerce capabilities while keeping organizations in control of identity, budgets, approvals, custody, settlement, auditability, and emergency response.

The platform is designed around a simple operating model: an agent may request a financial action, but AgentPay decides whether that action is permitted, how it should be executed, which identity or provider may execute it, and what evidence is required before the action is treated as complete.

## What AgentPay provides

AgentPay combines a control plane, payment execution layer, agent interfaces, operational tooling, and multiple provider/network integrations.

### Agent and organization control

- multi-tenant organizations, workspaces, members, and server-side RBAC;
- autonomous agents with stable identities and enable/disable state;
- scoped, revocable, expirable agent credentials;
- per-agent payment accounts and custody configuration;
- organization-level kill switch and defensive maintenance operations;
- organization data export, retention, and deletion workflows;
- entitlements, usage tracking, support cases, and notification endpoints.

### Policy and approvals

- immutable published policy versions;
- per-transaction, hourly, daily, and monthly spend controls;
- asset, network, merchant, resource, category, schedule, velocity, and cooldown constraints;
- configurable `DENY` or `REQUIRE_APPROVAL` decisions;
- threshold approvals and separation-of-duties controls;
- spend reservations and idempotency to prevent policy races and duplicate side effects;
- optional Pyth-based conservative USD valuation for policy enforcement;
- optional trust requirements backed by Masumi and Veridian/KERI evidence.

### Payments and commerce

- direct x402 paid-resource requests;
- Hedera Testnet and Mainnet payment profiles;
- Arc Testnet payment profile;
- Cardano Preprod and Mainnet x402 payment profiles;
- Moove Receive hosted payment links with durable reconciliation;
- Masumi registry verification and escrow-backed purchase lifecycle;
- invoices and invoice settlement tracking;
- resource-provider catalog and marketplace listings/reviews;
- payment intents, payment attempts, settlements, and transaction history;
- provider-backed virtual-card, cardholder, and fiat-account/transfer surfaces when configured;
- cross-chain quote, preparation, and transfer orchestration surfaces when configured;
- automation rules and execution/decision workflows.

### Operations and intelligence

- reconciliation for pending and ambiguous financial operations;
- tamper-evident audit events and export;
- incident-oriented operational controls;
- financial observations, forecasts, anomalies, and budget recommendations;
- outbox-backed notification delivery;
- readiness and health endpoints;
- public-chain analytics support through Dune without making Dune part of the authorization path.

## Architecture

```text
Humans / Applications / Autonomous agents
                  |
                  v
        AGENTPAY CONTROL PLANE
        Next.js + TypeScript
        Vercel + PostgreSQL
                  |
     +------------+-------------+
     |            |             |
 identity      policy        operations
 RBAC          approvals     audit
 credentials   reservations  reconciliation
 workspaces    limits        notifications
     |            |             |
     +------------+-------------+
                  |
          EXECUTION / RAIL LAYER
                  |
   +--------------+---------------+----------------+
   |              |               |                |
 direct x402   Moove Receive    Masumi          Provider adapters
   |              |            trust/escrow      cards / fiat /
   |              |                              cross-chain
   v              v
 Unified       Moove API
 facilitator
   |
   +----------------------+----------------------+----------------+
   |                      |                      |
 Hedera                 Arc                  Cardano
 Testnet/Mainnet        Testnet              Preprod/Mainnet
                                                |
                                      isolated Cardano signer
                                      + external Mainnet custody
```

The control plane does not treat a provider response, browser redirect, or submission attempt as sufficient evidence of settlement. Financial state advances only when the evidence required for that rail has been validated.

## Supported payment profiles

| Capability | Current implementation |
| --- | --- |
| Hedera | Testnet and Mainnet x402/payment execution profiles |
| Arc | Testnet x402/payment execution profile |
| Cardano | Preprod and Mainnet x402 `exact`, self-custody support, and managed signing profiles described below |
| Moove Receive | Create, list/reconcile, and retrieve hosted payment links; persisted provider settlement evidence |
| Masumi | Registry-based counterparty verification plus separate escrow purchase/refund/reconciliation workflows |
| Virtual cards / fiat | Stripe-backed adapter plus sandbox implementation; availability depends on provider configuration and account eligibility |
| Cross-chain | Quote/prepare/submit orchestration surface; execution depends on enabled provider/network configuration |

A source capability and a configured production capability are intentionally distinguished. Readiness checks and environment contracts determine what a specific deployment may execute.

## Payment identity and custody

For managed blockchain accounts, AgentPay enforces the invariant:

```text
(network, canonical payment identity)
        -> exactly one PaymentAccount
        -> exactly one agent
```

A shared service process is acceptable; a shared managed-agent wallet is not.

Current managed identity models include:

- **Hedera Testnet:** per-agent Ed25519 test identity;
- **Arc Testnet:** per-agent secp256k1 test identity;
- **Cardano Preprod:** per-agent Ed25519 identity derived inside the isolated signer;
- **Cardano Mainnet:** self custody or external per-agent Ed25519 custody.

For Cardano Mainnet external custody, private keys remain outside the ordinary AgentPay application environment. The signer resolves the exact agent identity, derives the expected Cardano address from the returned public key, submits only the transaction-body hash to the custody service for signing, and verifies the returned Ed25519 signature locally.

## Cardano execution boundary

The Cardano signer and facilitator intentionally have different responsibilities.

**Signer:** resolves the payment identity, fetches bounded transaction inputs, constructs the narrow supported transaction, signs when the selected custody mode permits it, and returns transaction CBOR. It does not submit transactions on-chain.

**Facilitator:** independently parses and validates the signed transaction, verifies exact payer/payee/asset/amount, conservation, change, fee, TTL, nonce and resource binding, creates durable settlement claims, submits through Blockfrost, and verifies confirmation evidence.

A submission timeout is not treated as a clean failure. AgentPay preserves the candidate transaction and reconciles chain evidence before another financial side effect is allowed.

## Moove Receive

Moove Receive provides a hosted payment-link rail for agents, resources, and invoices.

AgentPay implements the live payment-link surface with:

- server-side API-key handling and production host restrictions;
- one Moove credential/account binding per AgentPay organization;
- durable local idempotency;
- no blind retry of ambiguous create requests;
- recovery of ambiguous creates through durable markers and provider listing reconciliation;
- persisted payment-link lifecycle and settlement evidence;
- polling/reconciliation rather than assuming a return URL means payment;
- exact destination token/network/decimals/amount checks before linked invoice automation can mark an invoice paid;
- REST, TypeScript SDK, MCP, and LangChain access.

See [`docs/moove-receive.md`](docs/moove-receive.md).

## Cards and fiat

AgentPay includes provider-neutral card and fiat account abstractions with a Stripe implementation and a local sandbox implementation. The Stripe path supports cardholder creation, virtual card issuance/status controls, card display-key creation, financial accounts, inbound/outbound money movement, provider reads, and signed Stripe webhook handling.

These capabilities are gated by configuration, provider eligibility, entitlements, and the same AgentPay organization/security controls used elsewhere. The sandbox adapter is for development and does not expose real card details or move real funds.

## Invoicing, resources, and marketplace

Organizations can model chargeable resources and services through providers, resource listings, prices, invoices, and settlement records. The platform supports:

- provider/resource registration and verification;
- resource pricing and marketplace listings;
- marketplace reviews;
- invoice creation, sending, collection, payment tracking, and voiding;
- resource fulfillment linked to successful payment evidence;
- Moove payment links bound to a resource or invoice;
- x402-protected resources with canonical URL and payment-requirement validation.

## Automation and financial intelligence

Automation rules can create controlled execution workflows with durable execution state and explicit decisions. Automation does not bypass financial policy: payment authorization, provider readiness, idempotency, and emergency controls remain authoritative.

The intelligence module derives operational views from AgentPay financial observations, including forecasts, anomaly records, summaries, and budget recommendations. Intelligence is advisory; it does not independently grant payment authority.

## Agent interfaces

AgentPay can be used by normal applications and AI-agent runtimes through:

- authenticated REST APIs;
- the TypeScript client in `dashboard/packages/sdk`;
- MCP through `dashboard/packages/mcp` and the hosted per-agent MCP endpoint;
- LangChain-compatible tools in `dashboard/packages/langchain`;
- the local AgentPay skill under `dashboard/integrations/agentpay-control`.

The agent-facing layers delegate policy, approvals, custody, settlement, and reconciliation to the control plane. They never need an underlying blockchain private key.

## Repository structure

```text
agentpay-control/
├── dashboard/                Next.js control plane, API and product UI
│   ├── src/                  routes, domain services, security and integrations
│   ├── prisma/               PostgreSQL schema and forward migrations
│   ├── packages/sdk/         TypeScript client
│   ├── packages/mcp/         MCP bridge
│   └── packages/langchain/   LangChain-compatible tools
├── facilitator/              Hedera facilitator
├── facilitator-arc/          Arc facilitator
├── facilitator-combined/     unified rail dispatcher and Cardano facilitator
├── cardano-signer/           isolated Cardano construction/signing gateway
├── resource-server/          x402-protected resource server
├── analytics/dune/           read-only Cardano public analytics assets
├── docs/                     product, architecture, security and operations docs
├── scripts/ci/               verification, security and release gates
└── render*.yaml              deployment blueprints/profiles
```

## Development

The repository is an npm workspace and pins its supported Node/npm range in `package.json`.

```bash
npm install
npm run verify
```

The dashboard can be run from its workspace:

```bash
npm run dev --workspace=agentpay-control
```

Copy the relevant `.env.example` files and configure only the providers/networks needed for the environment. Never commit live credentials.

Database changes use forward Prisma migrations. Production environments should run migration deployment before promoting application code that depends on the new schema.

## Deployment model

The canonical production topology separates the control plane from payment/signing services:

- **Vercel:** Next.js dashboard and API;
- **PostgreSQL:** system of record for organization, policy, payment and evidence state;
- **Render:** facilitator and Cardano signer services;
- **external systems:** network RPC/data providers, custody, Moove, Stripe, Masumi, Pyth, KERIA, Dune, and other configured providers.

Every production profile should pass environment validation, migrations, readiness checks, tests, security gates, container builds, and a controlled canary before handling material value.

## Security

AgentPay is designed to minimize the authority held by any single layer. Important controls include tenant isolation, scoped credentials, immutable policy versions, approval separation, reservations, idempotency, canonical identity uniqueness, SSRF-safe external-resource handling, fail-closed trust checks, signer/facilitator separation, exact settlement validation, audit evidence, emergency stop, and reconciliation of ambiguous side effects.

See [`SECURITY.md`](SECURITY.md) and [`docs/threat-model.md`](docs/threat-model.md).

## Documentation

Start with [`docs/README.md`](docs/README.md). The documentation set includes product requirements, system design, API/UI contracts, end-to-end workflows, payment-rail details, threat model, production readiness, deployment, testing, and component-specific guides.

## License

MIT. See [`LICENSE`](LICENSE).
