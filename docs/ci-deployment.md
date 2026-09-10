# CI and Release Pipeline

**Updated:** 2026-09-10

AgentPay uses CI as a release gate for a financial control system, not merely as a compile check. The expected jobs must actually execute on the exact candidate SHA.

## Pipeline responsibilities

Current repository checks include:

- dependency installation/resolution and lockfile regeneration validation;
- dashboard lint, Next type generation, TypeScript typecheck, unit tests, and production build;
- Hedera facilitator typecheck/tests/build;
- Arc facilitator typecheck/tests/build;
- combined facilitator typecheck/tests/build;
- resource-server typecheck/tests/build;
- Cardano signer validation/tests;
- production container builds;
- npm production dependency audit;
- OSV dependency scanning;
- Semgrep source scanning;
- Gitleaks repository-tree scanning;
- CodeQL;
- release evidence/artifact generation.

## Production dependency audit policy

The security pipeline refreshes dependency resolution metadata in the ephemeral CI checkout before scanning so audit tools evaluate the graph selected by the current manifests/overrides rather than stale lock metadata.

Known-advisory exceptions, if ever necessary, must be exact and reviewed. The preferred response is to upgrade/override to a patched compatible dependency and prove compatibility through the full test/build pipeline.

## Lockfile handling

`package.json` security overrides are part of the dependency policy. The generated `package-lock.json` should be kept synchronized with manifests using the pinned npm version.

The lockfile-regeneration job is validation/evidence tooling; the release branch should ultimately contain a reproducible lockfile rather than relying indefinitely on ephemeral regeneration.

## Vercel build

The dashboard build runs repository-wide verification through the configured prebuild before the final Next production build. This intentionally catches failures in sibling payment services that the dashboard relies on.

Preview environments must not attempt DB-backed tests against an unavailable production/external database. DB integration tests should run in CI with a reachable disposable database or in a specifically provisioned preview test environment.

## CircleCI release flow

The configured production workflow runs verification, security, CodeQL, Cardano signer, container builds, lockfile regeneration, and a release-gate job whose prerequisites require the relevant core checks.

A status badge is supporting evidence; the actual executed job/step result for the exact commit is authoritative.

## Infrastructure-blocked rule

If a CI platform marks a run failed before the expected executable steps are created, classify it as infrastructure/workflow blocked until logs prove a code/test failure. Do not call it a passing check, and do not modify application code merely to satisfy an infrastructure event without evidence.

## Release promotion

1. freeze an exact candidate SHA;
2. confirm every required job is terminal and successful;
3. inspect security results, not only aggregate status;
4. verify migration/lockfile artifacts;
5. build/deploy services from the same source revision;
6. apply migrations safely;
7. verify readiness;
8. perform low-value profile-specific canaries;
9. capture release evidence;
10. promote traffic/limits only after operational verification.

## Failure triage

- **lint/typecheck/test:** fix source or test contract; never suppress a real failure without understanding it.
- **dependency audit:** identify exact package/advisory/path; upgrade or apply narrow reviewed resolution.
- **DB integration:** verify test DB lifecycle/connectivity before changing business code.
- **provider integration:** distinguish mock/unit failure from unavailable external service.
- **container build:** verify Docker context, runtime version, native dependencies, and environment assumptions.
- **Vercel:** inspect the first real failing command in build logs; warnings such as a deliberate Node engine override are not automatically failures.

## Deployment topology

The release is promoted to Vercel control plane and Render facilitator/signer services, with PostgreSQL and configured external providers around them. See [`unified-production-deployment.md`](unified-production-deployment.md).
