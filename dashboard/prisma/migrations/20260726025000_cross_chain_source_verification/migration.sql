ALTER TABLE "CrossChainTransfer"
  ADD COLUMN "sourceVerifiedAt" TIMESTAMPTZ,
  ADD COLUMN "sourceBlockNumber" TEXT;

CREATE INDEX "CrossChainTransfer_sourceVerifiedAt_idx"
  ON "CrossChainTransfer"("sourceVerifiedAt");
