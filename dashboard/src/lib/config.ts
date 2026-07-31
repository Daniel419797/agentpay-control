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

function validateProduction(parsed: AppConfig) {
  if (parsed.APP_ENV !== "production") return;
  const errors: string[] = [];
  if (new URL(parsed.NEXT_PUBLIC_APP_URL).protocol !== "https:") errors.push("NEXT_PUBLIC_APP_URL must use HTTPS");
  if (parsed.AUTH_SECRET === "development-only-secret-change-before-deploy") errors.push("AUTH_SECRET is not configured");
  if (!parsed.CRON_SECRET) errors.push("CRON_SECRET is not configured");
  if (!parsed.FACILITATOR_URL) errors.push("FACILITATOR_URL is not configured");
  if (!parsed.FACILITATOR_SIGNING_API_KEY) errors.push("FACILITATOR_SIGNING_API_KEY is not configured");
  if (!parsed.FACILITATOR_SETTLEMENT_API_KEY) errors.push("FACILITATOR_SETTLEMENT_API_KEY is not configured");
  if (!parsed.FACILITATOR_CONTRACT_API_KEY) errors.push("FACILITATOR_CONTRACT_API_KEY is not configured");
  if (!parsed.ARC_FACILITATOR_URL) errors.push("ARC_FACILITATOR_URL is not configured");
  if (!parsed.ARC_FACILITATOR_SIGNING_API_KEY) errors.push("ARC_FACILITATOR_SIGNING_API_KEY is not configured");
  if (!parsed.ARC_FACILITATOR_CONTRACT_API_KEY) errors.push("ARC_FACILITATOR_CONTRACT_API_KEY is not configured");
  if (!parsed.ARC_RPC_URL) errors.push("ARC_RPC_URL is not configured");
  if (!parsed.ARC_PROVIDER_ADDRESS) errors.push("ARC_PROVIDER_ADDRESS is not configured");
  if (!parsed.HEDERA_PAYER_ACCOUNT_ID) errors.push("HEDERA_PAYER_ACCOUNT_ID is not configured");
  if (!parsed.KEY_ENCRYPTION_MASTER_KEY || Buffer.from(parsed.KEY_ENCRYPTION_MASTER_KEY, "base64url").length !== 32) errors.push("KEY_ENCRYPTION_MASTER_KEY must be a base64url-encoded 32-byte key");
  if (!parsed.SUPABASE_URL || !parsed.SUPABASE_ANON_KEY) errors.push("Supabase authentication is not configured");
  if (parsed.HEDERA_OPERATOR_ID || parsed.HEDERA_OPERATOR_KEY) errors.push("Hedera operator credentials must be held only by the facilitator");
  if (parsed.VIRTUAL_CARDS_ENABLED) {
    if (parsed.CARD_PROVIDER !== "STRIPE") errors.push("Virtual cards require CARD_PROVIDER=STRIPE");
    if (!parsed.STRIPE_RESTRICTED_KEY) errors.push("STRIPE_RESTRICTED_KEY is not configured");
    if (!parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) errors.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured");
    if (!parsed.STRIPE_WEBHOOK_SECRET) errors.push("STRIPE_WEBHOOK_SECRET is not configured");
  }
  if (errors.length) {
    console.error(`[config] Production validation failed:\n  ${errors.join("\n  ")}`);
  }
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  try {
    const parsed = envSchema.parse(process.env);
    validateProduction(parsed);
    cached = parsed;
  } catch (err) {
    console.error("[config] Environment validation failed, using defaults:", err);
    cached = envSchema.parse({});
  }
  return cached;
}
