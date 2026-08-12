import { fetchAgentPayDuneAnalytics } from "@/lib/dune";

export const dynamic = "force-dynamic";

function value(row: Record<string, unknown> | undefined, key: string) {
  const candidate = row?.[key];
  return candidate == null ? "—" : String(candidate);
}

export default async function CardanoAnalyticsPage() {
  if (process.env.DUNE_ANALYTICS_ENABLED !== "true") {
    return <section style={{ padding: 24 }}><h1>Cardano analytics</h1><p>Dune analytics are disabled for this deployment. No placeholder metrics are shown.</p></section>;
  }

  let analytics: Awaited<ReturnType<typeof fetchAgentPayDuneAnalytics>>;
  try {
    analytics = await fetchAgentPayDuneAnalytics();
  } catch {
    return <section style={{ padding: 24 }}><h1>Cardano analytics</h1><p>Verified Dune results are currently unavailable. AgentPay does not substitute synthetic metrics.</p></section>;
  }

  const overview = analytics.overview.rows[0];
  const activity = analytics.activity?.rows ?? [];
  const metrics = [
    ["Total observed payments", value(overview, "total_transactions")],
    ["USDCx payments", value(overview, "usdcx_transactions")],
    ["ADA / other payments", value(overview, "non_usdcx_transactions")],
    ["Active days", value(overview, "active_days")],
    ["Network fees (ADA)", value(overview, "total_network_fees_ada")],
    ["Latest observed payment", value(overview, "latest_observed_payment")],
  ];

  return <section style={{ padding: 24, display: "grid", gap: 20 }}>
    <div><p style={{ margin: 0, opacity: .65 }}>Public Cardano chain evidence · Dune</p><h1 style={{ margin: "4px 0" }}>AgentPay on Cardano</h1><p style={{ margin: 0, opacity: .75 }}>Only public on-chain settlement activity is shown. Organization, user, policy, purpose, prompts and resource content are not sent to Dune.</p></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>{metrics.map(([label, metric]) => <article key={label} className="surface-card" style={{ padding: 16 }}><div style={{ fontSize: 13, opacity: .65 }}>{label}</div><strong style={{ display: "block", fontSize: 24, marginTop: 6 }}>{metric}</strong></article>)}</div>
    <article className="surface-card" style={{ padding: 16, overflowX: "auto" }}><h2>Daily activity</h2>{activity.length ? <table className="data-table"><thead><tr><th>Day</th><th>Transactions</th><th>USDCx</th><th>ADA / other</th><th>Fees (ADA)</th></tr></thead><tbody>{activity.map((row, index) => <tr key={`${String(row.day ?? "day")}-${index}`}><td>{value(row, "day")}</td><td>{value(row, "transactions")}</td><td>{value(row, "usdcx_transactions")}</td><td>{value(row, "non_usdcx_transactions")}</td><td>{value(row, "network_fees_ada")}</td></tr>)}</tbody></table> : <p>No completed public activity rows are available yet.</p>}</article>
    <div style={{ fontSize: 13, opacity: .7 }}>Overview query #{analytics.overview.queryId}{analytics.activity ? ` · Activity query #${analytics.activity.queryId}` : ""}{analytics.overview.executedAt ? ` · Last executed ${analytics.overview.executedAt}` : ""}{analytics.dashboardUrl ? <> · <a href={analytics.dashboardUrl} target="_blank" rel="noreferrer">Open public Dune dashboard</a></> : null}</div>
  </section>;
}
