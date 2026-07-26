CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'ENTERPRISE');
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportSeverity" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "OrganizationEntitlement" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "tier" "PlanTier" NOT NULL DEFAULT 'FREE',
  "maxActiveAgents" INTEGER NOT NULL DEFAULT 2,
  "maxMembers" INTEGER NOT NULL DEFAULT 3,
  "maxMonthlyPaymentIntents" INTEGER NOT NULL DEFAULT 100,
  "maxNotificationEndpoints" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "currentPeriodStart" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currentPeriodEnd" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "OrganizationEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationEntitlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupportCase" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "createdBy" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" "SupportSeverity" NOT NULL DEFAULT 'NORMAL',
  "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupportMessage" (
  "id" UUID NOT NULL,
  "supportCaseId" UUID NOT NULL,
  "authorId" UUID,
  "authorType" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportMessage_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrganizationEntitlement_organizationId_key" ON "OrganizationEntitlement"("organizationId");
CREATE INDEX "SupportCase_organizationId_status_updatedAt_idx" ON "SupportCase"("organizationId", "status", "updatedAt" DESC);
CREATE INDEX "SupportMessage_supportCaseId_createdAt_idx" ON "SupportMessage"("supportCaseId", "createdAt");
