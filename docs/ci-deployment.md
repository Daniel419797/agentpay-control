# AgentPay CI and production deployment

AgentPay treats GitHub as the source repository and pull-request control plane. Executable release verification is intentionally provider-independent: the real checks live in `scripts/ci/`, CircleCI orchestrates them, and Render deploys only after external checks pass.

This architecture is also the fallback when GitHub Actions or Vercel cannot execute. A blocked GitHub Actions job or Vercel preview is not counted as release evidence.

## Trust boundaries

- **GitHub**: source, pull requests, commit identity and check/status aggregation.
- **CircleCI**: application verification, browser tests, security scans, signer verification, production image builds and exact-SHA CI evidence.
- **Render dashboard**: AgentPay Next.js application/API and database migrations. It never receives chain signing private keys.
- **Render combined facilitator**: Hedera and Arc signing/execution capability boundary plus the Cardano x402 verification/settlement boundary.
- **Render Cardano signer gateway**: constructs the deliberately narrow Cardano transaction and delegates only the transaction-body hash to the external Ed25519/HSM-style custody service.
- **Render resource server**: x402 resource advertisement and settlement verification calls. Cardano USDCx remains disabled until its canary/evidence gate is satisfied.
- **External Ed25519/HSM custody**: production Cardano private signing material. It is not stored in GitHub, CircleCI, the dashboard, or a Docker image.

## CircleCI workflow

`.circleci/config.yml` runs the `agentpay-production` workflow.

Required jobs:

1. `verify`
   - installs the exact repository dependency graph with `npm ci`
   - starts a disposable PostgreSQL 17 service
   - deploys Prisma migrations and checks resource data
   - runs governance verification
   - runs dashboard lint, typecheck, unit tests and production build
   - runs Hedera, Arc, combined-facilitator and resource-server builds/tests
   - runs the dashboard Playwright smoke suite
2. `security`
   - production dependency audit
   - OSV Scanner
   - Semgrep OWASP rules
   - Gitleaks release-tree secret scan
   - stores machine-readable security artifacts
3. `codeql`
   - downloads the pinned CodeQL bundle
   - verifies its SHA-256 checksum
   - analyzes JavaScript/TypeScript
   - stores SARIF
   - fails closed when the selected code-scanning suite reports a result
4. `cardano-signer`
   - signer typecheck/test
   - signer production image build
   - never supplies signing material as a Docker build argument
5. `container-builds`
   - facilitator
   - Arc facilitator
   - combined facilitator
   - resource server
6. `release-gate`
   - runs only after all jobs above succeed
   - requires the checked-out Git SHA to equal `CIRCLE_SHA1`
   - records the Git tree SHA and CircleCI execution identifiers
   - creates a checksummed `ci-release-manifest.json`
   - explicitly does **not** claim that external launch evidence has been satisfied

Generated reports are stored as CircleCI artifacts and the local `artifacts/` directory is gitignored.

## Provider-independent CI scripts

The release logic is not embedded in CircleCI-specific YAML. CircleCI calls:

- `scripts/ci/verify.sh`
- `scripts/ci/security.sh`
- `scripts/ci/codeql.sh`
- `scripts/ci/cardano-signer.sh`
- `scripts/ci/container-builds.sh`
- `scripts/ci/release-gate.sh`

These scripts are the canonical release checks and can be executed by another controlled CI runner if CircleCI is unavailable.

## Render Blueprint

`render.yaml` defines:

- `agentpay-cardano-signer-preprod`
- `agentpay-facilitator`
- `agentpay-resource-server`
- `agentpay-dashboard`

All services use `autoDeployTrigger: checksPass`. Production preview environments are disabled so a pull request cannot accidentally receive production credentials through an automatically generated preview service.

The dashboard's build, pre-deploy migration and start commands all call the exact-release guard in `scripts/render/release-sha.sh`. The deployed Git checkout must equal Render's `RENDER_GIT_COMMIT`; the script exports that immutable commit as `RELEASE_SHA` for the process.

The same helper derives the dashboard's namespaced facilitator URLs from one `AGENTPAY_FACILITATOR_ORIGIN`:

- Hedera: `<origin>/hedera`
- Arc: `<origin>/arc`
- Cardano Preprod: `<origin>/cardano`

This avoids duplicating service URLs and avoids unsupported string interpolation in Blueprint configuration.

## Render secret setup

`sync: false` values must be supplied through Render during initial Blueprint setup (or explicitly updated in the Render dashboard afterward).

At minimum, production operators must supply the values marked `sync: false` in `render.yaml`, including database/auth-provider configuration, real rail account identifiers, Cardano Blockfrost access, Arc payer address/private-key boundary inputs, Cardano signer custody inputs and provider addresses.

`KEY_ENCRYPTION_MASTER_KEY` has a stricter contract than a generic generated secret: it must be exactly 32 random bytes encoded as **43-character unpadded base64url**.

The Cardano settlement-store capability is generated once on `agentpay-facilitator` and shared to the dashboard through `fromService`. Its endpoint must be set exactly to:

`https://<agentpay-dashboard-host>/api/v1/internal/cardano-settlement-claims`

The combined facilitator rejects a non-HTTPS settlement-store URL in production.

Do not put Hedera operator keys, Hedera payer keys, Arc payer/relayer/contract private keys, a Cardano signing seed, or the external HSM/Ed25519 custody secret into the dashboard environment.

## Activation sequence

1. Connect the GitHub repository to CircleCI using the CircleCI GitHub integration.
2. Configure CircleCI to run the repository `.circleci/config.yml` for pull requests and branch pushes.
3. Run the full `agentpay-production` workflow for the exact production-hardening commit.
4. Inspect all stored security/test artifacts. A skipped, canceled or infrastructure-rejected job is not green evidence.
5. Add the resulting CircleCI check names to the repository's required PR checks only after the first successful real execution proves the integration is reporting statuses correctly.
6. Create or sync the Render Blueprint from `render.yaml`.
7. Supply every required `sync: false` production value. Use separate credentials for every capability that the application requires to be distinct.
8. Set `CARDANO_SETTLEMENT_STORE_URL` to the exact HTTPS dashboard endpoint above.
9. Deploy the same immutable Git SHA that passed CircleCI. Render must report successful build, pre-deploy migration, start and health check for that commit.
10. Perform staging/sandbox smoke checks before enabling any production financial rail.
11. Only after the replacement path has produced real green exact-SHA evidence should GitHub Actions/Vercel checks be removed from the required release path.

The existing GitHub workflows may remain in the repository as a secondary implementation until the replacement path has executed successfully. Their failure to start because of an account/infrastructure problem is not treated as an application failure, but neither is it treated as a pass.

## External production gates remain mandatory

Passing CircleCI and deploying successfully to Render does not establish all facts required for production. The release still needs evidence tied to the same immutable release SHA for every applicable launch gate, including:

- authenticated Pyth production access/feed IDs and failure drills
- Masumi Registry/Payment credentials plus escrow/result/refund/dispute drills
- reviewed Veridian/KERIA verification including negative/revocation cases
- published Dune query/visualization/dashboard evidence
- funded Cardano Preprod canaries
- separately isolated Cardano Mainnet custody and deliberately low-value canonical USDCx canary before Mainnet enablement
- remote Ed25519/HSM custody review
- production DNS/TLS and secret management
- monitoring, paging and named on-call
- database PITR and recorded restore drill
- incident exercise
- independent security assessment
- Stripe/LI.FI approvals/canaries if those optional rails are enabled

Do not mark the production-hardening PR ready or merge it until exact-head executable checks and all applicable external evidence gates are satisfied.
