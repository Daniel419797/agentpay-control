-- Cardano signed transactions are bearer-like settlement evidence. While a
-- submission is CLAIMED/SUBMISSION_STARTED, the exact same binding may be
-- retried so an ambiguous provider response can be reconciled safely. Once
-- the transaction is CONFIRMED, however, the original binding must never be
-- reusable to unlock another paid resource with identical price/payee terms.
--
-- Seal the binding at the durable state transition itself. The API compares
-- every future request's original bindingHash before acting; after sealing it
-- will therefore return CARDANO_SETTLEMENT_REPLAY (409). This also makes
-- concurrent cross-resource attempts safe because claim state transitions are
-- already serialized by a transaction-scoped advisory lock.
--
-- If the HTTP fulfillment response is lost after confirmation, AgentPay's
-- existing reconciliation contract keeps the financial settlement and records
-- fulfillment as unavailable rather than replaying confirmed payment evidence.

CREATE OR REPLACE FUNCTION agentpay_seal_confirmed_cardano_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" = 'CONFIRMED' AND OLD."state" IS DISTINCT FROM 'CONFIRMED' THEN
    -- Preserve the 64-lowercase-hex column invariant without retaining the
    -- caller-supplied bearer binding. A future request still possesses only
    -- the original binding and can no longer compare equal after confirmation.
    NEW."bindingHash" := reverse(NEW."transactionHash");
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "CardanoSettlementClaim_seal_confirmed" ON "CardanoSettlementClaim";

CREATE TRIGGER "CardanoSettlementClaim_seal_confirmed"
BEFORE UPDATE OF "state" ON "CardanoSettlementClaim"
FOR EACH ROW
WHEN (NEW."state" = 'CONFIRMED' AND OLD."state" IS DISTINCT FROM 'CONFIRMED')
EXECUTE FUNCTION agentpay_seal_confirmed_cardano_claim();
