# AgentPay Threat Model

**Status:** Current implementation threat model  
**Updated:** 2026-08-22

> **Why this document was updated:** Cardano Mainnet now has an implemented external per-agent Ed25519 custody path. The threat model was synchronized so Mainnet autonomous custody is treated as a real trust boundary rather than a future-only concept, while self-custody remains supported in parallel.

## 1. Security objective

An autonomous agent may request financial action, but it must not be able to:

- bypass organization/agent policy;
- use another agent's payment identity;
- obtain unrestricted private-key authority;
- alter a verified x402 requirement after authorization;
- replay a payment against another resource;
- cause blind resubmission after an ambiguous side effect;
- cross organization boundaries;
- weaken required trust/oracle evidence.

## 2. Trust boundaries

### Control plane — Vercel

Trusts authenticated users/agents only within explicit organization/role/scope boundaries. Holds business state, policy, reservations, approvals, audit and reconciliation records. Holds no blockchain private keys or Mainnet custody API credentials.

### PostgreSQL

Authoritative application-state boundary. Must preserve tenant isolation, transaction integrity and canonical payment-identity uniqueness.

### Unified facilitator — Render

Protocol/settlement boundary for Hedera, Arc and Cardano. Cardano side verifies signed transactions, controls replay/claims, submits through Blockfrost and evaluates confirmation evidence. It does not hold the Cardano payer private key.

### Cardano signer — Render

Transaction-construction/signing boundary. Preprod may hold a testnet-only derivation secret. Mainnet may hold an external custody API capability but not the managed-agent private keys themselves. The signer does not perform Cardano on-chain submission.

### External Cardano Mainnet custody

Separate provider/HSM/KMS/delegation boundary. Holds per-agent Mainnet private keys and exposes only bounded public identity/body-hash signing operations.

### Resource providers

Untrusted/semi-trusted external HTTP/x402 systems. Resource URLs, challenges and responses are treated as hostile input until validated.

### Pyth / Masumi / KERIA / Dune / Blockfrost

External evidence/provider boundaries with different authority. None may silently gain policy authority beyond its configured role.

### Blockchains

Authoritative final settlement evidence, subject to the confirmation/reconciliation rules for the supported rail.

## 3. Protected assets

- blockchain private keys;
- testnet managed-agent master keys;
- external HSM/KMS signer references and credentials;
- agent API credentials;
- session/auth secrets;
- organization membership/roles;
- immutable policy versions;
- spend reservations;
- approvals;
- payment intents/attempts/settlements;
- settlement claims/nonces;
- audit/incident evidence;
- encrypted escrow/job inputs and provider secrets;
- private organization/resource/prompt content.

## 4. Identity-isolation threats

### Threat: two agents share one wallet

Impact: one agent can spend from another agent's authority or attribution becomes false.

Controls:

- one canonical payment identity per network/PaymentAccount/agent;
- canonical unique DB index;
- transaction-scoped advisory locking;
- per-agent signer provisioning;
- reject legacy duplicate/shared-payer identities rather than silently migrating them.

### Threat: infrastructure account becomes agent wallet

Controls:

- distinguish Hedera operator/payer, Arc relayer/contract executor and other service principals from `PaymentAccount.accountId`;
- do not assign deployment-wide service identities to autonomous agents.

## 5. Cardano Mainnet custody threats

### Shared Mainnet master key

Threat: compromise of one derivation secret compromises every managed agent.

Control: `CARDANO_MANAGED_AGENT_MASTER_KEY` is prohibited on Mainnet.

### Custody provider returns same key for multiple agents

Controls:

- immutable Agent ID in `/identity` request;
- locally derive Cardano payer address from returned Ed25519 public key;
- global DB canonical identity uniqueness;
- operational verification using multiple Agent IDs.

### Custody returns wrong/changed public key or signer reference

Controls:

- bind payer address to resolved public key;
- verify optional claimed address;
- compare returned signer reference/public key on signing;
- fail closed on mismatch.

### Custody signs altered data

Control: external signer receives only the exact transaction-body hash constructed by AgentPay. Returned signature is verified locally against the resolved public key/body hash.

### Custody outage

Control: managed signing fails. There is no fallback to shared hot wallet, another agent, deployment-wide payer or deterministic Mainnet master key.

### Custody API credential compromise

Controls:

- signer-only placement;
- HTTPS;
- distinct capability from Cardano signer/facilitator keys;
- provider-side authorization/rate/policy controls should be applied;
- rotate affected credential and contain managed signing if compromise is suspected.

