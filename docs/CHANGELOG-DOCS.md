# AgentPay Documentation Changelog

## 2026-09-10 — Full product documentation synchronization

The active documentation set was synchronized with the current AgentPay source and product architecture.

### Product coverage

Documentation now describes the complete control-plane surface, including:

- organizations, workspaces, RBAC, agents and scoped credentials;
- immutable policies, approvals, reservations and emergency controls;
- direct x402 payment flows across the implemented network profiles;
- Cardano signer/facilitator and Mainnet custody boundaries;
- Moove Receive payment links and reconciliation;
- Masumi registry/trust and escrow workflows;
- Pyth and Veridian/KERI trust evidence;
- cards, cardholders and provider authorization handling;
- fiat accounts/transfers;
- cross-chain quote/prepare/submit orchestration;
- resources, providers, marketplace, invoicing and fulfillment;
- automation rules/executions;
- financial intelligence;
- audit, notifications, support, retention, export, deletion and operational readiness.

### Developer documentation

Added or expanded documentation for:

- TypeScript SDK;
- MCP bridge/tools;
- LangChain tools;
- AgentPay agent-integration skill;
- Hedera, Arc and combined facilitator services;
- Cardano signer;
- x402 resource server;
- Dune analytics.

### Operations and security

Production-readiness, deployment, testing, runbook, threat-model, identity-isolation, and CI documentation were aligned around the same principles:

- source capability is distinct from deployment readiness;
- financial completion requires validated evidence;
- ambiguous submissions are reconciled rather than blindly retried;
- secrets are scoped to the service that requires them;
- managed payment identities are isolated per agent where applicable;
- provider-dependent capabilities fail closed when required configuration is missing.

### Documentation structure

The documentation index now points only to active product, engineering, security, integration, and operations material. Superseded proposal/pitch documents are no longer part of the active documentation tree.

## Maintenance rule

Material product changes should update the relevant specification, implementation inventory, operating guide, and component README in the same pull request. This changelog should record documentation changes that alter the documented public capability or security/operations contract.
