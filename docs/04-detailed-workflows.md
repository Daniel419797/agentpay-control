# AgentPay Control: Detailed Workflows

**Status:** Current implementation workflows  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

The original workflow document described the July 2026 Hedera MVP. This version documents the payment, custody, trust and reconciliation flows currently implemented. The original workflow document remains available in Git history.

## 1. Agent provisioning

### Managed testnet agent

```text
Authorized operator
  -> create Agent
  -> choose managed-capable testnet network
  -> control plane calls facilitator /managed-identity
  -> network signer/facilitator resolves unique identity for immutable Agent ID
  -> PaymentAccount created
  -> DB canonical identity uniqueness enforced
  -> agent becomes usable when required configuration is valid
```

A duplicate canonical identity is rejected rather than shared between agents.

### Cardano Mainnet external-delegated agent

```text
Authorized operator
  -> create Cardano Mainnet agent
  -> choose external delegated custody
  -> control plane calls Cardano Mainnet facilitator /managed-identity
  -> facilitator calls isolated Cardano signer
  -> signer calls external custody POST /identity
  -> custody returns publicKeyHex + signerRef
  -> AgentPay derives addr1... locally
  -> optional claimed address must match derived address
  -> PaymentAccount uniqueness check
  -> account stored as autonomous managed/external delegated
```

`CARDANO_MANAGED_AGENT_MASTER_KEY` is not used or accepted on Mainnet.

## 2. Direct x402 paid request

```text
Autonomous agent / operator
  -> AgentPay paid-request API
  -> validate agent credential/session
  -> SSRF-safe GET to resource
  -> resource responds HTTP 402
  -> parse x402 V2 requirements
  -> locate registered resource/price
  -> verify configured trust requirements
  -> evaluate immutable policy
  -> reserve spend
  -> DENY | APPROVAL_PENDING | AUTHORIZED
```

For Cardano, the selected requirement must match the exact canonical resource URL, network, asset, amount and payee and must contain the expected resource binding/server-submission/confirmation policy.

## 3. Approval workflow

```text
Policy result = REQUIRE_APPROVAL
  -> payment intent remains non-signable
  -> approval request created
  -> authorized approver reviews context
  -> reject => no signing / reservation released as applicable
  -> approve threshold reached
  -> approval consumed
  -> intent becomes authorized
  -> execution resumes once
```

Where separation of duties applies, the initiator cannot approve their own request.

## 4. Cardano Preprod managed signing

```text
Authorized payment intent
  -> facilitator /managed-agent-sign
  -> isolated Cardano Preprod signer
  -> derive Agent-ID-specific seed from signer-only testnet master key
  -> derive Ed25519 public key + addr_test1...
  -> verify expected payer identity
  -> fetch payer UTxOs/protocol data through Blockfrost
  -> build narrow transaction
  -> sign transaction-body hash
  -> return signed CBOR + nonce + transaction ID
  -> facilitator independently verifies transaction
```

The Preprod master secret never goes to Vercel.

## 5. Cardano Mainnet external per-agent signing

```text
Authorized payment intent
  -> facilitator /managed-agent-sign
  -> isolated Cardano Mainnet signer
  -> external custody POST /identity(agentId)
  -> receive publicKeyHex + signerRef
  -> derive expected addr1... locally
  -> verify payerAccountId matches
  -> fetch UTxOs/protocol data through Blockfrost
  -> build narrow Cardano transaction
  -> hash transaction body
  -> external custody POST /sign
       agentId + signerRef + payerAddress + messageHex
  -> receive Ed25519 signature
  -> verify signerRef/public key consistency
  -> verify Ed25519 signature locally
  -> return signed CBOR
  -> facilitator independently verifies full transaction
```

The private key remains in the external HSM/KMS/delegation boundary. Custody failure is terminal for that signing attempt and cannot fall back to a shared key or another agent.

## 6. Cardano self-custody preparation

```text
Verified wallet owner
  -> request preparation for exact payer
  -> Cardano facilitator
  -> signer /unsigned
  -> signer fetches UTxOs/protocol data
  -> returns unsigned transaction
  -> wallet/provider signs outside AgentPay
  -> signed payload is verified by facilitator before settlement
```

Self custody remains available on Cardano Mainnet in parallel with external per-agent managed custody.

## 7. Cardano verification and settlement

The facilitator performs an independent verification after signing/preparation.

It checks the supported transaction profile, including:

- transaction/witness encoding;
- exact payer credential and payer-only inputs;
- exact payee, amount and asset;
- allowed asset set and conservation;
- payer-only change;
- fee ceiling;
- TTL/network;
- resource binding;
- UTxO nonce/replay state.

Then:

