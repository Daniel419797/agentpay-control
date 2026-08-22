# Catalyst production release checklist

Use this checklist for the exact deployment/profile being demonstrated. Configuration or source support alone does not prove that an external dependency is operating.

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
- [ ] isolated per-agent master key exists only on the signer
- [ ] two different Agent IDs resolve to different Preprod addresses
- [ ] funded deliberately selected payer UTxOs
- [ ] ADA canary independently verified
- [ ] configured test-token canary independently verified when enabled
- [ ] replay/mismatch/submission-timeout drills performed

## Cardano Mainnet / USDCx

- [ ] signer/facilitator/custody deployment isolated from Preprod
- [ ] no `CARDANO_MANAGED_AGENT_MASTER_KEY` or deployment-wide payer private key exists on Mainnet
- [ ] self-custody mode remains available for wallet-confirmed transactions
- [ ] external per-agent custody adapter configured when autonomous Mainnet agents are enabled
- [ ] custody API credential exists only on the Cardano signer
- [ ] two different Agent IDs resolve to different stable Ed25519 public keys/signer references and `addr1...` addresses
- [ ] AgentPay-derived address matches the custody public key
- [ ] returned custody signatures verify locally
- [ ] canonical Mainnet USDCx asset configured when USDCx is enabled
- [ ] production payer/payee verified
- [ ] deliberately low-value Mainnet transaction exercised for each enabled custody/asset mode
- [ ] Blockfrost confirms payer, payee, asset, amount and confirmation depth

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

- [ ] overview query published when Dune is part of the demonstrated profile
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
- [ ] Mainnet custody-adapter failure blocks managed signing without falling back to another agent/shared key

## Operations/security

- [ ] production secret management configured
- [ ] DNS/TLS configured
- [ ] monitoring configured
- [ ] database backup/restore capability verified
- [ ] incident procedure reviewed
- [ ] custody/provider credentials can be rotated without exposing private keys

## Verification sequence

1. Deploy the exact release SHA.
2. Configure the external services used by the profile being demonstrated.
3. For Mainnet managed custody, resolve at least two Agent IDs and confirm their public identities are distinct before funding them.
4. Execute permitted low-value transactions through normal operator/agent workflows.
5. Cross-check resulting Cardano transactions against Blockfrost/chain evidence.
6. Run the failure cases relevant to the enabled integrations.
7. Confirm `/api/v1/ready` matches the configured profile.
8. Keep submission/demo claims tied to what was actually demonstrated.