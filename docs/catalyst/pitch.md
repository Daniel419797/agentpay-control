# AgentPay Catalyst pitch

## 30-second pitch

AI agents can now discover services and pay autonomously, but businesses cannot safely solve that by handing software an unrestricted wallet. AgentPay is the financial-control layer for autonomous agents on Cardano. It combines Cardano x402 and USDCx/ADA settlement with Pyth-valued budgets, verified Masumi counterparties, optional KERI credentials, approvals, reconciliation and emergency shutdown. On Cardano Mainnet, an autonomous managed agent can use its own externally custodied Ed25519 signer identity rather than a shared platform wallet.

## 60-second pitch

Cardano now has the primitives for machine payments and agent-to-agent commerce. The remaining organizational problem is governance: who is an agent allowed to pay, how much may it spend, which asset may it use, when must a human approve, and what happens when a network response is ambiguous?

AgentPay answers those questions before and after settlement. A policy can cap spend in USD using Pyth, require a trusted Masumi agent and capability, require an independently verified KERI credential, and route either a direct Cardano x402 payment or a separate Masumi escrow purchase. Cardano signing stays outside the dashboard. Preprod managed agents use isolated testnet identities; Mainnet managed agents use a distinct external HSM/KMS/delegation signer identity per Agent ID, while self custody remains available. AgentPay derives the Mainnet payer address from the public key and verifies every returned signature before settlement is independently reconciled.

We are not replacing Cardano ecosystem infrastructure—we are composing it into the treasury and control plane organizations need to let agents spend safely.

## Judge questions

### Why not just use Masumi?

We do use Masumi. Masumi provides agent identity/discovery and an optional escrow purchase lifecycle. AgentPay handles the organization's budgets, approvals, policy composition, treasury controls, signer permissions, emergency stop, reconciliation and audit evidence.

### Why Pyth?

Organizations think in business budgets such as `$50/day`, not an arbitrary ADA quantity. AgentPay uses a fresh, confidence-bounded Pyth observation and values the payment at the conservative upper confidence edge. Oracle failure cannot relax an existing atomic limit.

### Why USDCx?

Stable-value settlement makes autonomous budgeting and service pricing easier to reason about. AgentPay pins Mainnet USDCx to the configured canonical Cardano asset identity rather than allowing an arbitrary token to be relabelled USDCx.

### What stops a compromised agent from draining the wallet?

The agent credential does not decide policy and does not hold the Cardano private signing key. AgentPay enforces transaction/hour/day/month limits, counterparty rules and approval thresholds. For a Mainnet managed agent, the external custody adapter signs only the transaction-body hash for that agent's signer reference; AgentPay verifies the public identity and signature locally, and the facilitator independently verifies the final transaction shape. Emergency stop blocks new AgentPay-controlled spending.

### Is there one Mainnet master key for all agents?

No. `CARDANO_MANAGED_AGENT_MASTER_KEY` remains prohibited on Mainnet. Each externally delegated Mainnet agent resolves to its own public key and signer reference. The private key stays in the external HSM/KMS/delegation boundary.

### What if settlement times out?

AgentPay does not assume timeout means failure. The exact candidate transaction is retained and independently reconciled from Cardano evidence instead of blindly resubmitting.

### Is the Dune dashboard fake demo data?

No. The code deliberately shows no placeholder live metrics. Dune query IDs/dashboard URLs are deployment facts, and observed metrics are reported as observed metrics rather than copied from planning targets.

### How is seller reputation calculated?

AgentPay does not invent a Masumi-native score. Its policy score is derived from AgentPay-observed, linked escrow outcomes: verified completed results versus refunds, disputes and failed purchases, with a configurable minimum completed-history requirement.

### What does Veridian add?

Masumi identity and Cardano seller-key verification can be complemented by a KERI/ACDC credential. AgentPay delegates cryptographic verification to a KERIA verifier and pins acceptable issuer AIDs and schema SAIDs in policy.

### What is the current TRL?

The proposal should state TRL 5 until the intended Mainnet/pilot configuration has been demonstrated in a relevant environment. The repository now implements Mainnet external per-agent custody, but source implementation by itself is not the TRL 6 demonstration.