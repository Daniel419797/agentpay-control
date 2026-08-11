CREATE TABLE IF NOT EXISTS "KeriResourceIdentity" (
  "resourceListingId" UUID PRIMARY KEY REFERENCES "ResourceListing"("id") ON DELETE CASCADE,
  "masumiAgentIdentifier" TEXT NOT NULL,
  "aid" TEXT NOT NULL,
  "credentialSaid" TEXT NOT NULL,
  "issuerAid" TEXT NOT NULL,
  "schemaSaid" TEXT NOT NULL,
  "claimsHash" CHAR(64) NOT NULL,
  "verifiedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ,
  "verifierEvidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "KeriResourceIdentity_hash_check" CHECK ("claimsHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS "KeriResourceIdentity_agent_idx"
  ON "KeriResourceIdentity" ("masumiAgentIdentifier", "verifiedAt" DESC);
