CREATE TABLE "MoovePaymentLink" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "agentId" UUID,
  "resourceListingId" UUID,
  "invoiceId" UUID,
  "idempotencyKey" VARCHAR(100) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "providerLinkId" TEXT,
  "providerUrl" TEXT,
  "providerStatus" VARCHAR(32) NOT NULL DEFAULT 'CREATING',
  "toAmount" TEXT NOT NULL,
  "description" VARCHAR(500),
  "providerDescription" VARCHAR(500) NOT NULL,
  "maxUsage" INTEGER,
  "expirationDate" TIMESTAMPTZ,
  "destinationAddress" TEXT,
  "token" JSONB,
  "receivedAmount" TEXT,
  "transactionUrl" TEXT,
  "providerEvidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "failureCode" TEXT,
  "lastReconciledAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MoovePaymentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MoovePaymentLink_status_check" CHECK ("providerStatus" IN ('CREATING','ACTIVE','COMPLETED','INACTIVE','SUBMISSION_UNKNOWN','FAILED')),
  CONSTRAINT "MoovePaymentLink_amount_check" CHECK ("toAmount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  CONSTRAINT "MoovePaymentLink_max_usage_check" CHECK ("maxUsage" IS NULL OR "maxUsage" >= 1),
  CONSTRAINT "MoovePaymentLink_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MoovePaymentLink_agent_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MoovePaymentLink_resource_fkey" FOREIGN KEY ("resourceListingId") REFERENCES "ResourceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MoovePaymentLink_invoice_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AgentInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MoovePaymentLink_org_idempotency_key" ON "MoovePaymentLink"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "MoovePaymentLink_provider_link_key" ON "MoovePaymentLink"("providerLinkId") WHERE "providerLinkId" IS NOT NULL;
CREATE UNIQUE INDEX "MoovePaymentLink_provider_description_key" ON "MoovePaymentLink"("providerDescription");
CREATE INDEX "MoovePaymentLink_org_status_created_idx" ON "MoovePaymentLink"("organizationId", "providerStatus", "createdAt" DESC);
CREATE INDEX "MoovePaymentLink_agent_created_idx" ON "MoovePaymentLink"("agentId", "createdAt" DESC) WHERE "agentId" IS NOT NULL;
CREATE INDEX "MoovePaymentLink_reconcile_idx" ON "MoovePaymentLink"("organizationId", "lastReconciledAt") WHERE "providerStatus" IN ('CREATING','ACTIVE','SUBMISSION_UNKNOWN');
