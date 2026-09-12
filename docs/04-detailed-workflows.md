# AgentPay Detailed Workflows

**Status:** implementation-aligned operational workflows  
**Updated:** 2026-09-10

## 1. Organization and agent provisioning

```text
authorized human
 -> create/select organization and workspace
 -> create agent
 -> assign network/custody profile
 -> resolve or attach payment identity where required
 -> enforce canonical identity uniqueness
 -> publish policy
 -> create scoped agent credential
 -> readiness checks pass
 -> agent can request permitted actions
```

Agent credentials authorize AgentPay APIs; they do not expose the underlying blockchain/provider secret.

## 2. Direct x402 resource purchase

```text
agent -> paid-request API
      -> authenticate credential + organization
      -> SSRF-safe request to resource
      -> receive HTTP 402 requirements
      -> canonicalize resource + validate requirement
      -> resolve resource/provider/trust evidence
      -> evaluate immutable policy
      -> reserve spend
      -> DENY | REQUIRE_APPROVAL | AUTHORIZE
      -> execute selected custody/network path
      -> verify settlement evidence
      -> retry resource request with payment proof
      -> persist fulfillment + audit
```

A lost resource response after confirmed settlement does not make the payment disappear; fulfillment recovery is separate from payment reconciliation.

## 3. Approval flow

```text
policy => REQUIRE_APPROVAL
 -> durable approval request
 -> authorized approver decision(s)
 -> threshold not met => remain pending
 -> rejection => stop execution/release reservation as applicable
 -> approval threshold met
 -> bind approval to original financial context
 -> consume approval once
 -> resume authorized execution
```

## 4. Hedera payment flow

```text
authorized payment
 -> resolve expected Hedera account/custody mode
 -> build/verify supported payment payload
 -> facilitator applies rail-specific validation
 -> submit/observe Hedera settlement
 -> persist transaction evidence
 -> settle local intent only after accepted evidence
```

Managed Testnet identities remain per-agent. Mainnet operation follows its configured custody profile and readiness contract.

## 5. Arc payment flow

```text
authorized payment
 -> resolve Arc Testnet account/custody
 -> construct supported EVM payment path
 -> validate network, payer, payee, amount and contract constraints
 -> submit/observe settlement
 -> persist evidence
```

The adapter does not imply an unconfigured public production network.

## 6. Cardano Preprod managed flow

```text
authorized intent
 -> Cardano facilitator
 -> isolated Preprod signer
 -> derive Agent-ID-specific Ed25519 identity
 -> verify expected addr_test1... payer
 -> fetch bounded UTxOs/protocol inputs from Blockfrost
 -> build narrow key-spend transaction
 -> sign transaction-body hash
 -> return signed CBOR
 -> facilitator independently verifies full transaction
 -> create durable settlement claim
 -> submit through Blockfrost
 -> poll confirmation evidence
 -> confirm or reconcile
```

## 7. Cardano Mainnet external custody flow

```text
authorized intent
 -> Cardano facilitator
 -> isolated Mainnet signer
 -> external custody /identity(agentId)
 -> publicKeyHex + signerRef
 -> derive expected addr1... locally
 -> build bounded transaction
 -> hash transaction body
 -> external custody /sign(exact agent/signer/message)
 -> verify returned Ed25519 signature locally
 -> signed CBOR
 -> facilitator independently verifies
 -> durable settlement claim
 -> Blockfrost submission/confirmation
```

There is no fallback to another agent or shared deployment-wide payer when the custody dependency fails.

## 8. Cardano self-custody flow

```text
verified payer/wallet
 -> request exact payment preparation
 -> signer builds unsigned transaction for exact payer
 -> wallet/provider signs outside AgentPay
 -> signed transaction returned
 -> facilitator independently validates it
 -> durable settlement claim
 -> submit/confirm/reconcile
```

## 9. Ambiguous blockchain submission

```text
submission started
 -> timeout / transport failure / uncertain provider response
 -> preserve candidate transaction + reservation + claim
 -> mark pending/submission-unknown
 -> query authoritative chain evidence
      -> confirmed => SETTLED
      -> definitive rejection => resolved failure
      -> still uncertain => remain pending
```

AgentPay does not create a second payment simply because the first HTTP response was lost.

## 10. Moove Receive link creation

```text
agent/application
 -> POST /api/v1/moove/payment-links + Idempotency-Key
 -> authenticate organization/agent and validate input
 -> validate optional resource/invoice binding
 -> create/find durable local request fingerprint
 -> call Moove create-payment-link
      -> success: store provider ID + URL + active state
      -> ambiguous: mark SUBMISSION_UNKNOWN and reconcile listing
 -> return AgentPay payment record
```

A repeated client request with the same idempotency key and same payload resolves to the same intended AgentPay payment. A conflicting payload using that key is rejected.

## 11. Moove payment completion

```text
payer opens hosted link
 -> Moove processes payment and settles according to account configuration
 -> AgentPay refresh/reconciliation retrieves provider evidence
 -> validate provider link identity/status
 -> persist destination address, token/chain, amount, tx URL
 -> providerStatus = COMPLETED
 -> emit durable completion event
 -> if invoice-bound: verify exact expected settlement configuration
 -> atomically mark matching invoice settlement/paid state
 -> if resource-bound: emit resource-payment completion event
```

