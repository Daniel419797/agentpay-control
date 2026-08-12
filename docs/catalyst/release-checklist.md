# Catalyst production release checklist

A box is checked only when evidence exists for the **exact immutable release SHA**. Configuration or source support alone does not satisfy a live gate.

## Source and CI

- [ ] database migrations apply cleanly
- [ ] dashboard lint/typecheck/unit tests/build pass
- [ ] Cardano signer syntax/tests/image build pass
- [ ] facilitator/resource tests and container builds pass
- [ ] browser smoke tests pass
- [ ] CodeQL passes
- [ ] dependency review passes
- [ ] required quality gate passes
- [ ] fresh code review has no unresolved blocking finding

## Cardano Preprod

- [ ] deployed HTTPS dashboard/resource/facilitator/signer endpoints
- [ ] distinct capability credentials
- [ ] Blockfrost Preprod credentials
- [ ] reviewed remote signing custody
- [ ] funded deliberately selected payer UTxOs
- [ ] ADA canary independently verified
- [ ] configured test-token canary independently verified
- [ ] replay/mismatch/submission-timeout drills performed

## Cardano Mainnet / USDCx

- [ ] signer/facilitator/custody deployment isolated from Preprod
- [ ] canonical Mainnet USDCx asset configured
- [ ] production payer/payee verified
- [ ] deliberately low-value USDCx canary executed by an authorized operator
- [ ] release-evidence service independently confirms payer, payee, asset, amount and confirmation depth from Blockfrost

## Pyth

- [ ] authenticated production Hermes access
- [ ] ADA/USD feed independently verified
- [ ] USDC/USD feed independently verified for USDCx valuation
- [ ] fresh/confidence-bounded live dependency check passes
- [ ] outage/stale/future/wide-confidence failure drills deny or defer payment as designed

## Masumi

- [ ] authenticated HTTPS Registry access
- [ ] trusted RegistrySource policy IDs pinned
- [ ] seller address → payment-key credential verification passes
- [ ] real agent/capability binding exercised
- [ ] authenticated Payment Service configured with separate credential
- [ ] successful escrow purchase reaches verified `Completed`
- [ ] exact result string hash verification recorded
- [ ] refund lifecycle drill recorded
- [ ] dispute behavior reviewed
- [ ] observed seller reputation policy exercised

## Veridian/KERI

- [ ] reviewed KERIA verification endpoint configured
- [ ] trusted issuer AIDs pinned
- [ ] allowed schema SAIDs pinned
- [ ] resource credential contains Masumi-agent binding claim
- [ ] valid credential verification recorded
- [ ] revoked/expired/untrusted issuer/untrusted schema cases fail closed

## Dune

- [ ] overview query published
- [ ] daily activity query published
- [ ] verification-sample query published
- [ ] public visualizations/dashboard published
- [ ] actual dashboard URL configured
- [ ] recent Dune transaction sample independently cross-checked against Blockfrost
- [ ] no private AgentPay organization/user/prompt/policy/resource-content data is exposed

## AgentPay controls

- [ ] autonomous agent credential can initiate permitted purchase
- [ ] over-policy request is denied with no settlement
- [ ] approval-threshold request becomes `APPROVAL_PENDING`
- [ ] initiator cannot self-approve
- [ ] approved request dispatches to correct direct/escrow payment scheme
- [ ] emergency stop blocks new spend
- [ ] reconciliation remains available during emergency stop
- [ ] ambiguous submissions do not release spend or blindly retry

## Operations/security

- [ ] production secret manager
- [ ] DNS/TLS
- [ ] monitoring and paging
- [ ] named on-call owner
- [ ] database PITR enabled
- [ ] restore drill recorded
- [ ] incident exercise recorded
- [ ] independent security assessment recorded
- [ ] release evidence is stored only through the isolated attestation credential

## Release command sequence

1. Publish Dune queries with `analytics/dune/publish.mjs`.
2. Create Dune visualizations/dashboard with `analytics/dune/publish-dashboard.mjs`.
3. Deploy exact release SHA.
4. Execute permitted low-value canaries through normal operator/agent workflows.
5. Supply resulting transaction/purchase identifiers to `scripts/catalyst-live-demo.mjs`; it verifies/attests evidence but does not autonomously initiate Mainnet spend.
6. Record external operational/security evidence through the isolated release-evidence API.
7. Confirm `/api/v1/ready` returns `ready` with `catalystProduction: verified`.
8. Freeze submission/demo material to the same SHA.
