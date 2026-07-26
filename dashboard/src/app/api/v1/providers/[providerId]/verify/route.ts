import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before verifying a provider.");
    if (!workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Owner or Provider Admin access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before verifying a settlement account.");
    const { providerId } = await context.params;
    const provider = await db.resourceProvider.findFirst({ where: { id: providerId, organizationId: workspace.organization.id } });
    if (!provider) return problem(404, "PROVIDER_NOT_FOUND", "Provider not found.");
    const identity = await db.walletIdentity.findFirst({ where: { userId: workspace.user.id, network: "hedera:testnet", accountId: provider.settlementAccountId } });
    const managedAccount = await db.paymentAccount.findFirst({ where: { agent: { organizationId: workspace.organization.id }, network: "hedera:testnet", accountId: provider.settlementAccountId, status: "ACTIVE" } });
    if (!identity && !managedAccount) return problem(409, "SETTLEMENT_ACCOUNT_NOT_VERIFIED", "Verify ownership of the settlement account with HashPack or use an active organization-managed account.");
    const updated = await db.$transaction(async (tx) => {
      const record = await tx.resourceProvider.update({ where: { id: provider.id }, data: { settlementAccountVerified: true, verificationStatus: "VERIFIED", verifiedAt: new Date(), status: "ACTIVE" } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "RESOURCE_PROVIDER_VERIFIED", targetType: "RESOURCE_PROVIDER", targetId: provider.id, result: "SUCCESS", metadata: { verificationMethod: identity ? "WALLET_IDENTITY" : "MANAGED_ACCOUNT" } } });
      return record;
    });
    return ok(updated);
  } catch (error) { return handleApiError(error); }
}
