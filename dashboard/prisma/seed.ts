import "dotenv/config";

import { db } from "../src/lib/db";

function resourceServerBaseUrl() {
  const raw = process.env.RESOURCE_SERVER_URL ?? "http://localhost:3200";
  const url = new URL(raw);
  if (process.env.APP_ENV === "production" && url.protocol !== "https:") throw new Error("RESOURCE_SERVER_URL must use HTTPS when seeding production");
  return url.toString().replace(/\/$/, "");
}

function hederaProviderAccountId() {
  const accountId = process.env.HEDERA_PROVIDER_ACCOUNT_ID ?? "0.0.9651458";
  if (!/^0\.0\.\d+$/.test(accountId)) throw new Error("HEDERA_PROVIDER_ACCOUNT_ID must be a Hedera account ID");
  return accountId;
}

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
    const configuredTokenId = suffix === "testnet" ? process.env.HEDERA_USDC_TOKEN_ID : process.env.HEDERA_MAINNET_USDC_TOKEN_ID;
    const usdcTokenId = configuredTokenId || (suffix === "testnet" ? "0.0.429274" : "0.0.1456980");
    if (!/^0\.0\.\d+$/.test(usdcTokenId)) throw new Error(`Invalid Hedera ${suffix} USDC token ID`);
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
  for (const network of ["cardano:preprod", "cardano:mainnet"] as const) {
    await db.asset.upsert({
      where: { network_symbol: { network, symbol: "ADA" } },
      update: { name: "Cardano", decimals: 6, verified: true, type: "NATIVE", hederaTokenId: null },
      create: { network, type: "NATIVE", symbol: "ADA", name: "Cardano", decimals: 6, verified: true },
    });
  }

  const testnetHbar = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: "HBAR" } } });
  const testnetUsdc = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:testnet", symbol: "USDC" } } });
  const mainnetHbar = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:mainnet", symbol: "HBAR" } } });
  const mainnetUsdc = await db.asset.findUnique({ where: { network_symbol: { network: "hedera:mainnet", symbol: "USDC" } } });
  const arcUsdc = await db.asset.findUnique({ where: { network_symbol: { network: "eip155:5042002", symbol: "USDC" } } });
  const cardanoPreprodAda = await db.asset.findUnique({ where: { network_symbol: { network: "cardano:preprod", symbol: "ADA" } } });
  const cardanoMainnetAda = await db.asset.findUnique({ where: { network_symbol: { network: "cardano:mainnet", symbol: "ADA" } } });
  if (!testnetHbar || !mainnetHbar || !cardanoPreprodAda || !cardanoMainnetAda) throw new Error("Required native payment assets are missing");

  const hederaNetworkAssetSets: Array<{ hbar: { id: string }; usdc: { id: string } | null }> = [
    { hbar: testnetHbar, usdc: testnetUsdc },
    { hbar: mainnetHbar, usdc: mainnetUsdc },
  ];
  const cardanoAssets = [cardanoPreprodAda, cardanoMainnetAda];

  const providerAccountId = hederaProviderAccountId();
  const provider = await db.resourceProvider.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {
      name: "AgentPay Integration Fixtures",
      description: "Platform-owned synthetic resources for validating AgentPay x402 payment flows. Payloads are not live market data, production inference, or live research.",
      settlementAccountId: providerAccountId,
      settlementAccountVerified: true,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
    },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "AgentPay Integration Fixtures",
      description: "Platform-owned synthetic resources for validating AgentPay x402 payment flows. Payloads are not live market data, production inference, or live research.",
      settlementAccountId: providerAccountId,
      settlementAccountVerified: true,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
    },
  });

  const baseUrl = resourceServerBaseUrl();
  const resources = [
    { slug: "eth-price", category: "MARKET_DATA" as const, name: "ETH/USD Demo Snapshot", description: "Synthetic ETH/USD fixture for validating paid-resource flows; not live market data.", endpoint: `${baseUrl}/v1/market-data/ETH` },
    { slug: "btc-price", category: "MARKET_DATA" as const, name: "BTC/USD Demo Snapshot", description: "Synthetic BTC/USD fixture for validating paid-resource flows; not live market data.", endpoint: `${baseUrl}/v1/market-data/BTC` },
    { slug: "report-q2", category: "FILE" as const, name: "Demo Market Report", description: "Synthetic document fixture for validating paid file access; not a confidential or live report.", endpoint: `${baseUrl}/v1/files/report-q2` },
    { slug: "llama-inference", category: "AI_INFERENCE" as const, name: "Simulated LLaMA Inference", description: "Simulated inference fixture for validating metered x402 flows; no model is called.", endpoint: `${baseUrl}/v1/inference/llama-3.2` },
    { slug: "web-research", category: "WEB_RESEARCH" as const, name: "Simulated Web Research", description: "Synthetic research fixture for validating x402 flows; no live web retrieval occurs.", endpoint: `${baseUrl}/v1/research` },
  ];

  for (const resource of resources) {
    const listing = await db.resourceListing.upsert({
      where: { slug: resource.slug },
      update: { name: resource.name, description: resource.description, endpoint: resource.endpoint, status: "ACTIVE", public: true, providerId: provider.id },
      create: { providerId: provider.id, slug: resource.slug, category: resource.category, name: resource.name, description: resource.description, endpoint: resource.endpoint, inputSchema: {}, outputContentTypes: ["application/json"], status: "ACTIVE", public: true },
    });
    for (const assets of hederaNetworkAssetSets) {
      await db.resourcePrice.upsert({
        where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: assets.hbar.id } },
        update: { atomicAmount: 5_000_000 },
        create: { resourceListingId: listing.id, assetId: assets.hbar.id, atomicAmount: 5_000_000 },
      });
      if (assets.usdc && ["eth-price", "btc-price", "llama-inference"].includes(resource.slug)) {
        await db.resourcePrice.upsert({
          where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: assets.usdc.id } },
          update: { atomicAmount: 1_000_000 },
          create: { resourceListingId: listing.id, assetId: assets.usdc.id, atomicAmount: 1_000_000 },
        });
      }
    }
    if (arcUsdc && ["eth-price", "btc-price", "llama-inference"].includes(resource.slug)) {
      await db.resourcePrice.upsert({
        where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: arcUsdc.id } },
        update: { atomicAmount: 1_000_000 },
        create: { resourceListingId: listing.id, assetId: arcUsdc.id, atomicAmount: 1_000_000 },
      });
    }
    if (["eth-price", "btc-price", "llama-inference"].includes(resource.slug)) {
      for (const ada of cardanoAssets) {
        await db.resourcePrice.upsert({
          where: { resourceListingId_assetId: { resourceListingId: listing.id, assetId: ada.id } },
          update: { atomicAmount: 1_000_000 },
          create: { resourceListingId: listing.id, assetId: ada.id, atomicAmount: 1_000_000 },
        });
      }
    }
  }
}

main().finally(() => db.$disconnect());
