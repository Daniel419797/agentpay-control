-- Recent public AgentPay Cardano transaction sample for cross-checking against
-- an independent Cardano data provider. No private AgentPay application data is
-- present in this query.
-- Required parameter: {{provider_address}}

SELECT
  lower(to_hex(tx_hash)) AS transaction_hash,
  block_time,
  fee_lovelace,
  input_count,
  output_count
FROM cardano.transaction
WHERE is_invalid = false
  AND CAST(outputs AS varchar) LIKE concat('%', '{{provider_address}}', '%')
ORDER BY block_time DESC
LIMIT 20;
