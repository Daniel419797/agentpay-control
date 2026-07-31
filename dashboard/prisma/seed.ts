import "dotenv/config";

import { db } from "../src/lib/db";

async function main() {
  const networks = [
    { id: "hedera:testnet", family: "HEDERA" as const, chainReference: "testnet", displayName: "Hedera Testnet", nativeSymbol: "HBAR", explorerTxUrlTemplate: "https://hashscan.io/testnet/transaction/{txHash}", finalitySeconds: 5, requiredConfirmations: 1, testnet: true, enabled: true, supportsContracts: true },
    { id: "hedera:mainnet", family: "HEDERA" as const, chainReference: "mainnet", displayName: "Hedera Mainnet", nativeSymbol: "HBAR", explorerTxUrlTemplate: "https://hashscan.io/mainnet/transaction/{txHash}", finalitySeconds: 5, requiredConfirmations: 1, testnet: false, enabled: true, supportsContracts: true },
    { id: "eip155:11155111", family: "EVM" as const, chainReference: "11155111", displayName: "Ethereum Sepolia", nativeSymbol: "ETH", explorerTxUrlTemplate: "https://sepolia.etherscan.io/tx/{txHash}", finalitySeconds: 180, requiredConfirmations: 3, testnet: true, enabled: true, supportsContracts: true },
    { id: "eip155:84532", family: "EVM" as const, chainReference: "84532", displayName: "Base Sepolia", nativeSymbol: "ETH", explorerTxUrlTemplate: "https://sepolia.basescan.org/tx/{txHash}", finalitySeconds: 20, requiredConfirmations: 2, testnet: true, enabled: true, supportsContracts: true },
    { id: "eip155:1", family: "EVM" as const, chainReference: "1", displayName: "Ethereum", nativeSymbol: "ETH", explorerTxUrlTemplate: "https://etherscan.io/tx/{txHash}", finalitySeconds: 900, requiredConfirmations: 12, testnet: false, enabled: false, supportsContracts: true },
    { id: "eip155:42161", family: "EVM" as const, chainReference: "42161", displayName: "Arbitrum One", nativeSymbol: "ETH", explorerTxUrlTemplate: "https://arbiscan.io/tx/{txHash}", finalitySeconds: 60, requiredConfirmations: 20, testnet: false, enabled: false, supportsContracts: true },
    { id: "eip155:8453", family: "EVM" as const, chainReference: "8453", displayName: "Base", nativeSymbol: "ETH", explorerTxUrlTemplate: "https://basescan.org/tx/{txHash}", finalitySeconds: 60, requiredConfirmations: 20, testnet: false, enabled: false, supportsContracts: true },
    { id: "eip155:5042002", family: "EVM" as const, chainReference: "5042002", displayName: "Arc Testnet", nativeSymbol: "USDC", explorerTxUrlTemplate: "https://testnet.arcscan.app/tx/{txHash}", finalitySeconds: 1, requiredConfirmations: 1, testnet: true, enabled: true, supportsContracts: true },
  ];
  for (const network of networks) await db.chainNetwork.upsert({ where: { id: network.id }, update: network, create: network });

  for (const suffix of ["testnet", "mainnet"] as const) {
    const usdcTokenId = suffix === "testnet" ? "0.0.429274" : "0.0.1456980";
    await db.asset.upsert({
      where: { network_symbol: { network: `hedera:${suffix}`, symbol: "HBAR" } },
      update: { name: "Hedera", decimals: 8, verified: true, type: "NATIVE" },
      create: { network: `hedera:${suffix}`, type: "NATIVE", symbol: "HBAR", name: "Hedera", decimals: 8, verified: true },
    });
    await db.asset.upsert({
      where: { network_symbol: { network: `hedera:${suffix}`, symbol: "USDC" } },
      update: { name: "USD Coin", decimals: 6, hederaTokenId: usdcTokenId, verified: true, type: "TOKEN" },
      create: { network: `hedera:${suffix}`, type: "TOKEN", symbol: "USDC", name: "USD Coin", decimals: 6, hederaTokenId: usdcTokenId, verified: true },
    });
  }
  await db.asset.upsert({
    where: { network_symbol: { network: "eip155:5042002", symbol: "USDC" } },
    update: { name: "USD Coin", decimals: 6, verified: true, type: "TOKEN" },
    create: { network: "eip155:5042002", type: "TOKEN", symbol: "USDC", name: "USD Coin", decimals: 6, verified: true },
  });

  const testnetHbar = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: "HBAR" } } });
  const testnetUsdc = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: "USDC" } } });
  const mainnetHbar = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:mainnet", symbol: "HBAR" } } });
  const mainnetUsdc = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:mainnet", symbol: "USDC" } } });
  const arcUsdc = await db.asset.findUnique({ where: { network_symbol: { network: "eip155:5042002", symbol: "USDC" } } });
  if (!testnetHbar || !mainnetHbar) throw new Error("HBAR asset not found for one or both Hedera networks");

  const hederaNetworkAssetSets: Array<{ hbar: { id: string }; usdc: { id: string } | null; network: string }> = [
    { hbar: testnetHbar!, usdc: testnetUsdc, network: "hedera:testnet" },
    { hbar: mainnetHbar!, usdc: mainnetUsdc, network: "hedera:mainnet" },
  ];

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
    for (const assets of hederaNetworkAssetSets) {
      await db.resourcePrice.upsert({
        where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: assets.hbar.id } },
        update: { atomicAmount: 5000000 },
        create: { resourceListingId: listing.id, assetId: assets.hbar.id, atomicAmount: 5000000 },
      });
      if (assets.usdc && (r.slug === "eth-price" || r.slug === "btc-price" || r.slug === "llama-inference")) {
        await db.resourcePrice.upsert({
          where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: assets.usdc.id } },
          update: { atomicAmount: 1000000 },
          create: { resourceListingId: listing.id, assetId: assets.usdc.id, atomicAmount: 1000000 },
        });
      }
    }
    if (arcUsdc) {
      await db.resourcePrice.upsert({
        where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: arcUsdc.id } },
        update: { atomicAmount: 1000000 },
        create: { resourceListingId: listing.id, assetId: arcUsdc.id, atomicAmount: 1000000 },
      });
    }
  }
}

main().finally(() => db.$disconnect());
