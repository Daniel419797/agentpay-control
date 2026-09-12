# AgentPay Dune Analytics

Read-only public Cardano analytics for AgentPay settlement activity.

Dune is deliberately outside AgentPay's authorization, policy, signing, custody, submission, and reconciliation critical path.

```text
AgentPay -> Cardano settlement
            |\
            | +-> Blockfrost/chain evidence -> AgentPay reconciliation
            |
            +-> Dune public analytics
```

A Dune outage may degrade analytics views but must not change whether AgentPay authorizes or considers a payment settled.

## Queries and publishing

Checked-in SQL targets public Cardano datasets. `publish.mjs` can create/update queries using verified public deployment facts such as the relevant provider address/asset unit.

Typical publishing environment:

```text
DUNE_API_KEY=<write-scoped key>
DUNE_PROVIDER_ADDRESS=<verified public Cardano address>
DUNE_USDCX_ASSET_UNIT=<verified native-asset unit>
```

Optional existing query IDs can be supplied when updating previously published queries. `publish-dashboard.mjs` handles dashboard publishing where the configured account/API supports it.

Never commit a Dune API key or invent query/dashboard IDs.

## Runtime analytics

The AgentPay dashboard may read completed query results using read-scoped configuration such as query IDs and a public dashboard URL. Runtime Dune data is observability only.

## Privacy boundary

Only public chain facts belong in Dune-facing analytics. Do not publish:

- private organization/user identifiers;
- agent credentials;
- prompts/job inputs;
- private policy/approval records;
- provider/custody secrets;
- non-public resource content;
- raw internal audit metadata not already represented by public chain facts.

## Verification

Before relying on a chart/report, cross-check sample transaction hashes, timestamps, addresses, and asset units against independent Cardano evidence. Analytics counts are observations from the selected query scope, not payment authorization truth.

See [`../../docs/cardano-production.md`](../../docs/cardano-production.md) and [`../../docs/production-readiness.md`](../../docs/production-readiness.md).
