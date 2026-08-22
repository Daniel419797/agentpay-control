# AgentPay Control

**Documentation updated:** 2026-08-22  
**Primary builder / repository owner:** **Daniel Praise** (`Daniel419797`)

> **Why this README was updated:** AgentPay has moved beyond its original Hedera x402 bounty MVP. The current repository implements a multi-rail control plane, including Cardano Preprod per-agent managed signing and Cardano Mainnet self custody plus external per-agent Ed25519 custody. I synchronized the README and every Markdown document under `docs/` so the documentation describes what is actually implemented, clearly marks project provenance, and removes obsolete Mainnet self-custody-only assumptions.

## What AgentPay is

AgentPay is a policy-controlled payment operating system for autonomous software agents. It lets agents request and execute financial actions while organizations retain control over:

- spending policy;
- approvals;
- payment identity;
- custody/signing authority;
- counterparty trust;
- reservations/idempotency;
- settlement verification;
- reconciliation;
- audit and incidents;
- emergency controls.

The core principle is:

> **Give software agents bounded purchasing authority, not unrestricted wallets.**

## Project provenance

I am **Daniel Praise**, the person behind the GitHub account [`Daniel419797`](https://github.com/Daniel419797) and the primary technical contributor to this repository.

I originally built AgentPay for the **Hedera x402 bounty**. I later extended it into the current multi-rail AgentPay control plane, including the Cardano implementation described below. That prior Hedera program involvement is part of the project history and should be disclosed in any Catalyst submission. Previously completed Hedera work should not be represented as new Catalyst-funded delivery.

## Current architecture

```text
Human users / Autonomous agents
             |
             v
   AGENTPAY CONTROL PLANE
      Next.js / Vercel
 auth / orgs / RBAC / agents / credentials
 policy / approvals / reservations / audit
 resources / payments / incidents / reconciliation
             |
     +-------+--------------------------+
     |                                  |
 Direct x402                        Masumi escrow
     |                                  |
x402 Resource Server             Masumi Payment Service
     |                                  |
     +---------------+------------------+
                     |
          UNIFIED FACILITATOR — Render
  Hedera Testnet | Hedera Mainnet | Arc Testnet
       Cardano Preprod | Cardano Mainnet
                     |
          CARDANO SIGNER — Render
             Web Service Gateway
             /                 \
     Preprod worker          Mainnet worker
  per-agent test keys      self custody +
                           external per-agent custody
                                  |
                         External HSM/KMS/delegation
                         private keys stay external

Cardano signer -> Blockfrost: UTxOs/protocol data
Cardano facilitator -> Blockfrost: submit/confirm evidence
Blockfrost -> Cardano Preprod/Mainnet
Cardano -> reconciliation / optional Dune public analytics
```

## Repository structure

```text
agentpay-control/
├── dashboard/             Next.js control plane/API (Vercel)
│   ├── src/               UI, APIs, policy/payment/trust/reconciliation services
│   ├── prisma/            PostgreSQL schema and forward-only migrations
│   ├── packages/          SDK, MCP and LangChain integrations
│   └── e2e/               browser smoke tests
├── facilitator/           Hedera facilitator implementation
├── facilitator-arc/       Arc EVM facilitator implementation
├── facilitator-combined/  unified network dispatcher + Cardano facilitator
├── cardano-signer/        isolated Cardano transaction/signing gateway
├── resource-server/       x402-protected demonstration resource server
├── analytics/dune/        Cardano public analytics SQL/publishing support
├── docs/                  synchronized architecture/runbook/Catalyst docs
├── render.yaml            canonical two-service Render Blueprint
└── .github/workflows/     CI/security/signer validation workflows
```

## Supported network profiles

| Network | Role |
|---|---|
| Hedera Testnet | per-agent managed test identities + self-custody/test operation |
| Hedera Mainnet | current self-custody agent model; rail-specific infrastructure credentials are service principals |
| Arc Testnet | per-agent managed EVM identities + self custody |
| Cardano Preprod | x402 `exact`, ADA/configured native asset, per-agent managed Ed25519 signer + self custody |
| Cardano Mainnet | x402 `exact`, self custody + external per-agent Ed25519 custody; no shared managed-agent master key |

Arc public Mainnet is not declared as an enabled production profile without an actual reviewed supported public network.

## One agent = one payment identity

A facilitator/signer **service** may be shared infrastructure. A managed-agent wallet/private key may not be shared.

The database enforces:

```text
(network, canonical payment identity)
        -> one PaymentAccount
        -> one agent
```

Canonical uniqueness plus transaction-scoped advisory locking prevents concurrent agents/organizations/application replicas from safely claiming the same managed payment identity.

Current managed identity modes:

- Hedera Testnet: unique Ed25519 account per Agent ID;
- Arc Testnet: unique secp256k1 address per Agent ID;
- Cardano Preprod: unique Ed25519 `addr_test1...` identity derived inside the isolated signer;
- Cardano Mainnet: unique external Ed25519 public key/signer reference and locally derived `addr1...` address when managed custody is configured.

## Cardano Mainnet custody

Cardano Mainnet supports two separate modes.

### Self custody

AgentPay constructs the narrow unsigned transaction for the exact verified wallet. The wallet/provider signs outside AgentPay.

### External per-agent managed custody

The isolated Mainnet signer uses:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

The external provider must implement:

```text
POST /identity
POST /sign
```

Flow:

```text
immutable Agent ID
  -> external /identity
  -> publicKeyHex + signerRef
  -> AgentPay derives addr1... locally
  -> construct exact Cardano transaction
  -> hash transaction body
  -> external /sign exact signerRef
  -> Ed25519 signature returned
  -> AgentPay verifies signature locally
  -> signed CBOR returned to facilitator
  -> facilitator independently verifies
  -> facilitator submits via Blockfrost
  -> confirmation/reconciliation evidence
```

The private key never enters AgentPay.

`CARDANO_MANAGED_AGENT_MASTER_KEY` is **testnet-only and prohibited on Cardano Mainnet**. Mainnet has no deployment-wide autonomous-agent payer/master key.

## Cardano signer vs facilitator responsibilities

This distinction is intentional and security-relevant.

### Cardano signer

- resolves the exact per-agent signing identity;
- fetches UTxOs/protocol inputs required for construction;
- selects bounded inputs;
- calculates fee/TTL/change;
- constructs unsigned/signed CBOR;
- signs locally on Preprod or uses the external Mainnet per-agent signer;
- verifies returned external signatures;
- **does not submit Cardano transactions on-chain**.

### Cardano facilitator

- independently parses/verifies signed CBOR;
- verifies exact payer/payee/asset/amount;
- verifies allowed assets/conservation/change;
- verifies fee/TTL/resource binding/nonce;
- maintains durable settlement-claim/replay state;
- submits through Blockfrost `/tx/submit`;
- checks transaction/latest-block confirmation evidence;
- returns confirmed, rejected, pending or ambiguous settlement state.

## Cardano x402 safety profile

Cardano direct x402 uses V2 `exact` requirements with:

- exact CAIP-2 network;
- ADA as `lovelace` or one explicitly configured native asset;
- canonical resource SHA-256 binding;
- exact payer/payee/asset/amount;
- payer-only inputs and change;
- exact value/token conservation;
- bounded fee/TTL/input count;
- server submission and explicit confirmation policy.

The supported payment profile rejects unrelated complexity such as scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data and unrelated third-party assets/outputs.

## Ambiguous submissions

A timeout after possible submission does not automatically mean failure.

AgentPay preserves the candidate transaction/durable claim/reservation and reconciles independent chain evidence instead of blindly resubmitting.

```text
possible submission
  -> pending / SUBMISSION_UNKNOWN
  -> independent evidence
       -> confirmed => settled
       -> definitive rejection => resolved failure
       -> still uncertain => remain unresolved
```

## Policy controls

A published policy may constrain:

- per-transaction/hour/day/month atomic spend;
- `DENY` or `REQUIRE_APPROVAL` behavior;
- merchant/resource allow/deny rules;
- categories;
- approval/rejection thresholds;
- velocity/cooldown;
- activation/expiry/schedule windows;
- Pyth-valued USD limits;
- Masumi agent/capability/freshness requirements;
- minimum observed Masumi escrow history/reputation;
- optional KERI issuer/schema/freshness requirements.

Published versions are immutable; publishing a complete new version supersedes the old one.

## Pyth

Optional Pyth Hermes integration applies fresh/confidence-bounded conservative USD valuation to financial policy. Invalid/stale/uncertain required observations fail closed and cannot relax the underlying atomic policy.

## Masumi

Masumi is used in two intentionally separate ways:

1. **Registry/direct-payee trust:** verify expected agent/capability/seller payment facts before direct x402.
2. **Escrow:** separate purchase/job lifecycle with funds locking, result-hash verification, refunds/disputes and AgentPay-observed outcome history/reputation.

Direct x402 is never mislabeled as Masumi escrow.

## Veridian / KERI

Optional KERIA-backed verification may require trusted issuer/schema/identity/freshness evidence. AgentPay delegates KERI/ACDC cryptographic verification to the configured verifier and applies its own policy constraints around the verified result.

## Dune

Dune is public Cardano observability only. It cannot authorize, sign, submit or settle AgentPay payments. Public analytics must not expose private tenant identities, prompts, policy, credentials or private resource content.

## Deployment

Canonical topology:

```text
Vercel
  -> dashboard/API

Render
  -> agentpay-facilitator
  -> agentpay-cardano-signer

External
  -> PostgreSQL
  -> Blockfrost
  -> x402 resource providers
  -> optional Pyth / Masumi / KERIA / Dune
  -> optional Cardano Mainnet per-agent custody provider
```

See [`docs/unified-production-deployment.md`](docs/unified-production-deployment.md) and [`docs/production-runbook.md`](docs/production-runbook.md).

## Production/readiness truth

AgentPay has been deployed and personally exercised in supported environments. `production-readiness.md` does **not** mean the project has never been deployed/tested; it defines whether an exact release/network/custody/provider profile has completed the checks required for its intended production use.

Source support and external deployment facts remain separate. The repository cannot fabricate funded wallets, real external custody credentials, real provider accounts or pilot adoption.

## Catalyst status

For Catalyst I currently describe AgentPay as **TRL 5** until the intended Cardano Mainnet/pilot configuration is demonstrated in a relevant environment.

The current code implements Mainnet external per-agent custody, so the former technical limitation is resolved. I do not treat that code merge by itself as a TRL 6 demonstration.

Proposal-facing facts that must remain explicit:

- proposer/primary technical contributor: **Daniel Praise** (`Daniel419797`);
- prior program involvement: **Hedera x402 bounty**;
- previously completed Hedera work is prior work;
- pilot wallet/transaction/fee/adoption targets are proposal commitments, not repository achievements;
- observed results must come from actual external activity/evidence.

## Documentation status

Every Markdown document under `docs/` was reviewed/updated on **2026-08-22** for the current implementation.

The original July Hedera-focused requirements/design/screens/workflows remain available through Git history, but the checked-in versions now describe the current multi-rail implementation.

Key documents:

- [`docs/01-software-requirements-document.md`](docs/01-software-requirements-document.md) — current requirements
- [`docs/02-software-design-document.md`](docs/02-software-design-document.md) — current architecture/design
- [`docs/03-screens-and-dto-specification.md`](docs/03-screens-and-dto-specification.md) — current UI/API contracts
- [`docs/04-detailed-workflows.md`](docs/04-detailed-workflows.md) — current workflows
- [`docs/implementation-status.md`](docs/implementation-status.md) — implementation inventory
- [`docs/cardano-production.md`](docs/cardano-production.md) — Cardano production architecture
- [`docs/managed-signer-isolation.md`](docs/managed-signer-isolation.md) — identity/custody isolation
- [`docs/threat-model.md`](docs/threat-model.md) — current threat model
- [`docs/production-readiness.md`](docs/production-readiness.md) — release/profile readiness criteria
- [`docs/production-runbook.md`](docs/production-runbook.md) — operating procedure
- [`docs/unified-production-deployment.md`](docs/unified-production-deployment.md) — canonical deployment topology
- [`docs/ci-deployment.md`](docs/ci-deployment.md) — CI/promotion behavior
- [`docs/testing-script.md`](docs/testing-script.md) — current verification guide
- [`docs/demo-script.md`](docs/demo-script.md) — current product demo
- [`docs/catalyst-submission.md`](docs/catalyst-submission.md) and [`docs/catalyst/`](docs/catalyst/) — Catalyst-facing narrative/evidence material

## Local development

Typical local entry points:

```bash
# PostgreSQL
docker compose up -d

# Dashboard
cd dashboard
npm install
npm run dev -- -p 3100

# Combined facilitator
cd facilitator-combined
npm install
npm test
npm run dev

# Cardano signer
cd cardano-signer
node --test server.test.mjs

# Resource server
cd resource-server
npm install
npm test
npm run dev
```

Use service-specific `.env.example` files. Development fallbacks must not be treated as production custody architecture.

## Security

Report suspected vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Never place production private keys, managed-agent master keys, unrestricted provider credentials, card data, session secrets or HSM/custody credentials in GitHub issues, screenshots or public logs.

## License

MIT