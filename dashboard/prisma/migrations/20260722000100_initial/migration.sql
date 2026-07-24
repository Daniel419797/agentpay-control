-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'OPERATOR', 'APPROVER', 'VIEWER', 'PROVIDER_ADMIN');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'PAUSED', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('PLATFORM_MANAGED_TESTNET', 'KMS', 'SELF_CUSTODY', 'EXTERNAL_DELEGATED');

-- CreateEnum
CREATE TYPE "SigningMode" AS ENUM ('AUTONOMOUS_MANAGED', 'WALLET_CONFIRMATION', 'BOUNDED_DELEGATION');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'LOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OverLimitAction" AS ENUM ('DENY', 'REQUIRE_APPROVAL');

-- CreateEnum
CREATE TYPE "MerchantMode" AS ENUM ('ANY', 'ALLOWLIST_ONLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'QUOTED', 'DENIED', 'APPROVAL_PENDING', 'REJECTED', 'EXPIRED', 'AUTHORIZED', 'SIGNING', 'SUBMITTED', 'SUBMISSION_UNKNOWN', 'SETTLED', 'SETTLEMENT_FAILED', 'FAILED_BEFORE_SUBMISSION', 'CANCELED');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'DENY', 'REQUIRE_APPROVAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'SETTLED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('STARTED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('NATIVE', 'TOKEN');

-- CreateEnum
CREATE TYPE "ResourceCategory" AS ENUM ('MARKET_DATA', 'FILE', 'AI_INFERENCE', 'WEB_RESEARCH');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'PAUSED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "environmentMode" TEXT NOT NULL DEFAULT 'TESTNET_ONLY',
    "killSwitchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roles" "Role"[],

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletProvider" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'PROVISIONING',
    "network" TEXT NOT NULL DEFAULT 'hedera:testnet',
    "defaultAssetId" UUID,
    "effectivePolicyId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "evmAddress" TEXT,
    "publicKey" TEXT,
    "encryptedKeyBundle" TEXT,
    "custodyType" "CustodyType" NOT NULL,
    "signingMode" "SigningMode" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PROVISIONING',
    "delegationExpiresAt" TIMESTAMPTZ,
    "syncedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "hederaTokenId" TEXT,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" UUID NOT NULL,
    "paymentAccountId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "atomicAmount" DECIMAL(78,0) NOT NULL,
    "spendableAtomic" DECIMAL(78,0) NOT NULL,
    "source" TEXT NOT NULL,
    "asOf" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ,
    "lastUsedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PolicyStatus" NOT NULL,
    "assetId" UUID NOT NULL,
    "perTransactionLimitAtomic" DECIMAL(78,0) NOT NULL,
    "dailyLimitAtomic" DECIMAL(78,0) NOT NULL,
    "overLimitAction" "OverLimitAction" NOT NULL,
    "merchantMode" "MerchantMode" NOT NULL DEFAULT 'ANY',
    "allowedHosts" TEXT[],
    "deniedHosts" TEXT[],
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resourceUrl" TEXT NOT NULL,
    "merchantHost" TEXT NOT NULL,
    "purpose" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentQuote" (
    "id" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "x402Version" INTEGER NOT NULL,
    "scheme" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "resourceDescription" TEXT,
    "payToAccountId" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "validUntil" TIMESTAMPTZ NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rawChallenge" JSONB,

    CONSTRAINT "PaymentQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "outcome" "PolicyOutcome" NOT NULL,
    "reasonCodes" TEXT[],
    "factsHash" TEXT NOT NULL,
    "spendBeforeAtomic" DECIMAL(78,0) NOT NULL,
    "reservedBeforeAtomic" DECIMAL(78,0) NOT NULL,
    "projectedAtomic" DECIMAL(78,0) NOT NULL,
    "evaluatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendReservation" (
    "id" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "windowStart" TIMESTAMPTZ NOT NULL,
    "windowEnd" TIMESTAMPTZ NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SpendReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestPurpose" TEXT,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "decidedAt" TIMESTAMPTZ,
    "decidedBy" UUID,
    "decisionNote" TEXT,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL,
    "facilitatorRequestId" TEXT,
    "signatureFingerprint" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "status" "SettlementStatus" NOT NULL,
    "network" TEXT NOT NULL,
    "transactionId" TEXT,
    "consensusTimestamp" TEXT,
    "payerAccountId" TEXT NOT NULL,
    "payeeAccountId" TEXT NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "resultCode" TEXT,
    "submittedAt" TIMESTAMPTZ,
    "confirmedAt" TIMESTAMPTZ,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceProvider" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "settlementAccountId" TEXT NOT NULL,
    "settlementAccountVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceListing" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "category" "ResourceCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "inputSchema" JSONB NOT NULL,
    "outputContentTypes" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ResourceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourcePrice" (
    "id" UUID NOT NULL,
    "resourceListingId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "atomicAmount" DECIMAL(78,0) NOT NULL,
    "scheme" TEXT NOT NULL DEFAULT 'exact',

    CONSTRAINT "ResourcePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "result" "AuditResult" NOT NULL,
    "requestId" TEXT,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletIdentity_network_accountId_key" ON "WalletIdentity"("network", "accountId");

-- CreateIndex
CREATE INDEX "Agent_organizationId_status_idx" ON "Agent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PaymentAccount_agentId_status_idx" ON "PaymentAccount"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_network_accountId_key" ON "PaymentAccount"("network", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_network_symbol_key" ON "Asset"("network", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_network_hederaTokenId_key" ON "Asset"("network", "hederaTokenId");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_paymentAccountId_assetId_asOf_idx" ON "BalanceSnapshot"("paymentAccountId", "assetId", "asOf" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_prefix_key" ON "AgentCredential"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_secretHash_key" ON "AgentCredential"("secretHash");

-- CreateIndex
CREATE INDEX "AgentCredential_agentId_status_idx" ON "AgentCredential"("agentId", "status");

-- CreateIndex
CREATE INDEX "Policy_organizationId_agentId_idx" ON "Policy"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "PolicyVersion_policyId_status_idx" ON "PolicyVersion"("policyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyId_version_key" ON "PolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "PaymentIntent_organizationId_status_createdAt_idx" ON "PaymentIntent"("organizationId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PaymentIntent_agentId_createdAt_idx" ON "PaymentIntent"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_organizationId_agentId_idempotencyKey_key" ON "PaymentIntent"("organizationId", "agentId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentQuote_paymentIntentId_key" ON "PaymentQuote"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentQuote_fingerprint_key" ON "PaymentQuote"("fingerprint");

-- CreateIndex
CREATE INDEX "PolicyDecision_paymentIntentId_evaluatedAt_idx" ON "PolicyDecision"("paymentIntentId", "evaluatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SpendReservation_paymentIntentId_key" ON "SpendReservation"("paymentIntentId");

-- CreateIndex
CREATE INDEX "SpendReservation_agentId_assetId_windowStart_status_idx" ON "SpendReservation"("agentId", "assetId", "windowStart", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_paymentIntentId_key" ON "ApprovalRequest"("paymentIntentId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_paymentIntentId_attemptNumber_key" ON "PaymentAttempt"("paymentIntentId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_paymentAttemptId_key" ON "Settlement"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "Settlement_status_submittedAt_idx" ON "Settlement"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_network_transactionId_key" ON "Settlement"("network", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceListing_slug_key" ON "ResourceListing"("slug");

-- CreateIndex
CREATE INDEX "ResourceListing_category_status_idx" ON "ResourceListing"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResourcePrice_resourceListingId_assetId_key" ON "ResourcePrice"("resourceListingId", "assetId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_occurredAt_idx" ON "AuditEvent"("organizationId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_action_idx" ON "AuditEvent"("organizationId", "action");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_availableAt_idx" ON "OutboxEvent"("processedAt", "availableAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletIdentity" ADD CONSTRAINT "WalletIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_defaultAssetId_fkey" FOREIGN KEY ("defaultAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_effectivePolicyId_fkey" FOREIGN KEY ("effectivePolicyId") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentQuote" ADD CONSTRAINT "PaymentQuote_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentQuote" ADD CONSTRAINT "PaymentQuote_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendReservation" ADD CONSTRAINT "SpendReservation_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendReservation" ADD CONSTRAINT "SpendReservation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendReservation" ADD CONSTRAINT "SpendReservation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceProvider" ADD CONSTRAINT "ResourceProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceListing" ADD CONSTRAINT "ResourceListing_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ResourceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourcePrice" ADD CONSTRAINT "ResourcePrice_resourceListingId_fkey" FOREIGN KEY ("resourceListingId") REFERENCES "ResourceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourcePrice" ADD CONSTRAINT "ResourcePrice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
