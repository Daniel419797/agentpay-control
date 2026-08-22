# AgentPay: Current Feature Testing Script

**Status:** Current implementation verification guide  
**Updated:** 2026-08-22

## Revision note

The previous testing script centered the original Hedera flow and did not test the implemented Cardano Mainnet external per-agent custody or the current unified topology. This version covers the control plane, identity isolation, Cardano, trust and reconciliation behavior while keeping optional provider features conditional on configuration.

## 1. Repository baseline

From the exact release head, execute the applicable repository checks rather than relying on deployment status alone.

### Dashboard

```bash
cd dashboard
npm run lint
npm run typecheck
npm test
npm run build
```

### Payment-identity isolation

Use only the disposable test or local database intended by the verification script:

```bash
cd dashboard
npm run verify:identity-isolation
```

Expected: competing claims for the same canonical payment identity cannot both succeed.

### Cardano signer

Run the checked-in signer tests, image and build path used by the repository workflow. Verify the suite covers network guards, transaction construction and managed-agent identity and signature behavior.

### Facilitators and resource server

Run Hedera, Arc, combined facilitator and resource-server tests and builds applicable to the release.

## 2. Authentication and tenancy

Verify:

- dashboard sign-in works using configured authentication method;
- organization-scoped pages and API calls require authentication;
- users cannot read or mutate another organization's records by guessing IDs;
- Owner, Operator, Approver and Viewer permissions are enforced server-side;
- agent credentials reject invalid, expired, revoked or missing scopes.

## 3. Agent and payment-identity provisioning

### Hedera Testnet

Create two managed agents and verify distinct Hedera payment identities.

### Arc Testnet

Create two managed agents and verify distinct EVM addresses.

### Cardano Preprod

Create two managed agents and verify:

- both use `addr_test1...`;
- addresses differ;
- payment accounts are stored as distinct canonical identities;
- testnet master secret is not present in Vercel.

### Cardano Mainnet external delegated

Only run live if external custody is actually configured.

Create two agents and verify:

- both use `addr1...`;
- each resolves to its own external Ed25519 identity;
- public keys and signer references differ;
- local derived address matches the external public key;
- no Mainnet managed-agent master key exists;
- custody API credential exists only on the signer.

Negative cases:

- same external identity returned for a second agent -> duplicate identity rejected;
- invalid public key -> provisioning rejected;
- claimed address mismatch -> rejected;
- custody unavailable -> fail closed.

## 4. Policy tests

Publish a restrictive policy and test:

- within-limit -> `ALLOW`;
- over-limit with deny behavior -> `DENY`;
- over-limit with approval behavior -> `REQUIRE_APPROVAL`;
- merchant and resource allow or deny rule;
- schedule activation and expiry;
- velocity and cooldown where configured;
- immutable published version behavior.

Confirm denied requests do not reach signing.

## 5. Approval tests

- create an approval-required request;
- verify `APPROVAL_PENDING`;
- verify an unauthorized user cannot decide it;
- verify self-approval is blocked where applicable;
- approve through a valid approver;
- verify execution resumes once;
- reject a separate request and verify no signing or submission.

## 6. Spend reservation and idempotency tests

Verify:

- authorized intent creates or uses a durable spend reservation;
- duplicate idempotency key with identical request returns existing intent;
- same idempotency key with different request causes conflict;
- stale balance data cannot ignore active, consumed or recently settled commitments;
- failed-before-submission behavior releases or updates reservation according to state;
- ambiguous post-sign or submission outcome does not behave like clean pre-sign failure.

## 7. Direct x402 resource test

Use a registered x402 resource.

Expected path:

```text
GET resource
 -> 402 Payment Required
 -> select exact requirement
 -> policy/trust evaluation
 -> reserve spend
 -> sign/prepare
 -> request resource with payment payload
 -> resource verify/settle
 -> paid response
```

Validate resource URL canonicalization and SSRF restrictions.

## 8. Cardano Preprod direct x402 test

Use a deliberately funded low-value agent.

Verify:

- requirement network is `cardano:preprod`;
- scheme is `exact`;
- `resourceBinding` matches canonical URL;
- payer address matches the agent's managed identity;
- signer constructs valid CBOR;
- facilitator independently verifies transaction;
- facilitator submits via Blockfrost;
- chain evidence confirms payer, payee, asset and amount;
- AgentPay settlement state becomes confirmed or settled.

## 9. Cardano Mainnet self-custody test

