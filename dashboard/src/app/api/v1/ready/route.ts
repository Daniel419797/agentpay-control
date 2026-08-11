import { z } from "zod";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { ok, problem } from "@/lib/api";

export const dynamic = "force-dynamic";

const supportedSchema = z.object({
  kinds: z.array(z.object({
    x402Version: z.literal(2),
    scheme: z.literal("exact"),
    network: z.string(),
  }).passthrough()),
});

async function assertFacilitator(url: string, expectedNetwork: string) {
  const response = await fetch(`${url.replace(/\/$/, "")}/supported`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`FACILITATOR_UNAVAILABLE:${expectedNetwork}`);
  const supported = supportedSchema.parse(await response.json());
  if (!supported.kinds.some((kind) => kind.network === expectedNetwork)) {
    throw new Error(`FACILITATOR_NETWORK_MISMATCH:${expectedNetwork}`);
  }
}

export async function GET() {
  const started = performance.now();
  try {
    const config = getConfig();
    await db.$queryRaw`SELECT 1`;
    const migrations = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    if ((migrations[0]?.count ?? 0n) > 0n) throw new Error("MIGRATION_INCOMPLETE");

    await Promise.all([
      assertFacilitator(config.FACILITATOR_URL!, "hedera:testnet"),
      assertFacilitator(config.ARC_FACILITATOR_URL!, "eip155:5042002"),
      ...(config.HEDERA_MAINNET_FACILITATOR_URL
        ? [assertFacilitator(config.HEDERA_MAINNET_FACILITATOR_URL, "hedera:mainnet")]
        : []),
    ]);

    return ok({
      status: "ready",
      database: "connected",
      facilitators: {
        hederaTestnet: "connected",
        arcTestnet: "connected",
        hederaMainnet: config.HEDERA_MAINNET_FACILITATOR_URL ? "connected" : "not_configured",
      },
      latencyMs: Math.round(performance.now() - started),
    });
  } catch {
    return problem(503, "NOT_READY", "A required AgentPay dependency or production configuration is unavailable.");
  }
}
