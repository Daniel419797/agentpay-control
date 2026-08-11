import { z } from "zod";
import { getNetworkRouter, isHederaMainnetEnabled } from "@/domain/network-router";
import { cardanoAssetReadinessErrors } from "@/lib/cardano-assets";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { duneReadinessErrors } from "@/lib/dune";
import { masumiReadinessErrors } from "@/lib/masumi";
import { ok, problem } from "@/lib/api";
import { pythReadinessErrors } from "@/lib/pyth";

export const dynamic = "force-dynamic";

const supportedSchema = z.object({
  kinds: z.array(z.object({
    x402Version: z.literal(2),
    scheme: z.literal("exact"),
    network: z.string(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()),
});

async function assertFacilitator(url: string, expectedNetwork: string) {
  const response = await fetch(`${url.replace(/\/$/, "")}/supported`, {
    cache: "no-store",
    redirect: "error",
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
    const router = getNetworkRouter();
    const mainnetEnabled = isHederaMainnetEnabled(config) && Boolean(config.HEDERA_MAINNET_FACILITATOR_URL);
    const blockingConfigErrors = [
      ...cardanoAssetReadinessErrors(process.env),
      ...pythReadinessErrors(process.env),
      ...masumiReadinessErrors(process.env),
    ];
    if (blockingConfigErrors.length) throw new Error(`INTEGRATION_CONFIG:${blockingConfigErrors.join(",")}`);

    await db.$queryRaw`SELECT 1`;
    const migrations = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    if ((migrations[0]?.count ?? 0n) > 0n) throw new Error("MIGRATION_INCOMPLETE");

    const requiredFacilitators = [
      { network: "hedera:testnet", url: config.FACILITATOR_URL! },
      ...(router.supportsNetwork("eip155:5042002") ? [{ network: "eip155:5042002", url: config.ARC_FACILITATOR_URL! }] : []),
      ...(mainnetEnabled ? [{ network: "hedera:mainnet", url: config.HEDERA_MAINNET_FACILITATOR_URL! }] : []),
      ...(router.supportsNetwork("cardano:preprod") ? [{ network: "cardano:preprod", url: router.getRoute("cardano:preprod").facilitatorUrl }] : []),
      ...(router.supportsNetwork("cardano:mainnet") ? [{ network: "cardano:mainnet", url: router.getRoute("cardano:mainnet").facilitatorUrl }] : []),
    ];
    await Promise.all(requiredFacilitators.map(({ network, url }) => assertFacilitator(url, network)));

    const duneErrors = duneReadinessErrors(process.env);
    return ok({
      status: "ready",
      database: "connected",
      facilitators: Object.fromEntries(requiredFacilitators.map(({ network }) => [network, "connected"])),
      integrations: {
        pythPolicy: process.env.PYTH_POLICY_ENABLED === "true" ? "configured" : "disabled",
        masumiPolicy: process.env.MASUMI_POLICY_ENABLED === "true" ? "configured" : "disabled",
        usdcx: process.env.CARDANO_USDCX_ENABLED === "true" ? "configured" : "disabled",
        // Dune is observability-only; bad Dune configuration is surfaced as a
        // degraded integration but must never take the payment plane offline.
        duneAnalytics: process.env.DUNE_ANALYTICS_ENABLED !== "true" ? "disabled" : duneErrors.length ? "degraded" : "configured",
      },
      latencyMs: Math.round(performance.now() - started),
    });
  } catch {
    return problem(503, "NOT_READY", "A required AgentPay dependency or production configuration is unavailable.");
  }
}
