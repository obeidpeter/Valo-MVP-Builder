-- No retention duration is inferred for pre-existing records. If intake was
-- activated before this migration, an authorised operator must reconcile
-- those rows explicitly instead of the migration silently inventing policy.
DO $retention_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM valo_intake.bid_autopsy_requests) THEN
    RAISE EXCEPTION
      'public lead retention migration requires an empty intake table or authorised reconciliation';
  END IF;
END;
$retention_preflight$;
--> statement-breakpoint
ALTER TABLE "valo_intake"."bid_autopsy_requests"
  ADD COLUMN "retention_until" timestamp with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "valo_intake"."bid_autopsy_requests"
  ADD CONSTRAINT "bid_autopsy_requests_retention_until_check"
    CHECK (
      "retention_until" > "received_at"
      AND "retention_until" <= "received_at" + interval '3650 days'
    );
--> statement-breakpoint

DROP FUNCTION "valo_intake"."store_bid_autopsy_request"(
  text,text,text,text,text,text,text,text,date,text,text
);
--> statement-breakpoint

CREATE FUNCTION "valo_intake"."store_bid_autopsy_request"(
  p_idempotency_key_hash text,
  p_payload_fingerprint text,
  p_contact_name text,
  p_company_name text,
  p_business_email text,
  p_business_telephone text,
  p_tender_category text,
  p_bid_stage text,
  p_tender_deadline date,
  p_preferred_contact_method text,
  p_privacy_notice_version text,
  p_retention_days integer
)
RETURNS TABLE (
  request_id uuid,
  received_at timestamptz,
  replayed boolean,
  payload_matches boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_retention_days NOT BETWEEN 1 AND 3650 THEN
    RAISE EXCEPTION 'invalid public lead retention configuration'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO valo_intake.bid_autopsy_requests AS inserted (
    idempotency_key_hash,
    payload_fingerprint,
    contact_name,
    company_name,
    business_email,
    business_telephone,
    tender_category,
    bid_stage,
    tender_deadline,
    preferred_contact_method,
    privacy_notice_version,
    retention_until
  ) VALUES (
    p_idempotency_key_hash,
    p_payload_fingerprint,
    p_contact_name,
    p_company_name,
    p_business_email,
    p_business_telephone,
    p_tender_category,
    p_bid_stage,
    p_tender_deadline,
    p_preferred_contact_method,
    p_privacy_notice_version,
    pg_catalog.transaction_timestamp()
      + pg_catalog.make_interval(days => p_retention_days)
  )
  ON CONFLICT (idempotency_key_hash) DO NOTHING
  RETURNING inserted.id, inserted.received_at
  INTO request_id, received_at;

  IF FOUND THEN
    replayed := false;
    payload_matches := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT stored.id, stored.received_at,
    stored.payload_fingerprint = p_payload_fingerprint
  INTO request_id, received_at, payload_matches
  FROM valo_intake.bid_autopsy_requests AS stored
  WHERE stored.idempotency_key_hash = p_idempotency_key_hash;

  IF request_id IS NULL THEN
    RAISE EXCEPTION 'idempotent intake result unavailable';
  END IF;

  replayed := true;
  RETURN NEXT;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."store_bid_autopsy_request"(
  text,text,text,text,text,text,text,text,date,text,text,integer
) FROM PUBLIC;
--> statement-breakpoint

-- Owner-side, content-free lifecycle primitive. It has no runtime grant and
-- deletes only records whose explicit per-row retention deadline has elapsed.
CREATE FUNCTION "valo_intake"."purge_expired_bid_autopsy_requests"()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM valo_intake.bid_autopsy_requests
  WHERE retention_until <= pg_catalog.clock_timestamp();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."purge_expired_bid_autopsy_requests"()
FROM PUBLIC;
--> statement-breakpoint

-- Owner-side lifecycle primitive for expired pseudonymous limiter buckets.
-- It has no runtime grant and must be scheduled with the lead-retention job so
-- cleanup does not depend on another public request arriving.
CREATE FUNCTION "valo_intake"."purge_expired_bid_autopsy_rate_limits"()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM valo_intake.bid_autopsy_rate_limits
  WHERE expires_at <= pg_catalog.clock_timestamp();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."purge_expired_bid_autopsy_rate_limits"()
FROM PUBLIC;
--> statement-breakpoint

DO $runtime_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION "valo_intake"."store_bid_autopsy_request"(
      text,text,text,text,text,text,text,text,date,text,text,integer
    ) TO valo_app_runtime;
  END IF;
END;
$runtime_grant$;
