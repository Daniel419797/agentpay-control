import { createHash } from "node:crypto";
import { z } from "zod";

import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

const transactionRequestSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/),
  value: z.string(),
  chainId: z.number().int().positive(),
  gasLimit: z.string().optional(),
  gasPrice: z.string().optional(),
});
const quoteSchema = z.object({
  id: z.string().min(1),
  tool: z.string().optional(),
  estimate: z.object({ toAmount: z.string().regex(/^\d+$/), toAmountMin: z.string().regex(/^\d+$/), feeCosts: z.array(z.unknown()).optional(), gasCosts: z.array(z.unknown()).optional() }),
  transactionRequest: transactionRequestSchema,
});
const statusSchema = z.object({
  status: z.enum(["NOT_FOUND", "PENDING", "DONE", "FAILED", "INVALID"]),
  substatus: z.string().optional(),
  receiving: z.object({ txHash: z.string().optional() }).optional(),
});
const rpcUrlsSchema = z.record(z.string(), z.string().url());
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const rpcReceiptSchema = z.object({ transactionHash: hex, status: hex, blockNumber: hex, to: z.string().nullable(), logs: z.array(z.object({ address: z.string(), topics: z.array(z.string()), data: z.string() })) });
const rpcTransactionSchema = z.object({ hash: hex, from: z.string(), to: z.string().nullable(), value: hex, input: z.string().regex(/^0x[0-9a-fA-F]*$/) });
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const MIN_EXPORT_LIFETIME_MS = 15_000;
type DestinationReceipt = z.infer<typeof rpcReceiptSchema>;
type DestinationTransaction = z.infer<typeof rpcTransactionSchema>;

export type CrossChainQuoteInput = { agentId: string; sourceNetworkId: string; destinationNetworkId: string; sourceToken: string; destinationToken: string; sourceAddress: string; destinationAddress: string; inputAmountAtomic: string; slippage: number; order: "FASTEST" | "CHEAPEST" };

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function providerHeaders() { const key = getConfig().LIFI_API_KEY; return { accept: "application/json", ...(key ? { "x-lifi-api-key": key } : {}) }; }

export function destinationTransferMatches(destinationToken: string, destinationAddress: string, minimumOutputAtomic: string, receipt: DestinationReceipt, transaction: Pick<DestinationTransaction, "to" | "value">) {
  const destination = destinationAddress.toLowerCase(); const minimum = BigInt(minimumOutputAtomic); const token = destinationToken.toLowerCase();
  if (token === NATIVE_TOKEN) return transaction.to?.toLowerCase() === destination && BigInt(transaction.value) >= minimum;
  return receipt.logs.some((log) => {
    if (!/^0x[0-9a-fA-F]+$/.test(log.data) || log.topics.length < 3) return false;
    return log.address.toLowerCase() === token && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC && `0x${log.topics[2]!.slice(-40).toLowerCase()}` === destination && BigInt(log.data) >= minimum;
  });
}

export function sourceTransactionMatches(sourceAddress: string, expected: z.infer<typeof transactionRequestSchema>, transaction: DestinationTransaction) {
  return transaction.from.toLowerCase() === sourceAddress.toLowerCase()
    && transaction.to?.toLowerCase() === expected.to.toLowerCase()
    && transaction.input.toLowerCase() === expected.data.toLowerCase()
    && BigInt(transaction.value) === BigInt(expected.value);
}

