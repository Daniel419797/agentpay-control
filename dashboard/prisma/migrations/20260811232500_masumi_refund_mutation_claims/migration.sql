CREATE TABLE IF NOT EXISTS "MasumiEscrowMutationClaim" (
  "id" UUID PRIMARY KEY,
  "escrowPurchaseId" UUID NOT NULL REFERENCES "MasumiEscrowPurchase"("id") ON DELETE RESTRICT,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "providerEvidence" JSONB,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "MasumiEscrowMutationClaim_operation_check" CHECK ("operation" IN ('REQUEST_REFUND','AUTHORIZE_REFUND')),
  CONSTRAINT "MasumiEscrowMutationClaim_status_check" CHECK ("status" IN ('PREPARED','SUBMISSION_UNKNOWN','CONFIRMED','FAILED')),
  CONSTRAINT "MasumiEscrowMutationClaim_request_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  UNIQUE ("escrowPurchaseId", "operation")
);

CREATE INDEX IF NOT EXISTS "MasumiEscrowMutationClaim_reconcile_idx"
  ON "MasumiEscrowMutationClaim" ("status", "updatedAt");
