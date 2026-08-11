import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const usdMicros = z.string().regex(/^[1-9]\d*$/).max(24).nullable().optional();
const schema = z.object({
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
  }).optional(),
}).refine((value) => value.oracle !== undefined || value.masumi !== undefined, { message: "Provide oracle or Masumi controls." });

async function getOwnedDraft(policyVersionId: string, organizationId: string) {
  return db.policyVersion.findFirst({
    where: { id: policyVersionId, policy: { organizationId } },
    include: { policy: { select: { organizationId: true, agentId: true } }, asset: { select: { network: true, symbol: true, decimals: true } } },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ policyVersionId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing policy controls.");
    const { policyVersionId } = await params;
    const version = await db.policyVersion.findFirst({ where: { id: policyVersionId, policy: { organizationId: workspace.organization.id } }, select: { id: true, status: true } });
    if (!version) return problem(404, "POLICY_VERSION_NOT_FOUND", "Policy version not found in the active workspace.");
    const [oracle, masumi] = await Promise.all([
      db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "PolicyOracleLimit" WHERE "policyVersionId" = ${policyVersionId}::uuid LIMIT 1`,
      db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "MasumiPolicyTrust" WHERE "policyVersionId" = ${policyVersionId}::uuid LIMIT 1`,
    ]);
    const serialize = (row: Record<string, unknown> | undefined) => row ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])) : null;
    return ok({ policyVersionId, status: version.status, oracle: serialize(oracle[0]), masumi: serialize(masumi[0]) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ policyVersionId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing policy controls.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required to change payment policy controls.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing payment policy controls.");
    const { policyVersionId } = await params;
    const input = schema.parse(await boundedJson(request));
    const version = await getOwnedDraft(policyVersionId, workspace.organization.id);
    if (!version) return problem(404, "POLICY_VERSION_NOT_FOUND", "Policy version not found in the active workspace.");
    if (version.status !== "DRAFT") return problem(409, "POLICY_VERSION_IMMUTABLE", "Catalyst controls can only be changed on a draft policy version.");
    if (input.masumi?.enabled && !version.asset.network.startsWith("cardano:")) return problem(422, "MASUMI_CARDANO_POLICY_REQUIRED", "Masumi trust controls require a Cardano policy asset.");

    await db.$transaction(async (tx) => {
      if (input.oracle) {
        if (!input.oracle.enabled) {
          await tx.$executeRaw`DELETE FROM "PolicyOracleLimit" WHERE "policyVersionId" = ${policyVersionId}::uuid`;
        } else {
          await tx.$executeRaw`
            INSERT INTO "PolicyOracleLimit" (
              "policyVersionId", "quoteCurrency", "perTransactionUsdMicros", "hourlyUsdMicros", "dailyUsdMicros", "monthlyUsdMicros", "maxPriceAgeSeconds", "maxConfidenceBps", "createdAt", "updatedAt"
            ) VALUES (
              ${policyVersionId}::uuid, 'USD', ${input.oracle.perTransactionUsdMicros ?? null}::bigint,
              ${input.oracle.hourlyUsdMicros ?? null}::bigint, ${input.oracle.dailyUsdMicros ?? null}::bigint,
              ${input.oracle.monthlyUsdMicros ?? null}::bigint, ${input.oracle.maxPriceAgeSeconds}, ${input.oracle.maxConfidenceBps}, now(), now()
            )
            ON CONFLICT ("policyVersionId") DO UPDATE SET
              "perTransactionUsdMicros" = EXCLUDED."perTransactionUsdMicros",
              "hourlyUsdMicros" = EXCLUDED."hourlyUsdMicros",
              "dailyUsdMicros" = EXCLUDED."dailyUsdMicros",
              "monthlyUsdMicros" = EXCLUDED."monthlyUsdMicros",
              "maxPriceAgeSeconds" = EXCLUDED."maxPriceAgeSeconds",
              "maxConfidenceBps" = EXCLUDED."maxConfidenceBps",
              "updatedAt" = now()
          `;
        }
      }

      if (input.masumi) {
        if (!input.masumi.enabled) {
          await tx.$executeRaw`DELETE FROM "MasumiPolicyTrust" WHERE "policyVersionId" = ${policyVersionId}::uuid`;
        } else {
          const identifiers = input.masumi.allowedAgentIdentifiers.map((value) => value.toLowerCase());
          await tx.$executeRaw`
            INSERT INTO "MasumiPolicyTrust" (
              "policyVersionId", "required", "network", "allowedAgentIdentifiers", "allowedCapabilities", "maxRegistryAgeSeconds", "requireOnline", "createdAt", "updatedAt"
            ) VALUES (
              ${policyVersionId}::uuid, ${input.masumi.required}, ${input.masumi.network}, ${identifiers}::text[],
              ${input.masumi.allowedCapabilities}::text[], ${input.masumi.maxRegistryAgeSeconds}, ${input.masumi.requireOnline}, now(), now()
            )
            ON CONFLICT ("policyVersionId") DO UPDATE SET
              "required" = EXCLUDED."required",
              "network" = EXCLUDED."network",
              "allowedAgentIdentifiers" = EXCLUDED."allowedAgentIdentifiers",
              "allowedCapabilities" = EXCLUDED."allowedCapabilities",
              "maxRegistryAgeSeconds" = EXCLUDED."maxRegistryAgeSeconds",
              "requireOnline" = EXCLUDED."requireOnline",
              "updatedAt" = now()
          `;
        }
      }

      await tx.auditEvent.create({
        data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: workspace.user.id,
          action: "CATALYST_POLICY_CONTROLS_UPDATED",
          targetType: "POLICY_VERSION",
          targetId: policyVersionId,
          result: "SUCCESS",
          metadata: {
            oracleEnabled: input.oracle?.enabled ?? null,
            masumiEnabled: input.masumi?.enabled ?? null,
            masumiNetwork: input.masumi?.enabled ? input.masumi.network : null,
            assetNetwork: version.asset.network,
            assetSymbol: version.asset.symbol,
          },
        },
      });
    });

    return GET(request, { params: Promise.resolve({ policyVersionId }) });
  } catch (error) {
    return handleApiError(error);
  }
}
