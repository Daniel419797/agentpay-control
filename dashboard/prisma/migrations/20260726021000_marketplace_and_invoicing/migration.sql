CREATE TYPE "ProviderVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "ResourceHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN');
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'APPROVAL_PENDING', 'PAYMENT_PENDING', 'PAID', 'OVERDUE', 'VOID');

ALTER TABLE "ResourceListing"
  ADD COLUMN "healthStatus" "ResourceHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "lastHealthCheckAt" TIMESTAMPTZ,
  ADD COLUMN "public" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "serviceLevel" JSONB,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "termsUrl" TEXT;

ALTER TABLE "ResourceProvider"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "privacyUrl" TEXT,
  ADD COLUMN "publicSlug" TEXT,
  ADD COLUMN "supportEmail" TEXT,
  ADD COLUMN "termsUrl" TEXT,
  ADD COLUMN "verificationStatus" "ProviderVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "verifiedAt" TIMESTAMPTZ,
  ADD COLUMN "websiteUrl" TEXT;

CREATE TABLE "ResourceReview" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "resourceId" UUID NOT NULL,
  "paymentIntentId" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ResourceReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "ResourceReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourceReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourceReview_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourceReview_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ResourceHealthCheck" (
  "id" UUID NOT NULL,
  "resourceId" UUID NOT NULL,
  "status" "ResourceHealthStatus" NOT NULL,
  "httpStatus" INTEGER,
  "latencyMs" INTEGER,
  "errorCode" TEXT,
  "checkedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceHealthCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceHealthCheck_latency_check" CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0),
  CONSTRAINT "ResourceHealthCheck_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AgentInvoice" (
  "id" UUID NOT NULL,
  "issuerOrganizationId" UUID NOT NULL,
  "recipientOrganizationId" UUID NOT NULL,
  "issuerAgentId" UUID NOT NULL,
  "recipientAgentId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "memo" TEXT,
  "subtotalAtomic" DECIMAL(78,0) NOT NULL,
  "totalAtomic" DECIMAL(78,0) NOT NULL,
  "dueAt" TIMESTAMPTZ NOT NULL,
  "createdBy" UUID NOT NULL,
  "sentAt" TIMESTAMPTZ,
  "viewedAt" TIMESTAMPTZ,
  "paidAt" TIMESTAMPTZ,
  "voidedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "AgentInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentInvoice_amount_check" CHECK ("subtotalAtomic" > 0 AND "totalAtomic" = "subtotalAtomic"),
  CONSTRAINT "AgentInvoice_issuerOrganizationId_fkey" FOREIGN KEY ("issuerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentInvoice_recipientOrganizationId_fkey" FOREIGN KEY ("recipientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentInvoice_issuerAgentId_fkey" FOREIGN KEY ("issuerAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentInvoice_recipientAgentId_fkey" FOREIGN KEY ("recipientAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentInvoice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InvoiceSequence" (
  "organizationId" UUID NOT NULL,
  "nextNumber" BIGINT NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "InvoiceSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InvoiceItem" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitAmountAtomic" DECIMAL(78,0) NOT NULL,
  "totalAtomic" DECIMAL(78,0) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceItem_amount_check" CHECK ("quantity" > 0 AND "unitAmountAtomic" > 0 AND "totalAtomic" = "quantity" * "unitAmountAtomic"),
  CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AgentInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InvoiceEvent" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AgentInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InvoiceSettlement" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "paymentIntentId" UUID NOT NULL,
  "transactionId" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "settledAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceSettlement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AgentInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceSettlement_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ResourceProvider_publicSlug_key" ON "ResourceProvider"("publicSlug");
CREATE UNIQUE INDEX "ResourceReview_paymentIntentId_key" ON "ResourceReview"("paymentIntentId");
CREATE UNIQUE INDEX "ResourceReview_userId_resourceId_key" ON "ResourceReview"("userId", "resourceId");
CREATE INDEX "ResourceReview_resourceId_status_createdAt_idx" ON "ResourceReview"("resourceId", "status", "createdAt" DESC);
CREATE INDEX "ResourceHealthCheck_resourceId_checkedAt_idx" ON "ResourceHealthCheck"("resourceId", "checkedAt" DESC);
CREATE UNIQUE INDEX "AgentInvoice_issuerOrganizationId_number_key" ON "AgentInvoice"("issuerOrganizationId", "number");
CREATE INDEX "AgentInvoice_issuerOrganizationId_status_createdAt_idx" ON "AgentInvoice"("issuerOrganizationId", "status", "createdAt" DESC);
CREATE INDEX "AgentInvoice_recipientOrganizationId_status_dueAt_idx" ON "AgentInvoice"("recipientOrganizationId", "status", "dueAt");
CREATE UNIQUE INDEX "InvoiceItem_invoiceId_position_key" ON "InvoiceItem"("invoiceId", "position");
CREATE INDEX "InvoiceEvent_invoiceId_occurredAt_idx" ON "InvoiceEvent"("invoiceId", "occurredAt");
CREATE UNIQUE INDEX "InvoiceSettlement_invoiceId_key" ON "InvoiceSettlement"("invoiceId");
CREATE UNIQUE INDEX "InvoiceSettlement_paymentIntentId_key" ON "InvoiceSettlement"("paymentIntentId");
CREATE UNIQUE INDEX "InvoiceSettlement_transactionId_key" ON "InvoiceSettlement"("transactionId");
