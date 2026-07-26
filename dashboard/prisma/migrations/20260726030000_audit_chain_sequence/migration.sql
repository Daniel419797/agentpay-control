ALTER TABLE "AuditEvent" ADD COLUMN "chainSequence" BIGINT;

WITH sequenced AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "organizationId"
      ORDER BY "occurredAt", "id"
    ) AS sequence
  FROM "AuditEvent"
)
UPDATE "AuditEvent" AS event
SET "chainSequence" = sequenced.sequence
FROM sequenced
WHERE event."id" = sequenced."id";

ALTER TABLE "AuditEvent" ALTER COLUMN "chainSequence" SET NOT NULL;
CREATE UNIQUE INDEX "AuditEvent_organizationId_chainSequence_key"
ON "AuditEvent"("organizationId", "chainSequence");

CREATE OR REPLACE FUNCTION agentpay_chain_audit_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_hash TEXT;
  previous_sequence BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-chain:' || NEW."organizationId"::TEXT, 0));
  SELECT "eventHash", "chainSequence"
  INTO previous_hash, previous_sequence
  FROM "AuditEvent"
  WHERE "organizationId" = NEW."organizationId"
  ORDER BY "chainSequence" DESC
  LIMIT 1;

  NEW."chainSequence" := coalesce(previous_sequence, 0) + 1;
  NEW."previousHash" := previous_hash;
  NEW."eventHash" := encode(
    digest(
      concat_ws(
        '|',
        'agentpay-audit-v1',
        NEW."organizationId"::TEXT,
        coalesce(previous_hash, ''),
        NEW."id"::TEXT,
        NEW."actorType",
        coalesce(NEW."actorId", ''),
        NEW."action",
        NEW."targetType",
        coalesce(NEW."targetId", ''),
        NEW."result"::TEXT,
        coalesce(NEW."requestId", ''),
        NEW."metadata"::TEXT,
        to_char(NEW."occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION agentpay_protect_audit_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."organizationId", OLD."actorType", OLD."actorId", OLD."action",
    OLD."targetType", OLD."targetId", OLD."result", OLD."requestId",
    OLD."metadata", OLD."occurredAt", OLD."chainSequence",
    OLD."previousHash", OLD."eventHash"
  ) IS DISTINCT FROM ROW(
    NEW."organizationId", NEW."actorType", NEW."actorId", NEW."action",
    NEW."targetType", NEW."targetId", NEW."result", NEW."requestId",
    NEW."metadata", NEW."occurredAt", NEW."chainSequence",
    NEW."previousHash", NEW."eventHash"
  ) THEN
    RAISE EXCEPTION 'Audit events are immutable';
  END IF;
  RETURN NEW;
END
$$;
