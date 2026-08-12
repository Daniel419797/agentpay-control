-- Persist the USD value that was actually used for a policy decision. This
-- prevents later price movements from rewriting historical budget usage and
-- makes the oracle facts auditable during reconciliation and incident review.

CREATE TABLE "UsdSpendReservationSnapshot" (
  "spendReservationId" UUID PRIMARY KEY,
  "usdMicros" BIGINT NOT NULL,
  "feedId" TEXT NOT NULL,
  "price" NUMERIC(78,0) NOT NULL,
  "confidence" NUMERIC(78,0) NOT NULL,
  "exponent" INTEGER NOT NULL,
  "publishTime" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "UsdSpendReservationSnapshot_reservation_fkey"
    FOREIGN KEY ("spendReservationId") REFERENCES "SpendReservation"("id") ON DELETE CASCADE,
  CONSTRAINT "UsdSpendReservationSnapshot_usd_check" CHECK ("usdMicros" >= 0),
  CONSTRAINT "UsdSpendReservationSnapshot_feed_check" CHECK ("feedId" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "UsdSpendReservationSnapshot_price_check" CHECK ("price" > 0),
  CONSTRAINT "UsdSpendReservationSnapshot_conf_check" CHECK ("confidence" >= 0),
  CONSTRAINT "UsdSpendReservationSnapshot_exponent_check" CHECK ("exponent" BETWEEN -30 AND 30)
);

CREATE INDEX "UsdSpendReservationSnapshot_created_idx"
  ON "UsdSpendReservationSnapshot" ("createdAt" DESC);
