CREATE TYPE "ChainFamily" AS ENUM ('HEDERA', 'EVM');
CREATE TYPE "CrossChainQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELED');
CREATE TYPE "CrossChainTransferStatus" AS ENUM ('QUOTED', 'AWAITING_SIGNATURE', 'SUBMITTED', 'BRIDGING', 'DESTINATION_CONFIRMED', 'FAILED', 'REFUNDED', 'CANCELED');
CREATE TYPE "AutomationRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AutomationTriggerType" AS ENUM ('MANUAL', 'SCHEDULE', 'BALANCE_THRESHOLD', 'INVOICE_EVENT', 'WEBHOOK');
CREATE TYPE "AutomationActionType" AS ENUM ('CONTRACT_CALL', 'X402_PAYMENT', 'CREATE_INVOICE');
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "AutomationDecisionType" AS ENUM ('APPROVE', 'REJECT');

CREATE TABLE "ChainNetwork" (
  "id" TEXT NOT NULL,
  "family" "ChainFamily" NOT NULL,
  "chainReference" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "nativeSymbol" TEXT NOT NULL,
  "explorerTxUrlTemplate" TEXT NOT NULL,
  "finalitySeconds" INTEGER NOT NULL,
  "requiredConfirmations" INTEGER NOT NULL DEFAULT 1,
  "testnet" BOOLEAN NOT NULL DEFAULT FALSE,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "supportsContracts" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ChainNetwork_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChainNetwork_finality_check" CHECK ("finalitySeconds" > 0 AND "requiredConfirmations" > 0)
);

CREATE TABLE "CrossChainRouteQuote" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "sourceNetworkId" TEXT NOT NULL,
  "destinationNetworkId" TEXT NOT NULL,
  "sourceToken" TEXT NOT NULL,
  "destinationToken" TEXT NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "destinationAddress" TEXT NOT NULL,
  "inputAmountAtomic" DECIMAL(78,0) NOT NULL,
  "estimatedOutputAtomic" DECIMAL(78,0) NOT NULL,
  "minimumOutputAtomic" DECIMAL(78,0) NOT NULL,
  "provider" TEXT NOT NULL,
  "externalQuoteId" TEXT NOT NULL,
  "tool" TEXT,
  "feeSummary" JSONB NOT NULL,
  "transactionRequestEncrypted" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "CrossChainQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrossChainRouteQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrossChainRouteQuote_amounts_check" CHECK ("inputAmountAtomic" > 0 AND "estimatedOutputAtomic" > 0 AND "minimumOutputAtomic" > 0 AND "minimumOutputAtomic" <= "estimatedOutputAtomic"),
  CONSTRAINT "CrossChainRouteQuote_networks_check" CHECK ("sourceNetworkId" <> "destinationNetworkId"),
  CONSTRAINT "CrossChainRouteQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrossChainRouteQuote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrossChainRouteQuote_sourceNetworkId_fkey" FOREIGN KEY ("sourceNetworkId") REFERENCES "ChainNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrossChainRouteQuote_destinationNetworkId_fkey" FOREIGN KEY ("destinationNetworkId") REFERENCES "ChainNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CrossChainTransfer" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "CrossChainTransferStatus" NOT NULL DEFAULT 'QUOTED',
  "sourceTransactionHash" TEXT,
  "destinationTransactionHash" TEXT,
  "providerStatus" TEXT,
  "errorCode" TEXT,
  "submittedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "CrossChainTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrossChainTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrossChainTransfer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrossChainTransfer_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrossChainRouteQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ContractAllowlistEntry" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "networkId" TEXT NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "allowedFunctionSelectors" TEXT[] NOT NULL,
  "maxGas" INTEGER NOT NULL,
  "maxPayableAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "expectedCodeHash" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ContractAllowlistEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractAllowlistEntry_limits_check" CHECK ("maxGas" > 0 AND "maxPayableAtomic" >= 0),
  CONSTRAINT "ContractAllowlistEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractAllowlistEntry_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "ChainNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AutomationRule" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "AutomationRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "triggerType" "AutomationTriggerType" NOT NULL,
  "triggerConfig" JSONB NOT NULL,
  "actionType" "AutomationActionType" NOT NULL,
  "actionConfigEncrypted" TEXT NOT NULL,
  "approvalThreshold" INTEGER NOT NULL DEFAULT 0,
  "maxExecutionsPerDay" INTEGER NOT NULL DEFAULT 24,
  "nextRunAt" TIMESTAMPTZ,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationRule_limits_check" CHECK ("approvalThreshold" BETWEEN 0 AND 20 AND "maxExecutionsPerDay" BETWEEN 1 AND 1000),
  CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AutomationRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AutomationExecution" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "ruleId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "triggerFactsHash" TEXT NOT NULL,
  "requiredApprovals" INTEGER NOT NULL DEFAULT 0,
  "transactionId" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationExecution_approvals_check" CHECK ("requiredApprovals" BETWEEN 0 AND 20),
  CONSTRAINT "AutomationExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AutomationExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AutomationExecutionDecision" (
  "id" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "decision" "AutomationDecisionType" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationExecutionDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationExecutionDecision_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AutomationExecutionDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CrossChainRouteQuote_organizationId_status_createdAt_idx" ON "CrossChainRouteQuote"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "CrossChainRouteQuote_expiresAt_status_idx" ON "CrossChainRouteQuote"("expiresAt", "status");
CREATE UNIQUE INDEX "CrossChainTransfer_quoteId_key" ON "CrossChainTransfer"("quoteId");
CREATE UNIQUE INDEX "CrossChainTransfer_organizationId_idempotencyKey_key" ON "CrossChainTransfer"("organizationId", "idempotencyKey");
CREATE INDEX "CrossChainTransfer_organizationId_status_createdAt_idx" ON "CrossChainTransfer"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "CrossChainTransfer_sourceTransactionHash_idx" ON "CrossChainTransfer"("sourceTransactionHash");
CREATE UNIQUE INDEX "ContractAllowlistEntry_organizationId_networkId_contractAdd_key" ON "ContractAllowlistEntry"("organizationId", "networkId", "contractAddress");
CREATE INDEX "ContractAllowlistEntry_organizationId_active_idx" ON "ContractAllowlistEntry"("organizationId", "active");
CREATE INDEX "AutomationRule_organizationId_status_nextRunAt_idx" ON "AutomationRule"("organizationId", "status", "nextRunAt");
CREATE INDEX "AutomationRule_agentId_status_idx" ON "AutomationRule"("agentId", "status");
CREATE UNIQUE INDEX "AutomationExecution_ruleId_idempotencyKey_key" ON "AutomationExecution"("ruleId", "idempotencyKey");
CREATE INDEX "AutomationExecution_organizationId_status_createdAt_idx" ON "AutomationExecution"("organizationId", "status", "createdAt" DESC);
CREATE UNIQUE INDEX "AutomationExecutionDecision_executionId_userId_key" ON "AutomationExecutionDecision"("executionId", "userId");
CREATE INDEX "AutomationExecutionDecision_executionId_decision_idx" ON "AutomationExecutionDecision"("executionId", "decision");
