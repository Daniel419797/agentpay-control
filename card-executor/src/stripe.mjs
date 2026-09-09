import { request as httpsRequest } from "node:https";

import { resolvePublicHost } from "./security.mjs";

const STRIPE_HOST = "api.stripe.com";
const MAX_RESPONSE_BYTES = 64 * 1024;

function stripeKey() {
  const key = process.env.STRIPE_ISSUING_RESTRICTED_KEY;
  if (!key || !key.startsWith("rk_") || key.length < 20) throw new Error("STRIPE_ISSUING_RESTRICTED_KEY_REQUIRED");
  return key;
}

function pinnedLookup(pin) {
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, [{ address: pin.address, family: pin.family }]);
    else callback(null, pin.address, pin.family);
  };
}

async function stripeGet(path) {
  const pin = await resolvePublicHost(STRIPE_HOST);
  return await new Promise((resolve, reject) => {
    const req = httpsRequest({
      protocol: "https:",
      hostname: STRIPE_HOST,
      servername: STRIPE_HOST,
      port: 443,
      path,
      method: "GET",
      lookup: pinnedLookup(pin),
      timeout: 10_000,
      headers: {
        authorization: `Bearer ${stripeKey()}`,
        "user-agent": "agentpay-card-executor/0.1",
        "stripe-version": process.env.STRIPE_ISSUING_API_VERSION ?? "2026-06-24.dahlia",
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error("STRIPE_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body;
        try { body = JSON.parse(text); } catch { reject(new Error("STRIPE_RESPONSE_INVALID")); return; }
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) { reject(new Error(`STRIPE_CARD_RETRIEVAL_FAILED_${res.statusCode ?? 500}`)); return; }
        resolve(body);
      });
    });
    req.on("timeout", () => req.destroy(new Error("STRIPE_CARD_RETRIEVAL_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

export async function retrieveCardSecrets(externalCardId) {
  if (!/^ic_[A-Za-z0-9_]+$/.test(externalCardId)) throw new Error("STRIPE_CARD_ID_INVALID");
  const query = new URLSearchParams();
  query.append("expand[]", "number");
  query.append("expand[]", "cvc");
  const card = await stripeGet(`/v1/issuing/cards/${encodeURIComponent(externalCardId)}?${query.toString()}`);
  if (!card || typeof card !== "object") throw new Error("STRIPE_CARD_RESPONSE_INVALID");
  const number = typeof card.number === "string" ? card.number : "";
  const cvc = typeof card.cvc === "string" ? card.cvc : "";
  const expMonth = Number(card.exp_month);
  const expYear = Number(card.exp_year);
  if (!/^\d{12,19}$/.test(number) || !/^\d{3,4}$/.test(cvc) || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12 || !Number.isInteger(expYear) || expYear < 2020 || expYear > 2200) throw new Error("STRIPE_CARD_DETAILS_UNAVAILABLE");
  return { number, cvc, expMonth, expYear };
}
