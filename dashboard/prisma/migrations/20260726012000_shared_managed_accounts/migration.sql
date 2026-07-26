DROP INDEX IF EXISTS "PaymentAccount_network_accountId_key";
CREATE INDEX "PaymentAccount_network_accountId_idx" ON "PaymentAccount"("network", "accountId");
