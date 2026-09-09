import { ChallengeRequiredError, SubmissionUnknownError, executeCheckout } from "./checkout.mjs";
import { retrieveCardSecrets } from "./stripe.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const apiOrigin = new URL(required("AGENTPAY_API_ORIGIN"));
if (apiOrigin.username || apiOrigin.password || apiOrigin.hash || apiOrigin.search) throw new Error("AGENTPAY_API_ORIGIN_INVALID");
if ((process.env.NODE_ENV ?? "production") === "production" && apiOrigin.protocol !== "https:") throw new Error("AGENTPAY_API_ORIGIN_HTTPS_REQUIRED");
if (!["http:", "https:"].includes(apiOrigin.protocol)) throw new Error("AGENTPAY_API_ORIGIN_INVALID");
const sharedSecret = required("CARD_EXECUTOR_SHARED_SECRET");
if (sharedSecret.length < 32) throw new Error("CARD_EXECUTOR_SHARED_SECRET_TOO_SHORT");
const concurrency = Math.min(4, Math.max(1, Number(process.env.CARD_EXECUTOR_CONCURRENCY ?? "1") || 1));
const pollMs = Math.min(10_000, Math.max(250, Number(process.env.CARD_EXECUTOR_POLL_INTERVAL_MS ?? "1000") || 1000));
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    console.log(JSON.stringify({ event: "card_executor_shutdown_requested", signal }));
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function agentPay(path, body) {
  const response = await fetch(new URL(path, apiOrigin), {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${sharedSecret}`, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof payload.code === "string" && /^[A-Z0-9_]{2,120}$/.test(payload.code) ? payload.code : `AGENTPAY_HTTP_${response.status}`;
    const error = new Error(code);
    error.status = response.status;
    throw error;
  }
  return payload.data ?? payload;
}

async function lease() { return await agentPay("/api/internal/card-executor/lease"); }
async function heartbeat(task) { return await agentPay(`/api/internal/card-executor/${task.purchaseId}/heartbeat`, { leaseToken: task.leaseToken }); }
async function checkpointSubmission(task) { return await agentPay(`/api/internal/card-executor/${task.purchaseId}/submit`, { leaseToken: task.leaseToken }); }
async function complete(task, result) {
  return await agentPay(`/api/internal/card-executor/${task.purchaseId}/complete`, {
    leaseToken: task.leaseToken,
    status: result.status,
    resultCode: result.resultCode,
    resultUrl: result.finalUrl,
    resultSummary: {
      verification: result.verification ?? "NONE",
      challengeType: result.challengeType,
      finalHost: result.finalUrl ? new URL(result.finalUrl).hostname : undefined,
    },
  });
}

function safeFailureCode(error) {
  if (error instanceof SubmissionUnknownError) return error.message;
  if (error instanceof ChallengeRequiredError) return "CHECKOUT_REQUIRES_HUMAN";
  const message = error instanceof Error ? error.message : "CHECKOUT_EXECUTION_FAILED";
  return /^[A-Z0-9_]{2,120}$/.test(message) ? message : "CHECKOUT_EXECUTION_FAILED";
}

async function executeTask(task) {
  if (!task?.purchaseId || !task.leaseToken || !task.externalCardId || !task.checkoutPlan) throw new Error("EXECUTOR_TASK_INVALID");
  let secrets;
  let merchantCredentialBoundaryRecorded = false;
  try {
    secrets = await retrieveCardSecrets(task.externalCardId);
    const result = await executeCheckout({
      task,
      secrets,
      heartbeat: () => heartbeat(task),
      checkpointSubmission: async () => {
        await checkpointSubmission(task);
        merchantCredentialBoundaryRecorded = true;
      },
    });
    await complete(task, result);
    console.log(JSON.stringify({ event: "card_purchase_completed", purchaseId: task.purchaseId, status: result.status, resultCode: result.resultCode }));
  } catch (error) {
    const resultCode = safeFailureCode(error);
    const requiresHuman = merchantCredentialBoundaryRecorded || error instanceof SubmissionUnknownError || error instanceof ChallengeRequiredError;
    const result = {
      status: requiresHuman ? "REQUIRES_HUMAN" : "CHECKOUT_FAILED",
      resultCode: requiresHuman && !(error instanceof ChallengeRequiredError) && !resultCode.startsWith("SUBMISSION_") && resultCode !== "MERCHANT_CREDENTIAL_OUTCOME_UNKNOWN" ? "SUBMISSION_UNKNOWN" : resultCode,
      challengeType: error instanceof ChallengeRequiredError ? error.challengeType : undefined,
    };
    try { await complete(task, result); }
    catch { /* stale post-boundary leases are recovered server-side as REQUIRES_HUMAN and never retried */ }
    console.log(JSON.stringify({ event: "card_purchase_stopped", purchaseId: task.purchaseId, status: result.status, resultCode: result.resultCode }));
  } finally {
    secrets = null;
  }
}

async function worker(index) {
  console.log(JSON.stringify({ event: "card_executor_worker_started", worker: index }));
  while (!stopping) {
    try {
      const task = await lease();
      if (!task) { await sleep(pollMs); continue; }
      await executeTask(task);
    } catch (error) {
      console.error(JSON.stringify({ event: "card_executor_loop_error", worker: index, code: safeFailureCode(error) }));
      if (!stopping) await sleep(Math.max(pollMs, 1_000));
    }
  }
  console.log(JSON.stringify({ event: "card_executor_worker_stopped", worker: index }));
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
