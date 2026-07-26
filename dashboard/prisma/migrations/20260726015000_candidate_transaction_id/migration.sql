ALTER TABLE "PaymentAttempt" ADD COLUMN "candidateTransactionId" TEXT;
CREATE INDEX "PaymentAttempt_candidateTransactionId_idx" ON "PaymentAttempt"("candidateTransactionId");
