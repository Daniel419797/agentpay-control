-- Platform-managed agents intentionally share one treasury account. Every other
-- custody mode retains a database-enforced one-account-to-one-agent invariant.
CREATE UNIQUE INDEX "PaymentAccount_external_network_accountId_key"
ON "PaymentAccount"("network", "accountId")
WHERE "custodyType" <> 'PLATFORM_MANAGED_TESTNET';

ALTER TABLE "AutomationExecution" ADD COLUMN "triggeredByUserId" UUID;
CREATE INDEX "AutomationExecution_triggeredByUserId_idx" ON "AutomationExecution"("triggeredByUserId");
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_triggeredByUserId_fkey"
FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
