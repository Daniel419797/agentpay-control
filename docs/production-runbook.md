# AgentPay Production Runbook

**Status:** Current operational runbook  
**Updated:** 2026-08-22

> **Why this document was updated:** The runbook now reflects the deployed Vercel + two-service Render topology and the implemented Cardano Mainnet external per-agent custody path. It removes the obsolete assumption that Mainnet autonomous custody is unavailable and makes the signer/facilitator responsibilities explicit.

## 1. Canonical topology

```text
GitHub release SHA
  |-- Vercel: dashboard/API
  `-- Render
      |-- agentpay-facilitator
      `-- agentpay-cardano-signer
            |-- Preprod worker
            `-- Mainnet worker
                  `-- optional external HSM/KMS/delegation custody

External dependencies:
  PostgreSQL / Blockfrost / resource servers /
  Pyth / Masumi / KERIA / Dune as enabled
```

## 2. Secret placement

### Vercel

May contain application/database/provider capability configuration. Must not contain:

- blockchain private keys;
- managed-agent master keys;
- Cardano Mainnet custody API credentials.

### Combined facilitator

Contains rail/protocol capabilities and infrastructure credentials appropriate to Hedera/Arc/Cardano settlement verification/submission.

### Cardano signer

Preprod worker may receive:

```text
CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY
```

Mainnet worker may receive:

```text
CARDANO_MAINNET_AGENT_CUSTODY_URL
CARDANO_MAINNET_AGENT_CUSTODY_API_KEY
```

Mainnet must not receive `CARDANO_MANAGED_AGENT_MASTER_KEY` or production raw signing seeds.

## 3. Release preparation

1. Select the exact immutable release SHA.
2. Verify required CI/repository checks actually executed.
3. Confirm database migrations and identity-isolation checks.
4. Verify production environment values are sourced from secret management rather than committed files.
5. Confirm the enabled provider/network profile matches the release being deployed.

## 4. Database preparation

Before application traffic moves to the release:

- confirm managed PostgreSQL connectivity;
- verify backup/restore capability appropriate to the environment;
- apply forward-only migrations;
- allow the payment-identity isolation migration to fail if duplicate canonical identities exist;
- archive/reprovision legacy conflicting managed agents rather than bypassing the constraint or rewriting historical settlements.

## 5. Deploy Cardano signer

Deploy `agentpay-cardano-signer` from the exact release.

Verify:

- `/health`/`/ready` responds;
- Preprod and Mainnet child workers are loaded;
- network-specific signer API keys are distinct;
- Blockfrost network/project configuration matches each worker;
- Preprod master secret exists only where Preprod managed agents are enabled;
- Mainnet has no managed-agent master key;
- Mainnet external custody configuration is complete or absent as a pair.

If Mainnet external custody is enabled, health/readiness should expose the expected external-per-agent capability.

## 6. Verify Mainnet custody before funding

For autonomous Cardano Mainnet agents:

1. provision Agent A through the normal AgentPay path;
2. record its public identity, signer reference and locally derived `addr1...` address;
3. provision Agent B;
4. confirm Agent B has a different public identity/signer reference/address;
5. verify no Mainnet deterministic master key exists in the service;
6. verify the custody credential exists only on the signer;
7. test an unavailable/invalid custody response and confirm managed signing fails closed;
8. only then fund the deliberately selected agent address for a low-value test.

## 7. Deploy combined facilitator

Deploy `agentpay-facilitator` from the same release.

Verify:

```text
/health
/supported
/ready
```

Expected network paths include:

```text
/hedera/testnet
/hedera/mainnet
/arc/testnet
/cardano/preprod
/cardano/mainnet
```

For Cardano, verify the facilitator can reach the isolated signer using the correct network-scoped signer capability.

## 8. Deploy Vercel control plane

Deploy the Next.js dashboard/API from the exact release.

Verify:

- production app origin/session configuration;
- database connectivity/migration state;
- unified facilitator origin/capabilities;
- no signer/custody/private-key secrets present;
- `/api/v1/health` and `/api/v1/ready` reflect the intended profile.

## 9. Low-value Cardano canary

For each custody/network/asset mode being enabled:

1. use the normal AgentPay policy/payment workflow;
2. use a deliberately low-value amount;
3. ensure policy/reservation/approval behavior is correct;
4. for managed mode, confirm the exact agent identity signs;
5. confirm the signer returns CBOR but does not submit;
6. confirm the facilitator independently verifies;
7. confirm submission occurs through Blockfrost;
8. independently inspect chain evidence for payer/payee/asset/amount/transaction ID;
9. confirm AgentPay reconciliation/settlement state matches chain evidence.

## 10. Cardano ambiguity drill

Exercise or simulate an uncertain submission response in a safe environment.

Expected behavior:

- candidate transaction retained;
- settlement claim retained;
- spend is not blindly released/retried;
- state becomes pending/`SUBMISSION_UNKNOWN` as applicable;
- independent evidence reconciliation continues.

Do not manually force a second payment to make the UI look successful.

## 11. Policy/approval drill

Verify:

- an in-policy request can proceed;
- an over-policy request is denied or requires approval according to published policy;
- initiator self-approval remains blocked where applicable;
- approved request resumes exactly once;
- emergency stop blocks new risky side effects;
- reconciliation remains available during emergency stop.

## 12. External integration drills

Only test integrations that are actually enabled for the profile.

### Pyth

Verify good observation plus stale/future/wide-confidence failure.

### Masumi

Verify current registry/payee evidence and, if escrow is enabled, a real low-value lifecycle including result-hash evidence/refund path appropriate to the environment.

### KERIA/Veridian

Verify valid credential binding and at least one fail-closed invalid/stale/untrusted case.

### Dune

If shown publicly, verify real query/dashboard IDs and cross-check a known Cardano transaction. Dune is never a payment dependency.

## 13. Monitoring and incident response

Monitor at least:

- dashboard/API availability;
- facilitator readiness;
- signer readiness/child worker health;
- database errors/connection exhaustion;
- payment failure/submission-unknown rates;
- reconciliation backlog;
- custody/provider failures;
- authentication/authorization anomalies;
- emergency-stop changes.

For a suspected signing/custody compromise:

1. enable containment/emergency stop as appropriate;
2. disable/rotate the affected capability credential;
3. stop funding/using the affected identity;
4. preserve audit and chain evidence;
5. verify scope per agent/network;
6. restore only through a reviewed replacement identity/credential path.

## 14. Rollback

Rollback application/service versions only when schema/protocol compatibility permits it. Do not roll back by restoring old shared agent payment identities or weakening the canonical uniqueness constraint.

If a new custody adapter is unhealthy, disable that Mainnet managed profile while preserving self-custody and reconciliation rather than introducing a shared-key fallback.

## 15. Operational truth statement

AgentPay has been deployed and personally exercised. This runbook exists to make a specific release/profile reproducible and safer to operate; it does not imply the project only exists as source code.

Primary builder/operator for the repository: **Daniel Praise** (`Daniel419797`).