# Catalyst Release / Demonstration Checklist

**Updated:** 2026-08-22  
**Proposer / primary builder:** Daniel Praise (`Daniel419797`)

This checklist covers the implemented Cardano Mainnet external per-agent custody path, keeps self custody as a parallel mode, and separates repository validation from real deployment and pilot evidence.

## Identity and disclosure

- [ ] Proposal identifies **Daniel Praise** as primary technical contributor and GitHub `Daniel419797` as the repository account.
- [ ] Prior Hedera x402 bounty involvement is disclosed as prior program work.
- [ ] Previously completed Hedera work is not presented as new Catalyst-funded delivery.
- [ ] Current TRL is stated as **TRL 5** unless the intended relevant-environment demonstration has actually been completed.

## Source / repository checks

- [ ] exact release SHA recorded
- [ ] database migrations apply cleanly
- [ ] concurrent canonical payment-identity isolation check passes
- [ ] dashboard lint passes
- [ ] dashboard typecheck passes
- [ ] dashboard unit tests pass
- [ ] dashboard production build passes
- [ ] required browser smoke tests pass
- [ ] Hedera/Arc/combined facilitator tests/builds pass
- [ ] Cardano signer tests/image build pass
- [ ] resource-server tests/build pass where included
- [ ] CodeQL/dependency review/required release gates pass
- [ ] jobs actually executed; a workflow with no executable steps is not counted as a pass

## Cardano Preprod

- [ ] dashboard/facilitator/signer endpoints deployed for exact release
- [ ] correct Preprod Blockfrost project configured
- [ ] Preprod managed-agent master secret exists only on isolated signer
- [ ] two Agent IDs resolve to two different `addr_test1...` identities
- [ ] deliberately funded low-value payer UTxOs available
- [ ] ADA canary independently verified
- [ ] configured test-token canary verified if token mode is enabled
- [ ] replay/resource mismatch/ambiguity failure behavior reviewed

## Cardano Mainnet: self custody

- [ ] Mainnet Blockfrost project matches Mainnet
- [ ] no Cardano Mainnet managed-agent master key exists
- [ ] verified wallet prepares/signs exact low-value transaction
- [ ] facilitator independently verifies final signed CBOR
- [ ] facilitator submits through Blockfrost
- [ ] chain evidence confirms expected payer/payee/asset/amount

## Cardano Mainnet: external per-agent managed custody

Only check this section when this custody mode is actually enabled in the environment.

- [ ] `CARDANO_MAINNET_AGENT_CUSTODY_URL` configured on signer only
- [ ] `CARDANO_MAINNET_AGENT_CUSTODY_API_KEY` configured on signer only
- [ ] custody URL uses HTTPS
- [ ] no Mainnet deterministic managed-agent master key exists
- [ ] no deployment-wide autonomous-agent payer exists
- [ ] Agent A and Agent B resolve to different stable Ed25519 public keys/signer references
- [ ] Agent A and Agent B derive to different `addr1...` addresses
- [ ] AgentPay-derived address matches custody public key
- [ ] transaction-body hash is the only signing message sent to custody
- [ ] returned signature verifies locally
- [ ] signer-ref/public-key mismatch fails closed
- [ ] custody unavailable/invalid-signature case fails without shared-key fallback
- [ ] low-value Mainnet managed transaction independently confirmed

## Cardano transaction profile

- [ ] x402 version/scheme/network exact
- [ ] canonical resource SHA-256 binding correct
- [ ] exact payer/payee/asset/amount
- [ ] payer-only inputs/change
- [ ] allowed asset set only
- [ ] exact value/token conservation
- [ ] fee/TTL/input limits respected
- [ ] unsupported scripts/minting/certificates/withdrawals/collateral/bootstrap witnesses/auxiliary data rejected
- [ ] UTxO nonce/replay claim checks work

## Ambiguous submission / reconciliation

- [ ] submission-started state persisted before external submit
- [ ] timeout/uncertain response does not become clean retryable failure
- [ ] candidate transaction retained where known
- [ ] spend/reservation not blindly released
- [ ] no blind duplicate submission
- [ ] Blockfrost/chain evidence can reconcile the final state

## Pyth

When included in demonstrated profile:

- [ ] correct feed/provider configured
- [ ] valid fresh/confidence-bounded observation works
- [ ] stale/future/non-positive/wide-confidence cases fail closed
- [ ] oracle failure cannot relax atomic policy

## Masumi

When included:

- [ ] trusted registry source/network configured
- [ ] seller agent/capability/address/payment-key evidence verified
- [ ] freshness/online requirements exercised
- [ ] escrow Payment Service configured separately from direct x402
- [ ] real eligible escrow lifecycle reconciled
- [ ] result hash verified against exact result
- [ ] refund/dispute behavior reviewed
- [ ] reputation shown only from observed linked outcomes

## Veridian/KERIA

When included:

- [ ] reviewed verification endpoint configured
- [ ] trusted issuer/schema sets configured
- [ ] identity binding to expected Masumi agent verified
- [ ] stale/revoked/expired/untrusted/mismatched cases fail closed

## Dune

When presented as public evidence:

- [ ] real query/dashboard IDs exist
- [ ] known Cardano transaction cross-checked
- [ ] only public-chain facts exposed
- [ ] no private AgentPay organization/user/prompt/policy/credential/resource-content data exposed
- [ ] Dune remains read-only/non-authoritative for payment

## AgentPay controls

- [ ] valid agent credential can initiate permitted purchase
- [ ] over-policy request is denied without signing/submission
- [ ] approval-required request becomes `APPROVAL_PENDING`
- [ ] initiator cannot self-approve where separation applies
- [ ] approved request executes once
- [ ] emergency stop blocks new risky side effects
- [ ] reconciliation/evidence processing remains available during emergency stop
- [ ] audit evidence records relevant transitions

## Pilot/adoption evidence

- [ ] proposal transaction target is mathematically compatible with stated users/wallets/payment frequency/pilot duration
- [ ] proposed Cardano fee budget is compatible with the target transaction count and realistic transaction fees
- [ ] external-wallet target meets the applicable Catalyst requirement
- [ ] acquisition sources are concrete rather than generic channel names
- [ ] per-source expected volume/conversion assumptions are stated
- [ ] first-two-week wallet/user/transaction checkpoints are stated
- [ ] committed/confirmed participants are described only when genuine
- [ ] actual pilot results are reported separately from proposal targets
- [ ] synthetic/demo transactions are not counted as external adoption unless they genuinely satisfy the program definition

## Final statement

Repository source support is not a substitute for external pilot evidence. The repository implements the technical Mainnet per-agent custody path; Catalyst claims about wallets, transaction volume, fees, adoption and TRL must be based on the actual proposal plan and observed evidence.