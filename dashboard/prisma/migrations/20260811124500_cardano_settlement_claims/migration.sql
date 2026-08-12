CREATE TABLE "CardanoSettlementClaim" (
  "transactionHash" VARCHAR(64) PRIMARY KEY,
  "network" VARCHAR(32) NOT NULL,
  "bindingHash" VARCHAR(64) NOT NULL,
  "state" VARCHAR(32) NOT NULL DEFAULT 'CLAIMED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardanoSettlementClaim_transactionHash_format" CHECK ("transactionHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CardanoSettlementClaim_bindingHash_format" CHECK ("bindingHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CardanoSettlementClaim_network" CHECK ("network" IN ('cardano:preprod', 'cardano:mainnet')),
  CONSTRAINT "CardanoSettlementClaim_state" CHECK ("state" IN ('CLAIMED', 'SUBMISSION_STARTED', 'CONFIRMED', 'REJECTED'))
);

CREATE INDEX "CardanoSettlementClaim_network_state_idx"
  ON "CardanoSettlementClaim" ("network", "state");
