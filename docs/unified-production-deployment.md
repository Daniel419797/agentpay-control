# Unified production deployment

This is the canonical AgentPay production topology.

```text
GitHub
   |
   +----------------------> Vercel
   |                         `-- AgentPay Next.js dashboard/API
   |
   `----------------------> Render Blueprint (render.yaml)
                             |-- agentpay-facilitator
                             |    |-- Hedera Testnet
                             |    |-- Hedera Mainnet
                             |    |-- Arc Testnet
                             |    |-- Cardano Preprod facilitator
                             |    `-- Cardano Mainnet facilitator
                             `-- agentpay-cardano-signer
                                  |-- Cardano Preprod worker
                                  `-- Cardano Mainnet worker
```

`render.yaml` is the production Render entrypoint. Older standalone Render YAML files are retained only for historical or isolated testing and are not the canonical production topology.

## Security boundaries

The two Render services are separate runtime trust boundaries even though one Blueprint deploys them together.

- `agentpay-facilitator` is the public x402/protocol boundary. It routes by exact CAIP network and has network-scoped capability credentials.
- `agentpay-cardano-signer` is the Cardano transaction/signing boundary. It runs independent Preprod and Mainnet workers behind `/preprod/*` and `/mainnet/*`.
- Cardano Preprod may derive one isolated testnet key/address per managed agent from `CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY`.
- Cardano Mainnet never receives that master key. Mainnet remains self-custody/unsigned-only.
- Hedera Testnet may use an isolated managed-agent master key. Hedera Mainnet does not.
- Arc managed identities are Testnet only. Do not invent an Arc Mainnet route before a public mainnet is actually available and separately reviewed.
- No managed-agent master key belongs in Vercel.
- Deployment-wide infrastructure payer/operator identities are never assigned as agent wallets.

## Public facilitator routes

The one facilitator origin exposes:

| Network | CAIP network | Route |
|---|---|---|
| Hedera Testnet | `hedera:testnet` | `/hedera/testnet` |
| Hedera Mainnet | `hedera:mainnet` | `/hedera/mainnet` |
| Arc Testnet | `eip155:5042002` | `/arc/testnet` |
| Cardano Preprod | `cardano:preprod` | `/cardano/preprod` |
| Cardano Mainnet | `cardano:mainnet` | `/cardano/mainnet` |

Root `/verify` and `/settle` inspect the x402 payload and requirement and dispatch only when both bind the same supported network. Root `/supported` aggregates every active child rail. `/health` reports loaded rails. `/ready` also requires the unified Cardano signer to be reachable.

## Cardano signer routes

The signer service exposes one public gateway and two network namespaces:

```text
/preprod/health
/preprod/managed-identity
/preprod/managed-agent-sign
/preprod/unsigned

/mainnet/health
/mainnet/unsigned
```

Mainnet managed-agent identity/signing is rejected. The gateway forwards only to fixed loopback workers; callers cannot select an arbitrary upstream.

## Render deployment

Create or update one Render Blueprint from repository root `render.yaml`.

The Blueprint creates exactly:

1. `agentpay-cardano-signer`
2. `agentpay-facilitator`

Populate every `sync: false` value before considering the deployment ready. Use different credentials for Testnet and Mainnet and different secrets for every capability.

Generate 32 random bytes as unpadded base64url when a managed-agent master key is required:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use different output for each master key. Never reuse a managed-agent master key as an API key, database encryption key, operator key or settlement credential.

### Required Cardano signer secrets

- `CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY`
- `CARDANO_PREPROD_BLOCKFROST_PROJECT_ID`
- `CARDANO_MAINNET_BLOCKFROST_PROJECT_ID`

The Blueprint generates separate Preprod/Mainnet signer API capabilities. Mainnet has no managed-agent master key.

### Required facilitator secrets

Hedera Testnet:

- operator ID/key/key type
- infrastructure payer ID/key/key type
- managed-agent master key

Hedera Mainnet:

- separate Mainnet operator ID/key/key type
- separate Mainnet infrastructure payer ID/key/key type
- no managed-agent master key

Arc Testnet:

- payer private key
- relayer private key
- contract-execution private key
- managed-agent master key
- provider address

All three Arc private keys must be distinct.

Cardano:

- `CARDANO_SETTLEMENT_STORE_URL` must be the production Vercel endpoint:
  `https://agentpay-zeta.vercel.app/api/v1/internal/cardano-settlement-claims`
- The Blueprint generates the durable settlement-store capability plus separate Preprod/Mainnet facilitator capabilities.

## Vercel configuration

Vercel hosts only the Next.js dashboard/API. Set:

```env
AGENTPAY_FACILITATOR_ORIGIN=https://<agentpay-facilitator>.onrender.com
```

Do not put Render signer master keys or blockchain private keys in Vercel.

Render-generated capability values must be copied into the matching Vercel variables because Render `fromService` references do not cross into Vercel:

| Vercel | Same value as Render |
|---|---|
| `FACILITATOR_SIGNING_API_KEY` | `HEDERA_TESTNET_MANAGED_SIGNING_API_KEY` |
| `FACILITATOR_SETTLEMENT_API_KEY` | `HEDERA_TESTNET_SETTLEMENT_API_KEY` |
| `FACILITATOR_CONTRACT_API_KEY` | `HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY` |
| `HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY` | `HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY` |
| `ARC_FACILITATOR_SIGNING_API_KEY` | `ARC_TESTNET_MANAGED_SIGNING_API_KEY` |
| `ARC_FACILITATOR_SETTLEMENT_API_KEY` | `ARC_TESTNET_SETTLEMENT_API_KEY` |
| `ARC_FACILITATOR_CONTRACT_API_KEY` | `ARC_TESTNET_CONTRACT_EXECUTION_API_KEY` |
| `CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY` | `CARDANO_PREPROD_MANAGED_SIGNING_API_KEY` |
| `CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY` | `CARDANO_PREPROD_SETTLEMENT_API_KEY` |
| `CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY` | `CARDANO_MAINNET_MANAGED_SIGNING_API_KEY` (prepare capability only) |
| `CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY` | `CARDANO_MAINNET_SETTLEMENT_API_KEY` |
| `CARDANO_SETTLEMENT_STORE_API_KEY` | `CARDANO_SETTLEMENT_STORE_API_KEY` |

Vercel still needs its own network-reading configuration where the control plane directly verifies balances/evidence, including Cardano Blockfrost IDs and platform provider addresses.

## Mainnet custody rules

Production support does not mean unrestricted platform custody.

- Hedera Mainnet agents: self-custody. The facilitator's operator/payer keys are infrastructure identities, not agent wallets.
- Cardano Mainnet agents: self-custody/unsigned transaction preparation. No deterministic managed-agent master key, no deployment-wide agent payer.
- Arc: current implementation is Testnet only until a public Mainnet exists and undergoes its own chain/asset/canary review.

## Migration from old multi-service deployment

1. Keep the existing production deployment serving traffic.
2. Sync `render.yaml` into the target Render account and populate all required `sync: false` values.
3. Verify `agentpay-cardano-signer/health` reports both `cardano:preprod` and `cardano:mainnet` healthy.
4. Verify `agentpay-facilitator/health`, `/supported`, and `/ready`.
5. Set `AGENTPAY_FACILITATOR_ORIGIN` and matching capabilities in Vercel Production.
6. Redeploy Vercel from the exact verified Git SHA.
7. Test managed-agent provisioning and a low-value payment on Hedera Testnet, Arc Testnet and Cardano Preprod.
8. Test low-value self-custody Mainnet flows separately. Never use Testnet funds/keys/configuration as Mainnet evidence.
9. Confirm `/api/v1/ready`, chain explorers/providers and settlement records agree.
10. Only then retire old per-network Render services.

Do not delete old services first. The migration must be reversible until the new two-service topology has produced real settlement evidence.

## Release verification

`scripts/ci/verify-unified-topology.sh` is the executable topology check. It runs signer syntax/tests and typecheck/tests/build for Hedera, Arc and the combined facilitator. The Vercel dashboard build runs this script as `prebuild`, so a frontend release cannot compile successfully while the checked-in backend topology is type-invalid or its unit tests fail.

A production release still requires external evidence that source-level tests cannot manufacture: valid production credentials, funded canaries, live provider/network access, database migration state, monitoring, backups/restore evidence and chain settlement evidence.
