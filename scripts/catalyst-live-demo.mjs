import { createHash, randomUUID } from "node:crypto";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
function appUrl(path) { return new URL(path, required("CATALYST_APP_URL")).toString(); }
function jsonHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function requestJson(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(90_000), headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 1000) }; }
  if (!response.ok) { const error = new Error(`HTTP_${response.status}:${JSON.stringify(body).slice(0, 1000)}`); error.status = response.status; error.body = body; throw error; }
  return body?.data ?? body;
}

function findCardanoTxHash(value) {
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (["transaction", "transactionId", "candidateTransactionId"].includes(key)) {
      const direct = findCardanoTxHash(child); if (direct) return direct;
    }
  }
  for (const child of Object.values(value)) { const found = findCardanoTxHash(child); if (found) return found; }
  return undefined;
}

async function directCanary({ agentId, credential, resourceUrl, evidenceType, network, asset }) {
  const result = await requestJson(appUrl(`/api/v1/agents/${agentId}/paid-requests`), {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "idempotency-key": `catalyst-${evidenceType.toLowerCase()}-${randomUUID()}` },
    body: JSON.stringify({ resourceUrl, purpose: `Catalyst release canary ${evidenceType}` }),
  });
  const transactionId = findCardanoTxHash(result);
  if (!transactionId) throw new Error(`${evidenceType}_TRANSACTION_EVIDENCE_MISSING`);
  await attest({ evidenceType, network, asset, transactionId, evidence: { source: "catalyst-live-demo", resourceUrl, responseHash: jsonHash(result), observedAt: new Date().toISOString() } });
  return { evidenceType, transactionId };
}

async function attest(body) {
  return requestJson(appUrl("/api/v1/organization/release-evidence"), {
    method: "POST",
    headers: { authorization: `Bearer ${required("RELEASE_EVIDENCE_API_KEY")}` },
    body: JSON.stringify({ releaseSha: required("RELEASE_SHA"), ...body }),
  });
}

async function masumiCanary() {
  const agentId = required("CATALYST_MASUMI_AGENT_ID"), credential = required("CATALYST_MASUMI_AGENT_CREDENTIAL");
  const inputData = JSON.parse(required("CATALYST_MASUMI_INPUT_JSON"));
  const started = await requestJson(appUrl("/api/v1/masumi/purchases"), {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "idempotency-key": `catalyst-masumi-${randomUUID()}` },
    body: JSON.stringify({ agentId, resourceListingId: required("CATALYST_MASUMI_RESOURCE_LISTING_ID"), inputData, purpose: "Catalyst autonomous agent-to-agent escrow canary" }),
  });
  const purchaseId = started.escrowPurchaseId ?? started.id;
  if (!purchaseId || typeof purchaseId !== "string") throw new Error("MASUMI_CANARY_PURCHASE_ID_MISSING");
  const deadline = Date.now() + Number(process.env.CATALYST_MASUMI_TIMEOUT_MS || 10 * 60_000);
  let state;
  while (Date.now() < deadline) {
    const current = await requestJson(appUrl(`/api/v1/masumi/purchases/${purchaseId}`), { headers: { authorization: `Bearer ${credential}` } });
    state = current.state;
    if (state === "Completed") {
      if (!current.resultHash || !current.resultVerifiedAt) throw new Error("MASUMI_RESULT_NOT_VERIFIED");
      await attest({ evidenceType: "MASUMI_ESCROW_COMPLETED", network: current.network, asset: "", evidence: { purchaseId, blockchainIdentifier: current.blockchainIdentifier, resultHash: current.resultHash, completedAt: current.completedAt } });
      await attest({ evidenceType: "MASUMI_RESULT_HASH_VERIFIED", network: current.network, asset: "", evidence: { purchaseId, resultHash: current.resultHash, resultVerifiedAt: current.resultVerifiedAt } });
      return current;
    }
    if (["FAILED", "RefundAuthorized", "Disputed"].includes(state)) throw new Error(`MASUMI_CANARY_TERMINAL_${state}`);
    await sleep(5000);
  }
  throw new Error(`MASUMI_CANARY_TIMEOUT:${state ?? "UNKNOWN"}`);
}

async function pythAndDuneEvidence() {
  const ready = await requestJson(appUrl("/api/v1/ready"));
  if (!ready.catalyst?.liveDependencies?.pyth) throw new Error("PYTH_LIVE_DEPENDENCY_EVIDENCE_MISSING");
  await attest({ evidenceType: "PYTH_LIVE_FEEDS", evidence: ready.catalyst.liveDependencies.pyth });
  const dashboardUrl = required("DUNE_DASHBOARD_URL");
  const dune = ready.catalyst?.liveDependencies?.dune;
  if (!dune?.overviewQueryId) throw new Error("DUNE_LIVE_DEPENDENCY_EVIDENCE_MISSING");
  await attest({ evidenceType: "DUNE_PUBLISHED", evidence: { dashboardUrl, overviewQueryId: dune.overviewQueryId, activityQueryId: dune.activityQueryId } });
  await attest({ evidenceType: "DUNE_SAMPLE_VERIFIED", evidence: { dashboardUrl, executedAt: dune.executedAt, verificationNote: required("DUNE_SAMPLE_VERIFICATION_NOTE") } });
}

if (process.env.CATALYST_LIVE_CANARY_ACK !== "I_UNDERSTAND_THIS_SPENDS_REAL_FUNDS") throw new Error("CATALYST_LIVE_CANARY_ACK_REQUIRED");
if (new URL(required("CATALYST_APP_URL")).protocol !== "https:") throw new Error("CATALYST_APP_HTTPS_REQUIRED");
if (!/^[0-9a-f]{40}$/.test(required("RELEASE_SHA"))) throw new Error("RELEASE_SHA_INVALID");

const results = [];
results.push(await directCanary({ agentId: required("CATALYST_PREPROD_AGENT_ID"), credential: required("CATALYST_PREPROD_AGENT_CREDENTIAL"), resourceUrl: required("CATALYST_PREPROD_ADA_RESOURCE_URL"), evidenceType: "CARDANO_PREPROD_ADA_CANARY", network: "cardano:preprod", asset: "lovelace" }));
results.push(await directCanary({ agentId: required("CATALYST_PREPROD_AGENT_ID"), credential: required("CATALYST_PREPROD_AGENT_CREDENTIAL"), resourceUrl: required("CATALYST_PREPROD_TOKEN_RESOURCE_URL"), evidenceType: "CARDANO_PREPROD_TOKEN_CANARY", network: "cardano:preprod", asset: required("CARDANO_PREPROD_USDCX_ASSET_ID") }));
results.push(await directCanary({ agentId: required("CATALYST_MAINNET_AGENT_ID"), credential: required("CATALYST_MAINNET_AGENT_CREDENTIAL"), resourceUrl: required("CATALYST_MAINNET_USDCX_RESOURCE_URL"), evidenceType: "CARDANO_MAINNET_USDCX_CANARY", network: "cardano:mainnet", asset: required("CARDANO_MAINNET_USDCX_ASSET_ID") }));
results.push({ masumi: await masumiCanary() });
await pythAndDuneEvidence();
console.log(JSON.stringify({ releaseSha: process.env.RELEASE_SHA, results }, null, 2));
