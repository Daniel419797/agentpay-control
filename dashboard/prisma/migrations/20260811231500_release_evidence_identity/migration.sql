UPDATE "ProductionReleaseEvidence" SET "network" = '' WHERE "network" IS NULL;
UPDATE "ProductionReleaseEvidence" SET "asset" = '' WHERE "asset" IS NULL;

ALTER TABLE "ProductionReleaseEvidence"
  ALTER COLUMN "network" SET DEFAULT '',
  ALTER COLUMN "network" SET NOT NULL,
  ALTER COLUMN "asset" SET DEFAULT '',
  ALTER COLUMN "asset" SET NOT NULL;
