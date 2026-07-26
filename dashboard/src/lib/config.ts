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
  const parsed = envSchema.parse(process.env);
  if (parsed.APP_ENV !== "production" && parsed.HEDERA_NETWORK === "mainnet") {
    throw new Error("Mainnet is prohibited outside production");
  }
  if (parsed.APP_ENV === "production") {
    if (new URL(parsed.NEXT_PUBLIC_APP_URL).protocol !== "https:") throw new Error("Production NEXT_PUBLIC_APP_URL must use HTTPS");
    if (parsed.AUTH_SECRET === "development-only-secret-change-before-deploy") throw new Error("Production AUTH_SECRET is not configured");
    if (!parsed.CRON_SECRET) throw new Error("Production CRON_SECRET is not configured");
    if (!parsed.FACILITATOR_URL) throw new Error("Production FACILITATOR_URL is not configured");
    if (!parsed.FACILITATOR_API_KEY) throw new Error("Production FACILITATOR_API_KEY is not configured");
    if (!parsed.HEDERA_PAYER_ACCOUNT_ID) throw new Error("Production HEDERA_PAYER_ACCOUNT_ID is not configured");
    if (!parsed.KEY_ENCRYPTION_MASTER_KEY) throw new Error("Production KEY_ENCRYPTION_MASTER_KEY is not configured");
    if (parsed.HEDERA_OPERATOR_ID || parsed.HEDERA_OPERATOR_KEY) throw new Error("Hedera operator credentials must be held only by the facilitator");
    if (parsed.VIRTUAL_CARDS_ENABLED) {
      if (parsed.CARD_PROVIDER !== "STRIPE") throw new Error("Production virtual cards require CARD_PROVIDER=STRIPE");
      if (!parsed.STRIPE_RESTRICTED_KEY) throw new Error("Production STRIPE_RESTRICTED_KEY is not configured");
      if (!parsed.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) throw new Error("Production NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured");
      if (!parsed.STRIPE_WEBHOOK_SECRET) throw new Error("Production STRIPE_WEBHOOK_SECRET is not configured");
    }
  }
  cached = parsed;
  return cached;
}
