import { z } from "zod";
import { getConfig } from "@/lib/config";

export type CardanoNetwork = "cardano:preprod" | "cardano:mainnet";

const amountSchema = z.object({ unit: z.string().min(1), quantity: z.string().regex(/^\d+$/) });
const addressSchema = z.object({ address: z.string().min(1), amount: z.array(amountSchema) });
const transactionSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  block_height: z.number().int().nonnegative(),
  valid_contract: z.boolean().optional(),
});
const txIoSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  inputs: z.array(z.object({ address: z.string().min(1), amount: z.array(amountSchema) })),
  outputs: z.array(z.object({ address: z.string().min(1), amount: z.array(amountSchema) })),
});
const blockSchema = z.object({ height: z.number().int().nonnegative() });

function cardanoProvider(network: CardanoNetwork) {
  const config = getConfig();
  if (network === "cardano:preprod") {
    if (!config.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID) throw new Error("CARDANO_PREPROD_PROVIDER_UNAVAILABLE");
    return { baseUrl: config.CARDANO_PREPROD_BLOCKFROST_URL.replace(/\/$/, ""), projectId: config.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID };
  }
  if (!config.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID) throw new Error("CARDANO_MAINNET_PROVIDER_UNAVAILABLE");
  return { baseUrl: config.CARDANO_MAINNET_BLOCKFROST_URL.replace(/\/$/, ""), projectId: config.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID };
}

async function request(network: CardanoNetwork, path: string, allowNotFound = false) {
  const provider = cardanoProvider(network);
  const response = await fetch(`${provider.baseUrl}${path}`, {
    redirect: "error",
    cache: "no-store",
    headers: { project_id: provider.projectId, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`CARDANO_PROVIDER_${response.status}`);
  return response.json();
}

export async function cardanoAddressLovelaceBalance(network: CardanoNetwork, address: string) {
  const payload = addressSchema.parse(await request(network, `/addresses/${encodeURIComponent(address)}`));
  if (payload.address !== address) throw new Error("CARDANO_ADDRESS_EVIDENCE_MISMATCH");
  return payload.amount.find((entry) => entry.unit === "lovelace")?.quantity ?? "0";
}

export type CardanoTransactionEvidence = {
  transactionHash: string;
  confirmations: number;
  validContract: boolean;
  inputs: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>;
  outputs: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>;
};

export async function cardanoTransactionEvidence(network: CardanoNetwork, transactionHash: string): Promise<CardanoTransactionEvidence | null> {
  if (!/^[0-9a-f]{64}$/.test(transactionHash)) throw new Error("CARDANO_TRANSACTION_HASH_INVALID");
  const txValue = await request(network, `/txs/${transactionHash}`, true);
  if (txValue === null) return null;
  const [ioValue, latestValue] = await Promise.all([
    request(network, `/txs/${transactionHash}/utxos`),
    request(network, "/blocks/latest"),
  ]);
  const tx = transactionSchema.parse(txValue);
  const io = txIoSchema.parse(ioValue);
  const latest = blockSchema.parse(latestValue);
  if (tx.hash !== transactionHash || io.hash !== transactionHash) throw new Error("CARDANO_TRANSACTION_HASH_MISMATCH");
  if (latest.height < tx.block_height) throw new Error("CARDANO_BLOCK_HEIGHT_INVALID");
  return {
    transactionHash,
    confirmations: latest.height - tx.block_height + 1,
    validContract: tx.valid_contract !== false,
    inputs: io.inputs,
    outputs: io.outputs,
  };
}

function isAdaOnly(amounts: Array<{ unit: string; quantity: string }>) {
  return amounts.length > 0 && amounts.every((amount) => amount.unit === "lovelace");
}

export function cardanoExactPaymentMatches(
  evidence: CardanoTransactionEvidence,
  payerAddress: string,
  payeeAddress: string,
  asset: string,
  amountAtomic: string,
) {
  if (!evidence.validContract || asset !== "lovelace") return false;
  if (evidence.inputs.length === 0 || evidence.inputs.some((input) => input.address !== payerAddress || !isAdaOnly(input.amount))) return false;
  let paid = 0n;
  for (const output of evidence.outputs) {
    if (!isAdaOnly(output.amount)) return false;
    if (output.address !== payeeAddress && output.address !== payerAddress) return false;
    if (output.address !== payeeAddress) continue;
    for (const amount of output.amount) paid += BigInt(amount.quantity);
  }
  return paid === BigInt(amountAtomic);
}
