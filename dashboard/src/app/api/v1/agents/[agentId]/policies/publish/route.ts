import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { masumiConfigFromEnv } from "@/lib/masumi";
import { masumiPaymentConfigFromEnv } from "@/lib/masumi-payment";
import { pythConfigFromEnv, pythFeedForSymbol } from "@/lib/pyth";
import { hasRecentAuthentication } from "@/lib/session";
import { veridianKeriConfigFromEnv } from "@/lib/veridian-keri";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const usdMicros = z.string().regex(/^[1-9]\d*$/).max(24).nullable().optional();
const catalystSchema = z.object({
  oracle: z.object({
    enabled: z.boolean(),
    perTransactionUsdMicros: usdMicros,
    hourlyUsdMicros: usdMicros,
    dailyUsdMicros: usdMicros,
    monthlyUsdMicros: usdMicros,
    maxPriceAgeSeconds: z.number().int().min(1).max(300).default(30),
    maxConfidenceBps: z.number().int().min(1).max(5000).default(250),
  }).optional(),
  masumi: z.object({
    enabled: z.boolean(),
    required: z.boolean().default(true),
    network: z.enum(["Preprod", "Mainnet"]),
    allowedAgentIdentifiers: z.array(z.string().regex(/^[0-9a-fA-F]{57,250}$/)).max(100).default([]),
    allowedCapabilities: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    maxRegistryAgeSeconds: z.number().int().min(15).max(3600).default(120),
    requireOnline: z.boolean().default(true),
    minimumReputationBps: z.number().int().min(0).max(10000).nullable().default(null),
    minimumCompletedPurchases: z.number().int().min(0).max(1_000_000).default(0),
  }).optional(),
  keri: z.object({
    enabled: z.boolean(),
    required: z.boolean().default(true),
    trustedIssuerAids: z.array(z.string().trim().min(20).max(200)).max(100).default([]),
    allowedSchemaSaids: z.array(z.string().trim().min(20).max(200)).max(100).default([]),
    maxVerificationAgeSeconds: z.number().int().min(15).max(86400).default(300),
  }).optional(),
}).optional();

const schema = z.object({
  assetId: z.string().uuid(),
  perTransactionLimitAtomic: z.string().regex(/^\d+$/),
  dailyLimitAtomic: z.string().regex(/^\d+$/),
  overLimitAction: z.enum(["DENY", "REQUIRE_APPROVAL"]),
  merchantMode: z.enum(["ANY", "ALLOWLIST_ONLY"]),
  allowedHosts: z.array(z.string()).default([]),
  deniedHosts: z.array(z.string()).default([]),
  approvalThreshold: z.number().int().min(1).max(20).default(1),
  rejectionThreshold: z.number().int().min(1).max(20).default(1),
  allowedMerchantCategories: z.array(z.enum(["MARKET_DATA", "FILE", "AI_INFERENCE", "WEB_RESEARCH"])).default([]),
  activeFrom: z.coerce.date().optional(),
  activeUntil: z.coerce.date().optional(),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
  allowedStartMinute: z.number().int().min(0).max(1439).optional(),
  allowedEndMinute: z.number().int().min(0).max(1439).optional(),
  hourlyLimitAtomic: z.string().regex(/^\d+$/).optional(),
  monthlyLimitAtomic: z.string().regex(/^\d+$/).optional(),
  maxTransactionsPerHour: z.number().int().positive().max(10_000).optional(),
  cooldownSeconds: z.number().int().min(0).max(86_400).optional(),
  catalyst: catalystSchema,
}).superRefine((value, context) => {
  if ((value.allowedStartMinute == null) !== (value.allowedEndMinute == null)) context.addIssue({ code: "custom", message: "Both schedule minutes are required." });
  if (value.activeFrom && value.activeUntil && value.activeUntil <= value.activeFrom) context.addIssue({ code: "custom", message: "activeUntil must be after activeFrom." });
});

