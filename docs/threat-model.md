# AgentPay Threat Model

**Status:** Current implementation threat model  
**Updated:** 2026-08-22

## Revision note

Cardano Mainnet now has an implemented external per-agent Ed25519 custody path. The threat model treats Mainnet autonomous custody as a current trust boundary while self custody remains supported in parallel.

## 1. Security objective

An autonomous agent may request financial action, but it must not be able to:

- bypass organization or agent policy;
- use another agent's payment identity;
- obtain unrestricted private-key authority;
- alter a verified x402 requirement after authorization;
- replay a payment against another resource;
- cause blind resubmission after an ambiguous side effect;
- cross organization boundaries;
- weaken required trust or oracle evidence.

## 2. Trust boundaries

### Control plane: Vercel

Trusts authenticated users and agents only within explicit organization, role and scope boundaries. Holds business state, policy, reservations, approvals, audit and reconciliation records. Holds no blockchain private keys or Mainnet custody API credentials.

### PostgreSQL

Authoritative application-state boundary. Must preserve tenant isolation, transaction integrity and canonical payment-identity uniqueness.

### Unified facilitator: Render

Protocol and settlement boundary for Hedera, Arc and Cardano. The Cardano side verifies signed transactions, controls replay and claims, submits through Blockfrost and evaluates confirmation evidence. It does not hold the Cardano payer private key.

### Cardano signer: Render

Transaction construction and signing boundary. Preprod may hold a testnet-only derivation secret. Mainnet may hold an external custody API capability but not the managed-agent private keys themselves. The signer does not perform Cardano on-chain submission.

### External Cardano Mainnet custody

Separate provider, HSM, KMS or delegation boundary. Holds per-agent Mainnet private keys and exposes only bounded public identity and body-hash signing operations.

### Resource providers

Untrusted or semi-trusted external HTTP and x402 systems. Resource URLs, challenges and responses are treated as hostile input until validated.

### Pyth / Masumi / KERIA / Dune / Blockfrost

External evidence and provider boundaries with different authority. None may silently gain policy authority beyond its configured role.

### Blockchains

Authoritative final settlement evidence, subject to the confirmation and reconciliation rules for the supported rail.

## 3. Protected assets

- blockchain private keys;
- testnet managed-agent master keys;
- external HSM/KMS signer references and credentials;
- agent API credentials;
- session and authentication secrets;
- organization membership and roles;
- immutable policy versions;
- spend reservations;
- approvals;
- payment intents, attempts and settlements;
- settlement claims and nonces;
- audit and incident evidence;
- encrypted escrow and job inputs and provider secrets;
- private organization, resource and prompt content.

## 4. Identity-isolation threats

### Threat: two agents share one wallet

Impact: one agent can spend from another agent's authority or attribution becomes false.

Controls:

- one canonical payment identity per network, PaymentAccount and agent;
- canonical unique DB index;
- transaction-scoped advisory locking;
- per-agent signer provisioning;
- reject legacy duplicate or shared-payer identities rather than silently migrating them.

### Threat: infrastructure account becomes agent wallet

Controls:

- distinguish Hedera operator and payer, Arc relayer and contract executor, and other service principals from `PaymentAccount.accountId`;
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

### Custody returns wrong or changed public key or signer reference

Controls:

- bind payer address to resolved public key;
- verify optional claimed address;
- compare returned signer reference and public key on signing;
- fail closed on mismatch.

### Custody signs altered data

Control: external signer receives only the exact transaction-body hash constructed by AgentPay. Returned signature is verified locally against the resolved public key and body hash.

### Custody outage

Control: managed signing fails. There is no fallback to shared hot wallet, another agent, deployment-wide payer or deterministic Mainnet master key.

### Custody API credential compromise

Controls:

- signer-only placement;
- HTTPS;
- distinct capability from Cardano signer and facilitator keys;
- provider-side authorization, rate and policy controls should be applied;
- rotate affected credential and contain managed signing if compromise is suspected.

## 6. Preprod derivation threats

Preprod deterministic derivation is testnet-only. The master secret must be random, isolated to the signer and never copied into Mainnet or Vercel configuration.

Compromise affects the derived testnet identities and should trigger testnet key rotation and reprovisioning, but this design must not be extrapolated to Mainnet custody.

