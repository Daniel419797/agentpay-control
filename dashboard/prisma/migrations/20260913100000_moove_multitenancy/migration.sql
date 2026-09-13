CREATE TABLE "MooveIntegration" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "encryptedApiKey" TEXT,
  "keyFingerprint" CHAR(64),
  "keyHint" VARCHAR(12),
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "settlementNetwork" VARCHAR(120),
  "settlementSymbol" VARCHAR(32),
  "settlementDecimals" INTEGER,
  "lastValidatedAt" TIMESTAMPTZ,
  "lastUsedAt" TIMESTAMPTZ,
  "lastReconciledAt" TIMESTAMPTZ,
  "lastFailureCode" TEXT,
  "createdBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MooveIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MooveIntegration_status_check" CHECK ("status" IN ('ACTIVE','SUSPENDED','REVOKED','ERROR')),
  CONSTRAINT "MooveIntegration_settlement_complete_check" CHECK (
    ("settlementNetwork" IS NULL AND "settlementSymbol" IS NULL AND "settlementDecimals" IS NULL)
    OR ("settlementNetwork" IS NOT NULL AND "settlementSymbol" IS NOT NULL AND "settlementDecimals" IS NOT NULL AND "settlementDecimals" BETWEEN 0 AND 255)
  ),
  CONSTRAINT "MooveIntegration_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MooveIntegration_creator_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MooveIntegration_organization_key" ON "MooveIntegration"("organizationId");
CREATE UNIQUE INDEX "MooveIntegration_key_fingerprint_key" ON "MooveIntegration"("keyFingerprint") WHERE "keyFingerprint" IS NOT NULL;
CREATE INDEX "MooveIntegration_status_reconcile_idx" ON "MooveIntegration"("status", "lastReconciledAt", "updatedAt");
