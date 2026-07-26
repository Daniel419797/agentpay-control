ALTER TABLE "PolicyVersion"
  ADD COLUMN "allowedMerchantCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "activeFrom" TIMESTAMPTZ,
  ADD COLUMN "activeUntil" TIMESTAMPTZ,
  ADD COLUMN "allowedWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "allowedStartMinute" INTEGER,
  ADD COLUMN "allowedEndMinute" INTEGER,
  ADD COLUMN "hourlyLimitAtomic" DECIMAL(78,0),
  ADD COLUMN "monthlyLimitAtomic" DECIMAL(78,0),
  ADD COLUMN "maxTransactionsPerHour" INTEGER,
  ADD COLUMN "cooldownSeconds" INTEGER;

ALTER TABLE "PolicyVersion"
  ADD CONSTRAINT "PolicyVersion_approvalThreshold_check" CHECK ("approvalThreshold" BETWEEN 1 AND 20),
  ADD CONSTRAINT "PolicyVersion_rejectionThreshold_check" CHECK ("rejectionThreshold" BETWEEN 1 AND 20),
  ADD CONSTRAINT "PolicyVersion_allowedWeekdays_check" CHECK ("allowedWeekdays" <@ ARRAY[0,1,2,3,4,5,6]),
  ADD CONSTRAINT "PolicyVersion_allowedStartMinute_check" CHECK ("allowedStartMinute" IS NULL OR "allowedStartMinute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "PolicyVersion_allowedEndMinute_check" CHECK ("allowedEndMinute" IS NULL OR "allowedEndMinute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "PolicyVersion_schedule_pair_check" CHECK (("allowedStartMinute" IS NULL) = ("allowedEndMinute" IS NULL)),
  ADD CONSTRAINT "PolicyVersion_active_range_check" CHECK ("activeUntil" IS NULL OR "activeFrom" IS NULL OR "activeUntil" > "activeFrom"),
  ADD CONSTRAINT "PolicyVersion_hourly_limit_check" CHECK ("hourlyLimitAtomic" IS NULL OR "hourlyLimitAtomic" > 0),
  ADD CONSTRAINT "PolicyVersion_monthly_limit_check" CHECK ("monthlyLimitAtomic" IS NULL OR "monthlyLimitAtomic" > 0),
  ADD CONSTRAINT "PolicyVersion_velocity_check" CHECK ("maxTransactionsPerHour" IS NULL OR "maxTransactionsPerHour" > 0),
  ADD CONSTRAINT "PolicyVersion_cooldown_check" CHECK ("cooldownSeconds" IS NULL OR "cooldownSeconds" >= 0);
