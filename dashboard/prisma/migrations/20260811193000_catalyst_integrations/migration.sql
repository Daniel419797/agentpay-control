-- Production policy extensions for the Catalyst stack.
-- These tables deliberately keep external-oracle and registry trust decisions
-- separate from the core immutable PolicyVersion row. A published policy can
-- therefore opt in to USD valuation and Masumi identity requirements without
-- weakening the existing atomic-asset limits.

CREATE TABLE "PolicyOracleLimit" (
  "policyVersionId" UUID PRIMARY KEY,
  "quoteCurrency" TEXT NOT NULL DEFAULT 'USD',
  "perTransactionUsdMicros" BIGINT,
  "hourlyUsdMicros" BIGINT,
  "dailyUsdMicros" BIGINT,
  "monthlyUsdMicros" BIGINT,
  "maxPriceAgeSeconds" INTEGER NOT NULL DEFAULT 30,
  "maxConfidenceBps" INTEGER NOT NULL DEFAULT 250,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "PolicyOracleLimit_policyVersionId_fkey"
    FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE,
  CONSTRAINT "PolicyOracleLimit_currency_check" CHECK ("quoteCurrency" = 'USD'),
  CONSTRAINT "PolicyOracleLimit_per_tx_check" CHECK ("perTransactionUsdMicros" IS NULL OR "perTransactionUsdMicros" > 0),
  CONSTRAINT "PolicyOracleLimit_hourly_check" CHECK ("hourlyUsdMicros" IS NULL OR "hourlyUsdMicros" > 0),
  CONSTRAINT "PolicyOracleLimit_daily_check" CHECK ("dailyUsdMicros" IS NULL OR "dailyUsdMicros" > 0),
  CONSTRAINT "PolicyOracleLimit_monthly_check" CHECK ("monthlyUsdMicros" IS NULL OR "monthlyUsdMicros" > 0),
  CONSTRAINT "PolicyOracleLimit_age_check" CHECK ("maxPriceAgeSeconds" BETWEEN 1 AND 300),
  CONSTRAINT "PolicyOracleLimit_confidence_check" CHECK ("maxConfidenceBps" BETWEEN 1 AND 5000)
);

CREATE TABLE "MasumiPolicyTrust" (
  "policyVersionId" UUID PRIMARY KEY,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "network" TEXT NOT NULL,
  "allowedAgentIdentifiers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowedCapabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxRegistryAgeSeconds" INTEGER NOT NULL DEFAULT 120,
  "requireOnline" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "MasumiPolicyTrust_policyVersionId_fkey"
    FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE,
  CONSTRAINT "MasumiPolicyTrust_network_check" CHECK ("network" IN ('Preprod', 'Mainnet')),
  CONSTRAINT "MasumiPolicyTrust_age_check" CHECK ("maxRegistryAgeSeconds" BETWEEN 15 AND 3600)
);

CREATE TABLE "MasumiResourceBinding" (
  "resourceListingId" UUID PRIMARY KEY,
  "network" TEXT NOT NULL,
  "agentIdentifier" TEXT NOT NULL,
  "registryPolicyId" TEXT NOT NULL,
  "apiBaseUrl" TEXT NOT NULL,
  "capabilityName" TEXT,
  "capabilityVersion" TEXT,
  "metadataHash" CHAR(64) NOT NULL,
  "verifiedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "MasumiResourceBinding_resourceListingId_fkey"
    FOREIGN KEY ("resourceListingId") REFERENCES "ResourceListing"("id") ON DELETE CASCADE,
  CONSTRAINT "MasumiResourceBinding_network_check" CHECK ("network" IN ('Preprod', 'Mainnet')),
  CONSTRAINT "MasumiResourceBinding_identifier_check" CHECK (length("agentIdentifier") BETWEEN 57 AND 250),
  CONSTRAINT "MasumiResourceBinding_hash_check" CHECK ("metadataHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MasumiResourceBinding_expiry_check" CHECK ("expiresAt" > "verifiedAt")
);

CREATE INDEX "MasumiResourceBinding_agent_idx"
  ON "MasumiResourceBinding" ("network", "agentIdentifier");

-- The old one-shot trigger intentionally invalidated every confirmed binding.
-- Resource-specific binding is now carried inside the signed x402 requirement,
-- so same-resource retries can remain idempotent while a different resource
-- produces a different binding and is rejected by the existing durable claim.
DROP TRIGGER IF EXISTS "CardanoSettlementClaim_seal_confirmed" ON "CardanoSettlementClaim";
DROP FUNCTION IF EXISTS agentpay_seal_confirmed_cardano_claim();
