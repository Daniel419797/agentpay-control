import "dotenv/config";

import { db } from "../src/lib/db";

async function main() {
  await db.asset.upsert({
    where: { network_symbol: { network: "hedera:testnet", symbol: "HBAR" } },
    update: { name: "Hedera", decimals: 8, verified: true, type: "NATIVE" },
    create: { network: "hedera:testnet", type: "NATIVE", symbol: "HBAR", name: "Hedera", decimals: 8, verified: true },
  });
  await db.asset.upsert({
    where: { network_symbol: { network: "hedera:testnet", symbol: "USDC" } },
    update: { name: "USD Coin", decimals: 6, hederaTokenId: "0.0.429274", verified: true, type: "TOKEN" },
    create: { network: "hedera:testnet", type: "TOKEN", symbol: "USDC", name: "USD Coin", decimals: 6, hederaTokenId: "0.0.429274", verified: true },
  });

  const hbar = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: "HBAR" } } });
  const usdc = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: "USDC" } } });
  if (!hbar) throw new Error("HBAR asset not found");

  const provider = await db.resourceProvider.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: { name: "AgentPay Demo Provider", settlementAccountId: "0.0.9651458" },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "AgentPay Demo Provider",
      settlementAccountId: "0.0.9651458",
      settlementAccountVerified: true,
      status: "ACTIVE",
    },
  });

  const resources = [
    { slug: "eth-price", category: "MARKET_DATA" as const, name: "ETH/USD Price", description: "Latest Ethereum price with 24h change, high, and low", endpoint: "http://localhost:3200/v1/market-data/ETH" },
    { slug: "btc-price", category: "MARKET_DATA" as const, name: "BTC/USD Price", description: "Latest Bitcoin price with 24h change, high, and low", endpoint: "http://localhost:3200/v1/market-data/BTC" },
    { slug: "report-q2", category: "FILE" as const, name: "Q2 Market Report", description: "Confidential Q2 market analysis report", endpoint: "http://localhost:3200/v1/files/report-q2" },
    { slug: "llama-inference", category: "AI_INFERENCE" as const, name: "LLaMA 3.2 Inference", description: "Run inference on LLaMA 3.2 with custom prompt", endpoint: "http://localhost:3200/v1/inference/llama-3.2" },
    { slug: "web-research", category: "WEB_RESEARCH" as const, name: "Web Research Query", description: "Bounded web research with source metadata", endpoint: "http://localhost:3200/v1/research" },
  ];

  for (const r of resources) {
    const listing = await db.resourceListing.upsert({
      where: { slug: r.slug },
      update: { name: r.name, description: r.description, endpoint: r.endpoint, status: "ACTIVE", providerId: provider.id },
      create: {
        providerId: provider.id,
        slug: r.slug,
        category: r.category,
        name: r.name,
        description: r.description,
        endpoint: r.endpoint,
        inputSchema: {},
        outputContentTypes: ["application/json"],
        status: "ACTIVE",
      },
    });
    await db.resourcePrice.upsert({
      where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: hbar.id } },
      update: { atomicAmount: 5000000 },
      create: { resourceListingId: listing.id, assetId: hbar.id, atomicAmount: 5000000 },
    });
    if (usdc && (r.slug === "eth-price" || r.slug === "btc-price" || r.slug === "llama-inference")) {
      await db.resourcePrice.upsert({
        where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: usdc.id } },
        update: { atomicAmount: 1000000 },
        create: { resourceListingId: listing.id, assetId: usdc.id, atomicAmount: 1000000 },
      });
    }
  }
}

main().finally(() => db.$disconnect());
