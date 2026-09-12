# AgentPay Arc Facilitator

Network-specific facilitator for AgentPay's supported Arc EVM payment profile.

The current source profile targets Arc Testnet. The service handles rail-specific EVM payment validation/execution while AgentPay's control plane remains responsible for organizations, agents, policy, approvals, reservations, and audit.

## Responsibilities

- validate Arc network/RPC and security configuration;
- verify supported payer/payee/amount/asset/contract context;
- enforce the bounded contract/payment profile implemented by the service;
- submit/observe settlement according to the configured execution mode;
- return normalized evidence to the control plane;
- expose health/readiness and fail closed on invalid production configuration.

## Identity boundary

Managed Testnet agent addresses are per-agent. Relayer or contract-executor credentials are infrastructure service principals and are not AgentPay `PaymentAccount` identities.

## Deployment

Use `.env.example` for required configuration and deploy only the reviewed network profile. The existence of the adapter does not imply an unconfigured public production network.

See [`../docs/managed-signer-isolation.md`](../docs/managed-signer-isolation.md) and [`../docs/production-readiness.md`](../docs/production-readiness.md).
