# Security Review: Daniel419797/agentpay-control

## Scope

Repository-wide standard security scan of the AgentPay dashboard, API routes, Prisma data model and migrations, Hedera and Arc facilitators, resource server, deployment descriptors, CI, documentation, and imported scan artifacts.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: github.com/Daniel419797/agentpay-control
- Revision: 466d356ce303b1ddd93443eb447f11c42c800852
- Snapshot digest: codex-security-snapshot/v1:sha256:5eaf289b43eddc9a618749f0d8818be03213ac765faa5eea475bd8eb1b768227
- Inventory strategy: repository
- Included paths: .
- Excluded paths: .git/, node_modules/, dashboard/.next/, dashboard/test-results/, dashboard/playwright-report/, \*\*/dist/
- Runtime or test status: Parent-only standard scan fallback; clean dependency, build, database recovery, container runtime, and browser evidence was gathered.
- Artifacts reviewed: artifacts/01_context/threat_model.md, artifacts/02_discovery/in_scope_files.txt, artifacts/02_discovery/candidate_ledger.jsonl

Limitations and exclusions:
- Live OAuth redirect and production secret-manager rotation require final provider credentials.
- A full Supabase platform-metadata restore requires a Supabase-compatible target; the application-owned public schema was restored successfully to stock PostgreSQL.
- Excluded .git/: Git object database and metadata are not application source.
- Excluded node_modules/, dashboard/.next/, \*\*/dist/: Generated dependencies and build products were evaluated through manifests, lockfile audit, clean builds, and runtime tests rather than line-by-line source review.
- Excluded dashboard/test-results/, dashboard/playwright-report/: Ephemeral browser-test output is not shipped application source.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 0 |
| Severity mix | none |
| Confidence mix | none |
| Coverage | complete |
| Validation mode | Compact validation of every discovery candidate; attack-path analysis was not entered because no candidate remained reportable or deferred. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

AgentPay accepts browser, webhook, agent, marketplace, and x402 traffic across trust boundaries while controlling payment signing and settlement credentials. Highest-impact risks are unauthorized signing or settlement, tenant-data access, credential disclosure, SSRF, payment-policy bypass, audit-chain tampering, and supply-chain compromise.

### Assets

- Hedera and Arc payer keys
- Facilitator capability credentials
- Encrypted agent credentials
- Organization payment policies and spend reservations
- Audit-chain and incident records
- Session and OAuth state

### Trust Boundaries

- Browser to Next.js application
- Next.js application to PostgreSQL and Supabase
- Application and resource server to facilitators
- Facilitators to Hedera and Arc networks
- Application to attacker-influenced outbound resource and notification URLs
- CI and container build to external package registries

### Attacker Capabilities

- Unauthenticated internet requests
- Authenticated low-privilege organization membership
- Control of marketplace resource or notification URLs
- Malformed x402 payloads and oversized request streams
- Compromised single-purpose service credential

### Security Objectives

- Never expose or misuse payer keys
- Enforce organization and role boundaries
- Keep signing, settlement, and contract-execution credentials independent
- Apply policy and transactional reservation checks before signing
- Prevent private-network access through outbound HTTP
- Preserve audit and incident integrity
- Fail closed in production when required security configuration is absent

## Findings

### No findings

No reportable findings survived the canonical discovery, validation, and reportability gates.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| API authentication, authorization, and organization isolation | Broken access control and tenant data exposure | No issue found | Reviewed authenticated route guards, workspace resolution, membership roles, internal-route secrets, object-scoped queries, and CSRF origin enforcement. Evidence: artifacts/02_discovery/in_scope_files.txt |
| Payment policy, approvals, reservations, and audit integrity | Unauthorized or duplicate spend and audit tampering | No issue found | Reviewed policy evaluation, approval flows, transactional spend reservations, immutable fingerprints, submission recovery incidents, and database-enforced hash chaining. Evidence: artifacts/02_discovery/in_scope_files.txt |
| Outbound resource, fulfillment, health, and notification HTTP | SSRF and DNS rebinding | Rejected | Candidate candidate-b878526e40d2b165 was suppressed after source tracing and regression tests proved public-IP validation plus connection-time DNS pinning at every identified sink. Evidence: artifacts/02_discovery/candidate_ledger.jsonl |
| Session, OAuth, wallet, and browser security controls | Session confusion, cookie shadowing, and token substitution | Rejected | Candidate candidate-56afbf8a791bb046 was suppressed because production cookies are host-bound and JWT verification fixes algorithm, issuer, and audience. Evidence: artifacts/02_discovery/candidate_ledger.jsonl |
| Credential encryption and key material | Credential disclosure and weak cryptographic keys | Rejected | Candidate candidate-8d8153bf200ebd90 was suppressed after exact 32-byte production-key validation, authenticated v2 encryption, tamper tests, and isolated v1 read compatibility. Evidence: artifacts/02_discovery/candidate_ledger.jsonl |
| Hedera and Arc signing, settlement, contract execution, and error handling | Privileged capability escalation and sensitive error disclosure | Rejected | Candidates candidate-986d2dafe67d7e5d and candidate-b6710f43bdb97de4 were suppressed by production fail-closed key separation, cross-capability rejection tests, bounded bodies, contract allowlists, and stable public error codes. Evidence: artifacts/02_discovery/candidate_ledger.jsonl |
| Dependencies, CI, containers, Compose, and Render blueprint | Known vulnerable dependencies, non-reproducible builds, and privileged runtimes | No issue found | Production audit reports zero vulnerabilities; npm is pinned; clean installs and all production images build; runtime containers use UID 1000 and pass health/restart tests. Evidence: artifacts/02_discovery/in_scope_files.txt |
| Prisma migrations, seed behavior, governance checks, and recovery | Schema drift, unrecoverable data, and broken integrity controls | No issue found | All 22 migrations are current; fresh and configured states were exercised; governance verification passed; the configured remote public schema restored locally with 60 tables and 22 migrations. Evidence: artifacts/02_discovery/in_scope_files.txt |

## Open Questions And Follow Up

- Are production OAuth redirects, TLS domains, egress controls, and secret rotation configured in the deployment provider?
  - Follow-up prompt: Verify live provider configuration and run authenticated canaries after final credentials are supplied.
- Is provider-managed Supabase metadata covered by the platform backup and recovery policy?
  - Follow-up prompt: Document and test a Supabase-compatible full-project recovery procedure in addition to the proven portable public-schema restore.
