# AgentPay Dune Analytics

**Status:** Current analytics documentation  
**Updated:** 2026-08-22  
**Primary builder:** Daniel Praise (`Daniel419797`)

These queries expose **public Cardano settlement activity only**. Dune is not in the payment authorization, policy, signing, submission, custody or reconciliation critical path.

## Where Dune sits in the architecture

```text
AgentPay policy / signing / facilitator
            |
            v
         Cardano
            |
            +----> Blockfrost evidence -> AgentPay reconciliation
            |
            `----> Dune public analytics
```

Dune cannot authorize, deny, sign, submit or settle a transaction. A Dune outage must not block AgentPay payments.

## Queries

The checked-in SQL targets Dune's Cardano public-chain datasets and is intended to expose public settlement activity for the configured provider/asset profile.

Before presenting any Dune dashboard as validated production/pilot evidence:

1. publish/execute the real queries;
2. verify the configured provider address/native-asset unit;
3. cross-check sample transaction hashes/timestamps against independent Cardano evidence;
4. record the real query/dashboard identifiers;
5. keep observed analytics separate from proposal targets or synthetic fixtures.

## Reproducible publishing

`publish.mjs` creates or updates the public Dune queries through Dune's Query API. It substitutes only validated public deployment facts into the SQL.

```bash
export DUNE_API_KEY='<write-scoped Dune key>'
export DUNE_PROVIDER_ADDRESS='<exact Cardano provider address>'
export DUNE_USDCX_ASSET_UNIT='<exact Cardano native-asset unit>'
node analytics/dune/publish.mjs
```

To update existing queries:

```bash
export DUNE_AGENTPAY_OVERVIEW_QUERY_ID='<verified query id>'
export DUNE_AGENTPAY_ACTIVITY_QUERY_ID='<verified query id>'
node analytics/dune/publish.mjs
```

Do not commit a write-scoped Dune API key. Query-management access is an external deployment credential, not source-code evidence.

## Dashboard publishing

Where supported/configured, use the checked-in dashboard publishing script after the underlying queries are real and verified:

```bash
node analytics/dune/publish-dashboard.mjs
```

A dashboard/query ID must not be invented merely to satisfy documentation or a proposal field.

## AgentPay runtime environment

The dashboard can read completed Dune results using a read-scoped API key:

```env
DUNE_ANALYTICS_ENABLED=true
DUNE_API_KEY=<read-scoped Dune API key>
DUNE_AGENTPAY_OVERVIEW_QUERY_ID=<verified query id>
DUNE_AGENTPAY_ACTIVITY_QUERY_ID=<verified query id>
DUNE_AGENTPAY_SAMPLE_QUERY_ID=<verified sample query id>
DUNE_DASHBOARD_URL=<public dashboard URL>
```

Runtime Dune access is observability only. If Dune is unavailable, AgentPay should degrade the analytics view rather than change payment authorization/settlement behavior.

## Privacy boundary

Do not publish private AgentPay data to Dune, including:

- organization/user identifiers that are not already public chain facts;
- API keys or credentials;
- private prompts/job inputs;
- organization spending policy;
- private resource contents/responses;
- external custody credentials/signer secrets;
- internal approval/audit details unrelated to public chain evidence.

## Scope and limitations

The checked-in templates identify public Cardano activity using configured public addresses/assets. They do not prove customer adoption, exact business volume, pilot conversion or production readiness by themselves.

Public-chain transaction counts, distinct wallets and observed fees may be useful Catalyst evidence **only when derived from real qualifying activity and clearly reported as observed values**. Proposal targets are separate planning commitments.

See [`../../docs/catalyst-submission.md`](../../docs/catalyst-submission.md) and [`../../docs/production-readiness.md`](../../docs/production-readiness.md).