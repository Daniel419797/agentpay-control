ALTER TABLE "MasumiEscrowPurchase"
  ADD COLUMN IF NOT EXISTS "inputEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "inputPurgedAt" TIMESTAMPTZ;

-- Existing rows cannot exist before this migration in a forward-only deployment.
ALTER TABLE "MasumiEscrowPurchase" ALTER COLUMN "inputEncrypted" SET NOT NULL;
