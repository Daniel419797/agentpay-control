import { z } from "zod";
import { parseEnabledNetworks, requiresNetwork } from "./network-selection.js";

const hederaId = /^0\.0\.\d+$/;
const evmAddress = /^0x[0-9a-fA-F]{40}$/;
const cardanoPreprodAddress = /^addr_test1[0-9a-z]+$/;
const cardanoMainnetAddress = /^addr1[0-9a-z]+$/;
const cardanoAssetUnit = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;
const optionalUrl = z.string().url().optional().or(z.literal(""));

const schema = z.object({
  APP_ENV: z.literal("production"),
  ENABLED_NETWORKS: z.string().default("hedera:testnet,eip155:5042002"),
  FACILITATOR_URL: optionalUrl,
  HEDERA_MAINNET_FACILITATOR_URL: optionalUrl,
  ARC_FACILITATOR_URL: optionalUrl,
  CARDANO_PREPROD_FACILITATOR_URL: optionalUrl,
  CARDANO_MAINNET_FACILITATOR_URL: optionalUrl,
  PROVIDER_ACCOUNT_ID: z.string().optional(),
  HEDERA_MAINNET_PROVIDER_ACCOUNT_ID: z.string().optional(),
  USDC_TOKEN_ID: z.string().optional(),
  HEDERA_MAINNET_USDC_TOKEN_ID: z.string().optional(),
  FACILITATOR_FEE_PAYER_ID: z.string().optional(),
  ARC_PROVIDER_ADDRESS: z.string().optional(),
  ARC_USDC_ADDRESS: z.string().optional(),
  CARDANO_PREPROD_PROVIDER_ADDRESS: z.string().optional(),
  CARDANO_MAINNET_PROVIDER_ADDRESS: z.string().optional(),
  CARDANO_PREPROD_USDCX_ASSET_ID: z.string().optional(),
  CARDANO_MAINNET_USDCX_ASSET_ID: z.string().optional(),
  CARDANO_USDCX_ENABLED: z.enum(["true", "false"]).default("false"),
  FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  ARC_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
});

function rawAppEnv(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>).APP_ENV;
  return typeof value === "string" ? value : undefined;
}

function requireHttps(name: string, value: string | undefined, errors: string[]) {
  if (!value) { errors.push(name); return; }
  if (new URL(value).protocol !== "https:") errors.push(`${name} must use HTTPS`);
}

function requireMatch(name: string, value: string | undefined, pattern: RegExp, errors: string[]) {
  if (!value || !pattern.test(value)) errors.push(name);
}

function validateOptionalMatch(name: string, value: string | undefined, pattern: RegExp, errors: string[]) {
  if (value && !pattern.test(value)) errors.push(name);
}

export function productionPreflightErrors(input: unknown = process.env): string[] {
  if (rawAppEnv(input) !== "production") return [];

  const parsed = schema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`);
  const env = parsed.data;
  const enabled = parseEnabledNetworks(env.ENABLED_NETWORKS);
  const errors: string[] = [];

  if (requiresNetwork(enabled, "hedera:testnet")) {
    requireHttps("FACILITATOR_URL", env.FACILITATOR_URL, errors);
    requireMatch("PROVIDER_ACCOUNT_ID", env.PROVIDER_ACCOUNT_ID, hederaId, errors);
    requireMatch("USDC_TOKEN_ID", env.USDC_TOKEN_ID, hederaId, errors);
    requireMatch("FACILITATOR_FEE_PAYER_ID", env.FACILITATOR_FEE_PAYER_ID, hederaId, errors);
    if (!env.FACILITATOR_SETTLEMENT_API_KEY) errors.push("FACILITATOR_SETTLEMENT_API_KEY");
  }

  if (requiresNetwork(enabled, "hedera:mainnet")) {
    requireHttps("HEDERA_MAINNET_FACILITATOR_URL", env.HEDERA_MAINNET_FACILITATOR_URL, errors);
    requireMatch("HEDERA_MAINNET_PROVIDER_ACCOUNT_ID", env.HEDERA_MAINNET_PROVIDER_ACCOUNT_ID, hederaId, errors);
    requireMatch("HEDERA_MAINNET_USDC_TOKEN_ID", env.HEDERA_MAINNET_USDC_TOKEN_ID, hederaId, errors);
    requireMatch("FACILITATOR_FEE_PAYER_ID", env.FACILITATOR_FEE_PAYER_ID, hederaId, errors);
    if (!env.HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY) errors.push("HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY");
  }

  if (requiresNetwork(enabled, "eip155:5042002")) {
    requireHttps("ARC_FACILITATOR_URL", env.ARC_FACILITATOR_URL, errors);
    requireMatch("ARC_PROVIDER_ADDRESS", env.ARC_PROVIDER_ADDRESS, evmAddress, errors);
    requireMatch("ARC_USDC_ADDRESS", env.ARC_USDC_ADDRESS, evmAddress, errors);
    if (!env.ARC_FACILITATOR_SETTLEMENT_API_KEY) errors.push("ARC_FACILITATOR_SETTLEMENT_API_KEY");
  }

  if (requiresNetwork(enabled, "cardano:preprod")) {
    requireHttps("CARDANO_PREPROD_FACILITATOR_URL", env.CARDANO_PREPROD_FACILITATOR_URL, errors);
    requireMatch("CARDANO_PREPROD_PROVIDER_ADDRESS", env.CARDANO_PREPROD_PROVIDER_ADDRESS, cardanoPreprodAddress, errors);
    validateOptionalMatch("CARDANO_PREPROD_USDCX_ASSET_ID", env.CARDANO_PREPROD_USDCX_ASSET_ID, cardanoAssetUnit, errors);
    if (env.CARDANO_USDCX_ENABLED === "true" && !env.CARDANO_PREPROD_USDCX_ASSET_ID) errors.push("CARDANO_PREPROD_USDCX_ASSET_ID");
    if (!env.CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY) errors.push("CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY");
  }

  if (requiresNetwork(enabled, "cardano:mainnet")) {
    requireHttps("CARDANO_MAINNET_FACILITATOR_URL", env.CARDANO_MAINNET_FACILITATOR_URL, errors);
    requireMatch("CARDANO_MAINNET_PROVIDER_ADDRESS", env.CARDANO_MAINNET_PROVIDER_ADDRESS, cardanoMainnetAddress, errors);
    validateOptionalMatch("CARDANO_MAINNET_USDCX_ASSET_ID", env.CARDANO_MAINNET_USDCX_ASSET_ID, cardanoAssetUnit, errors);
    if (env.CARDANO_USDCX_ENABLED === "true" && !env.CARDANO_MAINNET_USDCX_ASSET_ID) errors.push("CARDANO_MAINNET_USDCX_ASSET_ID");
    if (!env.CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY) errors.push("CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY");
  }

  return [...new Set(errors)];
}

export function assertProductionPreflight(input: unknown = process.env): void {
  const errors = productionPreflightErrors(input);
  if (errors.length) throw new Error(`Invalid production resource-server configuration: ${errors.join(", ")}`);
}

assertProductionPreflight();
