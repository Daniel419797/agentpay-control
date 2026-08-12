# AgentPay production readiness

This document separates **repository readiness** from **external launch readiness**. A green repository can prove that AgentPay fails closed, builds, tests and enforces its documented trust boundaries. It cannot manufacture provider approval, funded wallets, DNS ownership, live credentials, remote signing custody, monitoring, restore evidence or an independent security assessment.

## Release decision

A release is eligible for production only when:

1. every repository gate required by the enabled feature set is green on the exact immutable release SHA;
2. every enabled public service is deployed from that SHA or an explicitly recorded image digest derived from it;
3. every external gate required by the enabled feature set has recorded evidence against the same release SHA; and
4. `/api/v1/ready` reports ready for that production profile.

An older green preview or canary is not evidence for a newer commit.

## Repository gates

The exact release candidate must pass:

- forward-only PostgreSQL migrations and migration-state verification;
- resource endpoint/canonicalization invariants;
- governance invariants;
- dashboard lint, typecheck, unit tests and production build;
- Playwright/browser smoke tests required by the release workflow;
- Hedera, Arc, Cardano facilitator tests/builds;
- Cardano signer syntax/tests/image build;
- resource-server tests/build/image build;
- CodeQL and dependency review with no unresolved release-blocking finding;
- repository quality/Sonar policy or explicit reviewed dispositions;
- fresh code review on the stabilized final head.

A workflow that exits before executable steps are created is **not a pass**.

## Common control-plane invariants

Production configuration must fail closed. In particular:

- HTTPS is required for production public/payment service URLs.
- `KEY_ENCRYPTION_MASTER_KEY` must be the canonical unpadded base64url encoding of exactly 32 random bytes.
- production dashboard configuration must not contain Hedera, Arc or Cardano raw private signing material.
- payment, settlement, contract-execution, claim-store and signer capabilities remain independently scoped where applicable.
- OAuth uses PKCE and one-time state; unsafe cookie-authenticated mutations require the configured application origin.
- agent API credentials are scoped, revocable and environment-prefixed.
- user-controlled outbound resource fetches are body-bounded and SSRF-protected.
- sensitive notification destinations, webhook secrets, encrypted automation payloads and signing credentials are not returned by ordinary read APIs.
- audit rows remain immutable/hash-chain protected; retention does not silently delete chain evidence.
- containers run as an unprivileged user.
- emergency stop blocks new risky side effects while preserving defensive card actions, evidence ingestion and reconciliation.
- stale balance snapshots cannot reopen spend already represented by active/consumed/recently settled reservations.
- ambiguous post-sign/submission outcomes remain held for reconciliation rather than being converted into a retryable pre-submission failure.

## Cardano direct x402 invariants

For an enabled Cardano rail:

- x402 scheme is `exact` and the CAIP-2 network is exact (`cardano:preprod` or `cardano:mainnet`).
- ADA is `lovelace`; optional native-token support is limited to the explicitly configured unit.
- the x402 requirement includes a SHA-256 `resourceBinding` of the canonical paid-resource URL.
- the durable settlement claim binds the transaction hash to the complete resource-bound requirement, payer and UTxO nonce.
- same-resource retry remains idempotent; a different paid resource produces a different durable binding even if price/payee/asset match.
- the obsolete one-shot confirmed-claim trigger is removed by forward migration; already legacy-sealed claims remain fail-closed.
- the signer builds only the deliberately narrow supported phase-1 payment shape.
- production raw signing seeds are rejected.
- the signer sends only the transaction-body hash to the remote Ed25519/HSM-style signing boundary and verifies the returned signature against the configured public key.
- the facilitator independently parses signed CBOR and verifies witness, exact payer inputs, exact payee, exact amount, supported asset set, conservation, payer-only change, fee ceiling, TTL/network, resource binding and nonce before submission.
- scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data and unrelated third-party outputs are rejected by the supported Cardano payment profile.
- a possible submission records durable submission state before network submission so a timeout cannot trigger blind resubmission.
- confirmation and mismatch/replay decisions use independent Blockfrost evidence and configured confirmation depth.

### Cardano service topology

Root `render.yaml` declares three Preprod services:

- `agentpay-cardano-signer-preprod`;
- `agentpay-facilitator`;
- `agentpay-resource-server`.

The combined facilitator has both explicit `/hedera`, `/arc`, `/cardano` mounts and a root `/verify` + `/settle` dispatcher. Root dispatch requires `paymentRequirements.network` to exactly equal `paymentPayload.accepted.network` before selecting a rail. This allows Render to wire one `RENDER_EXTERNAL_URL` into the resource server without trusting an unbound route-selection header.

The signer gateway remains a separate process/trust boundary even when declared in the same Blueprint. The actual remote Ed25519 custody endpoint is still external to the gateway.

`render-cardano-signer.yaml` remains available for an independently managed signer deployment. Cardano Mainnet must use separately scoped custody/deployment credentials from Preprod.

