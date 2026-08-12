import { db } from "@/lib/db";
import { fetchMasumiAgent, masumiMetadataHash, type MasumiNetwork } from "@/lib/masumi";
import { findMasumiPurchase } from "@/lib/masumi-payment";

type BindingProbe = {
  network: MasumiNetwork;
  agentIdentifier: string;
  settlementAddress: string;
  metadataHash: string;
};

type PurchaseProbe = {
  network: MasumiNetwork;
  masumiPurchaseId: string;
  blockchainIdentifier: string;
};

export async function verifyLiveMasumiDependencies() {
  const [bindings, purchases] = await Promise.all([
    db.$queryRaw<BindingProbe[]>`
      SELECT "network","agentIdentifier","settlementAddress","metadataHash"
      FROM "MasumiResourceBinding"
      WHERE "settlementAddress" IS NOT NULL AND "sellerPaymentKeyHash" IS NOT NULL
      ORDER BY "verifiedAt" DESC
      LIMIT 1`,
    db.$queryRaw<PurchaseProbe[]>`
      SELECT "network","masumiPurchaseId","blockchainIdentifier"
      FROM "MasumiEscrowPurchase"
      WHERE "masumiPurchaseId" IS NOT NULL AND "blockchainIdentifier" <> 'pending' AND "state" <> 'PREPARED'
      ORDER BY "updatedAt" DESC
      LIMIT 1`,
  ]);
  const binding = bindings[0];
  if (!binding) throw new Error("MASUMI_LIVE_REGISTRY_BINDING_REQUIRED");
  const purchaseProbe = purchases[0];
  if (!purchaseProbe) throw new Error("MASUMI_LIVE_PAYMENT_EVIDENCE_REQUIRED");

  const [registry, purchase] = await Promise.all([
    fetchMasumiAgent(binding.agentIdentifier, binding.network),
    findMasumiPurchase(purchaseProbe.network, purchaseProbe.blockchainIdentifier),
  ]);
  if (registry.sellerWallet.address !== binding.settlementAddress) throw new Error("MASUMI_LIVE_REGISTRY_SELLER_MISMATCH");
  if (masumiMetadataHash(registry) !== binding.metadataHash) throw new Error("MASUMI_LIVE_REGISTRY_METADATA_CHANGED");
  if (!purchase || purchase.id !== purchaseProbe.masumiPurchaseId || purchase.blockchainIdentifier !== purchaseProbe.blockchainIdentifier) throw new Error("MASUMI_LIVE_PAYMENT_LOOKUP_MISMATCH");

  return {
    registry: { network: binding.network, status: registry.status },
    payment: { network: purchaseProbe.network, state: purchase.NextAction.requestedAction },
  };
}
