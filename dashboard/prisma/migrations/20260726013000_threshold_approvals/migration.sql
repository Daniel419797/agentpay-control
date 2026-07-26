CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVE', 'REJECT');

ALTER TABLE "PolicyVersion"
  ADD COLUMN "approvalThreshold" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rejectionThreshold" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ApprovalRequest"
  ADD COLUMN "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requiredRejections" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ApprovalDecision" (
  "id" UUID NOT NULL,
  "approvalRequestId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "decision" "ApprovalDecisionType" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalDecision_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ApprovalDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ApprovalDecision_approvalRequestId_userId_key" ON "ApprovalDecision"("approvalRequestId", "userId");
CREATE INDEX "ApprovalDecision_approvalRequestId_decision_idx" ON "ApprovalDecision"("approvalRequestId", "decision");
