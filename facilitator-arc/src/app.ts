import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { EvmFacilitator, envSchema } from "./evm-facilitator.js";
import { boundedJson, capabilityAuthorizationMatches, logFailure, publicFailure, validateContractCall } from "./security.js";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

export type ArcFacilitatorEnv = z.infer<typeof envSchema>;

function normalizePrivateKey(value: string) {
  return value.replace(/^0x/i, "").toLowerCase();
}

function validManagedMasterKey(value: string | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").length === 32);
}

export function parseArcEnv(input: unknown = process.env): ArcFacilitatorEnv {
  const env = envSchema.parse(input);
  if (env.APP_ENV === "production") {
    const capabilityKeys = [env.MANAGED_SIGNING_API_KEY, env.SETTLEMENT_API_KEY, env.CONTRACT_EXECUTION_API_KEY];
    if (capabilityKeys.some((key) => !key)) throw new Error("Production capability-specific facilitator API keys are required");
    if (new Set(capabilityKeys).size !== capabilityKeys.length) throw new Error("Production capability-specific facilitator API keys must be distinct");
    if (!validManagedMasterKey(env.ARC_MANAGED_AGENT_MASTER_KEY)) throw new Error("Production Arc managed agents require a 32-byte ARC_MANAGED_AGENT_MASTER_KEY");
    if (!env.ARC_RELAYER_PRIVATE_KEY || !env.ARC_CONTRACT_EXECUTION_PRIVATE_KEY) throw new Error("Production Arc relayer and contract-execution private keys are required");
    const chainKeys = [env.ARC_PAYER_PRIVATE_KEY, env.ARC_RELAYER_PRIVATE_KEY, env.ARC_CONTRACT_EXECUTION_PRIVATE_KEY].map(normalizePrivateKey);
    if (new Set(chainKeys).size !== chainKeys.length) throw new Error("Production Arc payer, relayer, and contract-execution private keys must be distinct");
  }
  return env;
}

