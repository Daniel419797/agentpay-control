export type MasumiRefundOperation = "REQUEST_REFUND" | "AUTHORIZE_REFUND";

export function masumiRefundTargetReached(operation: MasumiRefundOperation, providerState: string) {
  if (operation === "REQUEST_REFUND") return providerState === "RefundRequested" || providerState === "RefundAuthorized";
  return providerState === "RefundAuthorized";
}

export function masumiRefundTerminallyPrecluded(operation: MasumiRefundOperation, providerState: string) {
  if (masumiRefundTargetReached(operation, providerState)) return false;
  return providerState === "Completed" || providerState === "Disputed";
}

export function isAmbiguousMasumiRefundError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (error && typeof error === "object" && "ambiguous" in error && (error as { ambiguous?: unknown }).ambiguous === true) return true;
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("MASUMI_PAYMENT_PROVIDER_")) return true;
  return [
    "MASUMI_REFUND_RESPONSE_INVALID",
    "MASUMI_REFUND_AUTH_RESPONSE_INVALID",
    "MASUMI_REFUND_STATE_INVALID",
    "MASUMI_REFUND_AUTH_STATE_INVALID",
  ].includes(error.message);
}