## 7. Transaction-construction threats

Threats include malicious UTxO selection, extra outputs or assets, excessive fees, scripts, minting, certificates, withdrawals, collateral and payer or change manipulation.

Controls:

- narrow transaction builder;
- payer-only inputs;
- exact payee, amount and asset;
- allowed asset set and conservation;
- payer-only change;
- bounded fee, TTL and input count;
- reject unsupported transaction features;
- facilitator independently decodes and verifies CBOR after signing.

## 8. Resource and replay threats

### Payment reused for different resource

Control: SHA-256 binding of the canonical paid-resource URL is part of the Cardano requirement and settlement binding.

### Duplicate submission

Controls:

- idempotent payment intent creation;
- UTxO nonce;
- durable settlement claim;
- replay and mismatch checks before submission.

### Ambiguous timeout retried blindly

Controls:

- record submission-started state before external submit;
- preserve candidate transaction and reservation;
- mark pending or `SUBMISSION_UNKNOWN`;
- independent evidence reconciliation rather than blind retry.

## 9. Policy and authorization threats

### Agent bypasses spend policy

Controls:

- server-side immutable policy evaluation;
- active policy version binding;
- spend reservations;
- pre-sign revalidation;
- scoped credentials;
- payment account and network checks.

### Self-approval

Control: role and approval rules prevent initiator approval where separation is required.

### Kill-switch bypass

Control: organization emergency stop is checked before new risky side effects. Defensive reconciliation and evidence processing remains available.

### Stale balance reopens budget

Control: active, consumed and recently settled reservations remain part of spend accounting rather than trusting a stale chain balance snapshot alone.

## 10. External trust threats

### Pyth

Threat: stale, manipulated or uncertain price relaxes policy.

Controls: freshness, confidence and positive-value validation and conservative upper-bound valuation. Required oracle failure cannot relax atomic limits.

### Masumi Registry

Threat: wrong seller, capability or payment key becomes trusted.

Controls: trusted registry source and network, agent identifier, capability, seller address and payment-key verification, freshness and online requirements.

### Masumi escrow

Threat: HTTP success is mistaken for escrow completion.

Control: durable provider lifecycle reconciliation and exact result-hash verification before verified completion contributes to reputation.

### KERIA/Veridian

Threat: untrusted, stale, revoked or mismatched credential passes policy.

Controls: verified authority response plus pinned issuer and schema, subject and binding, freshness, expiry and revocation checks.

### Dune

Threat: analytics outage or manipulation affects payment authorization.

Control: Dune is read-only observability and is never an authorization, signing or settlement dependency.

### Blockfrost

Threat: provider error or ambiguous submission is treated as authoritative failure.

Controls: classify definitive versus ambiguous responses; query transaction and latest-block evidence; retain durable reconciliation state.

## 11. Web and API threats

Controls include:

- server-side RBAC and tenant checks;
- scoped and revocable API credentials;
- secure session and authentication configuration;
- recent authentication for sensitive actions where implemented;
- SSRF-safe outbound resource fetching;
- bounded request and response sizes;
- secret redaction and non-return;
- no raw signing material in browser or LLM context;
- HTTPS for production payment and custody endpoints.

## 12. Data and audit threats

- audit records must remain tamper-evident and immutable according to implemented controls;
- export APIs redact credential-bearing data;
- deletion must not falsely report completion before required cleanup succeeds;
- historical settlement evidence must survive agent or key migration where necessary for auditability.

## 13. Security test expectations

For relevant release profiles test:

- duplicate identity race;
- cross-tenant access rejection;
- invalid, expired or scopeless credentials;
- policy denial and approval separation;
- emergency stop;
- Cardano transaction mismatch and replay;
- submission ambiguity;
- Mainnet custody unavailable, wrong key, wrong signer reference or invalid signature;
- stale or invalid Pyth evidence;
- invalid Masumi or KERI evidence;
- production secret-placement and configuration guards.

## 14. Update provenance

Updated 2026-08-22 because the external per-agent Cardano Mainnet custody boundary is now implemented and merged. The threat model treats it as a current architecture component while continuing to require deployment-specific validation and fail-closed behavior.

Primary builder: **Daniel Praise** (`Daniel419797`).