# AgentPay Documentation

This directory contains the engineering and operating documentation for AgentPay. The documentation is organized by responsibility so product behavior, security boundaries, payment-rail behavior, and deployment procedures can be reviewed independently.

## Product and system specification

- [`01-software-requirements-document.md`](01-software-requirements-document.md) — functional, security, reliability, and operational requirements.
- [`02-software-design-document.md`](02-software-design-document.md) — system architecture, trust boundaries, data domains, and execution model.
- [`03-screens-and-dto-specification.md`](03-screens-and-dto-specification.md) — application surfaces, API groups, state conventions, and agent-facing contracts.
- [`04-detailed-workflows.md`](04-detailed-workflows.md) — end-to-end operational workflows for provisioning, payments, approvals, cards, fiat, invoicing, automation, and reconciliation.
- [`implementation-status.md`](implementation-status.md) — source capability inventory and deployment-dependent boundaries.

## Payment rails and custody

- [`cardano-production.md`](cardano-production.md) — Cardano Preprod/Mainnet profiles, signer/facilitator separation, self custody, external custody, and settlement rules.
- [`managed-signer-isolation.md`](managed-signer-isolation.md) — managed payment-identity isolation across supported networks.
- [`moove-receive.md`](moove-receive.md) — Moove Receive payment-link integration, idempotency, evidence, invoice/resource binding, and reconciliation.
- [`../cardano-signer/README.md`](../cardano-signer/README.md) — isolated Cardano signer service.
- [`../facilitator/README.md`](../facilitator/README.md) — Hedera facilitator service.
- [`../facilitator-arc/README.md`](../facilitator-arc/README.md) — Arc facilitator service.
- [`../facilitator-combined/README.md`](../facilitator-combined/README.md) — unified network dispatcher and Cardano facilitator.
- [`../resource-server/README.md`](../resource-server/README.md) — x402-protected resource server.

## Security and trust

- [`../SECURITY.md`](../SECURITY.md) — vulnerability reporting and top-level security policy.
- [`threat-model.md`](threat-model.md) — assets, actors, threats, controls, and residual-risk boundaries.
- [`managed-signer-isolation.md`](managed-signer-isolation.md) — payment identity and custody isolation.
- [`production-readiness.md`](production-readiness.md) — release criteria for financial functionality.

The security model also covers Pyth price evidence, Masumi registry/escrow evidence, optional Veridian/KERIA verification, provider webhook verification, SSRF-safe resource access, rate limiting, supply-chain checks, and fail-closed external dependencies.

## Operations and release

- [`production-readiness.md`](production-readiness.md) — release acceptance criteria.
- [`production-runbook.md`](production-runbook.md) — deploy, migrate, verify, reconcile, recover, and rollback procedures.
- [`unified-production-deployment.md`](unified-production-deployment.md) — Vercel, PostgreSQL, Render, and external service topology.
- [`ci-deployment.md`](ci-deployment.md) — CI/security/release gates and artifact expectations.
- [`testing-script.md`](testing-script.md) — local, CI, integration, and production smoke verification.
- [`demo-script.md`](demo-script.md) — product walkthrough for operators, customers, and technical evaluators.
- [`design-qa.md`](design-qa.md) — product UI and accessibility QA guidance.

## Agent and developer integrations

- [`../dashboard/packages/sdk/README.md`](../dashboard/packages/sdk/README.md) — TypeScript SDK.
- [`../dashboard/packages/mcp/README.md`](../dashboard/packages/mcp/README.md) — MCP bridge and hosted MCP tools.
- [`../dashboard/packages/langchain/README.md`](../dashboard/packages/langchain/README.md) — LangChain-compatible AgentPay tools.
- [`../dashboard/integrations/agentpay-control/SKILL.md`](../dashboard/integrations/agentpay-control/SKILL.md) — agent integration skill and operating rules.

All agent adapters are thin clients over the same control plane. Policy, approvals, custody, settlement, reconciliation, and organization controls remain server-side.

## Analytics

- [`../analytics/dune/README.md`](../analytics/dune/README.md) — read-only public Cardano analytics integration. Dune is not an authorization or settlement authority.

## Documentation principles

AgentPay documentation follows four rules:

1. **Implemented source capability and configured deployment capability are different facts.** Provider-backed features are documented as available only when their required environment and account configuration is present.
2. **Financial completion requires evidence.** Provider redirects, successful request submission, and optimistic UI state are not settlement proof.
3. **Secrets stay out of documentation.** Examples use placeholders and never include production private keys, API keys, cookies, card data, or custody credentials.
4. **Rail-specific behavior is explicit.** A Hedera, Arc, Cardano, Moove, Masumi, card, fiat, or cross-chain operation may have different custody, submission, and evidence rules.

## Maintenance

When product behavior changes, update the relevant system specification, implementation inventory, operational runbook, and component README in the same change. Record material documentation changes in [`CHANGELOG-DOCS.md`](CHANGELOG-DOCS.md).
