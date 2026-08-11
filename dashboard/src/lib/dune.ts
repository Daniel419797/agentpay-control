import { z } from "zod";

const resultSchema = z.object({
  query_id: z.number().int().positive(), state: z.string(), submitted_at: z.string().optional().nullable(), execution_ended_at: z.string().optional().nullable(),
  result: z.object({ metadata: z.object({ row_count: z.number().int().nonnegative().optional(), total_row_count: z.number().int().nonnegative().optional(), column_names: z.array(z.string()).optional() }).passthrough(), rows: z.array(z.record(z.string(), z.unknown())) }).optional(),
}).passthrough();

export type DuneConfig = { apiUrl: string; apiKey: string; overviewQueryId: number; activityQueryId?: number; sampleQueryId?: number; dashboardUrl?: string; timeoutMs: number };
function positiveInt(name: string, value: string | undefined, required = false): number | undefined {
  if (!value) { if (required) throw new Error(`${name}_REQUIRED`); return undefined; }
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name}_INVALID`); return parsed;
}
export function duneConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DuneConfig {
  const apiUrl = (env.DUNE_API_URL || "https://api.dune.com/api/v1").replace(/\/$/, ""), apiKey = env.DUNE_API_KEY || "";
  const overviewQueryId = positiveInt("DUNE_AGENTPAY_OVERVIEW_QUERY_ID", env.DUNE_AGENTPAY_OVERVIEW_QUERY_ID, true)!;
  const activityQueryId = positiveInt("DUNE_AGENTPAY_ACTIVITY_QUERY_ID", env.DUNE_AGENTPAY_ACTIVITY_QUERY_ID);
  const sampleQueryId = positiveInt("DUNE_AGENTPAY_SAMPLE_QUERY_ID", env.DUNE_AGENTPAY_SAMPLE_QUERY_ID, env.CATALYST_PRODUCTION_ENABLED === "true");
  const timeoutMs = positiveInt("DUNE_REQUEST_TIMEOUT_MS", env.DUNE_REQUEST_TIMEOUT_MS) ?? 7000;
  if (timeoutMs < 500 || timeoutMs > 15000) throw new Error("DUNE_REQUEST_TIMEOUT_MS_INVALID");
  if (!apiKey || apiKey.length < 20) throw new Error("DUNE_API_KEY_REQUIRED");
  if (new URL(apiUrl).protocol !== "https:" && env.APP_ENV === "production") throw new Error("DUNE_HTTPS_REQUIRED");
  if (env.DUNE_DASHBOARD_URL && new URL(env.DUNE_DASHBOARD_URL).protocol !== "https:") throw new Error("DUNE_DASHBOARD_URL_HTTPS_REQUIRED");
  return { apiUrl, apiKey, overviewQueryId, activityQueryId, sampleQueryId, dashboardUrl: env.DUNE_DASHBOARD_URL, timeoutMs };
}
export async function fetchDuneQueryResult(queryId: number, config: DuneConfig = duneConfigFromEnv()) {
  const response = await fetch(`${config.apiUrl}/query/${queryId}/results?limit=500`, { headers: { "X-Dune-Api-Key": config.apiKey, accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs) });
  if (!response.ok) throw new Error(`DUNE_PROVIDER_${response.status}`);
  const parsed = resultSchema.parse(await response.json());
  if (parsed.query_id !== queryId) throw new Error("DUNE_QUERY_ID_MISMATCH");
  if (parsed.state !== "QUERY_STATE_COMPLETED" || !parsed.result) throw new Error("DUNE_QUERY_RESULT_NOT_READY");
  return { queryId, rows: parsed.result.rows, metadata: parsed.result.metadata, executedAt: parsed.execution_ended_at ?? parsed.submitted_at ?? null };
}
export async function fetchAgentPayDuneAnalytics(config: DuneConfig = duneConfigFromEnv()) {
  const [overview, activity, sample] = await Promise.all([
    fetchDuneQueryResult(config.overviewQueryId, config),
    config.activityQueryId ? fetchDuneQueryResult(config.activityQueryId, config) : Promise.resolve(null),
    config.sampleQueryId ? fetchDuneQueryResult(config.sampleQueryId, config) : Promise.resolve(null),
  ]);
  return { overview, activity, sample, dashboardUrl: config.dashboardUrl ?? null };
}
export function duneReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.DUNE_ANALYTICS_ENABLED !== "true") return [];
  try { duneConfigFromEnv(env); return []; }
  catch (error) { return [error instanceof Error ? error.message : "DUNE_CONFIG_INVALID"]; }
}