async function rpc<T>(url: string, method: string, params: unknown[], schema: z.ZodType<T>, scope: "SOURCE" | "DESTINATION") {
  const response = await fetch(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${scope}_RPC_${response.status}`);
  const envelope = z.object({ result: z.unknown().nullable(), error: z.unknown().optional() }).parse(await response.json());
  if (envelope.error || envelope.result === null) throw new Error(`${scope}_RECEIPT_UNAVAILABLE`);
  return schema.parse(envelope.result);
}

export async function verifyDestinationReceipt(quote: { destinationNetworkId: string; destinationToken: string; destinationAddress: string; minimumOutputAtomic: { toString(): string } }, transactionHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error("DESTINATION_TRANSACTION_HASH_INVALID");
  const urls = rpcUrlsSchema.parse(JSON.parse(getConfig().EVM_RPC_URLS_JSON)); const url = urls[quote.destinationNetworkId];
  if (!url) throw new Error("DESTINATION_RPC_NOT_CONFIGURED");
  const [receipt, transaction, blockHex] = await Promise.all([
    rpc(url, "eth_getTransactionReceipt", [transactionHash], rpcReceiptSchema, "DESTINATION"),
    rpc(url, "eth_getTransactionByHash", [transactionHash], rpcTransactionSchema, "DESTINATION"),
    rpc(url, "eth_blockNumber", [], hex, "DESTINATION"),
  ]);
  if (receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase() || BigInt(receipt.status) !== 1n) throw new Error("DESTINATION_TRANSACTION_FAILED");
  const network = await db.chainNetwork.findUniqueOrThrow({ where: { id: quote.destinationNetworkId } });
  const confirmations = BigInt(blockHex) - BigInt(receipt.blockNumber) + 1n;
  if (confirmations < BigInt(network.requiredConfirmations)) throw new Error("DESTINATION_CONFIRMATIONS_PENDING");
  if (!destinationTransferMatches(quote.destinationToken, quote.destinationAddress, quote.minimumOutputAtomic.toString(), receipt, transaction)) throw new Error("DESTINATION_TRANSFER_MISMATCH");
  return { transactionHash, confirmations: Number(confirmations), blockNumber: receipt.blockNumber };
}

export async function verifySourceTransaction(quote: { sourceNetworkId: string; sourceAddress: string; transactionRequestEncrypted: string }, transactionHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error("SOURCE_TRANSACTION_HASH_INVALID");
  const urls = rpcUrlsSchema.parse(JSON.parse(getConfig().EVM_RPC_URLS_JSON));
  const url = urls[quote.sourceNetworkId];
  if (!url) throw new Error("SOURCE_RPC_NOT_CONFIGURED");
  const [receipt, transaction, blockHex] = await Promise.all([
    rpc(url, "eth_getTransactionReceipt", [transactionHash], rpcReceiptSchema, "SOURCE"),
    rpc(url, "eth_getTransactionByHash", [transactionHash], rpcTransactionSchema, "SOURCE"),
    rpc(url, "eth_blockNumber", [], hex, "SOURCE"),
  ]);
  if (receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase() || transaction.hash.toLowerCase() !== transactionHash.toLowerCase() || BigInt(receipt.status) !== 1n) throw new Error("SOURCE_TRANSACTION_FAILED");
  const network = await db.chainNetwork.findUniqueOrThrow({ where: { id: quote.sourceNetworkId } });
  const confirmations = BigInt(blockHex) - BigInt(receipt.blockNumber) + 1n;
  if (confirmations < BigInt(network.requiredConfirmations)) throw new Error("SOURCE_CONFIRMATIONS_PENDING");
  const expected = transactionRequestSchema.parse(JSON.parse(decryptSecret(quote.transactionRequestEncrypted)));
  if (!sourceTransactionMatches(quote.sourceAddress, expected, transaction)) throw new Error("SOURCE_TRANSACTION_MISMATCH");
  return { transactionHash, confirmations: Number(confirmations), blockNumber: receipt.blockNumber };
}

export async function createCrossChainQuote(organizationId: string, input: CrossChainQuoteInput) {
  const [organization, agent, source, destination] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { status: true, killSwitchEnabled: true } }),
    db.agent.findFirst({ where: { id: input.agentId, organizationId, status: "ACTIVE" }, include: { accounts: { where: { status: "ACTIVE" } } } }),
    db.chainNetwork.findFirst({ where: { id: input.sourceNetworkId, enabled: true } }),
    db.chainNetwork.findFirst({ where: { id: input.destinationNetworkId, enabled: true } }),
  ]);
  if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
  if (organization.killSwitchEnabled) throw new Error("ORGANIZATION_KILL_SWITCH_ENABLED");
  if (!agent) throw new Error("AGENT_NOT_FOUND");
  if (!source || !destination || source.id === destination.id) throw new Error("CROSS_CHAIN_NETWORK_UNAVAILABLE");
  if (source.family !== "EVM" || destination.family !== "EVM") throw new Error("ROUTE_PROVIDER_NETWORK_UNSUPPORTED");
  if (agent.network !== source.id || !agent.accounts.some((account) => account.network === source.id && (account.evmAddress?.toLowerCase() === input.sourceAddress.toLowerCase() || account.accountId.toLowerCase() === input.sourceAddress.toLowerCase()))) throw new Error("SOURCE_ADDRESS_NOT_OWNED_BY_AGENT");
  const params = new URLSearchParams({ fromChain: source.chainReference, toChain: destination.chainReference, fromToken: input.sourceToken, toToken: input.destinationToken, fromAmount: input.inputAmountAtomic, fromAddress: input.sourceAddress, toAddress: input.destinationAddress, slippage: String(input.slippage), order: input.order });
  const response = await fetch(`${getConfig().LIFI_API_BASE_URL}/quote?${params}`, { headers: providerHeaders(), redirect: "error", signal: AbortSignal.timeout(15_000) });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ROUTE_PROVIDER_ERROR:${response.status}`);
  const quote = quoteSchema.parse(payload);
  if (quote.transactionRequest.chainId !== Number(source.chainReference)) throw new Error("ROUTE_CHAIN_MISMATCH");
  const requestHash = hash(input);
  return db.crossChainRouteQuote.create({ data: { organizationId, agentId: agent.id, sourceNetworkId: source.id, destinationNetworkId: destination.id, sourceToken: input.sourceToken, destinationToken: input.destinationToken, sourceAddress: input.sourceAddress, destinationAddress: input.destinationAddress, inputAmountAtomic: input.inputAmountAtomic, estimatedOutputAtomic: quote.estimate.toAmount, minimumOutputAtomic: quote.estimate.toAmountMin, provider: "LIFI", externalQuoteId: quote.id, tool: quote.tool, feeSummary: JSON.parse(JSON.stringify({ feeCosts: quote.estimate.feeCosts ?? [], gasCosts: quote.estimate.gasCosts ?? [] })), transactionRequestEncrypted: encryptSecret(JSON.stringify(quote.transactionRequest)), requestHash, expiresAt: new Date(Date.now() + 60_000) } });
}

