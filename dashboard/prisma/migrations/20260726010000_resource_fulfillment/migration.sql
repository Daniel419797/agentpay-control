CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'FULFILLED', 'FAILED');

CREATE TABLE "ResourceFulfillment" (
    "id" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "contentType" TEXT,
    "contentHash" TEXT,
    "contentBytes" INTEGER,
    "responseBody" JSONB,
    "errorCode" TEXT,
    "fulfilledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "ResourceFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceFulfillment_paymentIntentId_key" ON "ResourceFulfillment"("paymentIntentId");
CREATE INDEX "ResourceFulfillment_status_createdAt_idx" ON "ResourceFulfillment"("status", "createdAt");

ALTER TABLE "ResourceFulfillment"
ADD CONSTRAINT "ResourceFulfillment_paymentIntentId_fkey"
FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
