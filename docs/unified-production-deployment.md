# AgentPay Unified Production Deployment

**Status:** Current canonical deployment topology  
**Updated:** 2026-08-22

## Revision note

The production topology includes Cardano Mainnet external per-agent custody behind the isolated signer. This guide reflects `render.yaml`, the combined facilitator and the unified Cardano signer so secret placement and service responsibilities match the code.

## Canonical deployment

```text
GitHub release
   |
   |-- Vercel
   |    `-- AgentPay Next.js dashboard/API
   |
   `-- Render Blueprint
        |-- agentpay-facilitator
        `-- agentpay-cardano-signer
             |-- Preprod worker
             `-- Mainnet worker
                  `-- optional external per-agent custody
```

PostgreSQL, Blockfrost, x402 resource servers and enabled Pyth, Masumi, KERIA, Dune and custody providers are external dependencies, not additional canonical Blueprint services.

## Vercel control plane

Responsibilities:

- authentication and session management;
- organizations and RBAC;
- agents and credentials;
- policy and approvals;
- reservations and idempotency;
- payments and resources;
- audit, incidents and reconciliation;
- analytics and financial intelligence;
- export, deletion and settings.

Do not place blockchain private keys, testnet managed-agent master keys or Cardano Mainnet custody credentials in Vercel.

## `agentpay-facilitator`

One public Render web service mounts:

```text
/hedera/testnet
/hedera/mainnet
/arc/testnet
/cardano/preprod
/cardano/mainnet
```

Root endpoints include `/verify`, `/settle`, `/supported`, `/health` and `/ready` according to the combined application.

For Cardano it:

- forwards per-agent identity and sign requests to the signer;
- independently verifies signed transaction CBOR;
- controls replay and durable settlement claims;
- submits through Blockfrost;
- checks transaction and latest-block evidence and confirmation depth.

It does not hold the Cardano payer private key.

## `agentpay-cardano-signer`

This is a Render **web service gateway**, not a background-only worker. It starts isolated Preprod and Mainnet child signer processes.

Public network namespaces:

```text
/preprod/*
/mainnet/*
```

Relevant routes include:

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

The gateway keeps network-specific signer capability keys distinct.

## Preprod signer environment

Required or typical signer-only values include:

```text
CARDANO_PREPROD_BLOCKFROST_URL
CARDANO_PREPROD_BLOCKFROST_PROJECT_ID
CARDANO_PREPROD_SIGNER_API_KEY
CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY
CARDANO_PREPROD_USDCX_ASSET_ID   # only when configured
```

The Preprod master key is testnet-only and derives a different Ed25519 identity for each immutable Agent ID.

## Mainnet signer environment

Mainnet uses:

```text
CARDANO_MAINNET_BLOCKFROST_URL
CARDANO_MAINNET_BLOCKFROST_PROJECT_ID
CARDANO_MAINNET_SIGNER_API_KEY
CARDANO_MAINNET_USDCX_ASSET_ID   # when enabled
```

For autonomous managed agents it additionally uses signer-only:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

There is deliberately no `CARDANO_MAINNET_MANAGED_AGENT_MASTER_KEY`.

## Mainnet external custody contract

The external system is not hosted by AgentPay.

```text
POST /identity
  input: Agent ID + Cardano Mainnet/Ed25519 purpose
  output: stable publicKeyHex + signerRef

POST /sign
  input: Agent ID + signerRef + payerAddress + transaction-body hash
  output: Ed25519 signature
```

AgentPay derives the payer address locally and verifies returned signatures. Private keys stay in the external HSM/KMS/delegation boundary.

## Cardano data flow

```text
Control plane
  -> combined facilitator /managed-agent-sign
  -> Cardano signer
       -> Blockfrost UTxOs/protocol data
       -> construct transaction
       -> Preprod local derived signer OR Mainnet external per-agent signer
  -> signed CBOR returned to facilitator
  -> facilitator independently verifies
  -> durable claim/replay control
  -> Blockfrost /tx/submit
  -> Cardano
  -> Blockfrost confirmation evidence
  -> reconciliation/control plane
```

The signer does not submit the transaction.

## Facilitator Cardano capabilities

Use separate capabilities for managed signing and preparation and for settlement. These are protocol authorization keys; they are not payer private keys and not the external custody credential.

The Mainnet managed-signing capability may authorize the dedicated per-agent identity and signing routes even though the generic or shared signing mode stays `unsigned-only`.

## Dashboard environment mapping

Vercel should normally use one public facilitator origin and network-specific capability keys. It may contain public or provider configuration such as Blockfrost project IDs where the control plane requires them, but must never contain:

```text
CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
blockchain private keys
raw Cardano signing seeds
```

## Deployment sequence

1. choose exact release SHA;
2. ensure required repository checks execute;
3. confirm DB backup and migration state;
4. deploy Cardano signer;
5. verify both signer workers;
6. if Mainnet managed custody is enabled, verify `/identity` for multiple Agent IDs produces distinct stable identities;
7. deploy combined facilitator;
8. verify `/health`, `/supported`, `/ready` and signer connectivity;
9. apply production database migrations;
10. deploy Vercel dashboard and API;
11. verify Vercel has no signer or custody secrets;
12. exercise low-value transactions for intended network and custody modes;
13. independently confirm resulting chain evidence;
14. only retire older services after the unified topology is verified and rollback is understood.

## Arc and Hedera notes

Hedera Testnet and Mainnet and Arc Testnet remain child rails within the unified facilitator. Arc public Mainnet is not declared until an actual supported public network or profile is reviewed. Hedera Mainnet agent custody remains self custody under the documented current model; its operator and payer infrastructure identities are not agent wallets.

## Update provenance

Updated on 2026-08-22 to reflect the current Cardano Mainnet per-agent external custody implementation and the two-service Render topology. Older wording that treated Mainnet autonomous custody as future-only has been removed, and secret placement and submission responsibility are now explicit.

Primary builder: **Daniel Praise** (`Daniel419797`).