import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatTimestamp } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function AuditPage() {
  const workspace = await currentWorkspace();
  const events = workspace ? await db.auditEvent.findMany({
    where: { organizationId: workspace.organization.id },
    orderBy: { occurredAt: "desc" },
    take: 100,
  }) : [];
  return <WorkspacePage
    title="Audit log"
    description="Immutable operator, agent, policy, and settlement events."
    empty="Audit events appear as real actions occur."
    rows={events.map((event) => ({
      id: event.id,
      title: event.action.replaceAll("_", " "),
      subtitle: `${event.actorType} · ${event.targetType}`,
      meta: formatTimestamp(event.occurredAt),
      status: event.result,
    }))}
  />;
}
