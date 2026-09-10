# AgentPay Hedera Facilitator

Network-specific facilitator for AgentPay's Hedera payment/x402 execution profile.

The service is responsible for Hedera protocol and settlement validation. Organization tenancy, agent authentication, published policy, approvals, reservations, and product/business state remain in the AgentPay control plane.

## Responsibilities

- validate supported Hedera environment/network configuration;
- verify supported payment requirements/payloads;
- execute or observe the configured Hedera settlement path;
- return normalized settlement evidence to AgentPay;
- expose service health/readiness behavior;
- fail closed when required network credentials/configuration are invalid.

## Identity boundary

Infrastructure operator/fee-payer credentials are service principals. They must not be represented as autonomous agent wallets. Managed test identities must remain isolated per agent according to AgentPay's payment-identity invariant.

## Development

Use the service `.env.example` as the configuration contract. From the repository root, the workspace participates in the unified CI typecheck/test/build pipeline.

Never commit live Hedera keys or other provider secrets.

See [`../docs/managed-signer-isolation.md`](../docs/managed-signer-isolation.md) and [`../docs/production-readiness.md`](../docs/production-readiness.md).
