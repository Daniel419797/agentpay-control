import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  CARD_EXECUTOR_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CARD_EXECUTOR_SHARED_SECRET: z.string().min(32).optional(),
  CARD_EXECUTOR_LEASE_SECONDS: z.coerce.number().int().min(30).max(300).default(120),
  CARD_EXECUTOR_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
});

export type CardExecutorConfig = z.infer<typeof schema>;

let cached: CardExecutorConfig | undefined;

export function getCardExecutorConfig() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function assertCardExecutorConfigured() {
  const config = getCardExecutorConfig();
  if (!config.CARD_EXECUTOR_ENABLED) throw new Error("CARD_EXECUTOR_DISABLED");
  if (!config.CARD_EXECUTOR_SHARED_SECRET) throw new Error("CARD_EXECUTOR_SHARED_SECRET_REQUIRED");
  return config;
}

export function authorizeCardExecutorRequest(request: Request) {
  const config = assertCardExecutorConfigured();
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(config.CARD_EXECUTOR_SHARED_SECRET!);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
