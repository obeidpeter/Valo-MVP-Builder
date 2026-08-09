-- AUDIT BOUNDARY SCHEMA
-- Every active event is a complete tenant-bound v2 chain row. Historical v1
-- bytes with a known payload discontinuity live only in the immutable archive.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS hash_version integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
DO $hash_version_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_events_hash_version_check'
      AND conrelid = 'public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_hash_version_check
      CHECK (hash_version = 2);
  END IF;
END;
$hash_version_constraint$;
--> statement-breakpoint
ALTER TABLE public.audit_events
  ALTER COLUMN seq SET NOT NULL,
  ALTER COLUMN prev_hash SET NOT NULL,
  ALTER COLUMN hash SET NOT NULL;
--> statement-breakpoint
DO $active_audit_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='audit_events_seq_positive_check'
      AND conrelid='public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_seq_positive_check CHECK (seq > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='audit_events_prev_hash_format_check'
      AND conrelid='public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_prev_hash_format_check
      CHECK (prev_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='audit_events_hash_format_check'
      AND conrelid='public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_hash_format_check
      CHECK (hash ~ '^[0-9a-f]{64}$');
  END IF;
END;
$active_audit_constraints$;
--> statement-breakpoint
DROP INDEX IF EXISTS public.audit_events_organisation_seq_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX audit_events_organisation_seq_unique
  ON public.audit_events(organisation_id, seq);
--> statement-breakpoint
ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_user_id_users_id_fk;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.legacy_audit_integrity_assessments (
  id uuid PRIMARY KEY NOT NULL,
  organisation_id uuid NOT NULL
    CONSTRAINT legacy_audit_integrity_assessments_organisation_id_organisations_id_fk
    REFERENCES public.organisations(id) ON DELETE restrict,
  source_commit text NOT NULL,
  source_event_count integer NOT NULL,
  verified_ranges text NOT NULL,
  discontinuity_ranges text NOT NULL,
  finding text NOT NULL,
  probable_cause text,
  external_head_seq integer NOT NULL,
  external_head_hash text NOT NULL,
  source_backup_sha256 text NOT NULL,
  source_audit_export_sha256 text NOT NULL,
  rehearsal_evidence_sha256 text NOT NULL,
  archive_digest text NOT NULL,
  assessed_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.legacy_audit_events (
  id uuid PRIMARY KEY NOT NULL,
  organisation_id uuid NOT NULL
    CONSTRAINT legacy_audit_events_organisation_id_organisations_id_fk
    REFERENCES public.organisations(id) ON DELETE restrict,
  assessment_id uuid NOT NULL
    CONSTRAINT legacy_audit_events_assessment_id_legacy_audit_integrity_assessments_id_fk
    REFERENCES public.legacy_audit_integrity_assessments(id) ON DELETE restrict,
  user_id uuid,
  user_name text,
  project_id uuid,
  event_type text NOT NULL,
  object_type text,
  object_id text,
  details text,
  seq integer NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  row_no bigint NOT NULL,
  integrity_status text NOT NULL,
  archived_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT legacy_audit_events_integrity_status_check
    CHECK (integrity_status IN ('payload_hash_verified','known_discontinuity'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS legacy_audit_assessments_org_digest_unique
  ON public.legacy_audit_integrity_assessments(organisation_id, archive_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS legacy_audit_events_org_seq_unique
  ON public.legacy_audit_events(organisation_id, seq);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS legacy_audit_events_org_row_no_unique
  ON public.legacy_audit_events(organisation_id, row_no);
--> statement-breakpoint

-- AUDIT BOUNDARY SECURITY
-- The active stream is SELECT+INSERT only. Archive evidence and its assessment
-- are SELECT only, FORCE-RLS protected, and owner-resistant against mutation.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON public.audit_events;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select ON public.audit_events;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert ON public.audit_events;
--> statement-breakpoint
CREATE POLICY tenant_select ON public.audit_events
  FOR SELECT TO PUBLIC
  USING (organisation_id = valo_security.current_organisation_id());
--> statement-breakpoint
CREATE POLICY tenant_insert ON public.audit_events
  FOR INSERT TO PUBLIC
  WITH CHECK (organisation_id = valo_security.current_organisation_id());
--> statement-breakpoint

ALTER TABLE public.legacy_audit_integrity_assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.legacy_audit_integrity_assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select ON public.legacy_audit_integrity_assessments;
--> statement-breakpoint
CREATE POLICY tenant_select ON public.legacy_audit_integrity_assessments
  FOR SELECT TO PUBLIC
  USING (organisation_id = valo_security.current_organisation_id());
--> statement-breakpoint

ALTER TABLE public.legacy_audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.legacy_audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select ON public.legacy_audit_events;
--> statement-breakpoint
CREATE POLICY tenant_select ON public.legacy_audit_events
  FOR SELECT TO PUBLIC
  USING (organisation_id = valo_security.current_organisation_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION valo_security.reject_active_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
  IF pg_catalog.current_setting('valo.audit_test_cleanup', true)='approved'
     AND (pg_catalog.current_database()='valo_ci'
       OR pg_catalog.current_database() LIKE 'valo_bridge_ci%')
     AND pg_catalog.pg_has_role(
       pg_catalog.current_user,
       (SELECT c.relowner FROM pg_catalog.pg_class c
        WHERE c.oid='public.audit_events'::pg_catalog.regclass),
       'USAGE'
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION valo_security.reject_legacy_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'legacy audit evidence is immutable';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.reject_active_audit_mutation() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.reject_legacy_audit_mutation() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_append_only ON public.audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_active_audit_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS legacy_audit_events_immutable ON public.legacy_audit_events;
--> statement-breakpoint
CREATE TRIGGER legacy_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.legacy_audit_events
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_legacy_audit_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS legacy_audit_assessments_immutable ON public.legacy_audit_integrity_assessments;
--> statement-breakpoint
CREATE TRIGGER legacy_audit_assessments_immutable
  BEFORE UPDATE OR DELETE ON public.legacy_audit_integrity_assessments
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_legacy_audit_mutation();
