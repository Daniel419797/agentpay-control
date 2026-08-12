import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { verifyVeridianCredential } from "@/lib/veridian-keri";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const credentialSchema = z.object({
  credential: z.unknown(),
  expectedAid: z.string().min(20).max(200).optional(),
});

async function ownedResource(resourceId: string, organizationId: string) {
  return db.resourceListing.findFirst({ where: { id: resourceId, provider: { organizationId } }, include: { provider: true } });
}

function claimedMasumiIdentifier(credential: unknown) {
  if (!credential || typeof credential !== "object") return null;
  const attribute = (credential as Record<string, unknown>).a;
  if (!attribute || typeof attribute !== "object") return null;
  const claims = attribute as Record<string, unknown>;
  const value = claims.masumiAgentIdentifier ?? claims.agentIdentifier;
  return typeof value === "string" ? value : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing Veridian identity bindings.");
    const { resourceId } = await params;
    if (!await ownedResource(resourceId, workspace.organization.id)) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found in the active workspace.");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "masumiAgentIdentifier","aid","credentialSaid","issuerAid","schemaSaid","claimsHash","verifiedAt","expiresAt","createdAt","updatedAt"
      FROM "KeriResourceIdentity" WHERE "resourceListingId"=${resourceId}::uuid LIMIT 1
    `;
    return ok({ resourceId, binding: rows[0] ?? null });
  } catch (error) { return handleApiError(error); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before binding a Veridian credential.");
    if (!workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Owner or Provider Admin access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing a verifiable identity binding.");
    const { resourceId } = await params;
    const resource = await ownedResource(resourceId, workspace.organization.id);
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found in the active workspace.");
    if (resource.provider.status !== "ACTIVE" || resource.provider.verificationStatus !== "VERIFIED") return problem(409, "PROVIDER_VERIFICATION_REQUIRED", "The provider must be active and verified first.");
    const input = credentialSchema.parse(await boundedJson(request, 256 * 1024));
    const masumiRows = await db.$queryRaw<Array<{ agentIdentifier: string }>>`SELECT "agentIdentifier" FROM "MasumiResourceBinding" WHERE "resourceListingId"=${resourceId}::uuid LIMIT 1`;
    const masumi = masumiRows[0];
    if (!masumi) return problem(409, "MASUMI_RESOURCE_BINDING_REQUIRED", "Verify the Masumi resource identity before adding a Veridian credential.");
    const claimed = claimedMasumiIdentifier(input.credential);
    if (!claimed || claimed.toLowerCase() !== masumi.agentIdentifier.toLowerCase()) return problem(422, "VERIDIAN_MASUMI_CLAIM_REQUIRED", "The verified credential must contain a masumiAgentIdentifier claim matching the resource binding.");
    const verified = await verifyVeridianCredential(input.credential);
    const aid = input.expectedAid ?? verified.subjectAid;
    if (!aid) return problem(422, "VERIDIAN_SUBJECT_AID_REQUIRED", "The credential must identify the resource agent AID or expectedAid must be provided.");
    if (input.expectedAid && verified.subjectAid && input.expectedAid !== verified.subjectAid) return problem(422, "VERIDIAN_SUBJECT_AID_MISMATCH", "The credential subject AID does not match the expected AID.");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "KeriResourceIdentity" ("resourceListingId","masumiAgentIdentifier","aid","credentialSaid","issuerAid","schemaSaid","claimsHash","verifiedAt","expiresAt","verifierEvidence","createdAt","updatedAt")
        VALUES (${resourceId}::uuid,${masumi.agentIdentifier},${aid},${verified.credentialSaid},${verified.issuerAid},${verified.schemaSaid},${verified.claimsHash},${verified.verifiedAt},${verified.expiresAt},${JSON.stringify(verified.evidence)}::jsonb,now(),now())
        ON CONFLICT ("resourceListingId") DO UPDATE SET "masumiAgentIdentifier"=EXCLUDED."masumiAgentIdentifier","aid"=EXCLUDED."aid","credentialSaid"=EXCLUDED."credentialSaid","issuerAid"=EXCLUDED."issuerAid","schemaSaid"=EXCLUDED."schemaSaid","claimsHash"=EXCLUDED."claimsHash","verifiedAt"=EXCLUDED."verifiedAt","expiresAt"=EXCLUDED."expiresAt","verifierEvidence"=EXCLUDED."verifierEvidence","updatedAt"=now()
      `;
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "VERIDIAN_RESOURCE_IDENTITY_VERIFIED", targetType: "RESOURCE_LISTING", targetId: resourceId, result: "SUCCESS", metadata: { aid, credentialSaid: verified.credentialSaid, issuerAid: verified.issuerAid, schemaSaid: verified.schemaSaid, claimsHash: verified.claimsHash, masumiAgentIdentifier: masumi.agentIdentifier } } });
    });
    return ok({ resourceId, masumiAgentIdentifier: masumi.agentIdentifier, aid, ...verified, evidence: undefined });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before removing a Veridian binding.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before removing a verifiable identity binding.");
    const { resourceId } = await params;
    if (!await ownedResource(resourceId, workspace.organization.id)) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found in the active workspace.");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "KeriResourceIdentity" WHERE "resourceListingId"=${resourceId}::uuid`;
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "VERIDIAN_RESOURCE_IDENTITY_REMOVED", targetType: "RESOURCE_LISTING", targetId: resourceId, result: "SUCCESS", metadata: {} } });
    });
    return ok({ resourceId, removed: true });
  } catch (error) { return handleApiError(error); }
}
