# AgentPay Dune analytics

These queries expose **public Cardano settlement activity only**. Dune is an observability surface; it is not in the payment authorization, signing, settlement, policy, or reconciliation critical path.

## Queries

The checked-in SQL targets Dune's current `cardano.transaction` dataset and uses the documented `input_count` / `output_count` fields. Before any public launch, execute the queries and compare a sample of returned transactions with independent Cardano explorer evidence.

### Reproducible publishing

`publish.mjs` creates or updates the two public Dune queries through Dune's Query API. It substitutes only two public deployment facts into the SQL and rejects malformed values before making an API call.

```bash
export DUNE_API_KEY='<write-scoped Dune key>'
export DUNE_PROVIDER_ADDRESS='<exact Cardano provider address>'
export DUNE_USDCX_ASSET_UNIT='<exact Cardano native-asset unit>'
node analytics/dune/publish.mjs
```

To update existing queries instead of creating new ones:

```bash
export DUNE_AGENTPAY_OVERVIEW_QUERY_ID='<verified query id>'
export DUNE_AGENTPAY_ACTIVITY_QUERY_ID='<verified query id>'
node analytics/dune/publish.mjs
```

Do not commit the write-scoped Dune key. Query creation/update requires a Dune account/API plan that supports Query Management; that is a deployment credential, not source code.

After publishing:

1. Execute both queries.
2. Manually compare sample transaction hashes/timestamps with Cardano explorer evidence.
3. Build a public Dune dashboard from those verified queries.
4. Configure AgentPay with a **read-scoped** Dune key for runtime analytics.

Do not add private AgentPay organization IDs, user identifiers, API keys, policy facts, prompts, purposes, or resource response contents to Dune.

## AgentPay runtime environment

The dashboard reads already-computed Dune results using a read-scoped API key:

```env
DUNE_ANALYTICS_ENABLED=true
DUNE_API_KEY=<read-scoped Dune API key>
DUNE_AGENTPAY_OVERVIEW_QUERY_ID=<verified query id>
DUNE_AGENTPAY_ACTIVITY_QUERY_ID=<verified query id>
DUNE_DASHBOARD_URL=<public dashboard URL>
```

`GET /api/v1/analytics/dune` is authenticated and returns the latest completed query results. A Dune outage is deliberately reported as degraded observability and must never block a payment.

## Scope and limitations

The templates use the public `cardano.transaction` dataset to identify transactions whose outputs contain the configured provider address. The USDCx transaction count additionally matches the configured native-asset unit in the public output data. These templates intentionally do **not** claim exact USDCx volume until the deployed Dune query has been validated against the current decoded Cardano native-asset output schema and explorer evidence.

Query IDs and the dashboard URL are deployment facts. They must not be fabricated or committed as fake production values.