export async function prepareCrossChainTransfer(quoteId: string, organizationId: string, idempotencyKey: string, initiatedByUserId: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${quoteId}, 0))`;
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true, killSwitchEnabled: true } });
    if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
    if (organization.killSwitchEnabled) throw new Error("ORGANIZATION_KILL_SWITCH_ENABLED");
    const quote = await tx.crossChainRouteQuote.findFirst({ where: { id: quoteId, organizationId } });
    if (!quote || quote.status !== "ACTIVE" || quote.expiresAt <= new Date()) throw new Error("CROSS_CHAIN_QUOTE_EXPIRED");
    if (quote.expiresAt.getTime() - Date.now() < MIN_EXPORT_LIFETIME_MS) throw new Error("CROSS_CHAIN_QUOTE_TOO_CLOSE_TO_EXPIRY");
    const existing = await tx.crossChainTransfer.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } } });
    if (existing && existing.quoteId !== quote.id) throw new Error("IDEMPOTENCY_CONFLICT");
    const transfer = existing ?? await tx.crossChainTransfer.create({ data: { organizationId, agentId: quote.agentId, quoteId: quote.id, idempotencyKey, status: "AWAITING_SIGNATURE" } });
    const transactionRequest = transactionRequestSchema.parse(JSON.parse(decryptSecret(quote.transactionRequestEncrypted)));
    if (!existing) {
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorType: "USER",
          actorId: initiatedByUserId,
          action: "CROSS_CHAIN_TRANSACTION_EXPORTED",
          targetType: "CROSS_CHAIN_TRANSFER",
          targetId: transfer.id,
          result: "SUCCESS",
          metadata: { quoteId: quote.id, sourceNetworkId: quote.sourceNetworkId, destinationNetworkId: quote.destinationNetworkId, expiresAt: quote.expiresAt.toISOString(), externalWalletControl: true },
        },
      });
    }
    return {
      transfer,
      transactionRequest,
      expiresAt: quote.expiresAt,
      externalWalletControl: true as const,
      emergencyStopBoundary: "AgentPay can block new transaction exports, but cannot revoke a transaction payload already exported to an external self-custody wallet.",
    };
  }, { isolationLevel: "Serializable" });
}

export async function recordCrossChainSubmission(transferId: string, organizationId: string, sourceTransactionHash: string) {
  return db.$transaction(async (tx) => {
    const transfer = await tx.crossChainTransfer.findFirst({ where: { id: transferId, organizationId }, include: { quote: true } });
    if (!transfer) throw new Error("CROSS_CHAIN_TRANSFER_NOT_FOUND");
    if (transfer.sourceTransactionHash && transfer.sourceTransactionHash.toLowerCase() !== sourceTransactionHash.toLowerCase()) throw new Error("SOURCE_TRANSACTION_CONFLICT");
    if (!["AWAITING_SIGNATURE", "SUBMITTED", "BRIDGING"].includes(transfer.status)) throw new Error("CROSS_CHAIN_TRANSFER_NOT_SUBMITTABLE");
    await tx.crossChainRouteQuote.update({ where: { id: transfer.quoteId }, data: { status: "CONSUMED" } });
    const updated = await tx.crossChainTransfer.update({ where: { id: transfer.id }, data: { status: "SUBMITTED", sourceTransactionHash, submittedAt: transfer.submittedAt ?? new Date() } });
    await tx.outboxEvent.create({ data: { organizationId, eventType: "CROSS_CHAIN_TRANSFER_SUBMITTED", aggregateType: "CROSS_CHAIN_TRANSFER", aggregateId: transfer.id, payload: { sourceTransactionHash, sourceNetworkId: transfer.quote.sourceNetworkId, destinationNetworkId: transfer.quote.destinationNetworkId } } });
    return updated;
  });
}

export async function reconcileCrossChainTransfers(limit = 50) {
  const transfers = await db.crossChainTransfer.findMany({ where: { status: { in: ["SUBMITTED", "BRIDGING"] }, sourceTransactionHash: { not: null } }, include: { quote: true }, take: limit, orderBy: { updatedAt: "asc" } });
  let updated = 0;
  for (const transfer of transfers) {
    if (!transfer.sourceVerifiedAt) {
      try {
        const source = await verifySourceTransaction(transfer.quote, transfer.sourceTransactionHash!);
        await db.crossChainTransfer.update({ where: { id: transfer.id }, data: { status: "BRIDGING", sourceVerifiedAt: new Date(), sourceBlockNumber: source.blockNumber, errorCode: null } });
      } catch (error) {
        const code = error instanceof Error ? error.message : "SOURCE_VERIFICATION_FAILED";
        if (code === "SOURCE_RECEIPT_UNAVAILABLE" || code === "SOURCE_CONFIRMATIONS_PENDING" || code.startsWith("SOURCE_RPC_")) continue;
        await db.crossChainTransfer.update({ where: { id: transfer.id }, data: { status: "FAILED", errorCode: code, completedAt: new Date() } });
        updated += 1;
        continue;
      }
    }
    const params = new URLSearchParams({ txHash: transfer.sourceTransactionHash!, fromChain: transfer.quote.sourceNetworkId.replace("eip155:", ""), toChain: transfer.quote.destinationNetworkId.replace("eip155:", "") });
    if (transfer.quote.tool) params.set("bridge", transfer.quote.tool);
    const response = await fetch(`${getConfig().LIFI_API_BASE_URL}/status?${params}`, { headers: providerHeaders(), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) continue;
    const status = statusSchema.safeParse(await response.json());
    if (!status.success || status.data.status === "NOT_FOUND") continue;
    let mapped: "BRIDGING" | "DESTINATION_CONFIRMED" | "FAILED" | "REFUNDED" = status.data.status === "FAILED" || status.data.status === "INVALID" ? status.data.substatus === "REFUNDED" ? "REFUNDED" : "FAILED" : "BRIDGING";
    const destinationHash = status.data.receiving?.txHash;
    if (status.data.status === "DONE" && destinationHash) {
      try { await verifyDestinationReceipt(transfer.quote, destinationHash); mapped = "DESTINATION_CONFIRMED"; }
      catch (error) {
        const code = error instanceof Error ? error.message : "DESTINATION_VERIFICATION_FAILED";
        if (code === "DESTINATION_RECEIPT_UNAVAILABLE" || code === "DESTINATION_CONFIRMATIONS_PENDING" || code.startsWith("DESTINATION_RPC_")) continue;
        mapped = "FAILED";
      }
    }
    await db.crossChainTransfer.update({ where: { id: transfer.id }, data: { status: mapped, destinationTransactionHash: destinationHash ?? transfer.destinationTransactionHash, completedAt: ["DESTINATION_CONFIRMED", "FAILED", "REFUNDED"].includes(mapped) ? new Date() : null, errorCode: mapped === "FAILED" ? status.data.substatus ?? "ROUTE_FAILED" : null } });
    updated += 1;
  }
  return { scanned: transfers.length, updated };
}

export async function reconcileCrossChainTransfer(transferId: string) {
  try {
    await reconcileCrossChainTransfers(100);
    return db.crossChainTransfer.findUnique({ where: { id: transferId }, include: { quote: true } });
  } catch (error) {
    logError("cross_chain_reconcile_failed", error, { transferId });
    throw error;
  }
}
