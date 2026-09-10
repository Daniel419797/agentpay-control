# AgentPay Security Policy

AgentPay controls financial authorization, payment identities, provider credentials, settlement state, and autonomous-agent actions. Security issues affecting these boundaries should be reported privately and handled as potentially high impact until triaged.

## Supported version

Security fixes target the current `master` branch and the latest production release derived from it. Older unreleased revisions are not maintained as separate supported versions.

## Reporting a vulnerability

Do not open a public issue for suspected:

- authentication or session bypass;
- cross-tenant data access;
- role or approval bypass;
- agent credential leakage or scope escalation;
- payment-policy bypass;
- managed payment-identity collision;
- private-key, card, provider-key, custody, or secret exposure;
- forged provider webhook acceptance;
- SSRF or unsafe paid-resource fetching;
- replay, duplicate payment, or ambiguous-submission handling defects;
- settlement-evidence mismatch;
- supply-chain or deployment-secret exposure.

Use GitHub private vulnerability reporting/security advisories when available. Otherwise contact the repository owner privately and establish a secure reporting channel before sending sensitive evidence.

A useful report includes the affected route/service, attacker prerequisites, reproducible steps using non-production or low-value accounts, expected versus actual behavior, impact, and redacted logs/identifiers.

Never include live private keys, API keys, session cookies, card PAN/CVC, custody credentials, database passwords, webhook secrets, or unrestricted provider credentials in a public report.

## Security objectives

AgentPay is designed so an autonomous agent can request financial actions without receiving unrestricted authority over organization funds or payment infrastructure.

The system must prevent an agent or external dependency from:

- crossing organization boundaries;
- acting as another agent;
- bypassing published policy or required approvals;
- changing the authorized amount, asset, network, payee, or resource after approval;
- reusing one managed identity across multiple agents;
- forcing a duplicate payment after an uncertain provider/network response;
- turning provider request acceptance into false settlement;
- weakening required price, counterparty, credential, or chain evidence.

## High-value trust boundaries

### Next.js control plane

Holds organization, user, agent, policy, approval, payment, invoice, resource, audit, notification, automation, and reconciliation state. It must not contain blockchain payer private keys or Cardano Mainnet external-custody private keys.

### PostgreSQL

Authoritative application-state boundary. It enforces transaction consistency, tenant-owned relationships, idempotency records, settlement state, and canonical managed payment-identity uniqueness.

### Hedera / Arc / combined facilitators

Rail-specific verification and settlement services. They must accept only supported payment profiles and must not gain organization-policy authority beyond the execution contract given by the control plane.

### Cardano signer

Constructs bounded Cardano transactions and signs under the selected custody profile. Preprod may hold a test-only derivation secret. Mainnet may hold only the external custody API capability required to resolve/sign for exact agents. The signer never submits Cardano transactions on-chain.

### External Cardano Mainnet custody

Holds managed Mainnet private keys. AgentPay resolves a stable public key/signer reference per agent and sends only the exact transaction-body hash for signing. Returned signatures are verified locally.

### Moove

Moove creates hosted receive-payment links and reports settlement evidence. The Moove API credential is server-only and bound to one AgentPay organization because the configured Moove account controls the settlement destination. A payment link/redirect is not payment proof.

### Stripe card/fiat adapter

Stripe restricted credentials, cardholder/card mutations, financial-account operations, and provider webhooks are a separate provider boundary. AgentPay stores non-secret card/account identifiers and validates Stripe webhook signatures. Raw PAN/CVC is not persisted by AgentPay.

### Masumi, Pyth, Veridian/KERIA, Blockfrost, Dune

Each external system has a narrow authority:

- Pyth: price evidence for policy valuation;
- Masumi: registry/counterparty evidence and separate escrow lifecycle;
- Veridian/KERIA: credential-verification evidence;
- Blockfrost: Cardano chain data/submission/confirmation provider;
- Dune: read-only public analytics.

No external data source may silently become the organization policy engine.

### Resource URLs and agent clients

