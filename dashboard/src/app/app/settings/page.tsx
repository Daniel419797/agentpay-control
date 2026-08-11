import { SettingsOperations } from "@/components/settings-operations";
import { db } from "@/lib/db";
import { notificationDestinationDisplay } from "@/lib/notification-destination";
import { currentWorkspace } from "@/lib/workspace";

export default async function SettingsPage() {
  const workspace = await currentWorkspace();
  if (!workspace) return null;
  const organizationId = workspace.organization.id;
  const roles = workspace.membership.roles;
  const isOwner = roles.includes("OWNER");
  const canViewMembers = isOwner || roles.includes("OPERATOR") || roles.includes("VIEWER");
  const canViewEndpoints = isOwner || roles.includes("OPERATOR") || roles.includes("VIEWER");

  const [members, endpoints, retention] = await Promise.all([
    canViewMembers
      ? db.membership.findMany({ where: { organizationId }, include: { user: { select: { email: true, displayName: true } } }, orderBy: { invitedAt: "desc" } })
      : Promise.resolve([]),
    canViewEndpoints
      ? db.notificationEndpoint.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    db.dataRetentionPolicy.upsert({ where: { organizationId }, update: {}, create: { organizationId } }),
  ]);

  return <div className="page">
    <div className="page-heading"><div><h1>Organization settings</h1><p>Membership, notifications, retention, and emergency operating controls.</p></div></div>
    <SettingsOperations
      organization={{ name: workspace.organization.name, timezone: workspace.organization.timezone, slug: workspace.organization.slug, killSwitchEnabled: workspace.organization.killSwitchEnabled }}
      permissions={{ isOwner, canViewMembers, canViewEndpoints }}
      members={members.map((member) => ({ id: member.id, email: member.user.email, displayName: member.user.displayName, roles: member.roles, status: member.status }))}
      endpoints={endpoints.map((endpoint) => ({ id: endpoint.id, name: endpoint.name, type: endpoint.type, destination: notificationDestinationDisplay(endpoint.type, endpoint.destination), status: endpoint.status }))}
      retention={{ auditDays: retention.auditDays, financialRecordDays: retention.financialRecordDays, fulfillmentBodyDays: retention.fulfillmentBodyDays, notificationDays: retention.notificationDays }}
    />
  </div>;
}
