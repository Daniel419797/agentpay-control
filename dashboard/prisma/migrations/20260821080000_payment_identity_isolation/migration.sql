-- Payment identities are security principals. A single on-chain identity may
-- never back more than one AgentPay PaymentAccount, regardless of organization,
-- app instance, or request concurrency.
--
-- EVM addresses are canonicalized to lowercase. Hedera and Cardano identifiers
-- retain their exact representation.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentAccount"
    GROUP BY
      "network",
      CASE
        WHEN "network" LIKE 'eip155:%' THEN lower("accountId")
        ELSE "accountId"
      END
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_IDENTITY_DUPLICATES_EXIST';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION agentpay_lock_payment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_account text;
BEGIN
  canonical_account := CASE
    WHEN NEW."network" LIKE 'eip155:%' THEN lower(NEW."accountId")
    ELSE NEW."accountId"
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'payment-identity:' || NEW."network" || ':' || canonical_account,
      0
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "PaymentAccount_identity_lock" ON "PaymentAccount";
CREATE TRIGGER "PaymentAccount_identity_lock"
BEFORE INSERT OR UPDATE OF "network", "accountId" ON "PaymentAccount"
FOR EACH ROW
EXECUTE FUNCTION agentpay_lock_payment_identity();

-- Keep the ordinary Prisma-managed lookup index. The expression-unique index
-- below is an additional database security constraint rather than a replacement
-- for the schema-declared lookup index.
CREATE UNIQUE INDEX "PaymentAccount_network_canonical_accountId_key"
ON "PaymentAccount" (
  "network",
  (CASE
    WHEN "network" LIKE 'eip155:%' THEN lower("accountId")
    ELSE "accountId"
  END)
);