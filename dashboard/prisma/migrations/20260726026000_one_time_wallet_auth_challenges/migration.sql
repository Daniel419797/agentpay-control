CREATE TABLE "WalletAuthChallenge" (
  "id" UUID NOT NULL,
  "accountId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "consumedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletAuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletAuthChallenge_expiresAt_consumedAt_idx"
  ON "WalletAuthChallenge"("expiresAt", "consumedAt");
