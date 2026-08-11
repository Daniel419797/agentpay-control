-- A Masumi identity is not sufficient payment authorization by itself. Bind
-- the registry identity to the seller wallet returned by the Registry Service
-- /payment-information endpoint so AgentPay can require the x402 challenge's
-- payTo address to match the verified agent's wallet.

ALTER TABLE "MasumiResourceBinding"
  ADD COLUMN "settlementAddress" TEXT,
  ADD COLUMN "paymentType" TEXT,
  ADD COLUMN "pricingSnapshot" JSONB;

ALTER TABLE "MasumiResourceBinding"
  ADD CONSTRAINT "MasumiResourceBinding_settlement_address_check"
  CHECK (
    "settlementAddress" IS NULL OR
    "settlementAddress" ~ '^addr(_test)?1[0-9a-z]+$'
  );

CREATE INDEX "MasumiResourceBinding_settlement_idx"
  ON "MasumiResourceBinding" ("network", "settlementAddress");
