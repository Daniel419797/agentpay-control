import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { EvmFacilitator, envSchema } from "./evm-facilitator.js";
import { authorizationMatches, boundedJson, validateContractCall } from "./security.js";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

const env = envSchema.parse(process.env);
if (env.APP_ENV === "production" && !env.FACILITATOR_API_KEY) throw new Error("Production FACILITATOR_API_KEY is required");

const facilitator = new EvmFacilitator(env);

const contractAllowlistSchema = z.array(z.object({
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  selectors: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/)),
  maxGas: z.number().int().positive(),
  maxPayableAtomic: z.string().regex(/^\d+$/),
}));
const contractAllowlist = contractAllowlistSchema.parse(JSON.parse(env.CONTRACT_ALLOWLIST_JSON));

const contractRequestSchema = z.object({
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  functionSelector: z.string().regex(/^0x[0-9a-fA-F]{8}$/),
  calldata: z.string().regex(/^0x[0-9a-fA-F]*$/),
  gas: z.number().int().min(21000).max(15000000),
  payableAtomic: z.string().regex(/^\d+$/),
  transactionId: z.string().min(8).max(160).optional(),
});

const x402Request = z.object({
  paymentPayload: z.custom<PaymentPayload>(),
  paymentRequirements: z.custom<PaymentRequirements>(),
});

function authorized(value: string | undefined) {
  return authorizationMatches(env.FACILITATOR_API_KEY, value);
}

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", network: facilitator.network, x402Version: 2 }));

app.get("/supported", (c) => c.json({
  kinds: [{
    x402Version: 2,
    scheme: "exact",
    network: facilitator.network,
    extra: facilitator.scheme.getExtra(facilitator.network),
  }],
}));

app.post("/verify", async (c) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
  try {
    const body = x402Request.parse(await boundedJson(c.req.raw));
    return c.json(await facilitator.scheme.verify(body.paymentPayload, body.paymentRequirements));
  } catch (error) {
    return c.json({
      isValid: false,
      invalidReason: "invalid_request",
      invalidMessage: error instanceof Error ? error.message : "Invalid request",
    }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400);
  }
});

app.post("/settle", async (c) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
  try {
    const body = x402Request.parse(await boundedJson(c.req.raw));
    const verified = await facilitator.scheme.verify(body.paymentPayload, body.paymentRequirements);
    if (!verified.isValid) return c.json(verified, 422);
    return c.json(await facilitator.scheme.settle(body.paymentPayload, body.paymentRequirements));
  } catch (error) {
    return c.json({
      success: false,
      errorReason: "invalid_request",
      errorMessage: error instanceof Error ? error.message : "Invalid request",
    }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400);
  }
});

app.post("/contract-execute", async (c) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
  try {
    const body = contractRequestSchema.parse(await boundedJson(c.req.raw));
    const policyError = validateContractCall(body, contractAllowlist);
    if (policyError) return c.json({ success: false, error: policyError }, policyError === "SELECTOR_CALLDATA_MISMATCH" ? 422 : 403);

    const result = await facilitator.executeContractCall(
      body.contractAddress as `0x${string}`,
      body.calldata as `0x${string}`,
      body.gas,
      BigInt(body.payableAtomic),
    );

    return c.json({
      success: result.status,
      transactionHash: result.transactionHash,
      blockNumber: result.blockNumber?.toString(),
      status: result.status ? "SUCCESS" : "FAILED",
    });
  } catch (error) {
    console.error(error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "CONTRACT_EXECUTION_FAILED",
    }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 500);
  }
});

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay Arc facilitator listening on ${env.PORT}`);
