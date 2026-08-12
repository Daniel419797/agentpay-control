-- AgentPay public Cardano activity series.
-- Required parameters are identical to agentpay_cardano_overview.sql.

WITH agentpay_transactions AS (
  SELECT
    date_trunc('day', block_time) AS day,
    fee_lovelace,
    CASE
      WHEN CAST(outputs AS varchar) LIKE concat('%', '{{usdcx_asset_unit}}', '%') THEN 1
      ELSE 0
    END AS is_usdcx
  FROM cardano.transaction
  WHERE is_invalid = false
    AND CAST(outputs AS varchar) LIKE concat('%', '{{provider_address}}', '%')
)
SELECT
  day,
  count(*) AS transactions,
  sum(is_usdcx) AS usdcx_transactions,
  count(*) - sum(is_usdcx) AS non_usdcx_transactions,
  sum(fee_lovelace) / 1000000.0 AS network_fees_ada
FROM agentpay_transactions
GROUP BY 1
ORDER BY 1;
