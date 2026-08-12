-- Catalyst extension controls are part of the immutable PolicyVersion facts.
-- They may be configured while a version is DRAFT, but must not change once
-- that version is published or superseded.

CREATE OR REPLACE FUNCTION agentpay_assert_catalyst_policy_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_id uuid;
  target_status "PolicyStatus";
BEGIN
  target_id := COALESCE(NEW."policyVersionId", OLD."policyVersionId");
  SELECT "status" INTO target_status FROM "PolicyVersion" WHERE "id" = target_id FOR KEY SHARE;
  IF target_status IS DISTINCT FROM 'DRAFT'::"PolicyStatus" THEN
    RAISE EXCEPTION 'Catalyst controls are immutable after policy publication'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS "PolicyOracleLimit_draft_only" ON "PolicyOracleLimit";
CREATE TRIGGER "PolicyOracleLimit_draft_only"
BEFORE INSERT OR UPDATE OR DELETE ON "PolicyOracleLimit"
FOR EACH ROW EXECUTE FUNCTION agentpay_assert_catalyst_policy_draft();

DROP TRIGGER IF EXISTS "MasumiPolicyTrust_draft_only" ON "MasumiPolicyTrust";
CREATE TRIGGER "MasumiPolicyTrust_draft_only"
BEFORE INSERT OR UPDATE OR DELETE ON "MasumiPolicyTrust"
FOR EACH ROW EXECUTE FUNCTION agentpay_assert_catalyst_policy_draft();