A browser redirect or hosted checkout page is never treated as payment evidence.

## 12. Masumi registry trust

```text
resource requires Masumi trust
 -> load/refresh registry evidence
 -> verify expected agent identity/capability/network/payment facts
 -> enforce freshness/online/history/reputation policy
 -> trusted payee/result becomes policy input
 -> continue direct payment workflow
```

Registry trust does not convert a direct payment into escrow.

## 13. Masumi escrow purchase

```text
agent requests escrow-backed purchase
 -> verify resource/counterparty
 -> evaluate policy + reserve spend
 -> create durable purchase
 -> call Masumi payment service
 -> funds locking requested
 -> funds locked
 -> provider job/result lifecycle
 -> verify exact result hash/evidence
 -> completed
```

Refund, dispute, provider mutation, and reconciliation paths maintain their own one-shot claims and incident evidence.

## 14. Pyth policy valuation

```text
candidate payment
 -> fetch configured Pyth price observation
 -> verify positive price, publish time and confidence
 -> compute conservative USD micro-value
 -> compare to per-tx/hour/day/month USD policy
 -> combine with atomic policy
 -> most restrictive decision wins
```

If required oracle evidence is unavailable or invalid, it cannot relax policy.

## 15. Veridian/KERI trust flow

```text
resource/counterparty context
 -> configured KERIA verifier
 -> cryptographic credential result
 -> validate issuer/schema/subject/freshness/revocation/binding claims
 -> attach non-secret evidence to policy context
 -> required invalid/mismatched evidence => fail closed
```

## 16. Virtual-card flow

```text
authorized organization/operator
 -> create provider cardholder
 -> provider KYC/status response
 -> issue virtual card with configured limits/categories/countries
 -> persist non-secret provider card metadata
 -> signed provider authorization events arrive through webhook
 -> AgentPay records authorization state
 -> freeze/reactivate/cancel through provider status controls
```

Stripe is used when configured; Sandbox is development-only. AgentPay does not persist raw card credentials.

## 17. Fiat account and transfer flow

```text
authorized request
 -> provider adapter
 -> create/read financial account
 -> initiate inbound or outbound movement with idempotency key
 -> persist provider transfer identifier/status
 -> reconcile provider state
 -> update local transfer state
```

A provider request being accepted is distinct from the transfer succeeding.

## 18. Invoice flow

```text
create invoice + items
 -> send/publish invoice
 -> choose supported collection path
 -> direct payment / configured provider / Moove Receive
 -> persist payment/settlement evidence
 -> exact settlement validation
 -> invoice paid
```

Invoices may be voided only according to current lifecycle rules. Payment evidence is retained separately from invoice presentation state.

## 19. Resource-provider and marketplace flow

```text
provider registered
 -> provider verified where required
 -> resource registered with canonical endpoint
 -> price/listing published
 -> optional Masumi/Veridian binding
 -> marketplace discovery
 -> buyer/agent purchase
 -> settlement
 -> fulfillment
 -> review/operational evidence
```

## 20. Cross-chain flow

```text
request source/destination/asset intent
 -> discover supported network profiles
 -> obtain durable quote
 -> evaluate policy/readiness
 -> prepare exact transfer
 -> submit once
 -> persist provider/network submission state
 -> reconcile terminal outcome
```

Expired/mismatched quotes cannot be silently repurposed.

## 21. Automation flow

```text
rule trigger (manual/scheduled/provider webhook as configured)
 -> create durable execution
 -> validate organization + rule state
 -> generate candidate action
 -> normal policy/approval/reservation checks
 -> execute authorized side effect
 -> checkpoint irreversible boundary
 -> persist result or ambiguity
 -> optional human execution decision
```

Emergency stop blocks new risky side effects while defensive reconciliation may continue.

## 22. Financial intelligence flow

```text
persisted financial observations
 -> aggregation/analysis
 -> anomaly records
 -> spend forecasts
 -> budget recommendations
 -> operator/agent read access
```

Intelligence is advisory and cannot grant payment authority.

## 23. Notification flow

```text
business event
 -> durable outbox event
 -> configured notification endpoint
 -> delivery attempt
 -> success or retryable/terminal delivery state
```

Notification failure does not roll back the underlying financial truth.

## 24. Organization emergency stop

```text
owner activates kill switch
 -> new risky financial/automation side effects blocked
 -> defensive reads, evidence ingestion and reconciliation remain available
 -> operator investigates and revokes/rotates affected provider credentials if needed
 -> owner restores operation after review
```

## 25. Organization export/retention/deletion

```text
authorized organization request
 -> validate role and lifecycle constraints
 -> generate bounded export or retention action
 -> preserve required financial/audit evidence
 -> stream/complete export or process deletion workflow
 -> audit administrative action
```

## 26. Release workflow

```text
exact source revision
 -> dependency install + lock validation
 -> lint/typecheck/tests
 -> security scans
 -> service/container builds
 -> migration verification
 -> deploy service boundaries
 -> readiness checks
 -> low-value controlled canary for enabled financial profiles
 -> monitor/reconcile
```

See [`production-runbook.md`](production-runbook.md) and [`testing-script.md`](testing-script.md).
