-- ResourceListing.endpoint is part of the payment authorization identity.
-- Fail deployment rather than permit two listings to resolve the same exact
-- endpoint. Canonical URL equivalence is checked separately by
-- `npm run db:resources:check` before production traffic is enabled.
CREATE UNIQUE INDEX IF NOT EXISTS "ResourceListing_endpoint_key"
ON "ResourceListing"("endpoint");
