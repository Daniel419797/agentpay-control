CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "AuditEvent"
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "eventHash" TEXT;

DO $$
DECLARE
  organization_row RECORD;
  event_row RECORD;
  previous_hash TEXT;
  computed_hash TEXT;
BEGIN
  FOR organization_row IN
    SELECT DISTINCT "organizationId" FROM "AuditEvent" ORDER BY "organizationId"
  LOOP
    previous_hash := NULL;
    FOR event_row IN
      SELECT *
      FROM "AuditEvent"
      WHERE "organizationId" = organization_row."organizationId"
      ORDER BY "occurredAt", "id"
    LOOP
      computed_hash := encode(
        digest(
          concat_ws(
            '|',
            'agentpay-audit-v1',
            event_row."organizationId"::TEXT,
            coalesce(previous_hash, ''),
            event_row."id"::TEXT,
            event_row."actorType",
            coalesce(event_row."actorId", ''),
            event_row."action",
            event_row."targetType",
            coalesce(event_row."targetId", ''),
            event_row."result"::TEXT,
            coalesce(event_row."requestId", ''),
            event_row."metadata"::TEXT,
            to_char(event_row."occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          ),
          'sha256'
        ),
        'hex'
      );
      UPDATE "AuditEvent"
      SET "previousHash" = previous_hash, "eventHash" = computed_hash
      WHERE "id" = event_row."id";
      previous_hash := computed_hash;
    END LOOP;
  END LOOP;
END
$$;

ALTER TABLE "AuditEvent" ALTER COLUMN "eventHash" SET NOT NULL;
CREATE UNIQUE INDEX "AuditEvent_eventHash_key" ON "AuditEvent"("eventHash");
CREATE INDEX "AuditEvent_organizationId_eventHash_idx" ON "AuditEvent"("organizationId", "eventHash");

CREATE OR REPLACE FUNCTION agentpay_chain_audit_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-chain:' || NEW."organizationId"::TEXT, 0));
  SELECT "eventHash"
  INTO previous_hash
  FROM "AuditEvent"
  WHERE "organizationId" = NEW."organizationId"
  ORDER BY "occurredAt" DESC, "id" DESC
  LIMIT 1;

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

CREATE TRIGGER "AuditEvent_chain_insert"
BEFORE INSERT ON "AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION agentpay_chain_audit_event();

CREATE OR REPLACE FUNCTION agentpay_protect_audit_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."organizationId", OLD."actorType", OLD."actorId", OLD."action",
    OLD."targetType", OLD."targetId", OLD."result", OLD."requestId",
    OLD."metadata", OLD."occurredAt", OLD."previousHash", OLD."eventHash"
  ) IS DISTINCT FROM ROW(
    NEW."organizationId", NEW."actorType", NEW."actorId", NEW."action",
    NEW."targetType", NEW."targetId", NEW."result", NEW."requestId",
    NEW."metadata", NEW."occurredAt", NEW."previousHash", NEW."eventHash"
  ) THEN
    RAISE EXCEPTION 'Audit events are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "AuditEvent_immutable_update"
BEFORE UPDATE ON "AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION agentpay_protect_audit_event();

ALTER TABLE "SupportCase"
  ALTER COLUMN "createdBy" DROP NOT NULL,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" UUID;

CREATE UNIQUE INDEX "SupportCase_organizationId_sourceType_sourceId_key"
ON "SupportCase"("organizationId", "sourceType", "sourceId");
