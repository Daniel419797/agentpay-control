import { createHash } from "node:crypto";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
function appUrl(path) { return new URL(path, required("CATALYST_APP_URL")).toString(); }
function stableHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function requestJson(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(90_000), headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`HTTP_${response.status}:${JSON.stringify(body).slice(0, 1000)}`);
  return body?.data ?? body;
}

async function attest(body) {
  return requestJson(appUrl("/api/v1/organization/release-evidence"), {
    method: "POST",
    headers: { authorization: `Bearer ${required("RELEASE_EVIDENCE_API_KEY")}` },
    body: JSON.stringify({ releaseSha: required("RELEASE_SHA"), ...body }),
  });
}

async function verifyCanaryEvidence(name, evidenceType, network, asset) {
  const transactionId = required(name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(transactionId)) throw new Error(`${name}_INVALID`);
  await attest({ evidenceType, network, asset, transactionId, evidence: { source: "operator-executed-canary", transactionId, operatorEvidenceUrl: process.env[`${name}_EVIDENCE_URL`] || null, recordedAt: new Date().toISOString() } });
  return { evidenceType, transactionId };
}

async function dependencyEvidence() {
  const verified = await requestJson(appUrl("/api/v1/internal/catalyst-dependencies"), { headers: { authorization: `Bearer ${required("RELEASE_EVIDENCE_API_KEY")}` } });
  const dependencies = verified.dependencies;
  if (!dependencies?.pyth?.ada || !dependencies?.pyth?.usdcx) throw new Error("PYTH_LIVE_DEPENDENCY_EVIDENCE_MISSING");
  await attest({ evidenceType: "PYTH_LIVE_FEEDS", evidence: dependencies.pyth });
  const dune = dependencies.dune;
  if (!dune?.overviewQueryId || !dune?.sampleQueryId || !Array.isArray(dune.independentlyVerifiedTransactionIds) || !dune.independentlyVerifiedTransactionIds.length) throw new Error("DUNE_LIVE_DEPENDENCY_EVIDENCE_MISSING");
  await attest({ evidenceType: "DUNE_PUBLISHED", evidence: { dashboardUrl: required("DUNE_DASHBOARD_URL"), overviewQueryId: dune.overviewQueryId, activityQueryId: dune.activityQueryId, sampleQueryId: dune.sampleQueryId } });
  await attest({ evidenceType: "DUNE_SAMPLE_VERIFIED", evidence: { dashboardUrl: required("DUNE_DASHBOARD_URL"), executedAt: dune.executedAt, blockfrostVerifiedTransactionIds: dune.independentlyVerifiedTransactionIds } });
  return dependencies;
}

async function masumiEvidence() {
  const purchaseId = required("CATALYST_MASUMI_PURCHASE_ID"), agentId = required("CATALYST_MASUMI_AGENT_ID"), credential = required("CATALYST_MASUMI_AGENT_CREDENTIAL");
  const purchase = await requestJson(appUrl(`/api/v1/masumi/purchases/${purchaseId}`), { headers: { authorization: `Bearer ${credential}` } });
  if (String(purchase.agentId) !== agentId) throw new Error("MASUMI_CANARY_AGENT_MISMATCH");
  if (purchase.state !== "Completed" || !purchase.resultHash || !purchase.resultVerifiedAt) throw new Error("MASUMI_CANARY_NOT_VERIFIED_COMPLETE");
  await attest({ evidenceType: "MASUMI_ESCROW_COMPLETED", network: purchase.network, evidence: { purchaseId, blockchainIdentifier: purchase.blockchainIdentifier, resultHash: purchase.resultHash, completedAt: purchase.completedAt, evidenceHash: stableHash(purchase) } });
  await attest({ evidenceType: "MASUMI_RESULT_HASH_VERIFIED", network: purchase.network, evidence: { purchaseId, resultHash: purchase.resultHash, resultVerifiedAt: purchase.resultVerifiedAt } });
  return purchase;
}

if (new URL(required("CATALYST_APP_URL")).protocol !== "https:") throw new Error("CATALYST_APP_HTTPS_REQUIRED");
if (!/^[0-9a-f]{40}$/.test(required("RELEASE_SHA"))) throw new Error("RELEASE_SHA_INVALID");

const results = [];
results.push(await verifyCanaryEvidence("CATALYST_PREPROD_ADA_TX", "CARDANO_PREPROD_ADA_CANARY", "cardano:preprod", "lovelace"));
results.push(await verifyCanaryEvidence("CATALYST_PREPROD_TOKEN_TX", "CARDANO_PREPROD_TOKEN_CANARY", "cardano:preprod", required("CARDANO_PREPROD_USDCX_ASSET_ID")));
results.push(await verifyCanaryEvidence("CATALYST_MAINNET_USDCX_TX", "CARDANO_MAINNET_USDCX_CANARY", "cardano:mainnet", required("CARDANO_MAINNET_USDCX_ASSET_ID")));
results.push({ masumi: await masumiEvidence() });
results.push({ dependencies: await dependencyEvidence() });
console.log(JSON.stringify({ releaseSha: process.env.RELEASE_SHA, results }, null, 2));
