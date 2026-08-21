import { z } from "zod";
import type { CombinedTarget } from "./root-dispatch.js";

const privateKey = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).optional();
const optionalSecret = z.string().min(32).optional();
const optionalUrl = z.string().url().optional();

const combinedEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HEDERA_BASE_PATH: z.string().regex(/^\/[a-z0-9/_-]*$/i).default("/hedera"),
  ARC_BASE_PATH: z.string().regex(/^\/[a-z0-9/_-]*$/i).default("/arc"),
  CARDANO_BASE_PATH: z.string().regex(/^\/[a-z0-9/_-]*$/i).default("/cardano"),

  HEDERA_TESTNET_MANAGED_SIGNING_API_KEY: optionalSecret,
  HEDERA_TESTNET_SETTLEMENT_API_KEY: optionalSecret,
  HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY: optionalSecret,
  HEDERA_MAINNET_MANAGED_SIGNING_API_KEY: optionalSecret,
  HEDERA_MAINNET_SETTLEMENT_API_KEY: optionalSecret,
  HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY: optionalSecret,

  ARC_TESTNET_MANAGED_SIGNING_API_KEY: optionalSecret,
  ARC_TESTNET_SETTLEMENT_API_KEY: optionalSecret,
  ARC_TESTNET_CONTRACT_EXECUTION_API_KEY: optionalSecret,
  ARC_TESTNET_PAYER_PRIVATE_KEY: privateKey,
  ARC_TESTNET_RELAYER_PRIVATE_KEY: privateKey,
  ARC_TESTNET_CONTRACT_EXECUTION_PRIVATE_KEY: privateKey,

  CARDANO_PREPROD_MANAGED_SIGNING_API_KEY: optionalSecret,
  CARDANO_PREPROD_SETTLEMENT_API_KEY: optionalSecret,
  CARDANO_MAINNET_MANAGED_SIGNING_API_KEY: optionalSecret,
  CARDANO_MAINNET_SETTLEMENT_API_KEY: optionalSecret,
  CARDANO_PREPROD_SIGNER_API_KEY: optionalSecret,
  CARDANO_MAINNET_SIGNER_API_KEY: optionalSecret,
  CARDANO_SETTLEMENT_STORE_API_KEY: optionalSecret,
  CARDANO_SIGNER_ORIGIN: optionalUrl,
  CARDANO_SETTLEMENT_STORE_URL: optionalUrl,
});

export type CombinedEnv = z.infer<typeof combinedEnvSchema>;

function normalizePrivateKey(value: string) { return value.replace(/^0x/i, "").toLowerCase(); }
function stripSlash(value: string) { return value.replace(/\/$/, ""); }
function httpsOnly(name: string, value: string | undefined, errors: string[]) {
  if (!value) return;
  if (new URL(value).protocol !== "https:") errors.push(`${name} must use HTTPS`);
}

function assertDistinctSecrets(entries: Array<[string, string | undefined]>, errors: string[]) {
  const populated = entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const byValue = new Map<string, string[]>();
  for (const [name, value] of populated) {
    const names = byValue.get(value) ?? [];
    names.push(name);
    byValue.set(value, names);
  }
  for (const names of byValue.values()) if (names.length > 1) errors.push(`${names.join(" / ")} must be distinct`);
}

function requiredProduction(name: keyof CombinedEnv, env: CombinedEnv, errors: string[]) {
  if (!env[name]) errors.push(String(name));
}

