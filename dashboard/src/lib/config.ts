import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  X402_NETWORK: z.string().default("hedera:testnet"),
  KEY_ENCRYPTION_MASTER_KEY: z.string().optional(),
  WALLETCONNECT_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: z.string().optional()
});

export type AppConfig = z.infer<typeof envSchema> & {
  hederaLiveEnabled: boolean;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.parse(process.env);
  if (parsed.APP_ENV !== "production" && parsed.HEDERA_NETWORK === "mainnet") {
    throw new Error("Mainnet is prohibited outside production");
  }
  cached = {
    ...parsed,
    hederaLiveEnabled: Boolean(parsed.HEDERA_OPERATOR_ID && parsed.HEDERA_OPERATOR_KEY)
  };
  return cached;
}
