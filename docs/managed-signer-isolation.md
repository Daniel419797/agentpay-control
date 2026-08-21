# Managed signer isolation

AgentPay treats every agent payment identity as an independent security principal. A shared facilitator or signer **service** is allowed; a shared agent wallet/private key is not.

## Security invariant

For every active `PaymentAccount`:

```text
(network, canonical account identity) -> exactly one AgentPay agent
```

EVM addresses are canonicalized to lowercase. Hedera account IDs and Cardano addresses retain their exact representation. The database enforces this globally with both a transaction-scoped PostgreSQL advisory-lock trigger and a unique canonical identity index. The migration refuses to install if pre-existing duplicate identities exist.

This means two requests on different dashboard instances, in different organizations, cannot successfully assign the same blockchain identity to two agents.

## Testnet managed identities

Managed autonomous custody is testnet-only in the current release.

- **Hedera Testnet**: the facilitator derives a unique Ed25519 key from `HEDERA_MANAGED_AGENT_MASTER_KEY` and the immutable Agent ID, creates a distinct Hedera account using that public key, and verifies the live account key before signing.
- **Arc Testnet**: the facilitator derives a unique secp256k1 key from `ARC_MANAGED_AGENT_MASTER_KEY` and the immutable Agent ID. The resulting EVM address is the agent's payer identity.
- **Cardano Preprod**: the Cardano signer derives a unique Ed25519 payment key from `CARDANO_MANAGED_AGENT_MASTER_KEY` and the immutable Agent ID. The resulting `addr_test...` address is the agent's payer identity.

The dashboard receives only public identity material (`accountId`, optional public key, and signer reference). It never receives these master secrets or derived private keys.

All three master keys must be exactly 32 random bytes encoded as 43-character unpadded base64url. They belong only in the relevant Render signer/facilitator service. They must not be set in Vercel.

## Infrastructure identities are not agent identities

A blockchain service can still require infrastructure credentials. Examples include a Hedera operator, a Hedera contract-execution payer, an Arc transaction relayer, or an Arc contract-execution account. Those roles are service principals and must remain separate from managed-agent identities.

No agent provisioning path is allowed to copy a deployment-wide payer ID/address into `PaymentAccount.accountId`.

The production legacy `/managed-sign` endpoints fail closed. Managed agent requests use `/managed-identity` during provisioning and `/managed-agent-sign` during payment, both bound to the immutable Agent ID and the expected payer identity.

## Mainnet policy

Deterministic managed-agent master keys are prohibited on mainnet.

Current mainnet behavior is:

- Hedera Mainnet: self custody.
- Cardano Mainnet: self custody / wallet confirmation; the signer gateway prepares unsigned transactions.
- Autonomous mainnet delegation: disabled until a separate per-agent HSM/KMS/delegation identity is provisioned and policy-bounded.

A future mainnet delegated signer must expose a unique key reference for every agent. It must never fall back to an operator-wide hot wallet.

## Funding

New managed testnet identities intentionally begin unfunded. Creating an agent does not move funds from an organization treasury or a shared operator wallet. Fund the specific agent address/account before using it.

Spend limits and reservations remain agent-scoped. A shared service treasury must not be inferred merely because agents use the same facilitator deployment.

## Existing managed agents

Managed agents created under the former shared-payer design are not automatically migrated. They must fail closed and be reprovisioned onto isolated identities. Do not rewrite their historical payer identity in place because historical settlement and audit evidence must remain attributable to the identity that actually signed it.

Before rollout, identify any `PaymentAccount` rows that share the same canonical network/account identity. The identity-isolation migration intentionally aborts if duplicates remain. Archive/reprovision those agents first, then re-run the migration.

## Deployment checklist

1. Generate three independent 32-byte testnet master keys for Hedera, Arc, and Cardano Preprod. Never reuse capability/API secrets as signer master keys.
2. Set the Hedera and Arc master keys only on the combined facilitator; set the Cardano master key only on the Cardano Preprod signer.
3. Do not set any managed-agent master key on the dashboard/Vercel or on a mainnet service.
4. Deploy the database migration and verify `PaymentAccount_network_canonical_accountId_key` and `PaymentAccount_identity_lock` exist.
5. Deploy signer/facilitator services before enabling new managed-agent provisioning.
6. Reprovision any legacy managed agents that used a shared payer.
7. Run CI, the concurrent identity-isolation verifier, service tests, container builds, and browser smoke tests before production promotion.