function masumiNetworkForAgent(network: string) {
  if (network === "cardano:preprod") return "Preprod" as const;
  if (network === "cardano:mainnet") return "Mainnet" as const;
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before publishing a policy.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before publishing financial policy controls.");

    const { agentId } = await params;
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id } });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    const input = schema.parse(await boundedJson(request));
    const asset = await db.asset.findUnique({ where: { id: input.assetId } });
    if (!asset || asset.network !== agent.network) return problem(422, "POLICY_ASSET_NETWORK_MISMATCH", "The policy asset must belong to the agent's payment network.");

    if (input.catalyst?.oracle?.enabled) {
      if (process.env.PYTH_POLICY_ENABLED !== "true") return problem(503, "PYTH_POLICY_DISABLED", "Pyth-valued policy controls are not enabled for this deployment.");
      try {
        const pyth = pythConfigFromEnv();
        pythFeedForSymbol(asset.symbol, pyth);
      } catch {
        return problem(503, "PYTH_POLICY_NOT_CONFIGURED", "The selected asset does not have a complete Pyth policy feed configuration.");
      }
    }

    if (input.catalyst?.masumi?.enabled) {
      if (process.env.MASUMI_POLICY_ENABLED !== "true") return problem(503, "MASUMI_POLICY_DISABLED", "Masumi trust controls are not enabled for this deployment.");
      const expected = masumiNetworkForAgent(agent.network);
      if (!expected || input.catalyst.masumi.network !== expected) return problem(422, "MASUMI_POLICY_NETWORK_MISMATCH", "Masumi trust must use the same Cardano network as the agent.");
      try { masumiConfigFromEnv(); }
      catch { return problem(503, "MASUMI_POLICY_NOT_CONFIGURED", "Masumi registry trust is not fully configured for this deployment."); }
      if ((input.catalyst.masumi.minimumCompletedPurchases > 0 || input.catalyst.masumi.minimumReputationBps != null)) {
        if (process.env.MASUMI_ESCROW_ENABLED !== "true") return problem(503, "MASUMI_REPUTATION_SOURCE_DISABLED", "Masumi escrow must be enabled before enforcing settlement-derived reputation.");
        try { masumiPaymentConfigFromEnv(); }
        catch { return problem(503, "MASUMI_ESCROW_NOT_CONFIGURED", "Masumi payment-node configuration is required for settlement-derived reputation."); }
      }
    }

    if (input.catalyst?.keri?.enabled) {
      if (!masumiNetworkForAgent(agent.network)) return problem(422, "VERIDIAN_CARDANO_POLICY_REQUIRED", "Veridian/KERI identity controls require a Cardano agent.");
      if (process.env.VERIDIAN_IDENTITY_ENABLED !== "true") return problem(503, "VERIDIAN_IDENTITY_DISABLED", "Veridian/KERI identity controls are not enabled for this deployment.");
      if (!input.catalyst.keri.trustedIssuerAids.length || !input.catalyst.keri.allowedSchemaSaids.length) return problem(422, "VERIDIAN_POLICY_ALLOWLIST_REQUIRED", "KERI policy enforcement requires at least one trusted issuer AID and allowed schema SAID.");
      try {
        const config = veridianKeriConfigFromEnv();
        if (input.catalyst.keri.trustedIssuerAids.some((aid) => !config.trustedIssuerAids.includes(aid))) return problem(422, "VERIDIAN_ISSUER_NOT_DEPLOYMENT_TRUSTED", "Every policy issuer AID must also be trusted by the deployment.");
        if (input.catalyst.keri.allowedSchemaSaids.some((said) => !config.allowedSchemaSaids.includes(said))) return problem(422, "VERIDIAN_SCHEMA_NOT_DEPLOYMENT_ALLOWED", "Every policy schema SAID must also be allowed by the deployment.");
      } catch (error) {
        if (error instanceof Response) return error;
        return problem(503, "VERIDIAN_IDENTITY_NOT_CONFIGURED", "Veridian/KERIA verification is not fully configured for this deployment.");
      }
    }

    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`policy-publish:${agentId}`}, 0))`;
      let policy = await tx.policy.findFirst({ where: { agentId } });
      if (!policy) policy = await tx.policy.create({ data: { agentId, organizationId: workspace.organization.id } });
      const latest = await tx.policyVersion.aggregate({ where: { policyId: policy.id }, _max: { version: true } });

      const version = await tx.policyVersion.create({
        data: {
          policyId: policy.id,
          version: (latest._max.version ?? 0) + 1,
          status: "DRAFT",
          assetId: input.assetId,
          perTransactionLimitAtomic: input.perTransactionLimitAtomic,
          dailyLimitAtomic: input.dailyLimitAtomic,
          overLimitAction: input.overLimitAction,
          merchantMode: input.merchantMode,
          allowedHosts: input.allowedHosts.map((value) => value.toLowerCase()),
          deniedHosts: input.deniedHosts.map((value) => value.toLowerCase()),
          approvalThreshold: input.approvalThreshold,
          rejectionThreshold: input.rejectionThreshold,
          allowedMerchantCategories: input.allowedMerchantCategories,
          activeFrom: input.activeFrom,
          activeUntil: input.activeUntil,
          allowedWeekdays: [...new Set(input.allowedWeekdays)],
          allowedStartMinute: input.allowedStartMinute,
          allowedEndMinute: input.allowedEndMinute,
          hourlyLimitAtomic: input.hourlyLimitAtomic,
          monthlyLimitAtomic: input.monthlyLimitAtomic,
          maxTransactionsPerHour: input.maxTransactionsPerHour,
          cooldownSeconds: input.cooldownSeconds,
          createdBy: workspace.user.id,
        },
      });

      if (input.catalyst?.oracle?.enabled) {
        const oracle = input.catalyst.oracle;
        await tx.$executeRaw`
          INSERT INTO "PolicyOracleLimit" (
            "policyVersionId", "quoteCurrency", "perTransactionUsdMicros", "hourlyUsdMicros", "dailyUsdMicros", "monthlyUsdMicros", "maxPriceAgeSeconds", "maxConfidenceBps", "createdAt", "updatedAt"
          ) VALUES (
            ${version.id}::uuid, 'USD', ${oracle.perTransactionUsdMicros ?? null}::bigint,
            ${oracle.hourlyUsdMicros ?? null}::bigint, ${oracle.dailyUsdMicros ?? null}::bigint,
            ${oracle.monthlyUsdMicros ?? null}::bigint, ${oracle.maxPriceAgeSeconds}, ${oracle.maxConfidenceBps}, now(), now()
          )
        `;
      }

      if (input.catalyst?.masumi?.enabled) {
        const masumi = input.catalyst.masumi;
        const identifiers = masumi.allowedAgentIdentifiers.map((value) => value.toLowerCase());
        await tx.$executeRaw`
          INSERT INTO "MasumiPolicyTrust" (
            "policyVersionId", "required", "network", "allowedAgentIdentifiers", "allowedCapabilities", "maxRegistryAgeSeconds", "requireOnline", "minimumReputationBps", "minimumCompletedPurchases", "createdAt", "updatedAt"
          ) VALUES (
            ${version.id}::uuid, ${masumi.required}, ${masumi.network}, ${identifiers}::text[], ${masumi.allowedCapabilities}::text[], ${masumi.maxRegistryAgeSeconds}, ${masumi.requireOnline}, ${masumi.minimumReputationBps}, ${masumi.minimumCompletedPurchases}, now(), now()
          )
        `;
      }

      if (input.catalyst?.keri?.enabled) {
        const keri = input.catalyst.keri;
        await tx.$executeRaw`
          INSERT INTO "KeriPolicyTrust" (
            "policyVersionId", "required", "trustedIssuerAids", "allowedSchemaSaids", "maxVerificationAgeSeconds", "createdAt", "updatedAt"
          ) VALUES (
            ${version.id}::uuid, ${keri.required}, ${keri.trustedIssuerAids}::text[], ${keri.allowedSchemaSaids}::text[], ${keri.maxVerificationAgeSeconds}, now(), now()
          )
        `;
      }

      await tx.policyVersion.updateMany({ where: { policyId: policy.id, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
      const published = await tx.policyVersion.update({ where: { id: version.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await tx.agent.update({ where: { id: agentId }, data: { effectivePolicyId: published.id } });
      await tx.auditEvent.create({
        data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: workspace.user.id,
          action: "POLICY_PUBLISHED",
          targetType: "POLICY_VERSION",
          targetId: published.id,
          result: "SUCCESS",
          metadata: {
            agentId,
            version: published.version,
            asset: asset.symbol,
            network: asset.network,
            pythUsdPolicy: input.catalyst?.oracle?.enabled === true,
            masumiTrust: input.catalyst?.masumi?.enabled === true,
            masumiMinimumReputationBps: input.catalyst?.masumi?.enabled ? input.catalyst.masumi.minimumReputationBps : null,
            masumiMinimumCompletedPurchases: input.catalyst?.masumi?.enabled ? input.catalyst.masumi.minimumCompletedPurchases : null,
            keriTrust: input.catalyst?.keri?.enabled === true,
          },
        },
      });
      return published;
    });

    return ok({
      ...result,
      perTransactionLimitAtomic: result.perTransactionLimitAtomic.toString(),
      dailyLimitAtomic: result.dailyLimitAtomic.toString(),
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
