-- Enforce escrow/refund reservation semantics at the database boundary so an
-- application crash or stale worker cannot leave a refunded purchase consuming
-- an active spend reservation.
CREATE OR REPLACE FUNCTION agentpay_masumi_escrow_reservation_invariant() RETURNS trigger AS $$
BEGIN
  IF NEW."paymentIntentId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."state" = 'RefundAuthorized' AND OLD."state" IS DISTINCT FROM NEW."state" THEN
    UPDATE "SpendReservation"
       SET "status" = 'RELEASED', "updatedAt" = now()
     WHERE "paymentIntentId" = NEW."paymentIntentId"
       AND "status" IN ('ACTIVE', 'CONSUMED');
  ELSIF NEW."state" = 'Disputed' AND OLD."state" IS DISTINCT FROM NEW."state" THEN
    UPDATE "SpendReservation"
       SET "status" = 'CONSUMED', "updatedAt" = now()
     WHERE "paymentIntentId" = NEW."paymentIntentId"
       AND "status" = 'ACTIVE';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "MasumiEscrowPurchase_reservation_invariant" ON "MasumiEscrowPurchase";
CREATE TRIGGER "MasumiEscrowPurchase_reservation_invariant"
  AFTER UPDATE OF "state" ON "MasumiEscrowPurchase"
  FOR EACH ROW EXECUTE FUNCTION agentpay_masumi_escrow_reservation_invariant();
