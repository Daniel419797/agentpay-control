import { AppShell } from "@/components/app-shell";
import { getConfig } from "@/lib/config";

// All routes in this segment are organization-scoped and read live data.
// Build-time rendering would couple deployments to PostgreSQL and could cache
// one workspace's data into a static artifact.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const mainnetEnabled = config.APP_ENV !== "production" || Boolean(config.HEDERA_MAINNET_FACILITATOR_URL);
  return <AppShell mainnetEnabled={mainnetEnabled}>{children}</AppShell>;
}
