import { AppShell } from "@/components/app-shell";

// All routes in this segment are organization-scoped and read live data.
// Build-time rendering would couple deployments to PostgreSQL and could cache
// one workspace's data into a static artifact.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
