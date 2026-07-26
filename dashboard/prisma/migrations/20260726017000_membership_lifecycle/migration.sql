CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');
ALTER TABLE "Membership"
  ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "invitedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "activatedAt" TIMESTAMPTZ,
  ADD COLUMN "suspendedAt" TIMESTAMPTZ;
UPDATE "Membership" SET "activatedAt" = CURRENT_TIMESTAMP WHERE "status" = 'ACTIVE';
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");
ALTER TABLE "OutboxEvent"
  ADD COLUMN "directChannel" "NotificationChannelType",
  ADD COLUMN "directDestination" TEXT;
