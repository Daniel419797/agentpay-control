import { spawnSync } from "node:child_process";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
function numeric(name, value) {
  if (!/^\d+$/.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}
function run(args) {
  const bin = process.env.DUNE_CLI_BIN || "dune";
  const result = spawnSync(bin, [...args, "--api-key", required("DUNE_API_KEY"), "-o", "json"], { encoding: "utf8", shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`DUNE_CLI_FAILED:${result.stderr.slice(0, 1000)}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`DUNE_CLI_JSON_INVALID:${result.stdout.slice(0, 500)}`); }
}
function findId(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (Number.isInteger(candidate)) return String(candidate);
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) return candidate;
  }
  for (const candidate of Object.values(value)) {
    const found = findId(candidate, keys);
    if (found) return found;
  }
  return undefined;
}

const overviewQueryId = numeric("DUNE_AGENTPAY_OVERVIEW_QUERY_ID", required("DUNE_AGENTPAY_OVERVIEW_QUERY_ID"));
const activityQueryId = numeric("DUNE_AGENTPAY_ACTIVITY_QUERY_ID", required("DUNE_AGENTPAY_ACTIVITY_QUERY_ID"));

let overviewVizId = process.env.DUNE_AGENTPAY_OVERVIEW_VIZ_ID?.trim();
if (!overviewVizId) {
  const created = run(["viz", "create", "--query-id", overviewQueryId, "--name", "AgentPay Cardano settlement overview", "--type", "table", "--options", process.env.DUNE_OVERVIEW_VIZ_OPTIONS_JSON || "{}"]);
  overviewVizId = findId(created, ["id", "visualization_id", "visualizationId"]);
}
numeric("DUNE_AGENTPAY_OVERVIEW_VIZ_ID", overviewVizId || "");

let activityVizId = process.env.DUNE_AGENTPAY_ACTIVITY_VIZ_ID?.trim();
if (!activityVizId) {
  const created = run(["viz", "create", "--query-id", activityQueryId, "--name", "AgentPay Cardano daily activity", "--type", "table", "--options", process.env.DUNE_ACTIVITY_VIZ_OPTIONS_JSON || "{}"]);
  activityVizId = findId(created, ["id", "visualization_id", "visualizationId"]);
}
numeric("DUNE_AGENTPAY_ACTIVITY_VIZ_ID", activityVizId || "");

let dashboardId = process.env.DUNE_AGENTPAY_DASHBOARD_ID?.trim();
let dashboard;
if (dashboardId) {
  numeric("DUNE_AGENTPAY_DASHBOARD_ID", dashboardId);
  dashboard = run(["dashboard", "get", dashboardId]);
} else {
  dashboard = run([
    "dashboard", "create", "--name", process.env.DUNE_DASHBOARD_NAME || "AgentPay on Cardano",
    "--visualization-ids", `${overviewVizId},${activityVizId}`,
    "--columns-per-row", "2",
    "--text-widgets", JSON.stringify([{ text: "# AgentPay on Cardano\nPublic on-chain settlement evidence for AgentPay Cardano payments. No organization, user, prompt, policy, or resource-content data is published." }]),
  ]);
  dashboardId = findId(dashboard, ["id", "dashboard_id", "dashboardId"]);
}
if (!dashboardId) throw new Error("DUNE_DASHBOARD_ID_MISSING");

console.log(JSON.stringify({
  overviewQueryId: Number(overviewQueryId),
  activityQueryId: Number(activityQueryId),
  overviewVisualizationId: Number(overviewVizId),
  activityVisualizationId: Number(activityVizId),
  dashboardId: Number(dashboardId),
  dashboard,
}, null, 2));
