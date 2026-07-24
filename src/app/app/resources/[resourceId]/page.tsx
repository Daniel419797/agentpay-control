import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function ResourcePage({ params }: { params: Promise<{ resourceId: string }> }) {
  const [{ resourceId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const resource = await db.resourceListing.findFirst({
    where: { id: resourceId, provider: { organizationId: workspace.organization.id } },
    include: { provider: true, prices: { include: { asset: true } } },
  });
  if (!resource) notFound();
  const price = resource.prices[0];
  return <FormPage title={resource.name} description={resource.description}>
    <div className="detail-grid">
      <div><span>Price</span><strong>{price ? `${formatAtomic(price.atomicAmount.toString(), price.asset.decimals)} ${price.asset.symbol}` : "Unpriced"}</strong></div>
      <div><span>Scheme</span><strong>{price?.scheme ?? "Unavailable"}</strong></div>
      <div><span>Endpoint</span><strong>{resource.endpoint}</strong></div>
      <div><span>Settlement</span><strong>{resource.provider.settlementAccountId}</strong></div>
      <div><span>Status</span><strong>{resource.status}</strong></div>
    </div>
  </FormPage>;
}