export function parseCombinedEnv(input: NodeJS.ProcessEnv = process.env): CombinedEnv {
  const env = combinedEnvSchema.parse(input);
  const paths = [env.HEDERA_BASE_PATH, env.ARC_BASE_PATH, env.CARDANO_BASE_PATH];
  if (new Set(paths).size !== paths.length) throw new Error("Hedera, Arc, and Cardano base paths must be distinct");

  if (env.APP_ENV === "production") {
    const errors: string[] = [];
    const required: Array<keyof CombinedEnv> = [
      "HEDERA_TESTNET_MANAGED_SIGNING_API_KEY",
      "HEDERA_TESTNET_SETTLEMENT_API_KEY",
      "HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY",
      "HEDERA_MAINNET_MANAGED_SIGNING_API_KEY",
      "HEDERA_MAINNET_SETTLEMENT_API_KEY",
      "HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY",
      "ARC_TESTNET_MANAGED_SIGNING_API_KEY",
      "ARC_TESTNET_SETTLEMENT_API_KEY",
      "ARC_TESTNET_CONTRACT_EXECUTION_API_KEY",
      "CARDANO_PREPROD_MANAGED_SIGNING_API_KEY",
      "CARDANO_PREPROD_SETTLEMENT_API_KEY",
      "CARDANO_MAINNET_MANAGED_SIGNING_API_KEY",
      "CARDANO_MAINNET_SETTLEMENT_API_KEY",
      "CARDANO_PREPROD_SIGNER_API_KEY",
      "CARDANO_MAINNET_SIGNER_API_KEY",
      "CARDANO_SETTLEMENT_STORE_API_KEY",
      "CARDANO_SIGNER_ORIGIN",
      "CARDANO_SETTLEMENT_STORE_URL",
    ];
    for (const name of required) requiredProduction(name, env, errors);
    httpsOnly("CARDANO_SIGNER_ORIGIN", env.CARDANO_SIGNER_ORIGIN, errors);
    httpsOnly("CARDANO_SETTLEMENT_STORE_URL", env.CARDANO_SETTLEMENT_STORE_URL, errors);

    assertDistinctSecrets([
      ["HEDERA_TESTNET_MANAGED_SIGNING_API_KEY", env.HEDERA_TESTNET_MANAGED_SIGNING_API_KEY],
      ["HEDERA_TESTNET_SETTLEMENT_API_KEY", env.HEDERA_TESTNET_SETTLEMENT_API_KEY],
      ["HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY", env.HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY],
      ["HEDERA_MAINNET_MANAGED_SIGNING_API_KEY", env.HEDERA_MAINNET_MANAGED_SIGNING_API_KEY],
      ["HEDERA_MAINNET_SETTLEMENT_API_KEY", env.HEDERA_MAINNET_SETTLEMENT_API_KEY],
      ["HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY", env.HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY],
      ["ARC_TESTNET_MANAGED_SIGNING_API_KEY", env.ARC_TESTNET_MANAGED_SIGNING_API_KEY],
      ["ARC_TESTNET_SETTLEMENT_API_KEY", env.ARC_TESTNET_SETTLEMENT_API_KEY],
      ["ARC_TESTNET_CONTRACT_EXECUTION_API_KEY", env.ARC_TESTNET_CONTRACT_EXECUTION_API_KEY],
      ["CARDANO_PREPROD_MANAGED_SIGNING_API_KEY", env.CARDANO_PREPROD_MANAGED_SIGNING_API_KEY],
      ["CARDANO_PREPROD_SETTLEMENT_API_KEY", env.CARDANO_PREPROD_SETTLEMENT_API_KEY],
      ["CARDANO_MAINNET_MANAGED_SIGNING_API_KEY", env.CARDANO_MAINNET_MANAGED_SIGNING_API_KEY],
      ["CARDANO_MAINNET_SETTLEMENT_API_KEY", env.CARDANO_MAINNET_SETTLEMENT_API_KEY],
      ["CARDANO_PREPROD_SIGNER_API_KEY", env.CARDANO_PREPROD_SIGNER_API_KEY],
      ["CARDANO_MAINNET_SIGNER_API_KEY", env.CARDANO_MAINNET_SIGNER_API_KEY],
      ["CARDANO_SETTLEMENT_STORE_API_KEY", env.CARDANO_SETTLEMENT_STORE_API_KEY],
    ], errors);

    const arcKeys = [env.ARC_TESTNET_PAYER_PRIVATE_KEY, env.ARC_TESTNET_RELAYER_PRIVATE_KEY, env.ARC_TESTNET_CONTRACT_EXECUTION_PRIVATE_KEY];
    if (arcKeys.some((key) => !key)) errors.push("ARC_TESTNET_PAYER_PRIVATE_KEY / ARC_TESTNET_RELAYER_PRIVATE_KEY / ARC_TESTNET_CONTRACT_EXECUTION_PRIVATE_KEY");
    else {
      const normalized = arcKeys.map((key) => normalizePrivateKey(key!));
      if (new Set(normalized).size !== normalized.length) errors.push("Arc testnet payer, relayer, and contract-execution private keys must be distinct");
    }

    if (errors.length) throw new Error(`Invalid unified facilitator production configuration: ${errors.join(", ")}`);
  }
  return env;
}

