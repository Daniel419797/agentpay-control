# AgentPay Catalyst pitch

## 30-second pitch

AI agents can now discover services and pay autonomously, but businesses cannot safely solve that by handing software an unrestricted wallet. AgentPay is the financial-control layer for autonomous agents on Cardano. It combines Cardano x402 and USDCx/ADA settlement with Pyth-valued budgets, verified Masumi counterparties, optional KERI credentials, approvals, reconciliation and emergency shutdown. The agent remains autonomous inside a programmable financial boundary.

## 60-second pitch

Cardano now has the primitives for machine payments and agent-to-agent commerce. The remaining organizational problem is governance: who is an agent allowed to pay, how much may it spend, which asset may it use, when must a human approve, and what happens when a network response is ambiguous?

AgentPay answers those questions before and after settlement. A policy can cap spend in USD using Pyth, require a trusted Masumi agent and capability, require an independently verified KERI credential, and route either a direct Cardano x402 payment or a separate Masumi escrow purchase. Cardano signing stays outside the dashboard, settlement is independently reconciled, and a public Dune dashboard provides verifiable chain activity without exposing private business context.

We are not replacing Cardano ecosystem infrastructure—we are composing it into the treasury and control plane organizations need to let agents spend safely.

## Judge questions

### Why not just use Masumi?

We do use Masumi. Masumi provides agent identity/discovery and an optional escrow purchase lifecycle. AgentPay handles the organization's budgets, approvals, policy composition, treasury controls, signer permissions, emergency stop, reconciliation and audit evidence.

### Why Pyth?

Organizations think in business budgets such as `$50/day`, not an arbitrary ADA quantity. AgentPay uses a fresh, confidence-bounded Pyth observation and values the payment at the conservative upper confidence edge. Oracle failure cannot relax an existing atomic limit.

### Why USDCx?

Stable-value settlement makes autonomous budgeting and service pricing easier to reason about. AgentPay pins Mainnet USDCx to the canonical Cardano asset identity rather than allowing an arbitrary token to be relabelled USDCx.

### What stops a compromised agent from draining the wallet?

The agent credential does not decide policy and does not hold the production Cardano signing key. AgentPay enforces transaction/hour/day/month limits, counterparty rules and approval thresholds; the signer/facilitator enforce a narrow transaction shape; emergency stop blocks new AgentPay-controlled spending.

### What if settlement times out?

AgentPay does not assume timeout means failure. The exact candidate transaction is retained and independently reconciled from Cardano evidence instead of blindly resubmitting.

### Is the Dune dashboard fake demo data?

No. The code deliberately shows no placeholder live metrics. Dune query IDs/dashboard URLs are deployment facts. Release readiness requires a published dashboard and transaction samples independently cross-checked against Blockfrost.

### How is seller reputation calculated?

AgentPay does not invent a Masumi-native score. Its policy score is derived from AgentPay-observed, linked escrow outcomes: verified completed results versus refunds, disputes and failed purchases, with a configurable minimum completed-history requirement.

### What does Veridian add?

Masumi identity and Cardano seller-key verification can be complemented by a KERI/ACDC credential. AgentPay delegates cryptographic verification to a KERIA verifier and pins acceptable issuer AIDs and schema SAIDs in policy.

### What proves production readiness?

The exact release SHA must pass repository/security checks and have real evidence for the enabled production profile: Cardano canaries, live Pyth, Masumi and Veridian checks, published/verified Dune analytics, external signing custody, monitoring/on-call, restore drill, incident exercise and independent security assessment. Source code alone is not called a production launch.
