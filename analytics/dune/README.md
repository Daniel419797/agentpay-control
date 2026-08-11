# AgentPay Dune analytics

These queries expose **public Cardano settlement activity only**. Dune is an observability surface; it is not in the payment authorization, signing, settlement, or reconciliation critical path.

## Queries

1. Create a Dune query from `agentpay_cardano_overview.sql`.
2. Create a second query from `agentpay_cardano_activity.sql`.
3. Configure both with:
   - `provider_address`: the exact Cardano payee address being observed.
   - `usdcx_asset_unit`: the exact lower-case USDCx Cardano asset unit used by the deployment.
4. Execute both queries and manually compare a sample of returned transaction hashes/timestamps with Cardano explorer evidence before publishing the dashboard.
5. Build a public Dune dashboard from those verified queries.

Do not add private AgentPay organization IDs, user identifiers, API keys, policy facts, prompts, or resource response contents to Dune.

## AgentPay environment

The dashboard reads already-computed Dune results using a read-scoped API key:

```env
DUNE_ANALYTICS_ENABLED=true
DUNE_API_KEY=<read-scoped Dune API key>
DUNE_AGENTPAY_OVERVIEW_QUERY_ID=<verified query id>
DUNE_AGENTPAY_ACTIVITY_QUERY_ID=<verified query id>
DUNE_DASHBOARD_URL=<public dashboard URL>
```

`GET /api/v1/analytics/dune` is authenticated and returns the latest completed query results. A Dune outage must never block a payment.

## Scope and limitations

The templates use the public `cardano.transaction` dataset to identify transactions whose outputs contain the configured provider address. The USDCx transaction count additionally matches the configured asset unit in the public output data. These templates intentionally do **not** claim exact USDCx volume until the deployed Dune query has been validated against the current decoded Cardano native-asset output schema and explorer evidence.

Query IDs and the dashboard URL are deployment facts. They must not be fabricated or committed as fake production values.