function mapped(input: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...input, ...overrides };
}

export function networkEnv(input: NodeJS.ProcessEnv, env: CombinedEnv, target: CombinedTarget): NodeJS.ProcessEnv {
  switch (target) {
    case "hederaTestnet":
      return mapped(input, {
        HEDERA_NETWORK: "testnet",
        HEDERA_OPERATOR_ID: input.HEDERA_TESTNET_OPERATOR_ID,
        HEDERA_OPERATOR_KEY: input.HEDERA_TESTNET_OPERATOR_KEY,
        HEDERA_OPERATOR_KEY_TYPE: input.HEDERA_TESTNET_OPERATOR_KEY_TYPE,
        HEDERA_PAYER_ID: input.HEDERA_TESTNET_PAYER_ID,
        HEDERA_PAYER_KEY: input.HEDERA_TESTNET_PAYER_KEY,
        HEDERA_PAYER_KEY_TYPE: input.HEDERA_TESTNET_PAYER_KEY_TYPE,
        HEDERA_MANAGED_AGENT_MASTER_KEY: input.HEDERA_TESTNET_MANAGED_AGENT_MASTER_KEY,
        HEDERA_MANAGED_AGENT_INITIAL_TINYBAR: input.HEDERA_TESTNET_MANAGED_AGENT_INITIAL_TINYBAR ?? "0",
        MANAGED_SIGNING_API_KEY: env.HEDERA_TESTNET_MANAGED_SIGNING_API_KEY,
        SETTLEMENT_API_KEY: env.HEDERA_TESTNET_SETTLEMENT_API_KEY,
        CONTRACT_EXECUTION_API_KEY: env.HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY,
        CONTRACT_ALLOWLIST_JSON: input.HEDERA_TESTNET_CONTRACT_ALLOWLIST_JSON ?? "[]",
      });
    case "hederaMainnet":
      return mapped(input, {
        HEDERA_NETWORK: "mainnet",
        HEDERA_OPERATOR_ID: input.HEDERA_MAINNET_OPERATOR_ID,
        HEDERA_OPERATOR_KEY: input.HEDERA_MAINNET_OPERATOR_KEY,
        HEDERA_OPERATOR_KEY_TYPE: input.HEDERA_MAINNET_OPERATOR_KEY_TYPE,
        HEDERA_PAYER_ID: input.HEDERA_MAINNET_PAYER_ID,
        HEDERA_PAYER_KEY: input.HEDERA_MAINNET_PAYER_KEY,
        HEDERA_PAYER_KEY_TYPE: input.HEDERA_MAINNET_PAYER_KEY_TYPE,
        HEDERA_MANAGED_AGENT_MASTER_KEY: undefined,
        MANAGED_SIGNING_API_KEY: env.HEDERA_MAINNET_MANAGED_SIGNING_API_KEY,
        SETTLEMENT_API_KEY: env.HEDERA_MAINNET_SETTLEMENT_API_KEY,
        CONTRACT_EXECUTION_API_KEY: env.HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY,
        CONTRACT_ALLOWLIST_JSON: input.HEDERA_MAINNET_CONTRACT_ALLOWLIST_JSON ?? "[]",
      });
    case "arcTestnet":
      return mapped(input, {
        ARC_PAYER_PRIVATE_KEY: env.ARC_TESTNET_PAYER_PRIVATE_KEY,
        ARC_RELAYER_PRIVATE_KEY: env.ARC_TESTNET_RELAYER_PRIVATE_KEY,
        ARC_CONTRACT_EXECUTION_PRIVATE_KEY: env.ARC_TESTNET_CONTRACT_EXECUTION_PRIVATE_KEY,
        ARC_MANAGED_AGENT_MASTER_KEY: input.ARC_TESTNET_MANAGED_AGENT_MASTER_KEY,
        ARC_RPC_URL: input.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network",
        ARC_USDC_ADDRESS: input.ARC_TESTNET_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
        ARC_PROVIDER_ADDRESS: input.ARC_TESTNET_PROVIDER_ADDRESS,
        MANAGED_SIGNING_API_KEY: env.ARC_TESTNET_MANAGED_SIGNING_API_KEY,
        SETTLEMENT_API_KEY: env.ARC_TESTNET_SETTLEMENT_API_KEY,
        CONTRACT_EXECUTION_API_KEY: env.ARC_TESTNET_CONTRACT_EXECUTION_API_KEY,
        CONTRACT_ALLOWLIST_JSON: input.ARC_TESTNET_CONTRACT_ALLOWLIST_JSON ?? "[]",
      });
    case "cardanoPreprod":
      return mapped(input, {
        CARDANO_NETWORK: "preprod",
        CARDANO_SIGNING_MODE: "unsigned-only",
        CARDANO_PAYER_ADDRESS: undefined,
        CARDANO_BLOCKFROST_URL: input.CARDANO_PREPROD_BLOCKFROST_URL ?? "https://cardano-preprod.blockfrost.io/api/v0",
        CARDANO_BLOCKFROST_PROJECT_ID: input.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID,
        CARDANO_SIGNER_URL: env.CARDANO_SIGNER_ORIGIN ? `${stripSlash(env.CARDANO_SIGNER_ORIGIN)}/preprod` : undefined,
        CARDANO_SIGNER_API_KEY: env.CARDANO_PREPROD_SIGNER_API_KEY,
        CARDANO_SETTLEMENT_STORE_URL: env.CARDANO_SETTLEMENT_STORE_URL,
        CARDANO_SETTLEMENT_STORE_API_KEY: env.CARDANO_SETTLEMENT_STORE_API_KEY,
        CARDANO_USDCX_ASSET_ID: input.CARDANO_PREPROD_USDCX_ASSET_ID,
        MANAGED_SIGNING_API_KEY: env.CARDANO_PREPROD_MANAGED_SIGNING_API_KEY,
        SETTLEMENT_API_KEY: env.CARDANO_PREPROD_SETTLEMENT_API_KEY,
      });
    case "cardanoMainnet":
      return mapped(input, {
        CARDANO_NETWORK: "mainnet",
        CARDANO_SIGNING_MODE: "unsigned-only",
        CARDANO_PAYER_ADDRESS: undefined,
        CARDANO_BLOCKFROST_URL: input.CARDANO_MAINNET_BLOCKFROST_URL ?? "https://cardano-mainnet.blockfrost.io/api/v0",
        CARDANO_BLOCKFROST_PROJECT_ID: input.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID,
        CARDANO_SIGNER_URL: env.CARDANO_SIGNER_ORIGIN ? `${stripSlash(env.CARDANO_SIGNER_ORIGIN)}/mainnet` : undefined,
        CARDANO_SIGNER_API_KEY: env.CARDANO_MAINNET_SIGNER_API_KEY,
        CARDANO_SETTLEMENT_STORE_URL: env.CARDANO_SETTLEMENT_STORE_URL,
        CARDANO_SETTLEMENT_STORE_API_KEY: env.CARDANO_SETTLEMENT_STORE_API_KEY,
        CARDANO_USDCX_ASSET_ID: input.CARDANO_MAINNET_USDCX_ASSET_ID,
        MANAGED_SIGNING_API_KEY: env.CARDANO_MAINNET_MANAGED_SIGNING_API_KEY,
        SETTLEMENT_API_KEY: env.CARDANO_MAINNET_SETTLEMENT_API_KEY,
      });
  }
}
