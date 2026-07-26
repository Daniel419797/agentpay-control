CREATE TYPE "FinancialLedgerType" AS ENUM ('CRYPTO_PAYMENT', 'VIRTUAL_CARD', 'FIAT_TRANSFER', 'INVOICE');
CREATE TYPE "IntelligenceRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "FinancialAnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED');

CREATE TABLE "FinancialObservationDaily" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "agentId" UUID, "scopeKey" TEXT NOT NULL,
  "ledgerType" "FinancialLedgerType" NOT NULL, "assetCode" TEXT NOT NULL, "observationDate" DATE NOT NULL,
  "outflowAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0, "inflowAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "transactionCount" INTEGER NOT NULL DEFAULT 0, "declinedCount" INTEGER NOT NULL DEFAULT 0,
  "averageAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0, "maximumAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "FinancialObservationDaily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialObservationDaily_values_check" CHECK ("outflowAtomic" >= 0 AND "inflowAtomic" >= 0 AND "transactionCount" >= 0 AND "declinedCount" >= 0 AND "averageAtomic" >= 0 AND "maximumAtomic" >= 0)
);

CREATE TABLE "SpendForecast" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "agentId" UUID, "ledgerType" "FinancialLedgerType" NOT NULL,
  "assetCode" TEXT NOT NULL, "horizonDays" INTEGER NOT NULL, "predictedOutflowAtomic" DECIMAL(78,0) NOT NULL,
  "lowerBoundAtomic" DECIMAL(78,0) NOT NULL, "upperBoundAtomic" DECIMAL(78,0) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL, "modelName" TEXT NOT NULL, "modelVersion" TEXT NOT NULL,
  "trainingDays" INTEGER NOT NULL, "trainedThrough" DATE NOT NULL, "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpendForecast_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpendForecast_values_check" CHECK ("horizonDays" > 0 AND "trainingDays" > 0 AND "predictedOutflowAtomic" >= 0 AND "lowerBoundAtomic" >= 0 AND "upperBoundAtomic" >= "lowerBoundAtomic" AND "confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "FinancialAnomaly" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "agentId" UUID, "ledgerType" "FinancialLedgerType" NOT NULL,
  "assetCode" TEXT NOT NULL, "anomalyKey" TEXT NOT NULL, "severity" TEXT NOT NULL, "reasonCode" TEXT NOT NULL,
  "observedAtomic" DECIMAL(78,0) NOT NULL, "expectedAtomic" DECIMAL(78,0) NOT NULL, "deviationScore" DOUBLE PRECISION NOT NULL,
  "sourceType" TEXT, "sourceId" TEXT, "explanation" JSONB NOT NULL, "status" "FinancialAnomalyStatus" NOT NULL DEFAULT 'OPEN',
  "detectedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "acknowledgedAt" TIMESTAMPTZ, "resolvedAt" TIMESTAMPTZ,
  CONSTRAINT "FinancialAnomaly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialAnomaly_values_check" CHECK ("observedAtomic" >= 0 AND "expectedAtomic" >= 0 AND "deviationScore" >= 0 AND "severity" IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE TABLE "BudgetRecommendation" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "agentId" UUID NOT NULL, "assetId" UUID NOT NULL,
  "recommendedPerTransactionAtomic" DECIMAL(78,0) NOT NULL, "recommendedDailyAtomic" DECIMAL(78,0) NOT NULL,
  "recommendedMonthlyAtomic" DECIMAL(78,0) NOT NULL, "confidence" DOUBLE PRECISION NOT NULL, "rationale" JSONB NOT NULL,
  "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN', "basedOnThrough" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "BudgetRecommendation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BudgetRecommendation_values_check" CHECK ("recommendedPerTransactionAtomic" > 0 AND "recommendedDailyAtomic" > 0 AND "recommendedMonthlyAtomic" > 0 AND "confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "IntelligenceRun" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "status" "IntelligenceRunStatus" NOT NULL DEFAULT 'RUNNING',
  "windowStart" DATE NOT NULL, "windowEnd" DATE NOT NULL, "observations" INTEGER NOT NULL DEFAULT 0,
  "forecasts" INTEGER NOT NULL DEFAULT 0, "anomalies" INTEGER NOT NULL DEFAULT 0, "recommendations" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT, "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMPTZ,
  CONSTRAINT "IntelligenceRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntelligenceRun_values_check" CHECK ("windowStart" <= "windowEnd" AND "observations" >= 0 AND "forecasts" >= 0 AND "anomalies" >= 0 AND "recommendations" >= 0)
);

CREATE INDEX "FinancialObservationDaily_organizationId_ledgerType_assetCo_idx" ON "FinancialObservationDaily"("organizationId", "ledgerType", "assetCode", "observationDate");
CREATE UNIQUE INDEX "FinancialObservationDaily_organizationId_scopeKey_ledgerTyp_key" ON "FinancialObservationDaily"("organizationId", "scopeKey", "ledgerType", "assetCode", "observationDate");
CREATE INDEX "SpendForecast_organizationId_generatedAt_idx" ON "SpendForecast"("organizationId", "generatedAt" DESC);
CREATE INDEX "SpendForecast_agentId_ledgerType_assetCode_horizonDays_gene_idx" ON "SpendForecast"("agentId", "ledgerType", "assetCode", "horizonDays", "generatedAt" DESC);
CREATE UNIQUE INDEX "FinancialAnomaly_anomalyKey_key" ON "FinancialAnomaly"("anomalyKey");
CREATE INDEX "FinancialAnomaly_organizationId_status_detectedAt_idx" ON "FinancialAnomaly"("organizationId", "status", "detectedAt" DESC);
CREATE INDEX "FinancialAnomaly_agentId_status_detectedAt_idx" ON "FinancialAnomaly"("agentId", "status", "detectedAt" DESC);
CREATE INDEX "BudgetRecommendation_organizationId_status_createdAt_idx" ON "BudgetRecommendation"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "BudgetRecommendation_agentId_status_idx" ON "BudgetRecommendation"("agentId", "status");
CREATE INDEX "IntelligenceRun_organizationId_startedAt_idx" ON "IntelligenceRun"("organizationId", "startedAt" DESC);
CREATE INDEX "IntelligenceRun_status_startedAt_idx" ON "IntelligenceRun"("status", "startedAt");

ALTER TABLE "FinancialObservationDaily" ADD CONSTRAINT "FinancialObservationDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialObservationDaily" ADD CONSTRAINT "FinancialObservationDaily_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpendForecast" ADD CONSTRAINT "SpendForecast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpendForecast" ADD CONSTRAINT "SpendForecast_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAnomaly" ADD CONSTRAINT "FinancialAnomaly_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAnomaly" ADD CONSTRAINT "FinancialAnomaly_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetRecommendation" ADD CONSTRAINT "BudgetRecommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetRecommendation" ADD CONSTRAINT "BudgetRecommendation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetRecommendation" ADD CONSTRAINT "BudgetRecommendation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
