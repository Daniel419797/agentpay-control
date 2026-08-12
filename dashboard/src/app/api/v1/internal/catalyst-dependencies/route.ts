import { catalystProductionConfigErrors, liveCatalystDependencyChecks } from "@/lib/catalyst-release";
import { ok, problem } from "@/lib/api";
import { authorizeReleaseEvidenceRequest } from "@/lib/release-evidence-auth";

export async function GET(request: Request) {
  if (!authorizeReleaseEvidenceRequest(request)) return problem(401, "UNAUTHORIZED", "A dedicated release-evidence credential is required.");
  const configErrors = catalystProductionConfigErrors(process.env);
  if (configErrors.length) return problem(503, "CATALYST_CONFIG_NOT_READY", `Catalyst production configuration is incomplete: ${configErrors.join(", ")}`);
  try {
    return ok({ verifiedAt: new Date().toISOString(), dependencies: await liveCatalystDependencyChecks() });
  } catch {
    return problem(503, "CATALYST_DEPENDENCIES_NOT_READY", "One or more Catalyst production dependencies failed live verification.");
  }
}
