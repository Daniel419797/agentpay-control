import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CARDANO_ADDRESS = /^addr1[0-9a-z]{20,180}$/;
const CARDANO_ASSET_UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
function sqlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }
function render(sql, providerAddress, assetUnit) {
  return sql.replaceAll("'{{provider_address}}'", sqlLiteral(providerAddress)).replaceAll("'{{usdcx_asset_unit}}'", sqlLiteral(assetUnit));
}
async function dune(path, init = {}) {
  const apiKey = required("DUNE_API_KEY");
  const response = await fetch(`https://api.dune.com/api/v1${path}`, { ...init, redirect: "error", headers: { accept: "application/json", "x-dune-api-key": apiKey, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  const text = await response.text(); let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`DUNE_API_${response.status}:${JSON.stringify(body).slice(0, 500)}`);
  return body;
}
async function publishOne({ file, name, description, existingId }) {
  const providerAddress = required("DUNE_PROVIDER_ADDRESS").toLowerCase(), assetUnit = required("DUNE_USDCX_ASSET_UNIT").toLowerCase();
  if (!CARDANO_ADDRESS.test(providerAddress)) throw new Error("DUNE_PROVIDER_ADDRESS_INVALID");
  if (!CARDANO_ASSET_UNIT.test(assetUnit)) throw new Error("DUNE_USDCX_ASSET_UNIT_INVALID");
  const template = await readFile(join(here, file), "utf8"), querySql = render(template, providerAddress, assetUnit);
  if (querySql.includes("{{")) throw new Error(`DUNE_TEMPLATE_UNRESOLVED:${file}`);
  if (existingId) {
    if (!/^\d+$/.test(existingId)) throw new Error(`DUNE_QUERY_ID_INVALID:${file}`);
    const updated = await dune(`/query/${existingId}`, { method: "PATCH", body: JSON.stringify({ query_id: Number(existingId), query_sql: querySql, name, description, is_private: false }) });
    return { queryId: Number(updated.query_id ?? existingId), action: "updated" };
  }
  const created = await dune("/query", { method: "POST", body: JSON.stringify({ name, description, query_sql: querySql, is_private: false }) });
  if (!Number.isInteger(created.query_id)) throw new Error(`DUNE_QUERY_CREATE_RESPONSE_INVALID:${file}`);
  return { queryId: created.query_id, action: "created" };
}

const overview = await publishOne({ file: "agentpay_cardano_overview.sql", name: "AgentPay Cardano x402 Overview", description: "Public on-chain AgentPay Cardano x402 settlement activity. Contains no private AgentPay application data.", existingId: process.env.DUNE_AGENTPAY_OVERVIEW_QUERY_ID });
const activity = await publishOne({ file: "agentpay_cardano_activity.sql", name: "AgentPay Cardano x402 Daily Activity", description: "Daily public Cardano transaction activity for the configured AgentPay provider address.", existingId: process.env.DUNE_AGENTPAY_ACTIVITY_QUERY_ID });
const sample = await publishOne({ file: "agentpay_cardano_sample.sql", name: "AgentPay Cardano Verification Sample", description: "Recent public Cardano transaction hashes used only for independent Blockfrost/explorer verification of the AgentPay Dune dashboard.", existingId: process.env.DUNE_AGENTPAY_SAMPLE_QUERY_ID });

console.log(JSON.stringify({ overview, activity, sample }, null, 2));
