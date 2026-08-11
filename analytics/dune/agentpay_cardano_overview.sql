-- AgentPay public Cardano chain overview.
--
-- Required Dune parameters:
--   {{provider_address}}   Cardano address receiving the AgentPay x402 payment.
--   {{usdcx_asset_unit}}   Exact lower-case Cardano USDCx policy-id + asset-name unit.
--
-- Dune source of truth: cardano.transaction.
-- This intentionally derives only facts that are safely observable from the
-- public chain. It does not infer AgentPay organization, user, policy, purpose,
-- agent secrets, or any other private application metadata.

WITH agentpay_transactions AS (
  SELECT
    tx_hash,
    block_time,
    fee_lovelace,
    input_count,
    output_count,
    outputs,
    CASE
      WHEN CAST(outputs AS varchar) LIKE concat('%', '{{usdcx_asset_unit}}', '%') THEN 'USDCx'
      ELSE 'ADA/other'
    END AS payment_asset
  FROM cardano.transaction
  WHERE is_invalid = false
    AND CAST(outputs AS varchar) LIKE concat('%', '{{provider_address}}', '%')
)
SELECT
  count(*) AS total_transactions,
  count(DISTINCT date_trunc('day', block_time)) AS active_days,
  min(block_time) AS first_observed_payment,
  max(block_time) AS latest_observed_payment,
  sum(fee_lovelace) / 1000000.0 AS total_network_fees_ada,
  sum(CASE WHEN payment_asset = 'USDCx' THEN 1 ELSE 0 END) AS usdcx_transactions,
  sum(CASE WHEN payment_asset = 'ADA/other' THEN 1 ELSE 0 END) AS non_usdcx_transactions,
  avg(input_count) AS average_input_count,
  avg(output_count) AS average_output_count
FROM agentpay_transactions;