Only use a deliberately low-value verified wallet.

Verify:

- unsigned transaction prepared for exact payer;
- wallet or provider signs outside AgentPay;
- signed transaction satisfies facilitator checks;
- submission is performed by facilitator, not signer;
- resulting transaction is independently confirmed.

## 10. Cardano Mainnet external per-agent managed test

Run only if a real external custody adapter is configured.

Expected sequence:

```text
AgentPay
 -> facilitator /managed-agent-sign
 -> signer resolves /identity
 -> signer constructs transaction
 -> signer hashes transaction body
 -> custody /sign exact signerRef
 -> signer verifies Ed25519 signature locally
 -> facilitator independently verifies CBOR
 -> facilitator submits through Blockfrost
 -> confirmation evidence
```

Negative cases:

- changed signer reference -> reject;
- changed public key -> reject;
- invalid signature -> reject;
- custody timeout or unavailable -> reject and fail closed;
- no fallback to another agent or shared payer.

## 11. Cardano asset and profile tests

### ADA

Verify exact `lovelace` amount, payer-only change, fee and value conservation.

### Configured native token or USDCx

When enabled, verify:

- exact configured asset identity;
- no unrelated native assets;
- exact token conservation;
- exact payee token amount;
- change only to payer;
- Preprod token is never presented as Mainnet USDCx.

Reject unsupported scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data and unrelated outputs.

## 12. Replay and resource-binding tests

- same resource and idempotent retry remains safe;
- same price and payee but different canonical resource URL must not reuse binding;
- conflicting settlement claim for same transaction ID must reject;
- spent or unavailable UTxO nonce must reject when a new claim is attempted.

## 13. Ambiguous submission test

In a safe environment, force a timeout or uncertain response after submission could have occurred.

Expected:

- candidate transaction ID retained where known;
- state becomes pending or `SUBMISSION_UNKNOWN`;
- spend reservation not blindly released;
- no blind resubmission;
- reconciliation queries independent chain evidence;
- confirmed evidence transitions to settled.

## 14. Pyth policy tests

When enabled:

- valid fresh observation -> conservative USD valuation;
- stale observation -> fail closed;
- future timestamp -> fail closed;
- non-positive price -> fail closed;
- excessive confidence width -> fail closed;
- oracle failure does not relax atomic policy.

## 15. Masumi tests

### Registry and direct trust

Verify network, registry policy, agent identifier, capability, seller address, payment credential and freshness.

### Escrow

When configured, verify:

```text
PREPARED
 -> FundsLockingRequested
 -> FundsLocked
 -> ResultSubmitted
 -> Completed
```

Confirm returned result hash matches the exact result before counting completion as verified.

Exercise a separate refund or dispute path where appropriate.

## 16. KERI/Veridian tests

When configured:

- valid verified credential passes required policy;
- untrusted issuer or schema fails;
- stale, expired or revoked credential fails;
- Masumi-agent identity binding mismatch fails.

## 17. Emergency stop

- enable organization emergency stop;
- attempt new payment or risky side effect -> blocked;
- verify reconciliation and evidence access continues;
- restore through authenticated administrative control;
- confirm audit events exist.

## 18. Audit, reconciliation and analytics

Verify:

- payment, policy, approval and security events are recorded;
- transaction detail contains correct chain evidence;
- reconciliation status is visible for ambiguous outcomes;
- Dune, if enabled, contains public-chain facts only and is not needed for payment success.

## 19. Optional product surfaces

Virtual cards, fiat, cross-chain, invoices, marketplace, automations, notifications and financial-intelligence pages should be tested only against the provider and configuration mode actually enabled. Sandbox or fixture behavior must not be described as live production-provider evidence.

## 20. Final release checklist

- [ ] exact release SHA recorded
- [ ] expected CI jobs actually executed
- [ ] migrations pass
- [ ] concurrent identity-isolation check passes
- [ ] dashboard lint, typecheck, tests and build pass
- [ ] facilitator, signer and resource checks pass
- [ ] selected network and custody canary succeeds
- [ ] chain evidence independently verified
- [ ] negative and fail-closed cases exercised
- [ ] no secrets exposed in logs or screenshots
- [ ] observed metrics clearly separated from proposal targets and fixtures

## Update provenance

Updated on 2026-08-22 because the previous script did not cover the implemented Cardano Mainnet external per-agent custody architecture or current multi-rail topology.

Primary builder: **Daniel Praise** (`Daniel419797`).