## 6. Preprod derivation threats

Preprod deterministic derivation is testnet-only. The master secret must be random, isolated to the signer and never copied into Mainnet or Vercel configuration.

Compromise affects the derived testnet identities and should trigger testnet key rotation/reprovisioning, but this design must not be extrapolated to Mainnet custody.

## 7. Transaction-construction threats

Threats include malicious UTxO selection, extra outputs/assets, excessive fees, scripts/minting/certificates/withdrawals/collateral and payer/change manipulation.

Controls:

- narrow transaction builder;
- payer-only inputs;
- exact payee/amount/asset;
- allowed asset set and conservation;
- payer-only change;
- bounded fee/TTL/input count;
- reject unsupported transaction features;
- facilitator independently decodes/verifies CBOR after signing.

## 8. Resource/replay threats

### Payment reused for different resource

Control: SHA-256 binding of the canonical paid-resource URL is part of the Cardano requirement/settlement binding.

### Duplicate submission

Controls:

- idempotent payment intent creation;
- UTxO nonce;
- durable settlement claim;
- replay/mismatch checks before submission.

### Ambiguous timeout retried blindly

Controls:

- record submission-started state before external submit;
- preserve candidate transaction/reservation;
- mark pending/`SUBMISSION_UNKNOWN`;
- independent evidence reconciliation rather than blind retry.

## 9. Policy/authorization threats

### Agent bypasses spend policy

Controls:

- server-side immutable policy evaluation;
- active policy version binding;
- spend reservations;
- pre-sign revalidation;
- scoped credentials;
- payment account/network checks.

### Self-approval

Control: role/approval rules prevent initiator approval where separation is required.

### Kill-switch bypass

Control: organization emergency stop is checked before new risky side effects. Defensive reconciliation/evidence processing remains available.

### Stale balance reopens budget

Control: active/consumed/recently settled reservations remain part of spend accounting rather than trusting a stale chain balance snapshot alone.

## 10. External trust threats

### Pyth

Threat: stale/manipulated/uncertain price relaxes policy.

Controls: freshness/confidence/positive-value validation and conservative upper-bound valuation. Required oracle failure cannot relax atomic limits.

### Masumi Registry

Threat: wrong seller/capability/payment key becomes trusted.

Controls: trusted registry source/network, agent identifier, capability, seller address/payment-key verification, freshness/online requirements.

### Masumi escrow

Threat: HTTP success is mistaken for escrow completion.

Control: durable provider lifecycle reconciliation and exact result-hash verification before verified completion contributes to reputation.

### KERIA/Veridian

Threat: untrusted/stale/revoked/mismatched credential passes policy.

Controls: verified authority response plus pinned issuer/schema, subject/binding, freshness/expiry/revocation checks.

### Dune

Threat: analytics outage/manipulation affects payment authorization.

Control: Dune is read-only observability and is never an authorization/signing/settlement dependency.

### Blockfrost

Threat: provider error or ambiguous submission is treated as authoritative failure.

Controls: classify definitive vs ambiguous responses; query transaction/latest-block evidence; retain durable reconciliation state.

## 11. Web/API threats

Controls include:

- server-side RBAC/tenant checks;
- scoped/revocable API credentials;
- secure session/auth configuration;
- recent authentication for sensitive actions where implemented;
- SSRF-safe outbound resource fetching;
- bounded request/response sizes;
- secret redaction/non-return;
- no raw signing material in browser/LLM context;
- HTTPS for production payment/custody endpoints.

## 12. Data/audit threats

- audit records must remain tamper-evident/immutable according to implemented controls;
- export APIs redact credential-bearing data;
- deletion must not falsely report completion before required cleanup succeeds;
- historical settlement evidence must survive agent/key migration where necessary for auditability.

## 13. Security test expectations

For relevant release profiles test:

- duplicate identity race;
- cross-tenant access rejection;
- invalid/expired/scopeless credentials;
- policy denial/approval separation;
- emergency stop;
- Cardano transaction mismatch/replay;
- submission ambiguity;
- Mainnet custody unavailable/wrong key/wrong signerRef/invalid signature;
- stale/invalid Pyth evidence;
- invalid Masumi/KERI evidence;
- production secret-placement/configuration guards.

## 14. Update provenance

Updated 2026-08-22 because the external per-agent Cardano Mainnet custody boundary is now implemented and merged. The threat model therefore treats it as a real architecture component while continuing to require deployment-specific validation and fail-closed behavior.

Primary builder: **Daniel Praise** (`Daniel419797`).