Agent inputs, MCP/LangChain requests, browser requests, x402 challenges, and paid-resource URLs are untrusted until authenticated, canonicalized, authorized, and validated.

## Managed payment-identity invariant

A shared service may serve many agents; a shared managed-agent payment identity may not.

```text
(network, canonical payment identity) -> one PaymentAccount -> one agent
```

Canonical normalization, database uniqueness, and transaction-scoped locking protect against concurrent duplicate claims.

## Financial side-effect safety

Financial operations must identify the irreversible boundary and persist state before/after it appropriately.

- Before submission: a verified pre-submission failure may be safely reported.
- After possible submission: preserve candidate identifiers, reservations, claims, and provider evidence; reconcile before retrying.
- After settlement: fulfillment/notification failure does not undo the payment.

Idempotency keys are not optional bookkeeping. They are part of duplicate-payment prevention.

## Webhook security

Provider webhooks must be verified before business state changes. Current Stripe handling validates the signed timestamp/signature with a bounded tolerance. Webhook bodies/signatures are treated as untrusted input until verification succeeds.

Scheduled/internal reconciliation endpoints use separate secrets/authorization and should not rely on browser cookies for background authority.

## Card and fiat security

- Use provider-issued restricted credentials with minimum capability.
- Do not persist or log raw PAN/CVC.
- Do not expose provider restricted keys to agents, browsers, SDK clients, MCP clients, or LangChain tools.
- Sandbox card/fiat behavior is development-only and must not be represented as real funds/card evidence.
- Provider acceptance and terminal transfer success are distinct states.

## Moove security

- Keep `MOOVE_API_KEY` server-side.
- Restrict production API traffic to the reviewed Moove API origin unless an explicit environment override is intentionally configured.
- Bind the account credential to the intended AgentPay organization.
- Do not blindly retry create-payment-link POST requests after an ambiguous response.
- Reconcile provider-visible links using the durable AgentPay marker.
- For invoice automation, verify exact configured settlement network, symbol, decimals, requested amount, and received amount before `PAID`.

## Cardano security

- `CARDANO_MANAGED_AGENT_MASTER_KEY` is testnet-only and prohibited on Mainnet.
- No deployment-wide Mainnet managed-agent payer/private key.
- External custody identity must remain stable per Agent ID.
- AgentPay derives the expected Cardano address locally from the returned public key.
- Only the exact transaction-body hash is submitted for external signing.
- Returned Ed25519 signatures are locally verified.
- The facilitator independently validates signed transaction CBOR before submission.
- Unsupported transaction complexity is rejected.
- Ambiguous Blockfrost submission is reconciled rather than blindly resubmitted.

## External resource security

Paid-resource fetching must defend against SSRF, redirects to disallowed targets, oversized/unbounded responses, malformed x402 requirements, resource-binding mismatch, and attempts to swap the authorized payee or amount.

## Supply-chain and release security

Production candidates should run the repository's applicable gates, including:

- lint, typecheck, unit/integration tests, and production builds;
- npm production dependency audit policy;
- OSV analysis;
- Semgrep;
- Gitleaks;
- CodeQL;
- Cardano signer tests;
- production service/container builds;
- migration and identity-isolation verification;
- release-evidence generation.

A failed or skipped execution is not equivalent to a passing security check.

## Incident response

If active compromise or incorrect financial behavior is suspected:

1. enable the organization kill switch or provider/network containment appropriate to the incident;
2. revoke/rotate affected agent, provider, signer, webhook, or custody credentials;
3. freeze affected cards/accounts or stop funding affected blockchain identities where applicable;
4. preserve audit, provider, database, and chain evidence;
5. reconcile every operation whose submission state is uncertain;
6. identify affected organizations, agents, payment identities, and external capabilities;
7. deploy a reviewed fix from an exact commit;
8. restore the affected profile only after readiness and low-value verification succeed.

See [`docs/threat-model.md`](docs/threat-model.md), [`docs/managed-signer-isolation.md`](docs/managed-signer-isolation.md), and [`docs/production-readiness.md`](docs/production-readiness.md).
