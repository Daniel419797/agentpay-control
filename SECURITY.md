# Security Policy

AgentPay controls payment credentials, spending policy, approvals, and settlement workflows. Security reports should be handled privately and should include enough evidence to reproduce and assess the issue without exposing real credentials or funds.

## Supported versions

Security fixes are applied to the current `master` branch and the latest production release derived from it. Older unreleased commits are not maintained as separate supported versions.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability, leaked secret, authentication bypass, cross-tenant access issue, signing weakness, settlement ambiguity, SSRF path, webhook-verification issue, or other security-sensitive defect.

Use GitHub's private vulnerability reporting / repository security advisory flow when it is enabled for this repository. If that private flow is unavailable, contact the repository owner privately through GitHub and provide only the minimum information needed to establish a secure reporting channel.

A useful report includes:

- affected route, component, or workflow;
- attacker prerequisites and expected trust boundary;
- reproducible steps using test accounts and non-production funds;
- concrete impact and relevant logs or transaction identifiers with secrets removed;
- suggested remediation when known.

Never include private keys, API keys, session cookies, raw card data, unrestricted provider credentials, or other live secrets in an issue, pull request, screenshot, or report attachment.

## Response and remediation

Security reports are triaged by exploitability and impact. Payment authorization, cross-tenant access, credential disclosure, signature/settlement integrity, and arbitrary contract execution are treated as high-priority classes. A validated vulnerability should be fixed on a dedicated branch, covered by a regression test when practical, reviewed, and deployed from an immutable commit SHA.

If active compromise is suspected, use the organization kill switch and provider-side revocation/freeze controls, rotate affected credentials, preserve audit and provider evidence, and reconcile any ambiguous blockchain or fiat submission before retrying it.

## Production security requirements

Production releases must pass repository CI, CodeQL, dependency review for changed dependencies, database migration checks, governance verification, unit/browser tests, and container builds. Production configuration must fail closed when required secrets or payment dependencies are absent. Signing, settlement, and contract-execution credentials must remain capability-scoped; the combined facilitator additionally requires separate credentials for Hedera and Arc.

Production private keys should be held by a KMS/HSM or external signer rather than ordinary application configuration wherever the provider/network supports it. Dashboard/browser services must never receive facilitator private keys.
