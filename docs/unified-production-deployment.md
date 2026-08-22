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
                                       `-- external per-agent custody adapter
```

`render.yaml` is the production Render entrypoint. Older standalone Render YAML files are retained for isolated deployment/testing where applicable.

## Security boundaries

The two Render services are separate runtime trust boundaries even though one Blueprint deploys them together.

- `agentpay-facilitator` is the public x402/protocol boundary. It routes by exact CAIP network and has network-scoped capability credentials.
- `agentpay-cardano-signer` is the Cardano transaction/signing boundary. It runs independent Preprod and Mainnet workers behind `/preprod/*` and `/mainnet/*`.
- Cardano Preprod may derive one isolated testnet key/address per managed agent from `CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY`.
- Cardano Mainnet never receives that master key. It supports unsigned self-custody plus per-agent external custody through `CARDANO_MAINNET_AGENT_CUSTODY_URL` and `CARDANO_MAINNET_AGENT_CUSTODY_API_KEY`.
- The external Mainnet custody adapter owns/delegates a distinct Ed25519 key for each immutable Agent ID. AgentPay receives only public identity material and signatures.
- Hedera Testnet may use an isolated managed-agent master key. Hedera Mainnet does not.
- Arc managed identities are Testnet only. Do not invent an Arc Mainnet route before a public mainnet is actually available and separately reviewed.
- No managed-agent master key or external custody credential belongs in Vercel.
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
/mainnet/managed-identity
/mainnet/managed-agent-sign
/mainnet/unsigned
```

The gateway forwards only to fixed loopback workers; callers cannot select an arbitrary upstream. Mainnet managed routes fail closed if the external custody adapter is not configured or unavailable.

## Render deployment

Create or update one Render Blueprint from repository root `render.yaml`.

The Blueprint creates exactly:

1. `agentpay-cardano-signer`
2. `agentpay-facilitator`

Populate every required `sync: false` value for the profile being operated. Use different credentials for Testnet and Mainnet and different secrets for every capability.

Generate 32 random bytes as unpadded base64url when a **testnet** managed-agent master key is required:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use different output for each master key. Never reuse a managed-agent master key as an API key, database encryption key, operator key or settlement credential. Do not create a Cardano Mainnet managed-agent master key.

### Required Cardano signer secrets

For Preprod managed agents:

- `CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY`
- `CARDANO_PREPROD_BLOCKFROST_PROJECT_ID`

For Mainnet:

- `CARDANO_MAINNET_BLOCKFROST_PROJECT_ID`
- `CARDANO_MAINNET_AGENT_CUSTODY_URL` and `CARDANO_MAINNET_AGENT_CUSTODY_API_KEY` when autonomous managed agents are enabled

The Blueprint generates separate Preprod/Mainnet signer API capabilities. Mainnet has no managed-agent master key.

### Mainnet custody adapter contract

The configured adapter must support:

- `POST /identity` — resolve a stable `publicKeyHex` and `signerRef` for the immutable Agent ID.
- `POST /sign` — sign the supplied 32-byte Cardano transaction-body hash for that exact signer reference.

AgentPay derives the Cardano `addr1...` address locally from the returned public key and verifies the returned Ed25519 signature locally. The adapter must not return or expose private key material.

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

- `CARDANO_SETTLEMENT_STORE_URL` must be the production Vercel settlement-claim endpoint.
- The Blueprint generates the durable settlement-store capability plus separate Preprod/Mainnet facilitator capabilities.

## Vercel configuration

Vercel hosts only the Next.js dashboard/API. Set:

```env
AGENTPAY_FACILITATOR_ORIGIN=https://<agentpay-facilitator>.onrender.com
```

Do not put Render signer master keys, Cardano Mainnet custody API credentials or blockchain private keys in Vercel.

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
| `CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY` | `CARDANO_MAINNET_MANAGED_SIGNING_API_KEY` |
| `CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY` | `CARDANO_MAINNET_SETTLEMENT_API_KEY` |
| `CARDANO_SETTLEMENT_STORE_API_KEY` | `CARDANO_SETTLEMENT_STORE_API_KEY` |

The Mainnet external custody API key is **not** copied to Vercel or the facilitator.

## Mainnet custody rules

Production support does not mean unrestricted platform custody.

- Hedera Mainnet agents: self-custody. The facilitator's operator/payer keys are infrastructure identities, not agent wallets.
- Cardano Mainnet self-custody: unsigned transaction preparation for the exact verified wallet.
- Cardano Mainnet autonomous managed custody: a unique external Ed25519 signer identity per immutable Agent ID, with local address derivation/signature verification and no shared AgentPay Mainnet key.
- Arc: current implementation is Testnet only until a public Mainnet exists and undergoes its own chain/asset review.

## Migration from old multi-service deployment

1. Keep the existing production deployment serving traffic.
2. Sync `render.yaml` into the target Render account and populate the required values for the selected profile.
3. Verify `agentpay-cardano-signer/health` reports both `cardano:preprod` and `cardano:mainnet` healthy.
4. When Mainnet managed custody is enabled, verify Mainnet health reports `external-per-agent` managed identity support.
5. Verify `agentpay-facilitator/health`, `/supported`, and `/ready`.
6. Set `AGENTPAY_FACILITATOR_ORIGIN` and matching capabilities in Vercel Production.
7. Redeploy Vercel from the exact verified Git SHA.
8. Test managed-agent provisioning/payment on the enabled networks. For Cardano Mainnet, verify two different Agent IDs resolve to distinct addresses and execute only low-value funded tests.
9. Confirm `/api/v1/ready`, chain providers and settlement records agree.
10. Retire old per-network Render services only after the new topology is verified.

## Release verification

`scripts/ci/verify-unified-topology.sh` is the executable topology check. It runs signer syntax/tests and typecheck/tests/build for Hedera, Arc and the combined facilitator. The Vercel dashboard build runs this script as `prebuild`, so a frontend release cannot compile successfully while the checked-in backend topology is type-invalid or its unit tests fail.

Source-level tests cannot supply external custody credentials, funded wallets or network/provider access; those are deployment inputs for the production profile being operated.