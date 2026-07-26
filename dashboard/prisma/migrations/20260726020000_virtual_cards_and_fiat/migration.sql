CREATE TYPE "CardProvider" AS ENUM ('SANDBOX', 'STRIPE');
CREATE TYPE "CardholderStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED');
CREATE TYPE "VirtualCardStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'FROZEN', 'CANCELED');
CREATE TYPE "CardAuthorizationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'REVERSED', 'CLOSED');
CREATE TYPE "FiatAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'CLOSED');
CREATE TYPE "FiatTransferDirection" AS ENUM ('DEPOSIT', 'WITHDRAWAL');
CREATE TYPE "FiatTransferStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "ProviderWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "CardholderProfile" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID,
  "provider" "CardProvider" NOT NULL,
  "externalCardholderId" TEXT NOT NULL,
  "status" "CardholderStatus" NOT NULL DEFAULT 'PENDING',
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "billingAddress" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "CardholderProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardholderProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardholderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "VirtualCard" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "cardholderProfileId" UUID NOT NULL,
  "provider" "CardProvider" NOT NULL,
  "externalCardId" TEXT NOT NULL,
  "status" "VirtualCardStatus" NOT NULL DEFAULT 'INACTIVE',
  "currency" VARCHAR(3) NOT NULL,
  "last4" VARCHAR(4) NOT NULL,
  "brand" TEXT,
  "expMonth" INTEGER,
  "expYear" INTEGER,
  "nickname" TEXT,
  "spendingLimitMinor" DECIMAL(78,0),
  "spendingInterval" TEXT,
  "allowedCategories" TEXT[] NOT NULL,
  "blockedCategories" TEXT[] NOT NULL,
  "allowedCountries" TEXT[] NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "VirtualCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VirtualCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VirtualCard_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VirtualCard_cardholderProfileId_fkey" FOREIGN KEY ("cardholderProfileId") REFERENCES "CardholderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VirtualCard_expMonth_check" CHECK ("expMonth" IS NULL OR "expMonth" BETWEEN 1 AND 12),
  CONSTRAINT "VirtualCard_limit_check" CHECK ("spendingLimitMinor" IS NULL OR "spendingLimitMinor" > 0)
);

CREATE TABLE "CardAuthorization" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "virtualCardId" UUID NOT NULL,
  "provider" "CardProvider" NOT NULL,
  "externalAuthorizationId" TEXT NOT NULL,
  "status" "CardAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
  "amountMinor" DECIMAL(78,0) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "merchantName" TEXT,
  "merchantCategory" TEXT,
  "merchantCountry" TEXT,
  "approved" BOOLEAN,
  "decisionReasons" TEXT[] NOT NULL,
  "requestedAt" TIMESTAMPTZ NOT NULL,
  "resolvedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "CardAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardAuthorization_virtualCardId_fkey" FOREIGN KEY ("virtualCardId") REFERENCES "VirtualCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CardAuthorization_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "FiatAccount" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "provider" "CardProvider" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "status" "FiatAccountStatus" NOT NULL DEFAULT 'PENDING',
  "currency" VARCHAR(3) NOT NULL,
  "availableMinor" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "pendingMinor" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "FiatAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiatAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FiatAccount_balances_check" CHECK ("availableMinor" >= 0 AND "pendingMinor" >= 0)
);

CREATE TABLE "FiatTransfer" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "fiatAccountId" UUID NOT NULL,
  "provider" "CardProvider" NOT NULL,
  "externalTransferId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "direction" "FiatTransferDirection" NOT NULL,
  "status" "FiatTransferStatus" NOT NULL DEFAULT 'PENDING',
  "amountMinor" DECIMAL(78,0) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "FiatTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiatTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FiatTransfer_fiatAccountId_fkey" FOREIGN KEY ("fiatAccountId") REFERENCES "FiatAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FiatTransfer_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "ProviderWebhookEvent" (
  "id" UUID NOT NULL,
  "provider" "CardProvider" NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" "ProviderWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "errorCode" TEXT,
  "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ,
  CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardholderProfile_provider_externalCardholderId_key" ON "CardholderProfile"("provider", "externalCardholderId");
CREATE INDEX "CardholderProfile_organizationId_status_idx" ON "CardholderProfile"("organizationId", "status");
CREATE UNIQUE INDEX "VirtualCard_provider_externalCardId_key" ON "VirtualCard"("provider", "externalCardId");
CREATE INDEX "VirtualCard_organizationId_status_createdAt_idx" ON "VirtualCard"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "VirtualCard_agentId_status_idx" ON "VirtualCard"("agentId", "status");
CREATE UNIQUE INDEX "CardAuthorization_provider_externalAuthorizationId_key" ON "CardAuthorization"("provider", "externalAuthorizationId");
CREATE INDEX "CardAuthorization_organizationId_requestedAt_idx" ON "CardAuthorization"("organizationId", "requestedAt" DESC);
CREATE INDEX "CardAuthorization_virtualCardId_status_requestedAt_idx" ON "CardAuthorization"("virtualCardId", "status", "requestedAt");
CREATE UNIQUE INDEX "FiatAccount_provider_externalAccountId_key" ON "FiatAccount"("provider", "externalAccountId");
CREATE INDEX "FiatAccount_organizationId_status_idx" ON "FiatAccount"("organizationId", "status");
CREATE UNIQUE INDEX "FiatTransfer_provider_externalTransferId_key" ON "FiatTransfer"("provider", "externalTransferId");
CREATE UNIQUE INDEX "FiatTransfer_organizationId_idempotencyKey_key" ON "FiatTransfer"("organizationId", "idempotencyKey");
CREATE INDEX "FiatTransfer_organizationId_createdAt_idx" ON "FiatTransfer"("organizationId", "createdAt" DESC);
CREATE UNIQUE INDEX "ProviderWebhookEvent_provider_externalEventId_key" ON "ProviderWebhookEvent"("provider", "externalEventId");
CREATE INDEX "ProviderWebhookEvent_provider_status_receivedAt_idx" ON "ProviderWebhookEvent"("provider", "status", "receivedAt");