```text
verified transaction
  -> durable settlement claim
  -> MARK_SUBMISSION_STARTED
  -> POST Blockfrost /tx/submit
  -> poll transaction + latest block evidence
  -> enough confirmations => CONFIRM
  -> resource response may be fulfilled
```

The Cardano signer does **not** submit transactions on-chain; submission belongs to the facilitator.

## 8. Ambiguous submission/reconciliation

```text
signing succeeded
  -> submission started
  -> timeout / 5xx / uncertain provider response
  -> do NOT mark clean failure
  -> preserve candidate transaction ID and reservation state
  -> mark submission unknown / reconciliation required
  -> query independent chain evidence
       -> confirmed => settle
       -> definitively rejected/not valid according to reconciliation rules => resolve failure
       -> still uncertain => remain unresolved
```

This prevents blind retry from creating an unintended second payment.

## 9. Masumi registry trust for direct x402

```text
Resource is governed by Masumi policy
  -> load cached Masumi resource binding
  -> validate network / agent identifier / capability
  -> refresh through Masumi Registry when required
  -> verify seller address and payment-key facts
  -> enforce freshness/online/history/reputation controls
  -> derive trusted payee
  -> continue normal AgentPay policy evaluation
```

Masumi registry trust does not turn a direct x402 transfer into escrow.

## 10. Masumi escrow workflow

```text
Agent requests escrow-backed job
  -> verify Masumi resource identity
  -> evaluate AgentPay financial/trust policy
  -> create durable purchase state
  -> call Masumi Payment Service
  -> FundsLockingRequested
  -> FundsLocked
  -> start/reconcile seller job
  -> ResultSubmitted
  -> verify exact returned result against result hash
  -> Completed
```

Refund/dispute paths are tracked separately. A buyer may request refund and an authorized seller/provider workspace may authorize it according to the implemented lifecycle.

Only linked, observed terminal outcomes feed AgentPay's seller reputation calculation.

## 11. Pyth-valued policy workflow

```text
payment amount
  -> fetch Pyth observation
  -> validate publish time, confidence and positive price
  -> calculate conservative USD micro-dollar value
  -> compare against per-tx/hour/day/month USD limits
  -> combine with base atomic policy using most restrictive result
```

Oracle failure must not relax the base policy.

## 12. Veridian/KERIA workflow

```text
Masumi resource already verified
  -> fetch/receive credential verification evidence from configured KERIA endpoint
  -> validate issuer/schema/subject/freshness/revocation requirements
  -> require claim that binds credential to expected Masumi agent identity
  -> attach evidence to policy context
  -> invalid/stale/mismatched required evidence => fail closed
```

AgentPay does not reimplement KERI/CESR cryptography.

## 13. Emergency stop workflow

```text
Owner enables organization emergency stop
  -> new risky payment/automation side effects blocked
  -> existing evidence ingestion/reconciliation remains available
  -> operator investigates
  -> authenticated administrative action restores normal operation
```

## 14. Resource fulfillment workflow

For direct x402:

```text
resource 402 challenge
  -> AgentPay obtains signed payment payload
  -> repeat resource request with payment-signature
  -> resource verifies/settles through facilitator
  -> successful settlement evidence
  -> paid resource returned
```

If the resource response is lost after settlement, the transaction remains a payment and is reconciled rather than automatically retried.

## 15. Dune/public analytics workflow

```text
Cardano public settlement activity
  -> Dune queries/dashboard
  -> read-only public analytics
```

Dune cannot approve, sign, submit or reconcile a payment and must not receive private AgentPay organization/prompt/policy/credential data.

## 16. Release/deployment workflow

```text
exact Git commit
  -> repository checks execute
  -> database migration validation
  -> Render signer + facilitator deployment
  -> Vercel dashboard/API deployment
  -> readiness checks
  -> provision exact custody/provider configuration
  -> low-value canary for enabled profile
  -> independent chain verification
```

A workflow that terminates before test/build steps are created is infrastructure-blocked and is not treated as a passing validation.

## 17. Provenance and current maturity

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor. AgentPay was originally built for the Hedera x402 bounty. The workflows above document the multi-rail system that now exists after the Cardano, custody, trust and operational extensions.

For Catalyst purposes, the current maturity remains **TRL 5** until the intended Cardano Mainnet/pilot configuration is demonstrated in a relevant environment. Mainnet external per-agent custody is now implemented in source; that implementation is one prerequisite for, not a substitute for, a TRL 6 demonstration.

See [`02-software-design-document.md`](02-software-design-document.md), [`cardano-production.md`](cardano-production.md), [`production-readiness.md`](production-readiness.md), and [`implementation-status.md`](implementation-status.md).