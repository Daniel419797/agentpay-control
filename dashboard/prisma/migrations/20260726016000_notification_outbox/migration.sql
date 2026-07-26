CREATE TYPE "NotificationChannelType" AS ENUM ('WEBHOOK', 'EMAIL', 'SLACK');
CREATE TYPE "NotificationEndpointStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD_LETTER');

ALTER TABLE "OutboxEvent"
  ADD COLUMN "claimedAt" TIMESTAMPTZ,
  ADD COLUMN "claimToken" UUID,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "deadLetteredAt" TIMESTAMPTZ;

CREATE TABLE "NotificationEndpoint" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "type" "NotificationChannelType" NOT NULL,
  "name" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "eventTypes" TEXT[] NOT NULL,
  "status" "NotificationEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
  "signingSecretEncrypted" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "NotificationEndpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NotificationDelivery" (
  "id" UUID NOT NULL,
  "outboxEventId" UUID NOT NULL,
  "endpointId" UUID NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastHttpStatus" INTEGER,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDelivery_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "NotificationEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "NotificationEndpoint_organizationId_status_idx" ON "NotificationEndpoint"("organizationId", "status");
CREATE UNIQUE INDEX "NotificationDelivery_outboxEventId_endpointId_key" ON "NotificationDelivery"("outboxEventId", "endpointId");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
