ALTER TABLE "projects"
  ADD COLUMN "concluded_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "projects_retention_scan_idx"
  ON "projects" USING btree ("organisation_id", "concluded_at", "id")
  WHERE "status" IN ('signed_off', 'exported') AND "concluded_at" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "app_config"
  ADD COLUMN "retention_scan_cursor_organisation_id" uuid,
  ADD COLUMN "retention_scan_lease_owner" text,
  ADD COLUMN "retention_scan_lease_expires_at" timestamp with time zone,
  ADD COLUMN "retention_scan_cycle_incomplete" boolean NOT NULL DEFAULT false,
  ADD COLUMN "storage_lifecycle_cycle_incomplete" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "notification_events"
  ADD COLUMN "storage_replay_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "storage_cycle_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "storage_terminal_at" timestamp with time zone,
  ADD CONSTRAINT "notification_events_storage_replay_count_bound"
    CHECK ("storage_replay_count" BETWEEN 0 AND 3),
  ADD CONSTRAINT "notification_events_storage_cycle_attempts_bound"
    CHECK ("storage_cycle_attempts" BETWEEN 0 AND 5);
--> statement-breakpoint
-- FORCE RLS also applies to the table owner. Temporarily return to ordinary
-- owner-bypass semantics so this owner-only migration can backfill every
-- tenant while runtime callers remain subject to ENABLED RLS throughout.
ALTER TABLE "notification_events" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
WITH "legacy_storage_attempt_counts" AS (
  SELECT
    "event"."id",
    count("attempt"."id")::integer AS "attempt_count"
  FROM "notification_events" AS "event"
  LEFT JOIN "notification_attempts" AS "attempt"
    ON "attempt"."notification_event_id" = "event"."id"
  WHERE "event"."channel" = 'internal_storage'
    AND "event"."template" = 'valo.storage-deletion-intent/v1'
    AND "event"."status" IN (
      'retry_wait', 'completed', 'cancelled', 'dead_letter'
    )
  GROUP BY "event"."id"
)
UPDATE "notification_events" AS "event"
  SET "storage_terminal_at" = CASE
        WHEN "event"."status" IN ('completed', 'cancelled', 'dead_letter')
          THEN "event"."updated_at"
        ELSE NULL
      END,
      "storage_cycle_attempts" = CASE
        WHEN "event"."status" = 'dead_letter' THEN 5
        ELSE least(5, "counts"."attempt_count")
      END
  FROM "legacy_storage_attempt_counts" AS "counts"
  WHERE "event"."id" = "counts"."id";
--> statement-breakpoint
ALTER TABLE "notification_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "notification_events_storage_terminal_retention_idx"
  ON "notification_events" USING btree
    ("organisation_id", "storage_terminal_at", "id")
  WHERE "channel" = 'internal_storage'
    AND "template" = 'valo.storage-deletion-intent/v1'
    AND "status" IN ('completed', 'cancelled')
    AND "storage_terminal_at" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "authenticated_rate_limit_buckets" (
  "organisation_id" uuid NOT NULL,
  "bucket_key_sha256" text NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL DEFAULT 1,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "authenticated_rate_limit_buckets_pk"
    PRIMARY KEY ("organisation_id", "bucket_key_sha256", "window_started_at"),
  CONSTRAINT "authenticated_rate_limit_buckets_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "authenticated_rate_limit_buckets_key_sha256_check"
    CHECK ("bucket_key_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "authenticated_rate_limit_buckets_request_count_check"
    CHECK ("request_count" BETWEEN 1 AND 1000000),
  CONSTRAINT "authenticated_rate_limit_buckets_window_check"
    CHECK ("expires_at" > "window_started_at")
);
--> statement-breakpoint
CREATE INDEX "authenticated_rate_limit_buckets_expiry_idx"
  ON "authenticated_rate_limit_buckets" USING btree
    ("expires_at", "organisation_id");
--> statement-breakpoint

-- A tenant-free, content-free cap for authenticated control-plane mutations.
-- Runtime has no table privileges; it can only call the validated consume
-- function below. The key is SHA-256(actor id) and stores no raw identity.
CREATE TABLE valo_security.authenticated_actor_rate_limit_buckets (
  bucket_key_sha256 text NOT NULL,
  window_started_at timestamp with time zone NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT authenticated_actor_rate_limit_buckets_pk
    PRIMARY KEY (bucket_key_sha256, window_started_at),
  CONSTRAINT authenticated_actor_rate_limit_buckets_key_sha256_check
    CHECK (bucket_key_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT authenticated_actor_rate_limit_buckets_request_count_check
    CHECK (request_count BETWEEN 1 AND 1000000),
  CONSTRAINT authenticated_actor_rate_limit_buckets_window_check
    CHECK (expires_at > window_started_at)
);
--> statement-breakpoint
CREATE INDEX authenticated_actor_rate_limit_buckets_expiry_idx
  ON valo_security.authenticated_actor_rate_limit_buckets
    (expires_at, bucket_key_sha256);
--> statement-breakpoint
REVOKE ALL ON TABLE valo_security.authenticated_actor_rate_limit_buckets
  FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION valo_security.consume_authenticated_actor_rate_limit(
  p_bucket_key_sha256 text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  reset_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  observed_at timestamp with time zone := pg_catalog.clock_timestamp();
  window_start timestamp with time zone;
  observed_count integer;
BEGIN
  IF p_bucket_key_sha256 !~ '^[0-9a-f]{64}$'
    OR p_window_seconds NOT BETWEEN 1 AND 3600
    OR p_max_requests NOT BETWEEN 1 AND 100000
  THEN
    RAISE EXCEPTION 'invalid authenticated actor rate limit parameters'
      USING ERRCODE = '22023';
  END IF;

  window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM observed_at) / p_window_seconds
    ) * p_window_seconds
  );

  INSERT INTO valo_security.authenticated_actor_rate_limit_buckets AS bucket (
    bucket_key_sha256,
    window_started_at,
    request_count,
    expires_at
  ) VALUES (
    p_bucket_key_sha256,
    window_start,
    1,
    window_start + pg_catalog.make_interval(secs => p_window_seconds)
  )
  ON CONFLICT (bucket_key_sha256, window_started_at)
  DO UPDATE SET
    request_count = least(bucket.request_count + 1, 1000000),
    expires_at = excluded.expires_at
  RETURNING request_count INTO observed_count;

  RETURN QUERY SELECT
    observed_count <= p_max_requests,
    greatest(0, p_max_requests - observed_count),
    window_start + pg_catalog.make_interval(secs => p_window_seconds);
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.consume_authenticated_actor_rate_limit(
  text, integer, integer
) FROM PUBLIC;
--> statement-breakpoint
DO $runtime_actor_limiter_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT EXECUTE ON FUNCTION
      valo_security.consume_authenticated_actor_rate_limit(text, integer, integer)
      TO valo_app_runtime;
  END IF;
