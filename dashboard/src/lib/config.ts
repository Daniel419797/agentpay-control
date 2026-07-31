import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3100"),
  DATABASE_URL: z.string().min(1).default("postgresql://agentpay:agentpay@localhost:54329/agentpay?schema=public"),
  AUTH_SECRET: z.string().min(32).default("development-only-secret-change-before-deploy"),
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string().optional(),
  HEDERA_OPERATOR_KEY: z.string().optional(),
  HEDERA_PAYER_ACCOUNT_ID: z.string().optional(),
  HEDERA_PROVIDER_ACCOUNT_ID: z.string().default("0.0.98765"),
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
  HEDERA_MAINNET_MIRROR_NODE_URL: optionalUrl.default("https://mainnet-public.mirrornode.hedera.com"),
  ARC_FACILITATOR_URL: optionalUrl,
  ARC_FACILITATOR_API_KEY: z.string().min(32).optional(),
  ARC_FACILITATOR_SIGNING_API_KEY: z.string().min(32).optional(),
  ARC_FACILITATOR_CONTRACT_API_KEY: z.string().min(32).optional(),
  ARC_RPC_URL: z.string().url().optional(),
  ARC_PROVIDER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
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

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = parseEnv();
  if (parsed.APP_ENV === "production") {
    const missing: string[] = [];
    if (new URL(parsed.NEXT_PUBLIC_APP_URL).protocol !== "https:") missing.push("NEXT_PUBLIC_APP_URL must use HTTPS");
    if (parsed.AUTH_SECRET === "development-only-secret-change-before-deploy") missing.push("AUTH_SECRET");
    if (!parsed.CRON_SECRET) missing.push("CRON_SECRET");
    if (!parsed.FACILITATOR_URL) missing.push("FACILITATOR_URL");
    if (!parsed.FACILITATOR_SIGNING_API_KEY) missing.push("FACILITATOR_SIGNING_API_KEY");
    if (!parsed.FACILITATOR_SETTLEMENT_API_KEY) missing.push("FACILITATOR_SETTLEMENT_API_KEY");
    if (!parsed.FACILITATOR_CONTRACT_API_KEY) missing.push("FACILITATOR_CONTRACT_API_KEY");
    if (!parsed.ARC_FACILITATOR_URL) missing.push("ARC_FACILITATOR_URL");
    if (!parsed.ARC_FACILITATOR_SIGNING_API_KEY) missing.push("ARC_FACILITATOR_SIGNING_API_KEY");
    if (!parsed.ARC_FACILITATOR_CONTRACT_API_KEY) missing.push("ARC_FACILITATOR_CONTRACT_API_KEY");
    if (!parsed.ARC_RPC_URL) missing.push("ARC_RPC_URL");
    if (!parsed.ARC_PROVIDER_ADDRESS) missing.push("ARC_PROVIDER_ADDRESS");
    if (!parsed.HEDERA_PAYER_ACCOUNT_ID) missing.push("HEDERA_PAYER_ACCOUNT_ID");
    if (!parsed.KEY_ENCRYPTION_MASTER_KEY || Buffer.from(parsed.KEY_ENCRYPTION_MASTER_KEY, "base64url").length !== 32) missing.push("KEY_ENCRYPTION_MASTER_KEY");
    if (!parsed.SUPABASE_URL || !parsed.SUPABASE_ANON_KEY) missing.push("SUPABASE_URL / SUPABASE_ANON_KEY");
    if (parsed.HEDERA_OPERATOR_ID || parsed.HEDERA_OPERATOR_KEY) missing.push("Hedera operator credentials must be held only by the facilitator");
    if (parsed.VIRTUAL_CARDS_ENABLED) {
      if (parsed.CARD_PROVIDER !== "STRIPE") missing.push("CARD_PROVIDER=STRIPE");
      if (!parsed.STRIPE_RESTRICTED_KEY) missing.push("STRIPE_RESTRICTED_KEY");
      if (!parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) missing.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
      if (!parsed.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
    }
    if (missing.length) console.warn(`[config] Missing production env vars: ${missing.join(", ")}`);
  }
  cached = parsed;
  return cached;
}

function parseEnv(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;
  console.error("[config] Environment validation failed:", result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | "));
  const filtered: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) filtered[key] = process.env[key];
  for (const issue of result.error.issues) delete filtered[String(issue.path[0] ?? "")];
  const retry = envSchema.safeParse(filtered);
  if (retry.success) return retry.data;
  console.error("[config] Environment validation failed after dropping invalid keys, using defaults");
  return envSchema.parse({});
}
