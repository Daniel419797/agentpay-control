import { z } from "zod";
import { getNetworkRouter } from "@/domain/network-router";
import { cardanoAssetReadinessErrors } from "@/lib/cardano-assets";
import { catalystProductionReadiness } from "@/lib/catalyst-release";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { duneReadinessErrors } from "@/lib/dune";
import { masumiReadinessErrors } from "@/lib/masumi";
import { masumiPaymentReadinessErrors } from "@/lib/masumi-payment";
import { ok, problem } from "@/lib/api";
import { pythReadinessErrors } from "@/lib/pyth";
import { veridianReadinessErrors } from "@/lib/veridian-keri";

export const dynamic = "force-dynamic";

const supportedSchema = z.object({ kinds: z.array(z.object({ x402Version: z.literal(2), scheme: z.literal("exact"), network: z.string(), extra: z.record(z.string(), z.unknown()).optional() }).passthrough()) });

async function assertFacilitator(url: string, expectedNetwork: string) {
  const response = await fetch(`${url.replace(/\/$/, "")}/supported`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`FACILITATOR_UNAVAILABLE:${expectedNetwork}`);
  const supported = supportedSchema.parse(await response.json());
  if (!supported.kinds.some((kind) => kind.network === expectedNetwork)) throw new Error(`FACILITATOR_NETWORK_MISMATCH:${expectedNetwork}`);
}

export async function GET() {
  const started = performance.now();
  try {
    getConfig();
    const router = getNetworkRouter();
    const blockingConfigErrors = [...cardanoAssetReadinessErrors(process.env), ...pythReadinessErrors(process.env), ...masumiReadinessErrors(process.env), ...masumiPaymentReadinessErrors(process.env), ...veridianReadinessErrors(process.env)];
    if (blockingConfigErrors.length) throw new Error(`INTEGRATION_CONFIG:${blockingConfigErrors.join(",")}`);

    await db.$queryRaw`SELECT 1`;
    const migrations = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    if ((migrations[0]?.count ?? 0n) > 0n) throw new Error("MIGRATION_INCOMPLETE");

    const requiredFacilitators = router.supportedNetworks().map((network) => ({ network, url: router.getRoute(network).facilitatorUrl }));
    if (!requiredFacilitators.some(({ network }) => network === "hedera:testnet")) throw new Error("HEDERA_TESTNET_ROUTE_REQUIRED");
    await Promise.all(requiredFacilitators.map(({ network, url }) => assertFacilitator(url, network)));

    const catalyst = await catalystProductionReadiness();
    if (catalyst.enabled && !catalyst.ready) throw new Error(`CATALYST_RELEASE_NOT_READY:${[...catalyst.configErrors, ...(catalyst.evidence?.missing ?? [])].join(",")}`);
    const duneErrors = duneReadinessErrors(process.env);
    return ok({
      status: "ready",
      database: "connected",
      facilitatorTopology: process.env.AGENTPAY_FACILITATOR_ORIGIN ? "unified" : "legacy-per-network",
      facilitators: Object.fromEntries(requiredFacilitators.map(({ network }) => [network, "connected"])),
      integrations: {
        pythPolicy: process.env.PYTH_POLICY_ENABLED === "true" ? "configured" : "disabled",
        masumiPolicy: process.env.MASUMI_POLICY_ENABLED === "true" ? "configured" : "disabled",
        masumiEscrow: process.env.MASUMI_ESCROW_ENABLED === "true" ? "configured" : "disabled",
        veridianIdentity: process.env.VERIDIAN_IDENTITY_ENABLED === "true" ? "configured" : "disabled",
        usdcx: process.env.CARDANO_USDCX_ENABLED === "true" ? "configured" : "disabled",
        duneAnalytics: process.env.DUNE_ANALYTICS_ENABLED !== "true" ? "disabled" : duneErrors.length ? "degraded" : "configured",
        catalystProduction: catalyst.enabled ? "verified" : "disabled",
      },
      catalyst: catalyst.enabled ? { releaseSha: catalyst.evidence?.releaseSha ?? null, evidenceTypes: catalyst.evidence?.present ?? [], liveDependencies: catalyst.liveDependencies } : null,
      latencyMs: Math.round(performance.now() - started),
    });
  } catch {
    return problem(503, "NOT_READY", "A required AgentPay dependency, production configuration, or release-evidence gate is unavailable.");
  }
}
