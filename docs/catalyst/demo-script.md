# Catalyst live demo runbook

## Demo objective

Prove one coherent story: an autonomous agent can hire a verified agent/service on Cardano while AgentPay keeps enforceable control over budget, counterparties, assets, approvals, settlement state and emergency shutdown.

## Preconditions

Use the exact release being demonstrated and real credentials for the integrations shown. For a Cardano Mainnet autonomous-agent demo, configure the external per-agent custody adapter and fund only the specific `addr1...` identity provisioned for that agent. Do not put `CARDANO_MANAGED_AGENT_MASTER_KEY` on Mainnet.

## Scene 1 — policy and agent identity

Show the Research Agent and its active policy:

- network: Cardano
- custody mode: Preprod managed, Mainnet external delegated, or self custody
- assets: ADA and USDCx/configured stable asset
- maximum autonomous payment
- USD daily/monthly limit
- Pyth valuation enabled when used
- Masumi seller identity required when used
- approval threshold

For Mainnet external custody, show the agent's distinct `addr1...` payment address. Explain that AgentPay stores public identity material only; the private key remains in the external HSM/KMS/delegation boundary.

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

Use a real agent credential to initiate a policy-controlled purchase for a verified resource.

For direct x402, the expected path is:

`Agent request → policy → managed signer → facilitator verification → Cardano → reconciliation`

For Mainnet external delegated custody, point out that the signer resolves the public key/signer reference for the exact Agent ID, builds the transaction, sends only the transaction-body hash to that signer reference, verifies the returned Ed25519 signature locally, and then passes the transaction to the independent facilitator.

For Masumi escrow, show the lifecycle:

`PREPARED → FundsLockingRequested → FundsLocked → ResultSubmitted → Completed`

At completion show the purchase/job identifier, result hash, policy decision and audit trail. Explain that AgentPay verifies the returned result against the submitted result hash before counting the purchase as verified-complete.

## Scene 4 — direct x402 transaction

Show a Cardano `exact` x402 resource challenge and payment.

Point out:

- exact network
- resource SHA-256 binding
- exact payer/payee
- exact asset/amount
- per-agent custody identity
- facilitator verification
- transaction hash and Cardano explorer evidence

If demonstrating Mainnet, use a deliberately low-value payment from the exact provisioned agent address. The demo may use self custody or the configured external per-agent managed path; describe the mode actually being shown.

## Scene 5 — policy denial

Submit a request that is deliberately over the active policy limit or above the caller-provided maximum.

Expected result: `DENY` / `MAX_AMOUNT_EXCEEDED` / applicable policy reason. Show that no transaction is submitted.

## Scene 6 — human approval

Submit a payment inside the broader budget but above the autonomous threshold.

Expected result: `APPROVAL_PENDING`.

Use a different Owner/Approver account from the initiator. Approve the request and show execution continuing through the correct payment scheme. Self-approval must remain blocked.

## Scene 7 — custody failure

For a Mainnet external-delegated agent, demonstrate or describe the fail-closed behavior when the custody adapter is unavailable or returns an invalid identity/signature.

Expected result: managed signing fails. AgentPay must not fall back to a shared key, another agent's identity or a deployment-wide payer.

## Scene 8 — refund lifecycle

Use a dedicated escrow purchase whose result is eligible for refund. Request the refund as buyer, authorize as the provider organization, reconcile and show `RefundAuthorized` plus the corresponding spend state. Keep this separate from the primary successful purchase.

## Scene 9 — emergency stop

Enable the organization emergency stop through the normal operator UI/API. Attempt a new payment and show it is rejected. Then show that reconciliation/defensive evidence processing remains operational. Restore the organization only through the normal authenticated administrative control.

## Scene 10 — analytics

Open `/app/analytics/cardano` and, if configured, the public Dune dashboard.

Dune should show only public chain facts. AgentPay's authenticated analytics can show logical metrics such as unique paying agents/providers, policy denials, approval-required events, settlement success/latency and verified Masumi outcomes.

Never substitute planning targets or example numbers for observed values.

## Closing line

“AgentPay lets agents remain autonomous without becoming financially unrestricted: every Mainnet managed agent can have its own external signing identity, Cardano moves the value, and AgentPay enforces the organization's financial boundary.”