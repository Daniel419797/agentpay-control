-- Cardano payment requirements now carry a SHA-256 binding of the canonical
-- paid-resource URL. The facilitator includes the complete requirement in the
-- durable settlement binding, so the same signed transaction can be retried
-- idempotently only for the same resource while a different resource produces
-- a different binding and is rejected as replay.
--
-- The earlier one-shot trigger predated resource-specific requirements. It
-- intentionally destroyed bindingHash on CONFIRMED, which now prevents a
-- legitimate same-resource retry from reading its already-confirmed result.
-- Remove that obsolete trigger prospectively. Claims that were already sealed
-- before this migration remain safely one-shot because their original binding
-- cannot be reconstructed from database state.

DROP TRIGGER IF EXISTS "CardanoSettlementClaim_seal_confirmed" ON "CardanoSettlementClaim";
DROP FUNCTION IF EXISTS agentpay_seal_confirmed_cardano_claim();
