CREATE TABLE "card_autonomy_policy" (
  "virtual_card_id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'DISABLED',
  "per_purchase_auto_limit_minor" NUMERIC(78,0),
  "over_limit_action" TEXT NOT NULL DEFAULT 'REQUIRE_APPROVAL',
  "allowed_hosts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "denied_hosts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "require_purpose" BOOLEAN NOT NULL DEFAULT TRUE,
  "max_checkout_seconds" INTEGER NOT NULL DEFAULT 90,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "card_autonomy_policy_card_fk" FOREIGN KEY ("virtual_card_id") REFERENCES "VirtualCard"("id") ON DELETE RESTRICT,
  CONSTRAINT "card_autonomy_policy_org_fk" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "card_autonomy_policy_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE RESTRICT,
  CONSTRAINT "card_autonomy_policy_mode_check" CHECK ("mode" IN ('DISABLED','APPROVAL_REQUIRED','LIMITED','MERCHANT_ALLOWLIST','BROAD')),
  CONSTRAINT "card_autonomy_policy_over_limit_check" CHECK ("over_limit_action" IN ('DENY','REQUIRE_APPROVAL')),
  CONSTRAINT "card_autonomy_policy_auto_limit_check" CHECK ("per_purchase_auto_limit_minor" IS NULL OR "per_purchase_auto_limit_minor" > 0),
  CONSTRAINT "card_autonomy_policy_checkout_seconds_check" CHECK ("max_checkout_seconds" BETWEEN 10 AND 120)
);

CREATE INDEX "card_autonomy_policy_org_agent_idx"
  ON "card_autonomy_policy" ("organization_id", "agent_id");

CREATE TABLE "autonomous_card_purchase" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "virtual_card_id" UUID NOT NULL,
  "payment_intent_id" UUID NOT NULL UNIQUE,
  "card_authorization_id" UUID UNIQUE,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "merchant_url" TEXT NOT NULL,
  "merchant_host" TEXT NOT NULL,
  "amount_minor" NUMERIC(78,0) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "merchant_category" TEXT,
  "merchant_country" VARCHAR(2),
  "purpose" TEXT,
  "checkout_plan_encrypted" TEXT NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "executor_attempt" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ,
  "submission_started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "result_code" TEXT,
  "result_url" TEXT,
  "result_summary" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "autonomous_card_purchase_org_fk" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "autonomous_card_purchase_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE RESTRICT,
  CONSTRAINT "autonomous_card_purchase_card_fk" FOREIGN KEY ("virtual_card_id") REFERENCES "VirtualCard"("id") ON DELETE RESTRICT,
  CONSTRAINT "autonomous_card_purchase_intent_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT,
  CONSTRAINT "autonomous_card_purchase_authorization_fk" FOREIGN KEY ("card_authorization_id") REFERENCES "CardAuthorization"("id") ON DELETE RESTRICT,
  CONSTRAINT "autonomous_card_purchase_status_check" CHECK ("status" IN ('APPROVAL_PENDING','READY','EXECUTING','CHECKOUT_SUCCEEDED','CHECKOUT_FAILED','REQUIRES_HUMAN','REJECTED','CANCELED','EXPIRED')),
  CONSTRAINT "autonomous_card_purchase_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "autonomous_card_purchase_attempt_check" CHECK ("executor_attempt" >= 0),
  CONSTRAINT "autonomous_card_purchase_lease_pair_check" CHECK (("lease_token" IS NULL) = ("lease_expires_at" IS NULL))
);

COMMENT ON COLUMN "autonomous_card_purchase"."merchant_url" IS 'AES-256-GCM ciphertext produced by AgentPay secret-box; never plaintext checkout URLs.';
COMMENT ON COLUMN "autonomous_card_purchase"."checkout_plan_encrypted" IS 'AES-256-GCM ciphertext produced by AgentPay secret-box; never plaintext form plans.';
COMMENT ON COLUMN "autonomous_card_purchase"."submission_started_at" IS 'Set immediately before the irreversible merchant submit click. Expired leases after this point must never be automatically retried.';

CREATE UNIQUE INDEX "autonomous_card_purchase_idempotency_idx"
  ON "autonomous_card_purchase" ("organization_id", "agent_id", "idempotency_key");

CREATE INDEX "autonomous_card_purchase_agent_created_idx"
  ON "autonomous_card_purchase" ("agent_id", "created_at" DESC);

CREATE INDEX "autonomous_card_purchase_queue_idx"
  ON "autonomous_card_purchase" ("status", "lease_expires_at", "submission_started_at", "created_at");

CREATE INDEX "autonomous_card_purchase_card_status_idx"
  ON "autonomous_card_purchase" ("virtual_card_id", "status", "created_at");
