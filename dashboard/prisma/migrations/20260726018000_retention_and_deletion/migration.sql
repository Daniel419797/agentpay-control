CREATE TYPE "DeletionRequestStatus" AS ENUM ('REQUESTED', 'CANCELED', 'PROCESSING', 'COMPLETED');

CREATE TABLE "DataRetentionPolicy" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "auditDays" INTEGER NOT NULL DEFAULT 2555,
  "financialRecordDays" INTEGER NOT NULL DEFAULT 2555,
  "fulfillmentBodyDays" INTEGER NOT NULL DEFAULT 30,
  "notificationDays" INTEGER NOT NULL DEFAULT 90,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataRetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DataRetentionPolicy_audit_days_check" CHECK ("auditDays" BETWEEN 365 AND 3650),
  CONSTRAINT "DataRetentionPolicy_financial_days_check" CHECK ("financialRecordDays" BETWEEN 365 AND 3650),
  CONSTRAINT "DataRetentionPolicy_fulfillment_days_check" CHECK ("fulfillmentBodyDays" BETWEEN 0 AND 365),
  CONSTRAINT "DataRetentionPolicy_notification_days_check" CHECK ("notificationDays" BETWEEN 7 AND 365)
);

CREATE TABLE "DeletionRequest" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "requestedBy" UUID NOT NULL,
  "status" "DeletionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMPTZ NOT NULL,
  "previousKillSwitch" BOOLEAN NOT NULL,
  "snapshot" JSONB NOT NULL,
  "canceledAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeletionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DataRetentionPolicy_organizationId_key" ON "DataRetentionPolicy"("organizationId");
CREATE INDEX "DeletionRequest_status_scheduledFor_idx" ON "DeletionRequest"("status", "scheduledFor");
CREATE INDEX "DeletionRequest_organizationId_requestedAt_idx" ON "DeletionRequest"("organizationId", "requestedAt" DESC);