END;
$runtime_actor_limiter_grant$;
--> statement-breakpoint

ALTER TABLE "authenticated_rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "authenticated_rate_limit_buckets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation"
  ON "authenticated_rate_limit_buckets"
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING ("organisation_id" = valo_security.current_organisation_id())
  WITH CHECK ("organisation_id" = valo_security.current_organisation_id());
--> statement-breakpoint

-- Runtime may consume a bucket only inside its forced-RLS tenant boundary.
-- Destructive lifecycle privileges stay reserved for the separately attested
-- maintenance owner and its bounded purge function below.
DO $runtime_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT SELECT, INSERT, UPDATE
      ON TABLE public.authenticated_rate_limit_buckets
      TO valo_app_runtime;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.authenticated_rate_limit_buckets
      FROM valo_app_runtime;
  END IF;
END;
$runtime_grant$;
--> statement-breakpoint

-- Intentionally invoker-security: the scheduled entrypoint attests that its
-- dedicated connection is both the table/function owner and SUPERUSER or
-- BYPASSRLS. The application runtime cannot execute this function.
CREATE FUNCTION valo_security.purge_expired_authenticated_rate_limit_buckets()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_count bigint;
  actor_deleted_count bigint;
BEGIN
  WITH expired AS (
    SELECT bucket.tableoid, bucket.ctid
    FROM public.authenticated_rate_limit_buckets AS bucket
    WHERE bucket.expires_at <= pg_catalog.clock_timestamp()
    ORDER BY bucket.expires_at, bucket.organisation_id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.authenticated_rate_limit_buckets AS bucket
    USING expired
    WHERE bucket.tableoid = expired.tableoid
      AND bucket.ctid = expired.ctid
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::bigint INTO deleted_count FROM deleted;
  WITH expired AS (
    SELECT bucket.tableoid, bucket.ctid
    FROM valo_security.authenticated_actor_rate_limit_buckets AS bucket
    WHERE bucket.expires_at <= pg_catalog.clock_timestamp()
    ORDER BY bucket.expires_at, bucket.bucket_key_sha256
    LIMIT greatest(0, 1000 - deleted_count)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM valo_security.authenticated_actor_rate_limit_buckets AS bucket
  USING expired
  WHERE bucket.tableoid = expired.tableoid
    AND bucket.ctid = expired.ctid;
  GET DIAGNOSTICS actor_deleted_count = ROW_COUNT;
  RETURN deleted_count + actor_deleted_count;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  valo_security.purge_expired_authenticated_rate_limit_buckets()
  FROM PUBLIC;
