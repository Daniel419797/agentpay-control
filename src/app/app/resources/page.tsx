import type { Route } from "next";

import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function ResourcesPage() {
  const workspace = await currentWorkspace();
  const resources = workspace ? await db.resourceListing.findMany({
    where: { provider: { organizationId: workspace.organization.id } },
    include: { provider: true, prices: { include: { asset: true } } },
    orderBy: { createdAt: "desc" },
  }) : [];

  return <WorkspacePage
    title="Resource catalog"
    description="x402 endpoints your agents can discover and purchase."
    empty="Register a real provider resource to begin."
    rows={resources.map((resource) => {
      const price = resource.prices[0];
      return {
        id: resource.id,
        title: resource.name,
        subtitle: `${resource.category.replaceAll("_", " ")} · ${resource.provider.name}`,
        meta: price ? `${formatAtomic(price.atomicAmount.toString(), price.asset.decimals)} ${price.asset.symbol}` : "Unpriced",
        status: resource.status,
        href: `/app/resources/${resource.id}` as Route,
      };
    })}
  />;
}
