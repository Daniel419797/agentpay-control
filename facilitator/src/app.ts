import { AccountId, Client, ContractExecuteTransaction, ContractId, Hbar, PrivateKey, TransactionId } from "@hiero-ledger/sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  createHederaClient,
  createClientHederaSigner,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  inspectHederaTransaction,
  toFacilitatorHederaSigner
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import { Hono } from "hono";
import { z } from "zod";
import { boundedJson, capabilityAuthorizationMatches, logFailure, publicFailure, validateContractCall } from "./security.js";

const keyTypeSchema = z.enum(["ECDSA", "ED25519"]);
export const hederaEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string(),
  HEDERA_OPERATOR_KEY: z.string(),
  HEDERA_OPERATOR_KEY_TYPE: keyTypeSchema.optional(),
  HEDERA_PAYER_ID: z.string(),
  HEDERA_PAYER_KEY: z.string(),
  HEDERA_PAYER_KEY_TYPE: keyTypeSchema.optional(),
  FACILITATOR_API_KEY: z.string().min(32).optional(),
  MANAGED_SIGNING_API_KEY: z.string().min(32).optional(),
  SETTLEMENT_API_KEY: z.string().min(32).optional(),
  CONTRACT_EXECUTION_API_KEY: z.string().min(32).optional(),
  CONTRACT_ALLOWLIST_JSON: z.string().default("[]"),
  PORT: z.coerce.number().default(8787),
});

export type HederaFacilitatorEnv = z.infer<typeof hederaEnvSchema>;
type HederaKeyType = z.infer<typeof keyTypeSchema>;

function rawPrivateKey(value: string) {
  const normalized = value.replace(/^0x/i, "");
  return /^[0-9a-fA-F]{64}$/.test(normalized) ? normalized.toLowerCase() : undefined;
}

function canonicalPrivateKeyInput(value: string) {
  return rawPrivateKey(value) ?? value;
}

function requireRawKeyType(name: string, value: string, keyType: HederaKeyType | undefined) {
  if (rawPrivateKey(value) && !keyType) throw new Error(`${name}_TYPE is required for raw 64-hex private keys`);
}

export function parseHederaEnv(input: unknown = process.env): HederaFacilitatorEnv {
  const env = hederaEnvSchema.parse(input);
  requireRawKeyType("HEDERA_OPERATOR_KEY", env.HEDERA_OPERATOR_KEY, env.HEDERA_OPERATOR_KEY_TYPE);
  requireRawKeyType("HEDERA_PAYER_KEY", env.HEDERA_PAYER_KEY, env.HEDERA_PAYER_KEY_TYPE);
  if (env.APP_ENV === "production") {
    const capabilityKeys = [env.MANAGED_SIGNING_API_KEY, env.SETTLEMENT_API_KEY, env.CONTRACT_EXECUTION_API_KEY];
    if (capabilityKeys.some((key) => !key)) throw new Error("Production capability-specific facilitator API keys are required");
    if (new Set(capabilityKeys).size !== capabilityKeys.length) throw new Error("Production capability-specific facilitator API keys must be distinct");
    if (canonicalPrivateKeyInput(env.HEDERA_OPERATOR_KEY) === canonicalPrivateKeyInput(env.HEDERA_PAYER_KEY)) {
      throw new Error("Production settlement and managed payer keys must be distinct");
    }
  }
  if (env.APP_ENV !== "production" && env.HEDERA_NETWORK === "mainnet") throw new Error("Mainnet is prohibited outside production");
  return env;
}

function parsePrivateKey(value: string, keyType: HederaKeyType | undefined) {
  const raw = rawPrivateKey(value);
  if (!raw) return PrivateKey.fromString(value);
  if (keyType === "ECDSA") return PrivateKey.fromStringECDSA(raw);
  if (keyType === "ED25519") return PrivateKey.fromStringED25519(raw);
  throw new Error("HEDERA_PRIVATE_KEY_TYPE_REQUIRED");
}