## Cardano USDCx/native-token profile

- only the configured policy-id + asset-name unit is supported in addition to lovelace;
- Mainnet USDCx identity is pinned by production preflight to the canonical configured Circle xReserve Cardano asset identity;
- Preprod token configuration is deployment-specific and may not be represented as Mainnet USDCx;
- token-bearing inputs may contain only lovelace plus the allowed unit;
- exact token conservation is required;
- the payee receives exactly the quoted token amount;
- token/ADA change may return only to the payer;
- the root Render Blueprint leaves Preprod token advertisement disabled until the exact asset unit, funded payer and canary are verified.

## Pyth policy profile

When `PYTH_POLICY_ENABLED=true`:

- the selected asset must have a complete configured feed;
- an observation must be positive, not from the future, within configured freshness and confidence bounds;
- USD valuation uses the upper edge of the confidence interval and rounds upward;
- per-transaction/hour/day/month USD limits can only make the base atomic policy more restrictive;
- oracle failure/staleness/uncertainty cannot degrade into an ALLOW decision;
- USD valuation/reservation evidence is persisted for audit/reconciliation.

## Masumi registry/direct-payee trust

When `MASUMI_POLICY_ENABLED=true`:

- resource binding is allowed only for an eligible verified provider and requires recent authentication for mutation;
- AgentPay verifies the exact Masumi network, agent identifier, trusted registry policy, API base URL, online/capability facts and seller wallet/payment information;
- the seller payment key/address evidence must match the resource trust binding;
- direct Cardano x402 payee must equal the verified seller address when Masumi direct-payee trust is required;
- stale/expired registry evidence is refreshed according to policy; missing or inconsistent evidence fails closed.

## Masumi escrow/refund/result/reputation profile

When `MASUMI_ESCROW_ENABLED=true`:

- escrow is a separate settlement workflow from direct x402;
- scoped `payments:create` agents or recently authenticated Owner/Operator users can initiate buyer-side escrow under the same immutable spending policy;
- purchase input is encrypted at rest and purged after terminal completion/refund according to the implemented lifecycle;
- purchase creation, job start and provider evidence are idempotent/ambiguity-aware;
- lifecycle is reconciled through Masumi evidence instead of inferred from one HTTP response;
- supported lifecycle includes `FundsLockingRequested`, `FundsLocked`, `ResultSubmitted`, `Completed`, `RefundRequested`, `RefundAuthorized` and `Disputed`;
- completed reputation credit requires result-hash verification against the exact returned result string;
- buyer refund requests require Owner/Operator plus recent authentication;
- seller refund authorization is restricted to the organization that owns the resource provider, requires Owner/Provider Admin plus recent authentication and only applies after `RefundRequested`;
- seller worklists are visible to the provider workspace rather than only the buyer workspace;
- pending/ambiguous escrow work is included in maintenance reconciliation;
- authorized refunds release reserved spend according to the reservation invariant; disputes do not pretend spend was safely returned;
- a published policy may require a minimum count of AgentPay-observed verified completions and/or a minimum settlement-derived reputation score before new escrow spend is authorized.

No source or UI may describe a direct x402 payment as a Masumi escrow purchase.

## Veridian / KERI / ACDC profile

When `VERIDIAN_IDENTITY_ENABLED=true`:

- cryptographic KERI/ACDC verification is delegated to the configured KERIA authority; AgentPay does not implement its own CESR verifier;
- production KERIA URL must be HTTPS;
- deployment-level trusted issuer AIDs and allowed schema SAIDs must be nonempty;
- a resource credential can be bound only after the resource has a verified Masumi identity;
- the credential must contain a Masumi-agent identifier claim matching that binding;
- verifier evidence for revocation/expiry is enforced;
- persisted binding includes credential SAID, subject AID, issuer AID, schema SAID, claims hash, verification time and expiry;
- a published policy may further narrow issuer/schema sets and set a maximum verification age;
- stale, expired, revoked, untrusted or identity-mismatched credentials fail closed before protected escrow spend.

## Dune observability profile

Dune is never part of authorization/signing/settlement availability. When enabled for release evidence:

- checked-in SQL uses public Cardano chain data only;
- private organization/user/prompt/policy/job-input/signing data is not published;
- publication scripts create/update the configured queries and dashboard from real credentials/IDs;
- readiness requires publication evidence and a sample transaction independently cross-checked against chain evidence;
- a Dune outage cannot relax payment policy or prevent reconciliation.

## Organization data lifecycle

- Settings exposes Owner-only redacted organization export.
- export requires recent authentication and excludes/redacts credential-bearing destinations and secret/ciphertext fields according to the API contract.
- workspace deletion requires Owner, recent authentication, exact workspace slug and exact confirmation phrase.
- a deletion request immediately applies containment controls implemented by the deletion saga instead of waiting for final erase.
- REQUESTED deletion can be canceled; PROCESSING cannot be falsely canceled from the UI.
- final completion is not reported before required external card/provider cleanup succeeds.
- canceling deletion does not falsely reconstruct revoked credentials or automatically reactivate paused notification destinations.

