# AgentPay Security Threat Model

The authoritative full threat model is maintained at [`../docs/threat-model.md`](../docs/threat-model.md). This path exists for security tooling and reviewers that expect security-specific material under `security/`.

The core invariants are:

- organization data and authority remain tenant-isolated;
- agent credentials never become unrestricted payment/private-key authority;
- published policy and required approvals are enforced server-side;
- managed blockchain payment identities are unique per agent and network;
- payment context cannot change after authorization without a new decision;
- possible financial side effects are reconciled rather than blindly retried;
- provider/network completion requires validated evidence;
- required Pyth, Masumi, Veridian/KERI, Moove, Stripe, Blockfrost, or other provider evidence fails closed when invalid or mismatched;
- raw card data, blockchain private keys, custody keys, and provider restricted keys are excluded from normal agent/browser APIs;
- emergency controls can block new risky side effects while reconciliation remains possible.

Review [`../SECURITY.md`](../SECURITY.md) for vulnerability reporting and [`../docs/production-readiness.md`](../docs/production-readiness.md) for release criteria.
