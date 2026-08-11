import { AppShell } from "@/components/app-shell";
import { isHederaMainnetEnabled, isManagedArcEnabled } from "@/domain/network-router";
import { getConfig } from "@/lib/config";

// All routes in this segment are organization-scoped and read live data.
// Build-time rendering would couple deployments to PostgreSQL and could cache
// one workspace's data into a static artifact.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  return <AppShell mainnetEnabled={isHederaMainnetEnabled(config)} arcEnabled={isManagedArcEnabled(config)}>{children}</AppShell>;
}
