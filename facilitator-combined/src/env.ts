import { z } from "zod";

const privateKey = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional();

const combinedEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8787),
  HEDERA_BASE_PATH: z.string().regex(/^\/[a-z0-9/_-]*$/i).default("/hedera"),
  ARC_BASE_PATH: z.string().regex(/^\/[a-z0-9/_-]*$/i).default("/arc"),
  HEDERA_MANAGED_SIGNING_API_KEY: z.string().min(32).optional(),
  HEDERA_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  HEDERA_CONTRACT_EXECUTION_API_KEY: z.string().min(32).optional(),
  ARC_MANAGED_SIGNING_API_KEY: z.string().min(32).optional(),
  ARC_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  ARC_CONTRACT_EXECUTION_API_KEY: z.string().min(32).optional(),
  ARC_PAYER_PRIVATE_KEY: privateKey,
  ARC_RELAYER_PRIVATE_KEY: privateKey,
  ARC_CONTRACT_EXECUTION_PRIVATE_KEY: privateKey,
});

export type CombinedEnv = z.infer<typeof combinedEnvSchema>;

function normalizePrivateKey(value: string) {
  return value.replace(/^0x/i, "").toLowerCase();
}

export function parseCombinedEnv(input: NodeJS.ProcessEnv = process.env): CombinedEnv {
  const env = combinedEnvSchema.parse(input);
  if (env.HEDERA_BASE_PATH === env.ARC_BASE_PATH) throw new Error("Hedera and Arc base paths must be distinct");

  if (env.APP_ENV === "production") {
    const keys = [
      env.HEDERA_MANAGED_SIGNING_API_KEY,
      env.HEDERA_SETTLEMENT_API_KEY,
      env.HEDERA_CONTRACT_EXECUTION_API_KEY,
      env.ARC_MANAGED_SIGNING_API_KEY,
      env.ARC_SETTLEMENT_API_KEY,
      env.ARC_CONTRACT_EXECUTION_API_KEY,
    ];
    if (keys.some((key) => !key)) throw new Error("Production combined facilitator requires network-scoped capability API keys");
    if (new Set(keys).size !== keys.length) throw new Error("Production network-scoped capability API keys must all be distinct");

    const arcKeys = [env.ARC_PAYER_PRIVATE_KEY, env.ARC_RELAYER_PRIVATE_KEY, env.ARC_CONTRACT_EXECUTION_PRIVATE_KEY];
    if (arcKeys.some((key) => !key)) throw new Error("Production combined facilitator requires Arc payer, relayer, and contract-execution private keys");
    const normalized = arcKeys.map((key) => normalizePrivateKey(key!));
    if (new Set(normalized).size !== normalized.length) throw new Error("Production Arc payer, relayer, and contract-execution private keys must be distinct");
  }
  return env;
}

export function networkEnv(input: NodeJS.ProcessEnv, env: CombinedEnv, network: "hedera" | "arc"): NodeJS.ProcessEnv {
  const production = env.APP_ENV === "production";
  const prefix = network === "hedera" ? "HEDERA" : "ARC";
  const signing = env[`${prefix}_MANAGED_SIGNING_API_KEY` as keyof CombinedEnv] as string | undefined;
  const settlement = env[`${prefix}_SETTLEMENT_API_KEY` as keyof CombinedEnv] as string | undefined;
  const contract = env[`${prefix}_CONTRACT_EXECUTION_API_KEY` as keyof CombinedEnv] as string | undefined;

  return {
    ...input,
    MANAGED_SIGNING_API_KEY: signing ?? (production ? undefined : input.MANAGED_SIGNING_API_KEY),
    SETTLEMENT_API_KEY: settlement ?? (production ? undefined : input.SETTLEMENT_API_KEY),
    CONTRACT_EXECUTION_API_KEY: contract ?? (production ? undefined : input.CONTRACT_EXECUTION_API_KEY),
  };
}
