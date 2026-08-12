# Catalyst live demo runbook

## Demo objective

Prove one coherent story: an autonomous agent can hire a verified agent/service on Cardano while AgentPay keeps enforceable control over budget, counterparties, assets, approvals, settlement evidence and emergency shutdown.

## Preconditions

Do not demo from synthetic metrics or placeholder credentials. Pin the exact `RELEASE_SHA`. The production readiness profile must have real Pyth, Masumi Registry, Masumi Payment Service, Veridian/KERIA, Dune, Blockfrost and Cardano configuration. Mainnet payment execution is an explicit operator action; `scripts/catalyst-live-demo.mjs` verifies/records externally executed canary evidence and does not autonomously initiate Mainnet spend.

## Scene 1 — policy

Show the Research Agent and its active policy:

- network: Cardano
- assets: ADA and USDCx/configured stable asset
- maximum autonomous payment
- USD daily/monthly limit
- Pyth valuation enabled
- Masumi seller identity required
- minimum verified completed purchases/reputation where enabled
- KERI issuer/schema requirement where enabled
- approval threshold

Explain: the agent is autonomous inside a financial boundary, not an unrestricted wallet.

## Scene 2 — counterparty verification

Open the provider/resource identity evidence.

Show:

- Masumi `agentIdentifier`
- trusted RegistrySource policy ID
- capability
- seller address
- seller payment-key hash
- Cardano address/payment-key credential match
- latest verification time/expiry
- optional Veridian/KERI credential SAID, issuer AID and schema SAID

Do not display API keys or private credential bodies.

## Scene 3 — agent hires agent

Use a real agent credential to initiate a Masumi escrow purchase for a verified resource.

Expected progression:

`PREPARED → FundsLockingRequested → FundsLocked → ResultSubmitted → Completed`

At completion show:

- purchase/job identifier
- result hash
- result verification timestamp
- policy decision
- Pyth observation used for USD policy, when applicable
- audit trail

Explain that AgentPay verifies the exact returned result string against Masumi's submitted result hash before counting the purchase as verified-complete.

## Scene 4 — direct x402

Show a Cardano `exact` x402 resource challenge and payment.

Point out:

- exact network
- resource SHA-256 binding
- exact payer/payee
- exact asset/amount
- isolated signer boundary
- facilitator verification
- transaction hash and Cardano explorer evidence

For Mainnet USDCx use only the pre-executed low-value canary tied to the exact release SHA.

## Scene 5 — policy denial

Submit a request that is deliberately over the active policy limit or above the caller-provided maximum.

Expected result: `DENY` / `MAX_AMOUNT_EXCEEDED` / applicable policy reason. Show that no spend reservation proceeds to settlement and no transaction is created.

## Scene 6 — human approval

Submit a payment inside the broader budget but above the autonomous threshold.

Expected result: `APPROVAL_PENDING`.

Use a different Owner/Approver account from the initiator. Approve the request and show execution continuing through the correct payment scheme dispatcher. Self-approval must remain blocked.

## Scene 7 — refund lifecycle

Use a dedicated Preprod escrow purchase whose result is eligible for refund. Request the refund as buyer, authorize as the provider organization, reconcile and show `RefundAuthorized` plus released spend reservation. Keep this separate from the primary successful purchase.

## Scene 8 — emergency stop

Enable the organization emergency stop through the normal operator UI/API. Attempt a new payment and show it is rejected. Then show that reconciliation/defensive evidence processing remains operational. Restore the organization only after the demo using the normal authenticated administrative control.

## Scene 9 — analytics

Open `/app/analytics/cardano` and the public Dune dashboard.

Dune should show only public chain facts. Open `/api/v1/analytics/catalyst` from an authenticated workspace view for privacy-safe logical metrics such as unique paying agents/providers, policy denials, approval-required events, settlement success/latency and verified Masumi outcomes.

Never substitute the example numbers from planning documents for live values.

## Scene 10 — release evidence

Show the release evidence for the exact SHA. Explain that canary hashes are accepted only after Blockfrost confirms configured confirmation depth and exact payer/payee/asset/amount behavior. Dune sample hashes are independently cross-checked against Blockfrost.

## Closing line

“AgentPay lets agents remain autonomous without becoming financially unrestricted: Cardano moves the value, ecosystem services provide price/identity/analytics primitives, and AgentPay enforces the organization's financial boundary.”
