import Link from "next/link";
import { MarketplaceOperations } from "@/components/marketplace-operations";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function MarketplacePage() {
  const workspace = await currentWorkspace();
  const organizationId = workspace?.organization.id;
  const [resources, providers, assets] = await Promise.all([
    db.resourceListing.findMany({ where: { status: "ACTIVE", public: true, provider: { status: "ACTIVE", verificationStatus: "VERIFIED" } }, include: { provider: true, prices: { include: { asset: true } }, healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 }, reviews: { where: { status: "PUBLISHED" }, select: { rating: true } } }, orderBy: { createdAt: "desc" } }),
    organizationId ? db.resourceProvider.findMany({ where: { organizationId }, select: { id: true, name: true, verificationStatus: true }, orderBy: { createdAt: "desc" } }) : [],
    db.asset.findMany({ where: { verified: true }, select: { id: true, symbol: true, network: true }, orderBy: { symbol: "asc" } }),
  ]);
  return <div className="page"><div className="page-heading"><div><h1>Marketplace</h1><p>Verified, payment-ready resources your agents can purchase through x402.</p></div></div>
    <MarketplaceOperations providers={providers.map((provider) => ({ id: provider.id, label: provider.name, verificationStatus: provider.verificationStatus }))} assets={assets.map((asset) => ({ id: asset.id, label: `${asset.symbol} · ${asset.network}` }))} />
    {resources.length ? <div className="catalog-grid section-gap">{resources.map((resource) => { const price = resource.prices[0]; const rating = resource.reviews.length ? resource.reviews.reduce((sum, review) => sum + review.rating, 0) / resource.reviews.length : null; return <Link href={`/app/resources/${resource.id}`} className="catalog-card" key={resource.id}><div className="catalog-kicker"><span>{resource.category.replaceAll("_", " ")}</span><span>{resource.healthChecks[0]?.status ?? resource.healthStatus}</span></div><h2>{resource.name}</h2><p>{resource.description}</p><div className="catalog-meta"><span>{resource.provider.name}</span><strong>{price ? `${price.atomicAmount} ${price.asset.symbol}` : "Price unavailable"}</strong></div><div className="catalog-foot"><span>{rating ? `${rating.toFixed(1)} / 5` : "No reviews"}</span><span>{resource.tags.length ? resource.tags.slice(0, 2).join(" · ") : "Verified listing"}</span></div></Link>; })}</div> : <div className="panel section-gap"><div className="empty-state"><strong>No verified listings</strong><p>Marketplace resources appear after provider verification and health checks pass.</p></div></div>}
  </div>;
}
