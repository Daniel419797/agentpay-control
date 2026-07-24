type MirrorTransfer = { account: string; amount: number };
export type MirrorTransaction = {
  consensus_timestamp: string;
  result: string;
  transaction_id: string;
  transfers: MirrorTransfer[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

export function extractTransactionId(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) return null;
  if (typeof payload.transactionId === "string" && payload.transactionId.length > 0) {
    return payload.transactionId;
  }
  const result = asRecord(payload.result);
  return typeof result?.transactionId === "string" && result.transactionId.length > 0
    ? result.transactionId
    : null;
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

export function verifyHederaPayment(transaction: MirrorTransaction, payerAccountId: string, payeeAccountId: string, amountTinybar: number): boolean {
  if (transaction.result !== "SUCCESS") return false;
  const payerDebit = transaction.transfers
    .filter((transfer) => transfer.account === payerAccountId)
    .reduce((total, transfer) => total + transfer.amount, 0);
  const payeeCredit = transaction.transfers
    .filter((transfer) => transfer.account === payeeAccountId)
    .reduce((total, transfer) => total + transfer.amount, 0);
  return payerDebit <= -amountTinybar && payeeCredit >= amountTinybar;
}
