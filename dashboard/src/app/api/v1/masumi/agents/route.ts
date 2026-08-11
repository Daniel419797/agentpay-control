import { z } from "zod";

import { discoverMasumiAgents } from "@/lib/masumi";
import { handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceFromRequest } from "@/lib/workspace";

const querySchema = z.object({
  network: z.enum(["Preprod", "Mainnet"]),
  capability: z.string().trim().min(1).max(100).optional(),
  capabilityVersion: z.string().trim().min(1).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(15).default([]),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before discovering Masumi agents.");
    if (process.env.MASUMI_POLICY_ENABLED !== "true") return problem(503, "MASUMI_POLICY_DISABLED", "Masumi registry integration is disabled for this deployment.");

    const rate = await enforceRateLimit(request, {
      scope: "masumi-agent-discovery",
      subject: `user:${workspace.user.id}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);

    const url = new URL(request.url);
    const parsed = querySchema.parse({
      network: url.searchParams.get("network"),
      capability: url.searchParams.get("capability") || undefined,
      capabilityVersion: url.searchParams.get("capabilityVersion") || undefined,
      tags: url.searchParams.getAll("tag"),
      limit: url.searchParams.get("limit") || 20,
    });
    const entries = await discoverMasumiAgents({
      network: parsed.network,
      capabilityName: parsed.capability,
      capabilityVersion: parsed.capabilityVersion,
      tags: parsed.tags,
      limit: parsed.limit,
    });

    // Return only public discovery metadata. Seller wallet/payment information
    // is resolved again by the binding endpoint before it becomes trusted.
    return ok(entries.map((entry) => ({
      agentIdentifier: entry.agentIdentifier,
      name: entry.name,
      description: entry.description ?? null,
      status: entry.status,
      apiBaseUrl: entry.apiBaseUrl,
      paymentType: entry.paymentType ?? null,
      capability: entry.Capability ? { name: entry.Capability.name, version: entry.Capability.version ?? null } : null,
      tags: entry.tags,
      registryPolicyId: entry.RegistrySource.policyId,
    })));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MASUMI_PROVIDER_")) {
      return problem(503, "MASUMI_REGISTRY_UNAVAILABLE", "Masumi registry discovery is temporarily unavailable.");
    }
    return handleApiError(error);
  }
}