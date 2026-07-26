ALTER TYPE "FiatTransferStatus" ADD VALUE IF NOT EXISTS 'SUBMISSION_UNKNOWN';

ALTER TABLE "FiatTransfer"
  ADD COLUMN "instrumentIdEncrypted" TEXT,
  ADD COLUMN "description" TEXT;

CREATE INDEX "FiatTransfer_status_updatedAt_idx"
  ON "FiatTransfer"("status", "updatedAt");
