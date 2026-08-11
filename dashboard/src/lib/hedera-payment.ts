type MirrorTransfer = { account: string; amount: number };
export type MirrorTokenTransfer = { token_id: string; account: string; amount: number };
export type MirrorTransaction = {
  consensus_timestamp: string;
  result: string;
  transaction_id: string;
  transfers: MirrorTransfer[];
  token_transfers?: MirrorTokenTransfer[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

export function extractTransactionId(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) return null;
  if (typeof payload.transactionId === "string" && payload.transactionId.length > 0) return payload.transactionId;
  const result = asRecord(payload.result);
  return typeof result?.transactionId === "string" && result.transactionId.length > 0 ? result.transactionId : null;
}

export function normalizeTransactionId(transactionId: string): string {
  const match = transactionId.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : transactionId;
}

export function parseHbarToTinybars(amount: string): number | null {
  if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  const tinybars = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  return tinybars > 0n && tinybars <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(tinybars) : null;
}

export function formatTinybarsAsHbar(amountTinybar: number): string {
  return (amountTinybar / 100_000_000).toFixed(8).replace(/\.?0+$/, "");
}

function transferTotals(transfers: Array<{ account: string; amount: number }>, payerAccountId: string, payeeAccountId: string) {
  const payerDebit = transfers.filter((transfer) => transfer.account === payerAccountId).reduce((total, transfer) => total + BigInt(transfer.amount), 0n);
  const payeeCredit = transfers.filter((transfer) => transfer.account === payeeAccountId).reduce((total, transfer) => total + BigInt(transfer.amount), 0n);
  return { payerDebit, payeeCredit };
}

export function verifyHederaPayment(transaction: MirrorTransaction, payerAccountId: string, payeeAccountId: string, amountTinybar: number): boolean {
  if (transaction.result !== "SUCCESS") return false;
  const totals = transferTotals(transaction.transfers, payerAccountId, payeeAccountId);
  const amount = BigInt(amountTinybar);
  return totals.payerDebit <= -amount && totals.payeeCredit >= amount;
}

export function verifyHederaAssetPayment(
  transaction: MirrorTransaction,
  asset: { type: "NATIVE" | "TOKEN"; hederaTokenId?: string | null },
  payerAccountId: string,
  payeeAccountId: string,
  amountAtomic: string,
): boolean {
  if (transaction.result !== "SUCCESS" || !/^\d+$/.test(amountAtomic)) return false;
  const amount = BigInt(amountAtomic);
  if (amount <= 0n) return false;
  if (asset.type === "NATIVE") {
    const totals = transferTotals(transaction.transfers, payerAccountId, payeeAccountId);
    return totals.payerDebit <= -amount && totals.payeeCredit >= amount;
  }
  if (!asset.hederaTokenId) return false;
  const tokenTransfers = (transaction.token_transfers ?? []).filter((transfer) => transfer.token_id === asset.hederaTokenId);
  const totals = transferTotals(tokenTransfers, payerAccountId, payeeAccountId);
  return totals.payerDebit <= -amount && totals.payeeCredit >= amount;
}
