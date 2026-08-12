# AgentPay Catalyst architecture

## Product boundary

AgentPay is the financial-control and treasury layer for autonomous software agents. It does not claim to have invented x402, Masumi, Pyth, USDCx, KERI, or Dune. It composes those systems around a policy engine that limits what an autonomous agent may spend, with whom, on which network/asset, and under what approval conditions.

```mermaid
flowchart TD
  Org[Organization] --> AP[AgentPay control plane]
  AP --> Policy[Budgets / policy / approvals / emergency stop]
  AP --> Identity[Masumi registry + Veridian/KERI trust]
  AP --> Oracle[Pyth USD valuation]
  AP --> Agent[Autonomous agent credential]
  Agent -->|HTTP x402 exact| Resource[x402 resource]
  Agent -->|Masumi MIP-003 job| Seller[Masumi seller agent]
  Policy --> Direct[Direct Cardano x402 rail]
  Policy --> Escrow[Masumi escrow purchase rail]
  Direct --> Signer[Isolated Cardano signer gateway]
  Signer --> HSM[Remote Ed25519 / HSM boundary]
  Direct --> Facilitator[Independent Cardano facilitator]
  Facilitator --> Cardano[Cardano]
  Escrow --> MasumiPay[Masumi Payment Service]
  MasumiPay --> Cardano
  Cardano --> Blockfrost[Blockfrost reconciliation evidence]
  Cardano --> Dune[Dune public analytics]
  Blockfrost --> AP
  Dune --> AP
```

## Trust boundaries

1. **Dashboard/control plane**: tenant identity, policy, approvals, spend reservations, immutable audit, reconciliation and release evidence. No Cardano private signing key.
2. **Cardano signer gateway**: builds only the narrow supported ADA/whitelisted-native-token transaction shape. Production raw seeds are prohibited.
3. **Remote signer/HSM**: signs only the Cardano transaction-body hash. The gateway verifies the returned Ed25519 signature.
4. **Facilitator**: independently decodes and verifies CBOR, payer credential, inputs, outputs, resource binding, asset conservation, fee, TTL and replay state before submission.
5. **Masumi Registry**: agent identity/discovery and seller payment information. AgentPay pins trusted RegistrySource policy IDs and verifies the seller Cardano address payment credential against the reported payment-key hash.
6. **Masumi Payment Service**: separate escrow lifecycle. It is never silently treated as direct x402.
7. **Pyth Hermes**: optional USD valuation dependency. Failure/staleness/uncertainty can only make an oracle-governed payment more restrictive.
8. **Veridian/KERIA**: cryptographic KERI/ACDC verification authority. AgentPay pins allowed issuers and schemas instead of reimplementing KERI/CESR cryptography.
9. **Dune**: public read-only Cardano analytics. It cannot authorize, sign or settle payments.
10. **Blockfrost**: independent Cardano settlement/release evidence used for reconciliation and canary verification.

## Cardano payment modes

### Direct x402

- `cardano:preprod` and `cardano:mainnet`
- scheme `exact`
- ADA uses `lovelace`
- one explicitly whitelisted native token may be enabled
- Mainnet `USDCX` is pinned to the canonical Circle xReserve Cardano asset identity
- every requirement carries SHA-256 resource binding
- server submission and explicit L1 confirmation policy
- payer-only inputs and change
- no scripts, minting, certificates, withdrawals, collateral, bootstrap witnesses, auxiliary data or unrelated native assets

### Masumi escrow

- MIP-003 seller job startup/status
- exact Masumi agent identity and Cardano seller credential verification
- policy evaluation before purchase creation
- durable AgentPay purchase state
- ambiguous provider submission remains reconcilable
- `FundsLockingRequested → FundsLocked → ResultSubmitted → Completed`
- refund/dispute states tracked separately
- result hash verified against the exact returned result string before completion is considered verified
- completed/refund/dispute outcomes feed AgentPay's evidence-backed seller reputation score

## Policy composition

A payment may require all of the following simultaneously:

- atomic asset limit
- USD Pyth-valued transaction/hour/day/month limits
- merchant/resource allowlist
- Cardano network/asset allowlist
- verified Masumi agent identifier/capability
- minimum observed completed-purchase history
- minimum observed Masumi escrow reputation score
- trusted KERI credential issuer/schema
- human approval threshold

The final outcome is the most restrictive of the applicable controls.

## Observability

Public Dune data and private AgentPay aggregates are deliberately separated. Dune shows defensible public chain facts. AgentPay's authenticated analytics can show logical agent count, provider count, policy denials, approvals, verified Masumi outcomes and settlement latency without publishing private tenant identities.
