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
}

main().finally(() => db.$disconnect());
