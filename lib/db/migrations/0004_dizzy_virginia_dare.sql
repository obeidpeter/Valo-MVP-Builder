CREATE TABLE "valo_intake"."bid_autopsy_rate_limits" (
	"client_key_hash" text PRIMARY KEY NOT NULL,
	"request_count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bid_autopsy_rate_limits_expires_idx" ON "valo_intake"."bid_autopsy_rate_limits" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "valo_intake"."bid_autopsy_rate_limits"
  ADD CONSTRAINT "bid_autopsy_rate_limits_client_hash_check"
    CHECK ("client_key_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "bid_autopsy_rate_limits_count_check"
    CHECK ("request_count" BETWEEN 1 AND 101),
  ADD CONSTRAINT "bid_autopsy_rate_limits_window_check"
    CHECK (
      "expires_at" > "window_started_at"
      AND "expires_at" <= "window_started_at" + interval '1 hour'
    );
--> statement-breakpoint

-- Autoscale replicas share this fixed-window limiter. The key is an
-- application-side HMAC of the canonical client address; raw addresses and
-- the HMAC secret never enter PostgreSQL. Every consume removes up to 100
-- expired buckets. The separately authorised owner lifecycle job also calls
-- purge_expired_bid_autopsy_rate_limits(), so expiry does not depend on new
-- public traffic continuing to arrive.
REVOKE ALL ON TABLE "valo_intake"."bid_autopsy_rate_limits" FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "valo_intake"."consume_bid_autopsy_rate_limit"(
  p_client_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  bucket_count integer;
BEGIN
  IF p_client_key_hash !~ '^[0-9a-f]{64}$'
    OR p_window_seconds NOT BETWEEN 1 AND 3600
    OR p_max_requests NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'invalid public intake rate limit parameters'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM valo_intake.bid_autopsy_rate_limits AS expired
  USING (
    SELECT candidate.client_key_hash
    FROM valo_intake.bid_autopsy_rate_limits AS candidate
    WHERE candidate.expires_at <= observed_at
    ORDER BY candidate.expires_at
    LIMIT 100
  ) AS stale
  WHERE expired.client_key_hash = stale.client_key_hash;

  INSERT INTO valo_intake.bid_autopsy_rate_limits AS bucket (
    client_key_hash,
    request_count,
    window_started_at,
    expires_at
  ) VALUES (
    p_client_key_hash,
    1,
    observed_at,
    observed_at + pg_catalog.make_interval(secs => p_window_seconds)
  )
  ON CONFLICT (client_key_hash) DO UPDATE
  SET request_count = CASE
        WHEN bucket.expires_at <= observed_at THEN 1
        ELSE LEAST(bucket.request_count + 1, p_max_requests + 1)
      END,
      window_started_at = CASE
        WHEN bucket.expires_at <= observed_at THEN observed_at
        ELSE bucket.window_started_at
      END,
      expires_at = CASE
        WHEN bucket.expires_at <= observed_at
          THEN observed_at + pg_catalog.make_interval(secs => p_window_seconds)
        ELSE bucket.expires_at
      END
  RETURNING bucket.request_count, bucket.expires_at
  INTO bucket_count, reset_at;

  allowed := bucket_count <= p_max_requests;
  remaining := GREATEST(0, p_max_requests - bucket_count);
  RETURN NEXT;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "valo_intake"."consume_bid_autopsy_rate_limit"(
  text,integer,integer
) FROM PUBLIC;
--> statement-breakpoint

DO $runtime_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION "valo_intake"."consume_bid_autopsy_rate_limit"(
      text,integer,integer
    ) TO valo_app_runtime;
  END IF;
END;
$runtime_grant$;
