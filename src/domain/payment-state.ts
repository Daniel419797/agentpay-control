export const paymentStatuses = [
  "CREATED", "QUOTED", "DENIED", "APPROVAL_PENDING", "REJECTED", "EXPIRED", "AUTHORIZED",
  "SIGNING", "SUBMITTED", "SUBMISSION_UNKNOWN", "SETTLED", "SETTLEMENT_FAILED",
  "FAILED_BEFORE_SUBMISSION", "CANCELED"
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ["QUOTED", "FAILED_BEFORE_SUBMISSION", "CANCELED"],
  QUOTED: ["DENIED", "APPROVAL_PENDING", "AUTHORIZED", "EXPIRED", "CANCELED"],
  DENIED: [],
  APPROVAL_PENDING: ["AUTHORIZED", "REJECTED", "EXPIRED", "CANCELED"],
  REJECTED: [],
  EXPIRED: [],
  AUTHORIZED: ["SIGNING", "EXPIRED", "CANCELED"],
  SIGNING: ["SUBMITTED", "FAILED_BEFORE_SUBMISSION", "SUBMISSION_UNKNOWN"],
  SUBMITTED: ["SETTLED", "SETTLEMENT_FAILED", "SUBMISSION_UNKNOWN"],
  SUBMISSION_UNKNOWN: ["SETTLED", "SETTLEMENT_FAILED"],
  SETTLED: [],
  SETTLEMENT_FAILED: [],
  FAILED_BEFORE_SUBMISSION: [],
  CANCELED: []
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus) {
  return transitions[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus) {
  if (!canTransitionPayment(from, to)) throw new Error(`Invalid payment transition: ${from} -> ${to}`);
}