## Mobile/operator usability gate

Production operator pages must remain usable at narrow viewport widths. Generic `.data-table` content is not removed on mobile; the later accessibility stylesheet restores semantic tables inside `.table-wrap` and makes them horizontally scrollable where no purpose-built mobile replacement exists.

## External launch gates

These cannot be completed by source-code changes alone. Record evidence against the exact release SHA for every applicable enabled feature:

### Common platform

- production DNS/TLS for every public service;
- deployment secret manager with credential rotation owner;
- monitoring, error tracking, metrics, paging and named on-call;
- managed database PITR plus a recorded restore drill;
- production Supabase redirect/email verification;
- incident-response and credential-rotation exercise;
- independent security assessment with no unresolved release blocker.

### Cardano

- real Blockfrost credential and production-approved rate capacity;
- funded payer with appropriate UTxOs;
- reviewed remote Ed25519/KMS/HSM custody and public verification key;
- independently explorer-verified low-value Preprod canary for every enabled asset;
- separate Mainnet signer/custody/deployment and Mainnet canary before Mainnet enablement.

### Pyth

- real production Hermes/feed access;
- verified feed IDs for enabled assets;
- success plus stale/future/wide-confidence failure drills.

### Masumi

- real Registry/Payment Service access;
- real verified seller/resource identity;
- a real completed low-value escrow purchase;
- independently recorded result-hash verification;
- buyer refund + seller authorization drill;
- failure/dispute drill where applicable.

### Veridian/KERI

- live reviewed KERIA/Veridian verifier;
- real production credential/schema/issuer evidence;
- revoked/expired/untrusted/mismatched negative cases.

### Dune

- real write/read credentials as applicable;
- published query/visualization/dashboard identifiers;
- public dashboard URL;
- at least one known Cardano transaction sample independently cross-checked.

### Other enabled rails/providers

- Stripe Issuing/fiat approvals and low-value card/fiat canaries before those live features are enabled;
- funded/approved LI.FI routes plus failure/refund drill for every enabled source/destination pair;
- Hedera/Arc production signing material moved to reviewed managed/external custody for real-value use where supported;
- low-value x402 canary for each production-enabled non-Cardano rail.

## Dashboard (Vercel) environment rules

At minimum production requires:

- `APP_ENV=production`;
- HTTPS `NEXT_PUBLIC_APP_URL`;
- managed `DATABASE_URL`;
- unique `AUTH_SECRET` and `CRON_SECRET`;
- canonical `KEY_ENCRYPTION_MASTER_KEY`;
- production Supabase configuration;
- exact enabled rail facilitator URLs/capabilities/public payer/payee/asset identifiers;
- Cardano Blockfrost + claim-store + signer-related public configuration when Cardano is enabled;
- Pyth feed/config when Pyth policy is enabled;
- Masumi registry/payment-node config when those features are enabled;
- KERIA verifier + deployment issuer/schema trust config when Veridian/KERI is enabled;
- Dune query/read configuration only when Dune analytics is enabled.

Do not put raw production rail private keys, HSM signing credentials or raw Cardano signing seed in Vercel.

## Operational reconciliation

- run the authenticated internal maintenance endpoint on the documented schedule;
- reconciliation continues while emergency stop is active;
- unknown Hedera/Cardano/Arc submissions are resolved only from exact network evidence appropriate to the rail;
- fiat ambiguous submissions reuse the provider idempotency key;
- pending Masumi escrows are reconciled from purchase/job evidence;
- a chain-confirmed payment whose paid-resource response was lost remains settled and opens an operational fulfillment incident rather than being retried as unpaid;
- settlement mismatch/replay keeps spend consumed/held and creates an urgent incident;
- dead letters, unknown submissions, stale maintenance and external dependency failures must page an accountable operator in production.

## Release procedure

1. Stabilize the release/hardening PR and record the exact head SHA.
2. Run every required repository check on that exact head; repair infrastructure that prevents checks from executing.
3. Obtain fresh review/security/dependency/quality results.
4. Deploy candidate dashboard and enabled signer/facilitator/resource services from the exact SHA/image digest.
5. Apply forward-only database migrations.
6. Verify service `/health`, combined `/supported`, and `/api/v1/ready`.
7. Record external release evidence for every enabled dependency/custody/canary/drill.
8. Run low-value canaries and independently verify chain/provider evidence.
9. Verify monitoring, maintenance, dead-letter and reconciliation operation.
10. Merge/release only after the repository and applicable external gates are complete.

## Rollback rule

Application containers may roll back to a previously verified SHA. Database migrations are forward-only: repair schema regressions with a new corrective migration rather than editing or destructively rolling back a migration already recorded in production.
