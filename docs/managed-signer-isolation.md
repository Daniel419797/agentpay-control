# Managed signer isolation

AgentPay treats every agent payment identity as an independent security principal. A shared facilitator or signer **service** is allowed; a shared agent wallet/private key is not.

## Security invariant

For every active `PaymentAccount`:

```text
(network, canonical account identity) -> exactly one AgentPay agent
```

EVM addresses are canonicalized to lowercase. Hedera account IDs and Cardano addresses retain their exact representation. The database enforces this globally with both a transaction-scoped PostgreSQL advisory-lock trigger and a unique canonical identity index. The migration refuses to install if pre-existing duplicate identities exist.

This means two requests on different dashboard instances, in different organizations, cannot successfully assign the same blockchain identity to two agents.

## Managed identities

- **Hedera Testnet**: the facilitator derives a unique Ed25519 key from `HEDERA_MANAGED_AGENT_MASTER_KEY` and the immutable Agent ID, creates a distinct Hedera account using that public key, and verifies the live account key before signing.
- **Arc Testnet**: the facilitator derives a unique secp256k1 key from `ARC_MANAGED_AGENT_MASTER_KEY` and the immutable Agent ID. The resulting EVM address is the agent's payer identity.
- **Cardano Preprod**: the Cardano signer derives a unique Ed25519 payment key from `CARDANO_MANAGED_AGENT_MASTER_KEY` and the immutable Agent ID. The resulting `addr_test...` address is the agent's payer identity.
- **Cardano Mainnet**: the Cardano signer resolves a unique external Ed25519 public key and signer reference for the immutable Agent ID through the configured HSM/KMS/delegation custody adapter. AgentPay derives the `addr1...` address locally and sends only the transaction-body hash for signing.

The dashboard receives only public identity material (`accountId`, optional public key, and signer reference). It never receives master secrets, derived testnet private keys, or Mainnet external private keys.

Testnet master keys must be exactly 32 random bytes encoded as 43-character unpadded base64url. They belong only in the relevant Render signer/facilitator service. They must not be set in Vercel.

Cardano Mainnet deliberately does **not** use `CARDANO_MANAGED_AGENT_MASTER_KEY`. External Mainnet custody is configured with a signer-only URL and capability credential; the private key remains inside the external custody boundary.

## Infrastructure identities are not agent identities

A blockchain service can still require infrastructure credentials. Examples include a Hedera operator, a Hedera contract-execution payer, an Arc transaction relayer, or an Arc contract-execution account. Those roles are service principals and must remain separate from managed-agent identities.

No agent provisioning path is allowed to copy a deployment-wide payer ID/address into `PaymentAccount.accountId`.

The production legacy `/managed-sign` endpoints fail closed. Managed agent requests use `/managed-identity` during provisioning and `/managed-agent-sign` during payment, both bound to the immutable Agent ID and the expected payer identity.

## Mainnet policy

Deterministic managed-agent master keys remain prohibited on Mainnet.

Current behavior is:

- Hedera Mainnet: self custody.
- Cardano Mainnet self-custody: the signer gateway prepares unsigned transactions for the exact wallet.
- Cardano Mainnet autonomous managed custody: a distinct external Ed25519 signer identity is resolved for each immutable Agent ID; no deployment-wide private key or payer is accepted.

The Cardano custody adapter must expose a stable signer reference and public key for each agent. AgentPay derives the Cardano address from that public key and verifies every returned signature locally. The adapter must never fall back to an operator-wide hot wallet.

## Funding

New managed identities intentionally begin unfunded unless the external custody provider separately provisions funds. Creating an agent does not move funds from an organization treasury or a shared operator wallet. Fund the specific agent address/account before using it.

Spend limits and reservations remain agent-scoped. A shared service treasury must not be inferred merely because agents use the same facilitator deployment.

## Existing managed agents

Managed agents created under the former shared-payer design are not automatically migrated. They must fail closed and be reprovisioned onto isolated identities. Do not rewrite their historical payer identity in place because historical settlement and audit evidence must remain attributable to the identity that actually signed it.

Before rollout, identify any `PaymentAccount` rows that share the same canonical network/account identity. The identity-isolation migration intentionally aborts if duplicates remain. Archive/reprovision those agents first, then re-run the migration.

## Deployment checklist

1. Generate independent 32-byte testnet master keys for Hedera Testnet, Arc Testnet, and Cardano Preprod. Never reuse capability/API secrets as signer master keys.
2. Set the Hedera and Arc master keys only on the combined facilitator; set the Cardano Preprod master key only on the Cardano signer.
3. For Cardano Mainnet autonomous agents, configure `CARDANO_MAINNET_AGENT_CUSTODY_URL` and `CARDANO_MAINNET_AGENT_CUSTODY_API_KEY` on the unified signer, or the non-prefixed equivalents on a standalone Mainnet signer.
4. Do not set any managed-agent master key on the dashboard/Vercel or on a Mainnet service.
5. Verify the external Mainnet custody adapter returns a different stable Ed25519 public key/signer reference for different Agent IDs and never exposes private key material.
6. Deploy the database migration and verify `PaymentAccount_network_canonical_accountId_key` and `PaymentAccount_identity_lock` exist.
7. Deploy signer/facilitator services before enabling new managed-agent provisioning.
8. Reprovision any legacy managed agents that used a shared payer.
9. Run CI, the concurrent identity-isolation verifier, service tests, container builds, and browser smoke tests before production promotion.