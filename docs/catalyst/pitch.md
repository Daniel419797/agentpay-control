# AgentPay Catalyst Pitch

**Updated:** 2026-08-22  
**Proposer / primary builder:** Daniel Praise (`Daniel419797`)

## Revision note

The pitch identifies Daniel Praise as the primary builder, discloses the Hedera x402 origin directly, and reflects the Cardano Mainnet per-agent external custody implementation now in the repository. TRL and pilot claims remain conservative and are not inferred from source changes alone.

## 30-second pitch

AgentPay is the financial-control layer for autonomous agents on Cardano. Instead of handing software an unrestricted wallet, it combines policy, approvals, verified counterparties, isolated per-agent payment identities and independent settlement verification. Cardano Mainnet agents can use self custody or their own externally custodied Ed25519 signer identity, so there is no shared Mainnet agent master key.

## 60-second pitch

AgentPay was originally built for the Hedera x402 bounty and later extended into a multi-rail control plane with a Cardano-specific implementation. The core problem is governance: who may an autonomous agent pay, how much may it spend, which asset can it use, when must a human approve, and what happens when a network response is ambiguous?

AgentPay answers those questions around every payment. It can enforce atomic and Pyth-valued USD budgets, verify Masumi counterparties, optionally require KERI credential evidence, route direct Cardano x402 or a separate Masumi escrow flow, and keep an auditable reservation and settlement trail. Preprod managed agents use isolated per-agent test identities. On Mainnet, self custody remains available and autonomous managed agents can use a distinct external HSM/KMS/delegation signer identity per Agent ID. AgentPay derives the payer address and verifies the signature locally; the facilitator then independently verifies the transaction and submits it through Blockfrost.

## Judge questions

### Who built AgentPay?

**Daniel Praise** (`Daniel419797`) is the repository owner and primary technical contributor.

### Was AgentPay part of another program before Catalyst?

Yes. AgentPay was originally built for the **Hedera x402 bounty**. That prior program involvement is explicitly disclosed. Catalyst scope should describe Cardano-specific and pilot work and should not treat previously completed Hedera work as new Catalyst-funded delivery.

### Why not just use Masumi?

AgentPay uses Masumi rather than replacing it. Masumi can provide agent identity and discovery and a separate escrow purchase lifecycle. AgentPay adds the organization's budgets, approvals, reservations, custody boundaries, emergency controls, settlement reconciliation and audit layer.

### Why Pyth?

Organizations often reason in business budgets such as USD/day, while Cardano settlement amounts are atomic asset quantities. AgentPay can apply fresh, confidence-bounded Pyth observations to calculate a conservative USD valuation. Oracle failure cannot relax an existing atomic policy.

### Why USDCx?

When enabled, stable-value settlement makes machine-service pricing and budgeting easier to reason about. AgentPay does not accept arbitrary Cardano tokens as "USDCx"; Mainnet configuration is pinned to the configured canonical asset identity.

### What prevents a compromised agent from draining funds?

The agent credential does not control policy and does not receive the private signing key. AgentPay enforces published limits, reservations, counterparty rules and approvals before signing. Managed payment identities are isolated per agent. For Cardano Mainnet external custody, only the transaction-body hash is sent to the exact agent's signer reference, the returned signature is verified locally, and the facilitator independently verifies the completed transaction before submission.

### Is there one Cardano Mainnet master key for all agents?

No. `CARDANO_MANAGED_AGENT_MASTER_KEY` is prohibited on Mainnet. Each externally managed Mainnet agent resolves to its own external Ed25519 public key and signer reference and locally derived `addr1...` address.

### Does AgentPay hold those Mainnet private keys?

No. The external HSM/KMS/delegation provider retains them. AgentPay stores and uses only the public identity and signer reference needed for the bounded signing interaction.

### Who submits the Cardano transaction?

The **facilitator**. The Cardano signer constructs and signs the transaction and returns CBOR. The facilitator independently verifies the final transaction and submits it through Blockfrost, then checks confirmation evidence.

### What happens if submission times out?

AgentPay does not assume timeout means failure. It preserves the candidate transaction and durable claim state and reconciles independent chain evidence instead of blindly issuing another payment.

### Is Dune part of payment authorization?

No. Dune is public, read-only analytics. A Dune outage cannot authorize, block, sign or settle an AgentPay payment.

### How is seller reputation calculated?

AgentPay's policy signal is derived from AgentPay-observed, linked Masumi escrow outcomes such as verified completions, refunds, disputes and failures. It is not presented as a native Masumi reputation score.

### What does Veridian/KERI add?

Where configured, AgentPay can require a verified ACDC credential whose issuer, schema, identity and freshness satisfy policy. Cryptographic KERI verification is delegated to the configured KERIA authority; AgentPay applies its additional trust constraints.

### What is the current TRL?

**TRL 5.** The repository now implements Mainnet external per-agent custody, but TRL 6 should only be claimed after the intended Mainnet and pilot configuration is demonstrated in a relevant environment.

### What about the previous 3,000-transaction, fee and user assumptions?

Repository documentation does not treat proposal planning numbers as accomplished evidence. Any revised Catalyst targets must be internally consistent with the real acquisition model, external-wallet count, expected transaction frequency, pilot duration and realistic Cardano fees. Actual results must be reported from confirmed activity.

## Closing

AgentPay does not replace Cardano ecosystem primitives. It composes them into the financial boundary organizations need before autonomous agents can safely spend.