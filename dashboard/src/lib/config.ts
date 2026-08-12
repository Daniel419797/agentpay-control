import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const hederaAccountId = /^0\.0\.\d+$/;
const evmAddress = /^0x[0-9a-fA-F]{40}$/;
const cardanoPreprodAddress = /^addr_test1[0-9a-z]+$/;
const cardanoMainnetAddress = /^addr1[0-9a-z]+$/;
const appEnvironments = ["development", "test", "production"] as const;

const envSchema = z.object({
  APP_ENV: z.enum(appEnvironments).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3100"),
  DATABASE_URL: z.string().min(1).default("postgresql://agentpay:agentpay@localhost:54329/agentpay?schema=public"),
  AUTH_SECRET: z.string().min(32).default("development-only-secret-change-before-deploy"),
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string().optional(),
  HEDERA_OPERATOR_KEY: z.string().optional(),
  HEDERA_PAYER_ACCOUNT_ID: z.string().regex(hederaAccountId).optional(),
  HEDERA_PROVIDER_ACCOUNT_ID: z.string().regex(hederaAccountId).default("0.0.98765"),
  HEDERA_MAINNET_PROVIDER_ACCOUNT_ID: z.string().regex(hederaAccountId).optional(),
  HEDERA_USDC_TOKEN_ID: z.string().optional(),
  HEDERA_MIRROR_NODE_URL: optionalUrl.default("https://testnet.mirrornode.hedera.com"),
  FACILITATOR_URL: optionalUrl,
  FACILITATOR_API_KEY: z.string().min(32).optional(),
  FACILITATOR_SIGNING_API_KEY: z.string().min(32).optional(),
  FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  FACILITATOR_CONTRACT_API_KEY: z.string().min(32).optional(),
  HEDERA_MAINNET_FACILITATOR_URL: optionalUrl,
  HEDERA_MAINNET_FACILITATOR_API_KEY: z.string().min(32).optional(),
  HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: z.string().min(32).optional(),
  HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY: z.string().min(32).optional(),
  HEDERA_MAINNET_PAYER_ACCOUNT_ID: z.string().regex(hederaAccountId).optional(),
  HEDERA_MAINNET_MIRROR_NODE_URL: optionalUrl.default("https://mainnet-public.mirrornode.hedera.com"),
  ARC_FACILITATOR_URL: optionalUrl,
  ARC_FACILITATOR_API_KEY: z.string().min(32).optional(),
  ARC_FACILITATOR_SIGNING_API_KEY: z.string().min(32).optional(),
  ARC_FACILITATOR_CONTRACT_API_KEY: z.string().min(32).optional(),
  ARC_RPC_URL: z.string().url().optional(),
  ARC_PROVIDER_ADDRESS: z.string().regex(evmAddress).transform((value) => value.toLowerCase()).optional(),
  ARC_PAYER_ADDRESS: z.string().regex(evmAddress).transform((value) => value.toLowerCase()).optional(),
  ARC_USDC_ADDRESS: z.string().regex(evmAddress).transform((value) => value.toLowerCase()).default("0x3600000000000000000000000000000000000000"),
  CARDANO_SETTLEMENT_STORE_API_KEY: z.string().min(32).optional(),
  CARDANO_PREPROD_FACILITATOR_URL: optionalUrl,
  CARDANO_PREPROD_FACILITATOR_API_KEY: z.string().min(32).optional(),
  CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: z.string().min(32).optional(),
  CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  CARDANO_PREPROD_PAYER_ADDRESS: z.string().regex(cardanoPreprodAddress).optional(),
  CARDANO_PREPROD_PROVIDER_ADDRESS: z.string().regex(cardanoPreprodAddress).optional(),
  CARDANO_PREPROD_BLOCKFROST_URL: z.string().url().default("https://cardano-preprod.blockfrost.io/api/v0"),
  CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: z.string().min(20).optional(),
  CARDANO_MAINNET_FACILITATOR_URL: optionalUrl,
  CARDANO_MAINNET_FACILITATOR_API_KEY: z.string().min(32).optional(),
  CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY: z.string().min(32).optional(),
  CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  CARDANO_MAINNET_PAYER_ADDRESS: z.string().regex(cardanoMainnetAddress).optional(),
  CARDANO_MAINNET_PROVIDER_ADDRESS: z.string().regex(cardanoMainnetAddress).optional(),
  CARDANO_MAINNET_BLOCKFROST_URL: z.string().url().default("https://cardano-mainnet.blockfrost.io/api/v0"),
  CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: z.string().min(20).optional(),
  X402_NETWORK: z.string().default("hedera:testnet"),
  KEY_ENCRYPTION_MASTER_KEY: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().optional(),
  NOTIFICATION_FROM_EMAIL: z.string().email().default("notifications@agentpay.dev"),
  VIRTUAL_CARDS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CARD_PROVIDER: z.enum(["SANDBOX", "STRIPE"]).default("SANDBOX"),
  STRIPE_RESTRICTED_KEY: z.string().startsWith("rk_").optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_API_BASE_URL: optionalUrl.default("https://api.stripe.com"),
  STRIPE_MONEY_MANAGEMENT_VERSION: z.string().default("2026-02-25.preview"),
  LIFI_API_BASE_URL: optionalUrl.default("https://li.quest/v1"),
  LIFI_API_KEY: z.string().optional(),
  EVM_RPC_URLS_JSON: z.string().default("{}"),
  CRON_SECRET: z.string().min(32).optional(),
  WALLETCONNECT_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: z.string().optional()
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

function requestedAppEnv(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>).APP_ENV;
  return typeof value === "string" ? value : undefined;
}

function issueSummary(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`).join(" | ");
}

function requireHttps(name: string, value: string | undefined, errors: string[]) {
  if (!value) return;
  if (new URL(value).protocol !== "https:") errors.push(`${name} must use HTTPS`);
}

function isExactBase64Url32(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  return Buffer.from(value, "base64url").length === 32;
}

function assertDistinctSecrets(entries: Array<[string, string | undefined]>, errors: string[]) {
  const populated = entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const byValue = new Map<string, string[]>();
  for (const [name, value] of populated) {
    const names = byValue.get(value) ?? [];
    names.push(name);
    byValue.set(value, names);
  }
  for (const names of byValue.values()) if (names.length > 1) errors.push(`${names.join(" / ")} must use distinct secrets`);
}

function cardanoRailRequested(values: Array<string | undefined>) {
  return values.some(Boolean);
}

function requireCardanoRail(label: string, values: Array<[string, string | undefined]>, errors: string[]) {
  if (!cardanoRailRequested(values.map(([, value]) => value))) return;
  for (const [name, value] of values) if (!value) errors.push(`${label}: ${name}`);
}

export function productionConfigErrors(config: AppConfig): string[] {
  if (config.APP_ENV !== "production") return [];

  const errors: string[] = [];
  requireHttps("NEXT_PUBLIC_APP_URL", config.NEXT_PUBLIC_APP_URL, errors);
  requireHttps("FACILITATOR_URL", config.FACILITATOR_URL, errors);
  requireHttps("ARC_FACILITATOR_URL", config.ARC_FACILITATOR_URL, errors);
  requireHttps("HEDERA_MAINNET_FACILITATOR_URL", config.HEDERA_MAINNET_FACILITATOR_URL, errors);
  requireHttps("ARC_RPC_URL", config.ARC_RPC_URL, errors);
  requireHttps("CARDANO_PREPROD_FACILITATOR_URL", config.CARDANO_PREPROD_FACILITATOR_URL, errors);
  requireHttps("CARDANO_MAINNET_FACILITATOR_URL", config.CARDANO_MAINNET_FACILITATOR_URL, errors);
  requireHttps("CARDANO_PREPROD_BLOCKFROST_URL", config.CARDANO_PREPROD_BLOCKFROST_URL, errors);
  requireHttps("CARDANO_MAINNET_BLOCKFROST_URL", config.CARDANO_MAINNET_BLOCKFROST_URL, errors);
  requireHttps("SUPABASE_URL", config.SUPABASE_URL, errors);

  if (config.AUTH_SECRET === "development-only-secret-change-before-deploy") errors.push("AUTH_SECRET");
  if (!config.CRON_SECRET) errors.push("CRON_SECRET");
  if (!config.FACILITATOR_URL) errors.push("FACILITATOR_URL");
  if (!config.FACILITATOR_SIGNING_API_KEY) errors.push("FACILITATOR_SIGNING_API_KEY");
  if (!config.FACILITATOR_SETTLEMENT_API_KEY) errors.push("FACILITATOR_SETTLEMENT_API_KEY");
  if (!config.FACILITATOR_CONTRACT_API_KEY) errors.push("FACILITATOR_CONTRACT_API_KEY");
  if (config.HEDERA_MAINNET_FACILITATOR_URL && !config.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY) errors.push("HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY");
  const mainnetContractRoutingRequested = Boolean(config.HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY || config.HEDERA_MAINNET_PAYER_ACCOUNT_ID);
  if (mainnetContractRoutingRequested) {
    if (!config.HEDERA_MAINNET_FACILITATOR_URL) errors.push("HEDERA_MAINNET_FACILITATOR_URL");
    if (!config.HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY) errors.push("HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY");
    if (!config.HEDERA_MAINNET_PAYER_ACCOUNT_ID) errors.push("HEDERA_MAINNET_PAYER_ACCOUNT_ID");
  }
  if (!config.ARC_FACILITATOR_URL) errors.push("ARC_FACILITATOR_URL");
  if (!config.ARC_FACILITATOR_SIGNING_API_KEY) errors.push("ARC_FACILITATOR_SIGNING_API_KEY");
  if (!config.ARC_FACILITATOR_CONTRACT_API_KEY) errors.push("ARC_FACILITATOR_CONTRACT_API_KEY");
  if (!config.ARC_RPC_URL) errors.push("ARC_RPC_URL");
  if (!config.ARC_PROVIDER_ADDRESS) errors.push("ARC_PROVIDER_ADDRESS");
  if (!config.ARC_PAYER_ADDRESS) errors.push("ARC_PAYER_ADDRESS");
  if (!config.HEDERA_PAYER_ACCOUNT_ID) errors.push("HEDERA_PAYER_ACCOUNT_ID");
  if (!isExactBase64Url32(config.KEY_ENCRYPTION_MASTER_KEY)) errors.push("KEY_ENCRYPTION_MASTER_KEY must be exactly 32 random bytes encoded as unpadded base64url");
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) errors.push("SUPABASE_URL / SUPABASE_ANON_KEY");
  if (config.HEDERA_OPERATOR_ID || config.HEDERA_OPERATOR_KEY) errors.push("Hedera operator credentials must be held only by the facilitator");

  const preprodRequested = cardanoRailRequested([
    config.CARDANO_PREPROD_FACILITATOR_URL,
    config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY,
    config.CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY,
    config.CARDANO_PREPROD_PAYER_ADDRESS,
    config.CARDANO_PREPROD_PROVIDER_ADDRESS,
    config.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID,
  ]);
  const mainnetRequested = cardanoRailRequested([
    config.CARDANO_MAINNET_FACILITATOR_URL,
    config.CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY,
    config.CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY,
    config.CARDANO_MAINNET_PAYER_ADDRESS,
    config.CARDANO_MAINNET_PROVIDER_ADDRESS,
    config.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID,
  ]);

  requireCardanoRail("Cardano Preprod", [
    ["CARDANO_PREPROD_FACILITATOR_URL", config.CARDANO_PREPROD_FACILITATOR_URL],
    ["CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY", config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY],
    ["CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY", config.CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY],
    ["CARDANO_PREPROD_PAYER_ADDRESS", config.CARDANO_PREPROD_PAYER_ADDRESS],
    ["CARDANO_PREPROD_PROVIDER_ADDRESS", config.CARDANO_PREPROD_PROVIDER_ADDRESS],
    ["CARDANO_PREPROD_BLOCKFROST_PROJECT_ID", config.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID],
  ], errors);
  requireCardanoRail("Cardano Mainnet", [
    ["CARDANO_MAINNET_FACILITATOR_URL", config.CARDANO_MAINNET_FACILITATOR_URL],
    ["CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY", config.CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY],
    ["CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY", config.CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY],
    ["CARDANO_MAINNET_PAYER_ADDRESS", config.CARDANO_MAINNET_PAYER_ADDRESS],
    ["CARDANO_MAINNET_PROVIDER_ADDRESS", config.CARDANO_MAINNET_PROVIDER_ADDRESS],
    ["CARDANO_MAINNET_BLOCKFROST_PROJECT_ID", config.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID],
  ], errors);
  if ((preprodRequested || mainnetRequested) && !config.CARDANO_SETTLEMENT_STORE_API_KEY) errors.push("CARDANO_SETTLEMENT_STORE_API_KEY");

  assertDistinctSecrets([
    ["FACILITATOR_SIGNING_API_KEY", config.FACILITATOR_SIGNING_API_KEY],
    ["FACILITATOR_SETTLEMENT_API_KEY", config.FACILITATOR_SETTLEMENT_API_KEY],
    ["FACILITATOR_CONTRACT_API_KEY", config.FACILITATOR_CONTRACT_API_KEY],
    ["HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY", config.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY],
    ["HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY", config.HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY],
    ["ARC_FACILITATOR_SIGNING_API_KEY", config.ARC_FACILITATOR_SIGNING_API_KEY],
    ["ARC_FACILITATOR_CONTRACT_API_KEY", config.ARC_FACILITATOR_CONTRACT_API_KEY],
    ["CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY", config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY],
    ["CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY", config.CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY],
    ["CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY", config.CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY],
    ["CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY", config.CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY],
    ["CARDANO_SETTLEMENT_STORE_API_KEY", config.CARDANO_SETTLEMENT_STORE_API_KEY],
  ], errors);

  if (config.VIRTUAL_CARDS_ENABLED) {
    if (config.CARD_PROVIDER !== "STRIPE") errors.push("CARD_PROVIDER=STRIPE");
    if (!config.STRIPE_RESTRICTED_KEY) errors.push("STRIPE_RESTRICTED_KEY");
    if (!config.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) errors.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    if (!config.STRIPE_WEBHOOK_SECRET) errors.push("STRIPE_WEBHOOK_SECRET");
  }

  return errors;
}

export function parseEnv(input: unknown = process.env): AppConfig {
  const requested = requestedAppEnv(input);
  if (requested !== undefined && !appEnvironments.includes(requested as (typeof appEnvironments)[number])) throw new Error(`Invalid APP_ENV: ${requested}`);

  const result = envSchema.safeParse(input);
  if (!result.success) {
    const summary = issueSummary(result.error);
    if (requested === "production") throw new Error(`Invalid production environment: ${summary}`);
    console.error("[config] Environment validation failed:", summary);
    const filtered: Record<string, string | undefined> = {};
    if (input && typeof input === "object") for (const [key, value] of Object.entries(input as Record<string, unknown>)) filtered[key] = typeof value === "string" ? value : undefined;
    for (const issue of result.error.issues) delete filtered[String(issue.path[0] ?? "")];
    const retry = envSchema.safeParse(filtered);
    if (retry.success) return retry.data;
    console.error("[config] Environment validation failed after dropping invalid keys, using development defaults");
    return envSchema.parse({});
  }

  const parsed = result.data;
  const errors = productionConfigErrors(parsed);
  if (errors.length) throw new Error(`Invalid production configuration: ${errors.join(", ")}`);
  return parsed;
}

export function getConfig(): AppConfig {
  if (!cached) cached = parseEnv();
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
