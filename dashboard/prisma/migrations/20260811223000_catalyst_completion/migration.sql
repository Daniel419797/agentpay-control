-- Complete the Catalyst integration data model without weakening the existing
-- x402 payment path. Masumi escrow is an explicit, separate settlement rail.

ALTER TABLE "MasumiPolicyTrust"
  ADD COLUMN IF NOT EXISTS "minimumReputationBps" INTEGER,
  ADD COLUMN IF NOT EXISTS "minimumCompletedPurchases" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MasumiPolicyTrust"
  DROP CONSTRAINT IF EXISTS "MasumiPolicyTrust_reputation_check",
  ADD CONSTRAINT "MasumiPolicyTrust_reputation_check"
    CHECK ("minimumReputationBps" IS NULL OR "minimumReputationBps" BETWEEN 0 AND 10000),
  DROP CONSTRAINT IF EXISTS "MasumiPolicyTrust_completed_check",
  ADD CONSTRAINT "MasumiPolicyTrust_completed_check"
    CHECK ("minimumCompletedPurchases" BETWEEN 0 AND 1000000);

ALTER TABLE "MasumiResourceBinding"
  ADD COLUMN IF NOT EXISTS "sellerPaymentKeyHash" CHAR(56),
  ADD COLUMN IF NOT EXISTS "credentialVerifiedAt" TIMESTAMPTZ;

ALTER TABLE "MasumiResourceBinding"
  DROP CONSTRAINT IF EXISTS "MasumiResourceBinding_payment_key_check",
  ADD CONSTRAINT "MasumiResourceBinding_payment_key_check"
    CHECK ("sellerPaymentKeyHash" IS NULL OR "sellerPaymentKeyHash" ~ '^[0-9a-f]{56}$');

CREATE TABLE IF NOT EXISTS "MasumiEscrowPurchase" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "agentId" UUID NOT NULL REFERENCES "Agent"("id") ON DELETE RESTRICT,
  "resourceListingId" UUID REFERENCES "ResourceListing"("id") ON DELETE RESTRICT,
  "paymentIntentId" UUID REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "network" TEXT NOT NULL,
  "agentIdentifier" TEXT NOT NULL,
  "masumiPurchaseId" TEXT,
  "jobId" TEXT NOT NULL,
  "blockchainIdentifier" TEXT NOT NULL,
  "identifierFromPurchaser" TEXT NOT NULL,
  "sellerAddress" TEXT NOT NULL,
  "sellerPaymentKeyHash" CHAR(56) NOT NULL,
  "paymentType" TEXT NOT NULL,
  "inputHash" CHAR(64) NOT NULL,
  "resultHash" CHAR(64),
  "resultVerifiedAt" TIMESTAMPTZ,
  "state" TEXT NOT NULL,
  "providerState" TEXT,
  "amounts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "providerEvidence" JSONB,
  "refundRequestedAt" TIMESTAMPTZ,
  "refundAuthorizedAt" TIMESTAMPTZ,
  "disputedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "lastReconciledAt" TIMESTAMPTZ,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "MasumiEscrowPurchase_network_check" CHECK ("network" IN ('Preprod', 'Mainnet')),
  CONSTRAINT "MasumiEscrowPurchase_request_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MasumiEscrowPurchase_input_hash_check" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MasumiEscrowPurchase_result_hash_check" CHECK ("resultHash" IS NULL OR "resultHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MasumiEscrowPurchase_seller_key_check" CHECK ("sellerPaymentKeyHash" ~ '^[0-9a-f]{56}$'),
  CONSTRAINT "MasumiEscrowPurchase_state_check" CHECK ("state" IN (
    'PREPARED','SUBMISSION_UNKNOWN','FundsLockingRequested','FundsLocked','ResultSubmitted',
    'Completed','RefundRequested','RefundAuthorized','Disputed','FAILED'
  )),
  UNIQUE ("organizationId", "idempotencyKey"),
  UNIQUE ("network", "blockchainIdentifier")
);

CREATE INDEX IF NOT EXISTS "MasumiEscrowPurchase_agent_idx"
  ON "MasumiEscrowPurchase" ("agentIdentifier", "network", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "MasumiEscrowPurchase_reconcile_idx"
  ON "MasumiEscrowPurchase" ("state", "updatedAt");

CREATE TABLE IF NOT EXISTS "KeriAgentIdentity" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "agentId" UUID NOT NULL REFERENCES "Agent"("id") ON DELETE RESTRICT,
  "aid" TEXT NOT NULL,
  "credentialSaid" TEXT NOT NULL,
  "issuerAid" TEXT NOT NULL,
  "schemaSaid" TEXT NOT NULL,
  "subjectAid" TEXT,
  "oobi" TEXT,
  "claimsHash" CHAR(64) NOT NULL,
  "verifiedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ,
  "revoked" BOOLEAN NOT NULL DEFAULT false,
  "verifierEvidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "KeriAgentIdentity_claims_hash_check" CHECK ("claimsHash" ~ '^[0-9a-f]{64}$'),
  UNIQUE ("organizationId", "agentId", "credentialSaid")
);
CREATE INDEX IF NOT EXISTS "KeriAgentIdentity_lookup_idx"
  ON "KeriAgentIdentity" ("agentId", "revoked", "verifiedAt" DESC);

CREATE TABLE IF NOT EXISTS "KeriPolicyTrust" (
  "policyVersionId" UUID PRIMARY KEY REFERENCES "PolicyVersion"("id") ON DELETE CASCADE,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "trustedIssuerAids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowedSchemaSaids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxVerificationAgeSeconds" INTEGER NOT NULL DEFAULT 300,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "KeriPolicyTrust_age_check" CHECK ("maxVerificationAgeSeconds" BETWEEN 15 AND 86400)
);

CREATE TABLE IF NOT EXISTS "ProductionReleaseEvidence" (
  "id" UUID PRIMARY KEY,
  "releaseSha" CHAR(40) NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "network" TEXT,
  "asset" TEXT,
  "transactionId" TEXT,
  "evidenceHash" CHAR(64) NOT NULL,
  "evidence" JSONB NOT NULL,
  "verifiedBy" UUID,
  "verifiedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "ProductionReleaseEvidence_release_sha_check" CHECK ("releaseSha" ~ '^[0-9a-f]{40}$'),
  CONSTRAINT "ProductionReleaseEvidence_hash_check" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  UNIQUE ("releaseSha", "evidenceType", "network", "asset")
);
CREATE INDEX IF NOT EXISTS "ProductionReleaseEvidence_release_idx" ON "ProductionReleaseEvidence" ("releaseSha", "evidenceType");

-- Catalyst controls remain mutable only while their parent policy version is DRAFT.
CREATE OR REPLACE FUNCTION agentpay_guard_catalyst_policy_mutation() RETURNS trigger AS $$
DECLARE policy_state TEXT;
BEGIN
  SELECT "status"::text INTO policy_state FROM "PolicyVersion" WHERE "id" = COALESCE(NEW."policyVersionId", OLD."policyVersionId");
  IF policy_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'CATALYST_POLICY_IMMUTABLE_AFTER_PUBLICATION';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "KeriPolicyTrust_draft_only" ON "KeriPolicyTrust";
CREATE TRIGGER "KeriPolicyTrust_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "KeriPolicyTrust"
  FOR EACH ROW EXECUTE FUNCTION agentpay_guard_catalyst_policy_mutation();
