-- Content-minimised operational access to the public Bid Autopsy queue.
-- Contact names, email addresses and telephone numbers never cross the bulk
-- queue boundary. The authenticated application records named assignment,
-- SLA and conversion-proposal metadata in the tenant's immutable audit chain.
CREATE FUNCTION "valo_intake"."list_bid_autopsy_work_queue"(
  p_limit integer
)
RETURNS TABLE (
  request_id uuid,
  organisation_label text,
  tender_category text,
  bid_stage text,
  tender_deadline date,
  delivery_status text,
  received_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid public lead work queue limit'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    stored.id,
    stored.company_name,
    stored.tender_category,
    stored.bid_stage,
    stored.tender_deadline,
    stored.delivery_status,
    stored.received_at
  FROM valo_intake.bid_autopsy_requests AS stored
  WHERE stored.retention_until > pg_catalog.statement_timestamp()
    AND stored.delivery_status <> 'closed'
  ORDER BY stored.received_at DESC, stored.id DESC
  LIMIT p_limit;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."list_bid_autopsy_work_queue"(
  integer
) FROM PUBLIC;
--> statement-breakpoint

-- Status changes are intentionally a tiny closed state machine. Assignment,
-- SLA and conversion data remain in the tenant audit chain and this function
-- returns no personal contact fields.
CREATE FUNCTION "valo_intake"."transition_bid_autopsy_work_queue"(
  p_request_id uuid,
  p_expected_status text,
  p_next_status text
)
RETURNS TABLE (
  request_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_expected_status NOT IN ('stored','follow_up_started','closed')
    OR p_next_status NOT IN ('follow_up_started','closed')
    OR NOT (
      (p_expected_status = 'stored'
        AND p_next_status IN ('follow_up_started','closed'))
      OR (p_expected_status = 'follow_up_started'
        AND p_next_status = 'closed')
    )
  THEN
    RAISE EXCEPTION 'invalid public lead workflow transition'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE valo_intake.bid_autopsy_requests AS stored
  SET delivery_status = p_next_status
  WHERE stored.id = p_request_id
    AND stored.delivery_status = p_expected_status
    AND stored.retention_until > pg_catalog.statement_timestamp()
  RETURNING
    stored.id;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."transition_bid_autopsy_work_queue"(
  uuid,text,text
) FROM PUBLIC;
--> statement-breakpoint

-- A separately authorised, single-record contact handoff for the currently
-- assigned operator. The application must check assignment and optimistic
-- version under the same lead advisory lock before calling this function.
-- Only the selected contact channel crosses the boundary; there is no bulk
-- PII read, search, or alternate-channel disclosure.
CREATE FUNCTION "valo_intake"."get_bid_autopsy_contact_handoff"(
  p_request_id uuid
)
RETURNS TABLE (
  request_id uuid,
  contact_name text,
  preferred_contact_method text,
  contact_value text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    stored.id,
    stored.contact_name,
    stored.preferred_contact_method,
    CASE stored.preferred_contact_method
      WHEN 'email' THEN stored.business_email
      WHEN 'telephone' THEN stored.business_telephone
    END
  FROM valo_intake.bid_autopsy_requests AS stored
  WHERE stored.id = p_request_id
    AND stored.delivery_status <> 'closed'
    AND stored.retention_until > pg_catalog.statement_timestamp();
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."get_bid_autopsy_contact_handoff"(
  uuid
) FROM PUBLIC;
--> statement-breakpoint

DO $runtime_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT EXECUTE ON FUNCTION "valo_intake"."list_bid_autopsy_work_queue"(
      integer
    ) TO valo_app_runtime;
    GRANT EXECUTE ON FUNCTION "valo_intake"."transition_bid_autopsy_work_queue"(
      uuid,text,text
    ) TO valo_app_runtime;
    GRANT EXECUTE ON FUNCTION "valo_intake"."get_bid_autopsy_contact_handoff"(
      uuid
    ) TO valo_app_runtime;
  END IF;
END;
$runtime_grant$;