export function createArcApp(env: ArcFacilitatorEnv): { app: Hono; network: string } {
  const facilitator = new EvmFacilitator(env);
  const contractAllowlistSchema = z.array(z.object({ contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), selectors: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/)), maxGas: z.number().int().positive(), maxPayableAtomic: z.string().regex(/^\d+$/) }));
  const contractAllowlist = contractAllowlistSchema.parse(JSON.parse(env.CONTRACT_ALLOWLIST_JSON));
  const contractRequestSchema = z.object({ contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), functionSelector: z.string().regex(/^0x[0-9a-fA-F]{8}$/), calldata: z.string().regex(/^0x[0-9a-fA-F]*$/), gas: z.number().int().min(21000).max(15000000), payableAtomic: z.string().regex(/^\d+$/), transactionId: z.string().min(8).max(160).optional() });
  const x402Request = z.object({ paymentPayload: z.custom<PaymentPayload>(), paymentRequirements: z.custom<PaymentRequirements>() });
  const managedIdentityRequest = z.object({ agentId: z.string().uuid(), network: z.literal("eip155:5042002") });
  const managedSignRequest = z.object({ agentId: z.string().uuid(), payerAccountId: z.string().regex(/^0x[0-9a-fA-F]{40}$/), paymentRequirements: z.custom<PaymentRequirements>() });

  function authorized(capabilityKey: string | undefined, value: string | undefined) {
    return capabilityAuthorizationMatches(capabilityKey, env.FACILITATOR_API_KEY, value);
  }

  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok", network: facilitator.network, x402Version: 2, managedIdentity: "isolated-per-agent" }));
  app.get("/supported", (c) => c.json({ kinds: [{ x402Version: 2, scheme: "exact", network: facilitator.network, extra: facilitator.scheme.getExtra(facilitator.network) }] }));

  app.post("/managed-identity", async (c) => {
    if (!authorized(env.MANAGED_SIGNING_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const { agentId } = managedIdentityRequest.parse(await boundedJson(c.req.raw));
      return c.json(facilitator.managedIdentity(agentId));
    } catch (error) {
      const failure = publicFailure(error, "MANAGED_IDENTITY_PROVISIONING_FAILED", 422);
      logFailure("managed_identity_failed", error);
      return c.json({ code: failure.code }, failure.status);
    }
  });

  app.post("/managed-agent-sign", async (c) => {
    if (!authorized(env.MANAGED_SIGNING_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const { agentId, payerAccountId, paymentRequirements } = managedSignRequest.parse(await boundedJson(c.req.raw));
      if (paymentRequirements.network !== facilitator.network) return c.json({ code: "NETWORK_MISMATCH" }, 422);
      const result = await facilitator.createManagedAgentPaymentPayload(agentId, payerAccountId, paymentRequirements);
      const paymentPayload: PaymentPayload = { ...result, accepted: paymentRequirements };
      return c.json({ paymentPayload, transactionId: randomUUID() });
    } catch (error) {
      const failure = publicFailure(error, "SIGNING_FAILED", 422);
      logFailure("managed_agent_sign_failed", error);
      return c.json({ code: failure.code }, failure.status);
    }
  });

  app.post("/managed-sign", async (c) => {
    if (env.APP_ENV === "production") return c.json({ code: "SHARED_MANAGED_SIGNING_DISABLED" }, 410);
    if (!authorized(env.MANAGED_SIGNING_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const { paymentRequirements } = z.object({ paymentRequirements: z.custom<PaymentRequirements>() }).parse(await boundedJson(c.req.raw));
      if (paymentRequirements.network !== facilitator.network) return c.json({ code: "NETWORK_MISMATCH" }, 422);
      const result = await facilitator.clientScheme.createPaymentPayload(2, paymentRequirements);
      const paymentPayload: PaymentPayload = { ...result, accepted: paymentRequirements };
      return c.json({ paymentPayload, transactionId: randomUUID() });
    } catch (error) {
      const failure = publicFailure(error, "SIGNING_FAILED", 500);
      logFailure("legacy_managed_sign_failed", error);
      return c.json({ code: failure.code }, failure.status);
    }
  });

  app.post("/verify", async (c) => {
    if (!authorized(env.SETTLEMENT_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const body = x402Request.parse(await boundedJson(c.req.raw));
      return c.json(await facilitator.scheme.verify(body.paymentPayload, body.paymentRequirements));
    } catch (error) {
      const failure = publicFailure(error, "INVALID_REQUEST", 400);
      return c.json({ isValid: false, invalidReason: "invalid_request", invalidMessage: failure.code }, failure.status);
    }
  });

  app.post("/settle", async (c) => {
    if (!authorized(env.SETTLEMENT_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    let body: z.infer<typeof x402Request>;
    try {
      body = x402Request.parse(await boundedJson(c.req.raw));
      const verified = await facilitator.scheme.verify(body.paymentPayload, body.paymentRequirements);
      if (!verified.isValid) return c.json(verified, 422);
    } catch (error) {
      const failure = publicFailure(error, "INVALID_REQUEST", 400);
      return c.json({ success: false, errorReason: "invalid_request", errorMessage: failure.code }, failure.status);
    }

    const captured = await facilitator.captureSettlementEvidence(() => facilitator.scheme.settle(body.paymentPayload, body.paymentRequirements));
    if ("error" in captured) {
      logFailure("settlement_submission_unknown", captured.error);
      return c.json({
        success: false,
        transaction: captured.transactionId ?? "",
        ...(captured.transactionId ? { transactionId: captured.transactionId } : {}),
        network: facilitator.network,
        errorReason: "settlement_unknown",
        errorMessage: "SETTLEMENT_SUBMISSION_UNKNOWN",
      }, 503);
    }

    const result = captured.result;
    const evidence = result.transaction || captured.transactionId;
    if (!result.success && evidence) {
      logFailure("settlement_confirmation_unknown", new Error(result.errorReason ?? "SETTLEMENT_CONFIRMATION_UNKNOWN"));
      return c.json({
        ...result,
        success: false,
        transaction: evidence,
        transactionId: evidence,
        errorReason: "settlement_unknown",
        errorMessage: result.errorMessage ?? "SETTLEMENT_CONFIRMATION_UNKNOWN",
        network: facilitator.network,
      }, 503);
    }
    return result.success
      ? c.json({ ...result, network: result.network ?? facilitator.network })
      : c.json({ ...result, network: result.network ?? facilitator.network }, 422);
  });

  app.post("/contract-execute", async (c) => {
    if (!authorized(env.CONTRACT_EXECUTION_API_KEY, c.req.header("authorization"))) return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
    try {
      const body = contractRequestSchema.parse(await boundedJson(c.req.raw));
      const policyError = validateContractCall(body, contractAllowlist);
      if (policyError) return c.json({ success: false, error: policyError }, policyError === "SELECTOR_CALLDATA_MISMATCH" ? 422 : 403);
      const result = await facilitator.executeContractCall(body.contractAddress as `0x${string}`, body.calldata as `0x${string}`, body.gas, BigInt(body.payableAtomic));
      return c.json({ success: result.status, transactionHash: result.transactionHash, blockNumber: result.blockNumber?.toString(), status: result.status ? "SUCCESS" : "FAILED" });
    } catch (error) {
      const failure = publicFailure(error, "CONTRACT_EXECUTION_FAILED", 500);
      logFailure("contract_execution_failed", error);
      return c.json({ success: false, error: failure.code }, failure.status);
    }
  });

  return { app, network: facilitator.network };
}