function settlementTransactionCandidate(paymentPayload: PaymentPayload): string | undefined {
  const payload = paymentPayload.payload as Record<string, unknown> | undefined;
  const transaction = payload?.transaction;
  if (!transaction) return undefined;
  try {
    const inspected = inspectHederaTransaction(transaction as never);
    return inspected.transactionId || undefined;
  } catch {
    return undefined;
  }
}

export function createHederaApp(env: HederaFacilitatorEnv): { app: Hono; network: string } {
  function authorized(capabilityKey: string | undefined, value: string | undefined) {
    return capabilityAuthorizationMatches(capabilityKey, env.FACILITATOR_API_KEY, value);
  }
  const client = env.HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const operatorKey = parsePrivateKey(env.HEDERA_OPERATOR_KEY, env.HEDERA_OPERATOR_KEY_TYPE);
  client.setOperator(AccountId.fromString(env.HEDERA_OPERATOR_ID), operatorKey);
  const payerKey = parsePrivateKey(env.HEDERA_PAYER_KEY, env.HEDERA_PAYER_KEY_TYPE);
  const caipNetwork = `hedera:${env.HEDERA_NETWORK}`;
  const managedClientSigner = createClientHederaSigner(env.HEDERA_PAYER_ID, payerKey, { network: caipNetwork });
  const x402Signer = toFacilitatorHederaSigner({
    getAddresses: () => [env.HEDERA_OPERATOR_ID],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction((network) => createHederaClient(network), operatorKey),
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  });
  const x402Scheme = new ExactHederaScheme(x402Signer);
  const contractAllowlistSchema = z.array(z.object({contractId:z.string().regex(/^0\.0\.\d+$/),selectors:z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/)),maxGas:z.number().int().positive(),maxPayableAtomic:z.string().regex(/^\d+$/)}));
  const contractAllowlist = contractAllowlistSchema.parse(JSON.parse(env.CONTRACT_ALLOWLIST_JSON));
  const contractRequestSchema = z.object({contractId:z.string().regex(/^0\.0\.\d+$/),functionSelector:z.string().regex(/^0x[0-9a-fA-F]{8}$/),calldata:z.string().regex(/^0x[0-9a-fA-F]*$/),gas:z.number().int().min(21000).max(15000000),payableAtomic:z.string().regex(/^\d+$/),transactionId:z.string().min(8).max(160)});
  const x402Request = z.object({paymentPayload:z.custom<PaymentPayload>(),paymentRequirements:z.custom<PaymentRequirements>()});

  const app = new Hono();
  app.get("/health", c => c.json({ status: "ok", network: env.HEDERA_NETWORK, x402Version: 2 }));
  app.get("/supported", c => c.json({ kinds: [{ x402Version: 2, scheme: "exact", network: caipNetwork, extra: x402Scheme.getExtra(caipNetwork) }] }));
  app.post("/managed-sign", async c => {
    if (!authorized(env.MANAGED_SIGNING_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const { paymentRequirements } = z.object({ paymentRequirements: z.custom<PaymentRequirements>() }).parse(await boundedJson(c.req.raw));
      if (paymentRequirements.network !== caipNetwork) return c.json({ code: "NETWORK_MISMATCH" }, 422);
      const transaction = await managedClientSigner.createPartiallySignedTransferTransaction(paymentRequirements);
      const inspected = inspectHederaTransaction(transaction);
      const paymentPayload: PaymentPayload = { x402Version: 2, accepted: paymentRequirements, payload: { transaction } };
      return c.json({ paymentPayload, transactionId: inspected.transactionId });
    } catch (error) {
      const failure = publicFailure(error, "SIGNING_FAILED", 500);
      logFailure("managed_sign_failed", error);
      return c.json({ code: failure.code }, failure.status);
    }
  });
  app.post("/verify", async c => {
    if (!authorized(env.SETTLEMENT_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const body = x402Request.parse(await boundedJson(c.req.raw));
      return c.json(await x402Scheme.verify(body.paymentPayload, body.paymentRequirements));
    } catch (error) {
      const failure = publicFailure(error, "INVALID_REQUEST", 400);
      return c.json({ isValid: false, invalidReason: "invalid_request", invalidMessage: failure.code }, failure.status);
    }
  });
  app.post("/settle", async c => {
    if (!authorized(env.SETTLEMENT_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    let body: z.infer<typeof x402Request>;
    try {
      body = x402Request.parse(await boundedJson(c.req.raw));
      const verified = await x402Scheme.verify(body.paymentPayload, body.paymentRequirements);
      if (!verified.isValid) return c.json(verified, 422);
    } catch (error) {
      const failure = publicFailure(error, "INVALID_REQUEST", 400);
      return c.json({ success: false, errorReason: "invalid_request", errorMessage: failure.code }, failure.status);
    }
    const transactionCandidate = settlementTransactionCandidate(body.paymentPayload);
    try {
      const result = await x402Scheme.settle(body.paymentPayload, body.paymentRequirements);
      const evidence = result.transaction || transactionCandidate;
      if (!result.success && evidence) {
        logFailure("settlement_confirmation_unknown", new Error(result.errorReason ?? "SETTLEMENT_CONFIRMATION_UNKNOWN"));
        return c.json({
          ...result,
          success: false,
          transaction: evidence,
          transactionId: evidence,
          network: caipNetwork,
          errorReason: "settlement_unknown",
          errorMessage: result.errorMessage ?? "SETTLEMENT_CONFIRMATION_UNKNOWN",
        }, 503);
      }
      return result.success
        ? c.json({ ...result, network: result.network ?? caipNetwork })
        : c.json({ ...result, network: result.network ?? caipNetwork }, 422);
    } catch (error) {
      logFailure("settlement_submission_unknown", error);
      return c.json({
        success: false,
        transaction: transactionCandidate ?? "",
        ...(transactionCandidate ? { transactionId: transactionCandidate } : {}),
        network: caipNetwork,
        errorReason: "settlement_unknown",
        errorMessage: "SETTLEMENT_SUBMISSION_UNKNOWN",
      }, 503);
    }
  });
  app.post("/contract-execute", async c => {
    if (!authorized(env.CONTRACT_EXECUTION_API_KEY, c.req.header("authorization"))) return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
    try {
      const body = contractRequestSchema.parse(await boundedJson(c.req.raw));
      const policyError = validateContractCall(body, contractAllowlist);
      if (policyError) return c.json({ success: false, error: policyError }, policyError === "SELECTOR_CALLDATA_MISMATCH" ? 422 : 403);
      const payer = AccountId.fromString(env.HEDERA_PAYER_ID);
      const transactionId = TransactionId.fromString(body.transactionId);
      if (transactionId.accountId?.toString() !== payer.toString()) return c.json({ success: false, error: "TRANSACTION_PAYER_MISMATCH" }, 403);
      let transaction = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(body.contractId))
        .setGas(body.gas)
        .setFunctionParameters(Buffer.from(body.calldata.slice(2), "hex"))
        .setTransactionId(transactionId);
      if (BigInt(body.payableAtomic) > 0n) transaction = transaction.setPayableAmount(Hbar.fromTinybars(body.payableAtomic));
      const frozen = await transaction.freezeWith(client);
      const signed = await frozen.sign(payerKey);
      const response = await signed.execute(client);
      const receipt = await response.getReceipt(client);
      return c.json({ success: receipt.status.toString() === "SUCCESS", transactionId: response.transactionId.toString(), status: receipt.status.toString() });
    } catch (error) {
      const failure = publicFailure(error, "CONTRACT_EXECUTION_FAILED", 500);
      logFailure("contract_execution_failed", error);
      return c.json({ success: false, error: failure.code }, failure.status);
    }
  });
  return { app, network: caipNetwork };
}
