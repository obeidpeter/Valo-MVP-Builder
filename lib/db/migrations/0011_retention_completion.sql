-- Durable, tenant-scoped retention completion evidence.
-- The live project FK is detached by ON DELETE SET NULL, while historical
-- subject identity, manifests, storage receipts and certificates remain.
ALTER TABLE public.retention_requests
  ADD COLUMN completion_protocol_version integer DEFAULT 0 NOT NULL,
  ADD COLUMN subject_project_id uuid,
  ADD COLUMN requested_by_name text;
--> statement-breakpoint
-- FORCE RLS also applies to the table owner. The bounded migration path owns
-- this relation, so retain ENABLED RLS for runtime roles while temporarily
-- restoring owner bypass to backfill every tenant and requester snapshot.
ALTER TABLE public.retention_requests NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE public.retention_requests AS request
SET subject_project_id = request.project_id,
    requested_by_name = COALESCE(
      NULLIF(pg_catalog.btrim(requester.name), ''),
      requester.email,
      'Legacy retention requester unavailable'
    )
FROM public.users AS requester
WHERE requester.id = request.requested_by;
--> statement-breakpoint
UPDATE public.retention_requests
SET subject_project_id = project_id,
    requested_by_name = 'Legacy retention requester unavailable'
WHERE subject_project_id IS NULL OR requested_by_name IS NULL;
--> statement-breakpoint
ALTER TABLE public.retention_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_requests
  ALTER COLUMN subject_project_id SET NOT NULL,
  ALTER COLUMN requested_by_name SET NOT NULL,
  ALTER COLUMN completion_protocol_version SET DEFAULT 1,
  ALTER COLUMN project_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.retention_requests
  DROP CONSTRAINT retention_requests_project_id_projects_id_fk;
--> statement-breakpoint
ALTER TABLE public.retention_requests
  ADD CONSTRAINT retention_requests_project_id_projects_id_fk
  FOREIGN KEY (project_id) REFERENCES public.projects(id)
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE public.retention_requests
  DROP CONSTRAINT retention_requests_requested_by_users_id_fk;
--> statement-breakpoint
ALTER TABLE public.retention_requests
  ADD CONSTRAINT retention_requests_requested_by_users_id_fk
  FOREIGN KEY (requested_by) REFERENCES public.users(id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
DROP INDEX public.retention_requests_one_pending_per_project;
--> statement-breakpoint
CREATE UNIQUE INDEX retention_requests_one_pending_per_project
  ON public.retention_requests (subject_project_id)
  WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX retention_requests_org_subject_idx
  ON public.retention_requests
    (organisation_id, subject_project_id, created_at);
--> statement-breakpoint
ALTER TABLE public.retention_requests
  ADD CONSTRAINT retention_requests_completion_state_check
  CHECK (
    completion_protocol_version = 0
    OR (completion_protocol_version = 1 AND (
      (status IN ('pending', 'reconciling')
        AND completed_at IS NULL
        AND certificate_text IS NULL)
      OR (status = 'completed'
        AND completed_at IS NOT NULL
        AND certificate_text IS NOT NULL
        AND pg_catalog.length(pg_catalog.btrim(certificate_text)) BETWEEN 1 AND 512)
      OR (status = 'blocked'
        AND completed_at IS NOT NULL
        AND certificate_text IS NULL)
    ))
  ) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.retention_actions
  ADD COLUMN completion_protocol_version integer DEFAULT 0 NOT NULL,
  ADD COLUMN subject_project_id uuid,
  ADD COLUMN source_manifest text,
  ADD COLUMN source_manifest_sha256 text,
  ADD COLUMN purge_receipt text,
  ADD COLUMN purge_receipt_sha256 text,
  ADD COLUMN purged_at timestamp with time zone,
  ADD COLUMN executed_by_name text,
  ADD COLUMN reconciliation_manifest text,
  ADD COLUMN reconciliation_manifest_sha256 text,
  ADD COLUMN prepared_by_user_id uuid,
  ADD COLUMN prepared_by_name text,
  ADD COLUMN prepared_at timestamp with time zone,
  ADD COLUMN checked_by_user_id uuid,
  ADD COLUMN checked_by_name text,
  ADD COLUMN checked_at timestamp with time zone;
--> statement-breakpoint
-- Both sides of the legacy action/request join are FORCE-RLS tables. Preserve
-- runtime isolation while allowing the owner-only migration to see all rows.
ALTER TABLE public.retention_actions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_requests NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE public.retention_actions AS action
SET subject_project_id = COALESCE(
  request.subject_project_id,
  CASE WHEN action.object_type = 'project' THEN action.object_id END
)
FROM public.retention_requests AS request
WHERE request.id = action.retention_request_id;
--> statement-breakpoint
UPDATE public.retention_actions
SET subject_project_id = object_id
WHERE subject_project_id IS NULL AND object_type = 'project';
--> statement-breakpoint
UPDATE public.retention_actions AS action
SET executed_by_name = COALESCE(
  NULLIF(pg_catalog.btrim(executor.name), ''),
  executor.email,
  'Legacy retention executor unavailable'
)
FROM public.users AS executor
WHERE executor.id = action.executed_by_user_id
  AND action.executed_at IS NOT NULL;
--> statement-breakpoint
UPDATE public.retention_actions
SET executed_by_name = 'Legacy retention executor unavailable'
WHERE executed_at IS NOT NULL AND executed_by_name IS NULL;
--> statement-breakpoint
ALTER TABLE public.retention_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_actions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_actions
  ADD CONSTRAINT retention_actions_prepared_by_user_id_users_id_fk
  FOREIGN KEY (prepared_by_user_id) REFERENCES public.users(id)
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT retention_actions_checked_by_user_id_users_id_fk
  FOREIGN KEY (checked_by_user_id) REFERENCES public.users(id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX retention_actions_one_completion_per_request
  ON public.retention_actions (retention_request_id)
  WHERE completion_protocol_version = 1;
--> statement-breakpoint
ALTER TABLE public.retention_actions
  ADD CONSTRAINT retention_actions_source_manifest_pair_check
  CHECK (
    (source_manifest IS NULL AND source_manifest_sha256 IS NULL)
    OR (
      source_manifest IS NOT NULL
      AND source_manifest_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID,
  ADD CONSTRAINT retention_actions_reconciliation_manifest_pair_check
  CHECK (
    (reconciliation_manifest IS NULL
      AND reconciliation_manifest_sha256 IS NULL)
    OR (
      reconciliation_manifest IS NOT NULL
      AND reconciliation_manifest_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID,
  ADD CONSTRAINT retention_actions_purge_receipt_stamp_check
  CHECK (
    (purge_receipt IS NULL
      AND purge_receipt_sha256 IS NULL
      AND purged_at IS NULL)
    OR (
      completion_protocol_version = 1
      AND purge_receipt IS NOT NULL
      AND purge_receipt_sha256 ~ '^[0-9a-f]{64}$'
      AND purged_at IS NOT NULL
    )
  ) NOT VALID,
  ADD CONSTRAINT retention_actions_preparer_stamp_check
  CHECK (
    (prepared_by_user_id IS NULL
      AND prepared_by_name IS NULL
      AND prepared_at IS NULL)
    OR (
      prepared_by_user_id IS NOT NULL
      AND prepared_by_name IS NOT NULL
      AND pg_catalog.length(pg_catalog.btrim(prepared_by_name)) BETWEEN 1 AND 256
      AND prepared_at IS NOT NULL
    )
  ) NOT VALID,
  ADD CONSTRAINT retention_actions_executor_name_check
  CHECK (
    executed_by_name IS NULL
    OR pg_catalog.length(pg_catalog.btrim(executed_by_name)) BETWEEN 1 AND 256
  ) NOT VALID,
  ADD CONSTRAINT retention_actions_checker_stamp_check
  CHECK (
    (checked_by_user_id IS NULL
      AND checked_by_name IS NULL
      AND checked_at IS NULL)
    OR (
      checked_by_user_id IS NOT NULL
      AND checked_by_name IS NOT NULL
      AND pg_catalog.length(pg_catalog.btrim(checked_by_name)) BETWEEN 1 AND 256
      AND checked_at IS NOT NULL
      AND checked_by_user_id <> prepared_by_user_id
    )
  ) NOT VALID,
  ADD CONSTRAINT retention_actions_completion_state_check
  CHECK (
    (completion_protocol_version = 0
      AND status NOT IN ('detached', 'reconciled', 'certified')
      AND source_manifest IS NULL
      AND reconciliation_manifest IS NULL
      AND prepared_at IS NULL
      AND checked_at IS NULL)
    OR (completion_protocol_version = 1 AND (
      (status = 'pending'
        AND source_manifest IS NULL
        AND executed_by_name IS NULL
        AND reconciliation_manifest IS NULL
        AND prepared_at IS NULL
        AND checked_at IS NULL)
      OR (status = 'detached'
        AND subject_project_id IS NOT NULL
        AND source_manifest IS NOT NULL
        AND executed_by_name IS NOT NULL
        AND prepared_at IS NULL
        AND reconciliation_manifest IS NULL
        AND checked_at IS NULL)
      OR (status = 'reconciled'
        AND subject_project_id IS NOT NULL
        AND source_manifest IS NOT NULL
        AND executed_by_name IS NOT NULL
        AND prepared_at IS NOT NULL
        AND reconciliation_manifest IS NOT NULL
        AND checked_at IS NULL)
      OR (status = 'certified'
        AND subject_project_id IS NOT NULL
        AND source_manifest IS NOT NULL
        AND executed_by_name IS NOT NULL
        AND prepared_at IS NOT NULL
        AND reconciliation_manifest IS NOT NULL
        AND checked_at IS NOT NULL)
      OR status = 'blocked'
    ))
  ) NOT VALID;
--> statement-breakpoint

ALTER TABLE public.deletion_certificates
  ADD COLUMN certificate_manifest text,
  ADD COLUMN certificate_manifest_sha256 text,
  ADD COLUMN signed_by_name text;
--> statement-breakpoint
-- Snapshot every legacy signer before signed_by_name becomes mandatory.
ALTER TABLE public.deletion_certificates NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE public.deletion_certificates AS certificate
SET signed_by_name = COALESCE(
  NULLIF(pg_catalog.btrim(signer.name), ''),
  signer.email
)
FROM public.users AS signer
WHERE signer.id = certificate.signed_by_user_id;
--> statement-breakpoint
ALTER TABLE public.deletion_certificates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.deletion_certificates
  ALTER COLUMN signed_by_name SET NOT NULL,
  ADD CONSTRAINT deletion_certificates_scope_hash_check
  CHECK (scope_manifest_hash ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT deletion_certificates_manifest_pair_check
  CHECK (
    (certificate_manifest IS NULL AND certificate_manifest_sha256 IS NULL)
    OR (
      certificate_manifest IS NOT NULL
      AND certificate_manifest_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID,
  ADD CONSTRAINT deletion_certificates_signer_name_check
  CHECK (
    pg_catalog.length(pg_catalog.btrim(signed_by_name)) BETWEEN 1 AND 256
  ) NOT VALID;
--> statement-breakpoint
CREATE UNIQUE INDEX deletion_certificates_retention_action_unique
  ON public.deletion_certificates (retention_action_id)
  WHERE certificate_manifest IS NOT NULL;
--> statement-breakpoint

CREATE TABLE public.retention_action_storage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organisation_id uuid NOT NULL,
  retention_action_id uuid NOT NULL,
  storage_event_id uuid NOT NULL,
  request_sha256 text NOT NULL,
  object_path_sha256 text NOT NULL,
  bound_event_version integer NOT NULL,
  terminal_disposition text,
  terminal_event_version integer,
  terminal_at timestamp with time zone,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT retention_action_storage_events_organisation_id_organisations_id_fk
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT retention_action_storage_events_retention_action_id_retention_actions_id_fk
    FOREIGN KEY (retention_action_id) REFERENCES public.retention_actions(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT retention_action_storage_events_storage_event_id_notification_events_id_fk
    FOREIGN KEY (storage_event_id) REFERENCES public.notification_events(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT retention_action_storage_events_request_hash_check
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retention_action_storage_events_path_hash_check
    CHECK (object_path_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retention_action_storage_events_bound_version_check
    CHECK (bound_event_version >= 1),
  CONSTRAINT retention_action_storage_events_terminal_check
    CHECK (
      (terminal_disposition IS NULL
        AND terminal_event_version IS NULL
        AND terminal_at IS NULL)
      OR (
        terminal_disposition IN (
          'deleted',
          'already_absent',
          'cancelled_referenced',
          'accepted_unresolved'
        )
        AND terminal_event_version >= bound_event_version
        AND terminal_at IS NOT NULL
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX retention_action_storage_events_action_event_unique
  ON public.retention_action_storage_events
    (retention_action_id, storage_event_id);
--> statement-breakpoint
CREATE UNIQUE INDEX retention_action_storage_events_action_path_unique
  ON public.retention_action_storage_events
    (retention_action_id, object_path_sha256);
--> statement-breakpoint
CREATE INDEX retention_action_storage_events_org_terminal_idx
  ON public.retention_action_storage_events
    (organisation_id, retention_action_id, terminal_at, id);
--> statement-breakpoint

-- One owner-held trigger routine governs CAS, one-way phase transitions and
-- immutable evidence. Session actor text is never treated as an authority
-- stamp: user UUID, retained display name and database time are all persisted.
CREATE FUNCTION valo_security.enforce_retention_completion_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  action_completion_protocol_version integer;
  action_organisation_id uuid;
  action_retention_request_id uuid;
  action_subject_project_id uuid;
  action_status text;
  action_source_manifest_sha256 text;
  action_purge_receipt_sha256 text;
  action_purged_at timestamptz;
  action_reconciliation_manifest_sha256 text;
  action_prepared_by_user_id uuid;
  action_prepared_by_name text;
  action_prepared_at timestamptz;
  action_checked_by_user_id uuid;
  action_checked_by_name text;
  action_checked_at timestamptz;
  event_organisation_id uuid;
  event_project_id uuid;
  event_status text;
  event_version integer;
  event_terminal_at timestamptz;
  event_payload text;
  latest_attempt_status text;
  latest_response_code text;
  purge_function_owner text;
  purge_receipt_json jsonb;
  stamp_user_id uuid;
  stamp_user_name text;
  stamp_authorized boolean;
  source_manifest_json jsonb;
  reconciliation_manifest_json jsonb;
  certificate_manifest_json jsonb;
BEGIN
  IF TG_TABLE_NAME = 'retention_requests' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'retention request evidence is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.completion_protocol_version = 0 THEN
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'new retention requests must use completion protocol one'
          USING ERRCODE = '55000';
      END IF;
      IF OLD.completion_protocol_version <> 0 THEN
        RAISE EXCEPTION 'retention completion protocol cannot be downgraded'
          USING ERRCODE = '55000';
      END IF;
      RAISE EXCEPTION 'legacy retention request evidence is read-only'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.completion_protocol_version <> 1
       OR NEW.organisation_id IS NULL
       OR NEW.subject_project_id IS NULL
       OR NEW.requested_by_name IS NULL
       OR pg_catalog.length(pg_catalog.btrim(NEW.requested_by_name)) NOT BETWEEN 1 AND 256
       OR (NEW.project_id IS NOT NULL
         AND NEW.project_id IS DISTINCT FROM NEW.subject_project_id) THEN
      RAISE EXCEPTION 'invalid retention request completion identity'
        USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.version <> 1
         OR NEW.status <> 'pending'
         OR NEW.completed_at IS NOT NULL
         OR NEW.certificate_text IS NOT NULL THEN
        RAISE EXCEPTION 'retention request must begin pending at version one'
          USING ERRCODE = '55000';
      END IF;
      NEW.created_at := pg_catalog.transaction_timestamp();
      NEW.updated_at := NEW.created_at;
      IF NEW.requested_by IS NULL THEN
        IF NEW.requested_by_name IS DISTINCT FROM 'Valo retention scheduler' THEN
          RAISE EXCEPTION 'scheduler retention request provenance is invalid'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        SELECT EXISTS (
          SELECT 1
          FROM public.users AS actor
          INNER JOIN public.organisation_memberships AS membership
            ON membership.user_id = actor.id
          INNER JOIN public.organisations AS organisation
            ON organisation.id = membership.organisation_id
          INNER JOIN public.role_grants AS grant_row
            ON grant_row.membership_id = membership.id
          WHERE actor.id = NEW.requested_by
            AND actor.status = 'active'
            AND actor.name IS NOT NULL
            AND actor.name = pg_catalog.btrim(actor.name)
            AND actor.name = NEW.requested_by_name
            AND membership.organisation_id = NEW.organisation_id
            AND membership.status = 'active'
            AND membership.delegated_by_membership_id IS NULL
            AND (membership.access_starts_at IS NULL
              OR membership.access_starts_at <= NEW.created_at)
            AND (membership.access_expires_at IS NULL
              OR membership.access_expires_at > NEW.created_at)
            AND organisation.status = 'active'
            AND grant_row.revoked_at IS NULL
            AND (grant_row.starts_at IS NULL
              OR grant_row.starts_at <= NEW.created_at)
            AND (grant_row.expires_at IS NULL
              OR grant_row.expires_at > NEW.created_at)
            AND (
              (organisation.type = 'client' AND grant_row.role IN (
                'client_organisation_owner', 'client_administrator'
              ))
              OR (organisation.type = 'valo'
                AND grant_row.role = 'valo_operations_administrator')
            )
        ) INTO stamp_authorized;
        IF NOT stamp_authorized THEN
          RAISE EXCEPTION 'retention request lacks current named tenant authority'
            USING ERRCODE = '42501';
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    -- ON DELETE SET NULL performs this narrow locator detach without changing
    -- the historical subject or the workflow CAS version.
    IF OLD.project_id IS NOT NULL
       AND NEW.project_id IS NULL
       AND (
         pg_catalog.to_jsonb(NEW) - 'project_id'
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD) - 'project_id'
       )
       AND EXISTS (
         SELECT 1
         FROM public.retention_actions AS action
         WHERE action.organisation_id = NEW.organisation_id
           AND action.retention_request_id = NEW.id
           AND action.subject_project_id = NEW.subject_project_id
           AND action.completion_protocol_version = 1
           AND action.status = 'detached'
           AND action.purge_receipt IS NOT NULL
           AND action.purge_receipt_sha256 ~ '^[0-9a-f]{64}$'
           AND action.purged_at IS NOT NULL
       ) THEN
      RETURN NEW;
    END IF;

    IF OLD.completion_protocol_version <> 1
       OR NEW.version <> OLD.version + 1
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR (
         pg_catalog.to_jsonb(NEW) - ARRAY[
           'status', 'completed_at', 'certificate_text', 'version', 'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         pg_catalog.to_jsonb(OLD) - ARRAY[
           'status', 'completed_at', 'certificate_text', 'version', 'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'retention request transition is stale or rewrites identity'
        USING ERRCODE = '55000';
    END IF;

    NEW.updated_at := pg_catalog.transaction_timestamp();
    IF OLD.status = 'pending' AND NEW.status = 'reconciling' THEN
      IF NEW.completed_at IS NOT NULL
         OR NEW.certificate_text IS NOT NULL
         OR (
           SELECT pg_catalog.count(*)
           FROM public.retention_actions AS action
           WHERE action.organisation_id = NEW.organisation_id
             AND action.retention_request_id = NEW.id
             AND action.subject_project_id = NEW.subject_project_id
             AND action.completion_protocol_version = 1
             AND action.status IN ('detached', 'reconciled', 'certified')
         ) <> 1 THEN
        RAISE EXCEPTION 'invalid retention request reconciliation transition'
          USING ERRCODE = '55000';
      END IF;
    ELSIF OLD.status = 'reconciling' AND NEW.status = 'completed' THEN
       IF NEW.certificate_text IS NULL
          OR NEW.project_id IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM public.projects AS project
            WHERE project.organisation_id = NEW.organisation_id
              AND project.id = NEW.subject_project_id
          )
          OR pg_catalog.length(pg_catalog.btrim(NEW.certificate_text)) NOT BETWEEN 1 AND 512
         OR (
           SELECT pg_catalog.count(*)
           FROM public.retention_actions AS action
           INNER JOIN public.deletion_certificates AS certificate
             ON certificate.retention_action_id = action.id
            AND certificate.organisation_id = action.organisation_id
           WHERE action.organisation_id = NEW.organisation_id
             AND action.retention_request_id = NEW.id
             AND action.subject_project_id = NEW.subject_project_id
              AND action.completion_protocol_version = 1
              AND action.status = 'certified'
              AND action.purge_receipt IS NOT NULL
              AND action.purge_receipt_sha256 ~ '^[0-9a-f]{64}$'
              AND action.purged_at IS NOT NULL
              AND certificate.certificate_number = NEW.certificate_text
         ) <> 1 THEN
        RAISE EXCEPTION 'completed retention request requires certificate evidence'
          USING ERRCODE = '55000';
      END IF;
      NEW.completed_at := NEW.updated_at;
    ELSIF OLD.status IN ('pending', 'reconciling')
          AND NEW.status = 'blocked' THEN
      IF NEW.certificate_text IS NOT NULL
         OR (
           OLD.status = 'reconciling'
           AND (
             SELECT pg_catalog.count(*)
             FROM public.retention_actions AS action
             WHERE action.organisation_id = NEW.organisation_id
               AND action.retention_request_id = NEW.id
               AND action.subject_project_id = NEW.subject_project_id
               AND action.completion_protocol_version = 1
               AND action.status IN ('detached', 'reconciled', 'blocked')
           ) <> 1
         ) THEN
        RAISE EXCEPTION 'blocked retention request cannot carry a certificate'
          USING ERRCODE = '55000';
      END IF;
      NEW.completed_at := NEW.updated_at;
    ELSE
      RAISE EXCEPTION 'retention request transition is not monotonic'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'retention_actions' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'retention action evidence is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.completion_protocol_version = 0 THEN
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'new retention actions must use completion protocol one'
          USING ERRCODE = '55000';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.completion_protocol_version <> 0 THEN
        RAISE EXCEPTION 'retention completion protocol cannot be downgraded'
          USING ERRCODE = '55000';
      END IF;
      RAISE EXCEPTION 'legacy retention action evidence is read-only'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.completion_protocol_version <> 1
       OR (TG_OP = 'UPDATE' AND OLD.completion_protocol_version <> 1) THEN
      RAISE EXCEPTION 'retention completion protocol is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.retention_request_id IS NULL
       OR NEW.subject_project_id IS NULL
       OR NEW.action <> 'delete'
       OR NOT EXISTS (
         SELECT 1
         FROM public.retention_requests AS request
         WHERE request.id = NEW.retention_request_id
           AND request.organisation_id = NEW.organisation_id
           AND request.subject_project_id = NEW.subject_project_id
       ) THEN
      RAISE EXCEPTION 'retention action is not bound to its tenant request subject'
        USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.version <> 1
         OR NEW.status <> 'pending'
         OR NEW.source_manifest IS NOT NULL
         OR NEW.source_manifest_sha256 IS NOT NULL
         OR NEW.reconciliation_manifest IS NOT NULL
         OR NEW.reconciliation_manifest_sha256 IS NOT NULL
         OR NEW.prepared_by_user_id IS NOT NULL
         OR NEW.prepared_by_name IS NOT NULL
         OR NEW.prepared_at IS NOT NULL
         OR NEW.checked_by_user_id IS NOT NULL
         OR NEW.checked_by_name IS NOT NULL
         OR NEW.checked_at IS NOT NULL
         OR NEW.executed_by_name IS NOT NULL THEN
        RAISE EXCEPTION 'retention action must begin pending at version one'
          USING ERRCODE = '55000';
      END IF;
      NEW.created_at := pg_catalog.transaction_timestamp();
      NEW.updated_at := NEW.created_at;
      RETURN NEW;
    END IF;

    IF NEW.version <> OLD.version + 1
       OR (
         pg_catalog.to_jsonb(NEW) - ARRAY[
            'status', 'evidence', 'executed_by_user_id', 'executed_by_name',
            'executed_at',
            'source_manifest', 'source_manifest_sha256',
            'purge_receipt', 'purge_receipt_sha256', 'purged_at',
            'reconciliation_manifest', 'reconciliation_manifest_sha256',
           'prepared_by_user_id', 'prepared_by_name', 'prepared_at',
           'checked_by_user_id', 'checked_by_name', 'checked_at',
           'version', 'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         pg_catalog.to_jsonb(OLD) - ARRAY[
            'status', 'evidence', 'executed_by_user_id', 'executed_by_name',
            'executed_at',
            'source_manifest', 'source_manifest_sha256',
            'purge_receipt', 'purge_receipt_sha256', 'purged_at',
            'reconciliation_manifest', 'reconciliation_manifest_sha256',
           'prepared_by_user_id', 'prepared_by_name', 'prepared_at',
           'checked_by_user_id', 'checked_by_name', 'checked_at',
           'version', 'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'retention action transition is stale or rewrites identity'
        USING ERRCODE = '55000';
    END IF;

    NEW.updated_at := pg_catalog.transaction_timestamp();
    stamp_user_id := NULL;
    stamp_user_name := NULL;
    IF OLD.status = 'pending' AND NEW.status = 'detached' THEN
      stamp_user_id := NEW.executed_by_user_id;
      stamp_user_name := NEW.executed_by_name;
    ELSIF OLD.status = 'detached' AND NEW.status = 'reconciled' THEN
      stamp_user_id := NEW.prepared_by_user_id;
      stamp_user_name := NEW.prepared_by_name;
    ELSIF OLD.status = 'reconciled' AND NEW.status = 'certified' THEN
      stamp_user_id := NEW.checked_by_user_id;
      stamp_user_name := NEW.checked_by_name;
    END IF;

    IF stamp_user_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.users AS actor
        INNER JOIN public.organisation_memberships AS membership
          ON membership.user_id = actor.id
        INNER JOIN public.organisations AS organisation
          ON organisation.id = membership.organisation_id
        INNER JOIN public.role_grants AS grant_row
          ON grant_row.membership_id = membership.id
        WHERE actor.id = stamp_user_id
          AND actor.status = 'active'
          AND actor.name IS NOT NULL
          AND actor.name = pg_catalog.btrim(actor.name)
          AND actor.name = stamp_user_name
          AND membership.organisation_id = NEW.organisation_id
          AND membership.status = 'active'
          AND membership.delegated_by_membership_id IS NULL
          AND (membership.access_starts_at IS NULL
            OR membership.access_starts_at <= NEW.updated_at)
          AND (membership.access_expires_at IS NULL
            OR membership.access_expires_at > NEW.updated_at)
          AND organisation.status = 'active'
          AND grant_row.revoked_at IS NULL
          AND (grant_row.starts_at IS NULL
            OR grant_row.starts_at <= NEW.updated_at)
          AND (grant_row.expires_at IS NULL
            OR grant_row.expires_at > NEW.updated_at)
          AND (
            (organisation.type = 'client' AND grant_row.role IN (
              'client_organisation_owner', 'client_administrator'
            ))
            OR (organisation.type = 'valo'
              AND grant_row.role = 'valo_operations_administrator')
          )
      ) INTO stamp_authorized;
      IF NOT stamp_authorized THEN
        RAISE EXCEPTION 'retention completion stamp lacks current named tenant authority'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF OLD.status = 'pending' AND NEW.status = 'detached' THEN
      IF NEW.source_manifest IS NULL
         OR NEW.source_manifest_sha256 IS NULL
         OR pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(NEW.source_manifest, 'UTF8')
              ),
              'hex'
            ) IS DISTINCT FROM NEW.source_manifest_sha256
         OR NEW.evidence IS NULL
         OR NEW.executed_by_user_id IS NULL
         OR NEW.executed_by_name IS NULL
         OR NEW.reconciliation_manifest IS NOT NULL
         OR NEW.reconciliation_manifest_sha256 IS NOT NULL
         OR NEW.purge_receipt IS NOT NULL
         OR NEW.purge_receipt_sha256 IS NOT NULL
         OR NEW.purged_at IS NOT NULL
         OR NEW.prepared_by_user_id IS NOT NULL
         OR NEW.prepared_by_name IS NOT NULL
         OR NEW.prepared_at IS NOT NULL
         OR NEW.checked_by_user_id IS NOT NULL
         OR NEW.checked_by_name IS NOT NULL
         OR NEW.checked_at IS NOT NULL THEN
        RAISE EXCEPTION 'invalid retention detach transition'
          USING ERRCODE = '55000';
      END IF;
      source_manifest_json := NEW.source_manifest::jsonb;
      IF pg_catalog.jsonb_typeof(source_manifest_json)
           IS DISTINCT FROM 'object'
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_object_keys(
             CASE
               WHEN pg_catalog.jsonb_typeof(source_manifest_json) = 'object'
                 THEN source_manifest_json
               ELSE '{}'::jsonb
             END
           ) AS root_key(value)
         ) <> 14
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_object_keys(
             CASE
               WHEN pg_catalog.jsonb_typeof(source_manifest_json) = 'object'
                 THEN source_manifest_json
               ELSE '{}'::jsonb
             END
           ) AS root_key(value)
           WHERE root_key.value NOT IN (
             'schema', 'organisationId', 'retentionRequestId',
             'retentionActionId', 'subjectProjectId', 'requestVersion',
             'projectVersion', 'projectStatus', 'capturedAt',
             'idempotencyKeySha256', 'attestationSha256', 'categories',
             'storageObjects', 'retainedCategories'
           )
         )
         OR pg_catalog.jsonb_typeof(source_manifest_json->'categories')
              IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_typeof(source_manifest_json->'storageObjects')
              IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_typeof(
              source_manifest_json->'retainedCategories'
            ) IS DISTINCT FROM 'array'
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             source_manifest_json->'categories'
           ) AS entry(value)
           WHERE pg_catalog.jsonb_typeof(entry.value)
                   IS DISTINCT FROM 'object'
              OR (
                SELECT pg_catalog.count(*)
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(entry.value) = 'object'
                      THEN entry.value
                    ELSE '{}'::jsonb
                  END
                ) AS nested_key(value)
              ) <> 3
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(entry.value) = 'object'
                      THEN entry.value
                    ELSE '{}'::jsonb
                  END
                ) AS nested_key(value)
                WHERE nested_key.value NOT IN (
                  'category', 'count', 'identitiesSha256'
                )
              )
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             source_manifest_json->'storageObjects'
           ) AS entry(value)
           WHERE pg_catalog.jsonb_typeof(entry.value)
                   IS DISTINCT FROM 'object'
              OR (
                SELECT pg_catalog.count(*)
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(entry.value) = 'object'
                      THEN entry.value
                    ELSE '{}'::jsonb
                  END
                ) AS nested_key(value)
              ) <> 2
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(entry.value) = 'object'
                      THEN entry.value
                    ELSE '{}'::jsonb
                  END
                ) AS nested_key(value)
                WHERE nested_key.value NOT IN (
                  'objectPathSha256', 'sourceKind'
                )
              )
         )
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             source_manifest_json->'retainedCategories'
           ) AS entry(value)
           WHERE pg_catalog.jsonb_typeof(entry.value)
                   IS DISTINCT FROM 'object'
              OR (
                SELECT pg_catalog.count(*)
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(entry.value) = 'object'
                      THEN entry.value
                    ELSE '{}'::jsonb
                  END
                ) AS nested_key(value)
              ) <> 3
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(entry.value) = 'object'
                      THEN entry.value
                    ELSE '{}'::jsonb
                  END
                ) AS nested_key(value)
                WHERE nested_key.value NOT IN ('category', 'reason', 'count')
              )
         ) THEN
        RAISE EXCEPTION 'retention source manifest contains an unknown field'
          USING ERRCODE = '55000';
      END IF;
      NEW.executed_at := NEW.updated_at;
    ELSIF OLD.status = 'detached' AND NEW.status = 'detached' THEN
      SELECT owner_role.rolname
        INTO purge_function_owner
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      INNER JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
      WHERE namespace.nspname = 'valo_security'
        AND procedure.proname = 'purge_retention_project'
      LIMIT 1;

      NEW.purged_at := NEW.updated_at;
      IF purge_function_owner IS NULL
         OR CURRENT_USER::text IS DISTINCT FROM purge_function_owner
         OR OLD.purge_receipt IS NOT NULL
         OR NEW.purge_receipt IS NULL
         OR NEW.purge_receipt_sha256 IS NULL
         OR pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(NEW.purge_receipt, 'UTF8')
              ),
              'hex'
            ) IS DISTINCT FROM NEW.purge_receipt_sha256
         OR (
           pg_catalog.to_jsonb(NEW) - ARRAY[
             'purge_receipt', 'purge_receipt_sha256', 'purged_at',
             'version', 'updated_at'
           ]::text[]
         ) IS DISTINCT FROM (
           pg_catalog.to_jsonb(OLD) - ARRAY[
             'purge_receipt', 'purge_receipt_sha256', 'purged_at',
             'version', 'updated_at'
           ]::text[]
         ) THEN
        RAISE EXCEPTION 'only the owner-held purge may stamp purge evidence'
          USING ERRCODE = '42501';
      END IF;
      purge_receipt_json := NEW.purge_receipt::jsonb;
      IF purge_receipt_json->>'schema'
           IS DISTINCT FROM 'valo.retention-project-purge-receipt/v1'
         OR purge_receipt_json->>'organisationId'
           IS DISTINCT FROM NEW.organisation_id::text
         OR purge_receipt_json->>'retentionRequestId'
           IS DISTINCT FROM NEW.retention_request_id::text
         OR purge_receipt_json->>'retentionActionId'
           IS DISTINCT FROM NEW.id::text
         OR purge_receipt_json->>'subjectProjectId'
           IS DISTINCT FROM NEW.subject_project_id::text
         OR purge_receipt_json->>'sourceManifestSha256'
           IS DISTINCT FROM NEW.source_manifest_sha256
         OR (purge_receipt_json->>'actionVersionBefore')::integer
           IS DISTINCT FROM OLD.version
         OR (purge_receipt_json->>'actionVersionAfter')::integer
           IS DISTINCT FROM NEW.version
         OR (purge_receipt_json->>'deletedProjectRows')::integer
           IS DISTINCT FROM 1
         OR (purge_receipt_json->>'deletedDocumentVersionSnapshotRows')::integer
           IS NULL
         OR (purge_receipt_json->>'deletedDocumentVersionSnapshotRows')::integer < 0
         OR (purge_receipt_json->>'detachedLegalHoldRows')::integer IS NULL
         OR (purge_receipt_json->>'detachedLegalHoldRows')::integer < 0
         OR (purge_receipt_json->>'detachedOrderRows')::integer IS NULL
         OR (purge_receipt_json->>'detachedOrderRows')::integer < 0
         OR (purge_receipt_json->>'detachedEntitlementUsageRows')::integer
           IS NULL
         OR (purge_receipt_json->>'detachedEntitlementUsageRows')::integer < 0
         OR pg_catalog.date_trunc(
              'milliseconds',
              (purge_receipt_json->>'purgedAt')::timestamptz
            ) IS DISTINCT FROM pg_catalog.date_trunc(
              'milliseconds', NEW.purged_at
            )
         OR purge_receipt_json->>'method'
           IS DISTINCT FROM 'owner_held_manifest_bound_project_purge'
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_object_keys(
             CASE
               WHEN pg_catalog.jsonb_typeof(purge_receipt_json) = 'object'
                 THEN purge_receipt_json
               ELSE '{}'::jsonb
             END
           ) AS root_key(value)
         ) <> 15
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_object_keys(
             CASE
               WHEN pg_catalog.jsonb_typeof(purge_receipt_json) = 'object'
                 THEN purge_receipt_json
               ELSE '{}'::jsonb
             END
           ) AS root_key(value)
           WHERE root_key.value NOT IN (
             'schema', 'organisationId', 'retentionRequestId',
             'retentionActionId', 'subjectProjectId',
             'sourceManifestSha256', 'actionVersionBefore',
             'actionVersionAfter', 'deletedProjectRows',
             'deletedDocumentVersionSnapshotRows', 'detachedLegalHoldRows',
             'detachedOrderRows', 'detachedEntitlementUsageRows',
             'purgedAt', 'method'
           )
         ) THEN
        RAISE EXCEPTION 'owner purge receipt is not bound to the action authority'
          USING ERRCODE = '55000';
      END IF;
    ELSIF OLD.status = 'detached' AND NEW.status = 'reconciled' THEN
      IF NEW.source_manifest IS DISTINCT FROM OLD.source_manifest
         OR NEW.source_manifest_sha256 IS DISTINCT FROM OLD.source_manifest_sha256
         OR NEW.purge_receipt IS DISTINCT FROM OLD.purge_receipt
         OR NEW.purge_receipt_sha256 IS DISTINCT FROM OLD.purge_receipt_sha256
         OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
         OR NEW.purge_receipt IS NULL
         OR EXISTS (
           SELECT 1
           FROM public.projects AS project
           WHERE project.organisation_id = NEW.organisation_id
             AND project.id = NEW.subject_project_id
         )
         OR NOT EXISTS (
           SELECT 1
           FROM public.retention_requests AS request
           WHERE request.id = NEW.retention_request_id
             AND request.organisation_id = NEW.organisation_id
             AND request.subject_project_id = NEW.subject_project_id
             AND request.project_id IS NULL
             AND request.status = 'reconciling'
         )
         OR NEW.evidence IS DISTINCT FROM OLD.evidence
         OR NEW.executed_by_user_id IS DISTINCT FROM OLD.executed_by_user_id
         OR NEW.executed_by_name IS DISTINCT FROM OLD.executed_by_name
         OR NEW.executed_at IS DISTINCT FROM OLD.executed_at
         OR NEW.reconciliation_manifest IS NULL
         OR NEW.reconciliation_manifest_sha256 IS NULL
         OR pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(NEW.reconciliation_manifest, 'UTF8')
              ),
              'hex'
            ) IS DISTINCT FROM NEW.reconciliation_manifest_sha256
         OR NEW.prepared_by_user_id IS NULL
         OR NEW.prepared_by_name IS NULL
         OR NEW.checked_by_user_id IS NOT NULL
         OR NEW.checked_by_name IS NOT NULL
         OR NEW.checked_at IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM public.retention_action_storage_events AS binding
           WHERE binding.organisation_id = NEW.organisation_id
             AND binding.retention_action_id = NEW.id
             AND (
               binding.terminal_disposition IS NULL
               OR binding.terminal_disposition NOT IN ('deleted', 'already_absent')
             )
         ) THEN
        RAISE EXCEPTION 'invalid retention reconciliation transition'
          USING ERRCODE = '55000';
      END IF;
      reconciliation_manifest_json := NEW.reconciliation_manifest::jsonb;
      IF reconciliation_manifest_json->>'schema'
           IS DISTINCT FROM 'valo.retention-completion-reconciliation-manifest/v1'
         OR reconciliation_manifest_json->>'organisationId'
           IS DISTINCT FROM NEW.organisation_id::text
         OR reconciliation_manifest_json->>'retentionRequestId'
           IS DISTINCT FROM NEW.retention_request_id::text
         OR reconciliation_manifest_json->>'retentionActionId'
           IS DISTINCT FROM NEW.id::text
         OR reconciliation_manifest_json->>'subjectProjectId'
           IS DISTINCT FROM NEW.subject_project_id::text
         OR reconciliation_manifest_json->>'sourceManifestSha256'
           IS DISTINCT FROM NEW.source_manifest_sha256
         OR reconciliation_manifest_json->>'purgeReceiptSha256'
           IS DISTINCT FROM NEW.purge_receipt_sha256
         OR pg_catalog.date_trunc(
              'milliseconds',
              (reconciliation_manifest_json->>'purgedAt')::timestamptz
            ) IS DISTINCT FROM pg_catalog.date_trunc(
              'milliseconds', NEW.purged_at
            )
         OR reconciliation_manifest_json->>'idempotencyKeySha256'
           !~ '^[0-9a-f]{64}$'
         OR reconciliation_manifest_json->>'attestationSha256'
           !~ '^[0-9a-f]{64}$'
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_object_keys(
             CASE
               WHEN pg_catalog.jsonb_typeof(reconciliation_manifest_json)
                      = 'object'
                 THEN reconciliation_manifest_json
               ELSE '{}'::jsonb
             END
           ) AS root_key(value)
         ) <> 12
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_object_keys(
             CASE
               WHEN pg_catalog.jsonb_typeof(reconciliation_manifest_json)
                      = 'object'
                 THEN reconciliation_manifest_json
               ELSE '{}'::jsonb
             END
           ) AS root_key(value)
           WHERE root_key.value NOT IN (
             'schema', 'organisationId', 'retentionRequestId',
             'retentionActionId', 'subjectProjectId',
             'sourceManifestSha256', 'purgeReceiptSha256', 'purgedAt',
             'reconciledAt', 'idempotencyKeySha256',
             'attestationSha256', 'events'
           )
         )
         OR pg_catalog.jsonb_typeof(
              reconciliation_manifest_json->'events'
            ) IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_array_length(
              reconciliation_manifest_json->'events'
            ) > 1000
         OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             reconciliation_manifest_json->'events'
           ) AS event(value)
           WHERE pg_catalog.jsonb_typeof(event.value)
                   IS DISTINCT FROM 'object'
              OR (
                SELECT pg_catalog.count(*)
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(event.value) = 'object'
                      THEN event.value
                    ELSE '{}'::jsonb
                  END
                ) AS event_key(value)
              ) <> 7
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_object_keys(
                  CASE
                    WHEN pg_catalog.jsonb_typeof(event.value) = 'object'
                      THEN event.value
                    ELSE '{}'::jsonb
                  END
                ) AS event_key(value)
                WHERE event_key.value NOT IN (
                  'storageEventId', 'requestSha256', 'objectPathSha256',
                  'boundEventVersion', 'terminalDisposition',
                  'terminalEventVersion', 'terminalAt'
                )
              )
         )
         OR pg_catalog.date_trunc(
              'milliseconds',
              (reconciliation_manifest_json->>'reconciledAt')::timestamptz
            ) IS DISTINCT FROM pg_catalog.date_trunc(
              'milliseconds', NEW.updated_at
            )
         OR EXISTS (
           WITH claimed AS (
             SELECT event.value->>'storageEventId' AS storage_event_id,
                    event.value->>'requestSha256' AS request_sha256,
                    event.value->>'objectPathSha256' AS object_path_sha256,
                    (event.value->>'boundEventVersion')::integer
                      AS bound_event_version,
                    event.value->>'terminalDisposition'
                      AS terminal_disposition,
                    (event.value->>'terminalEventVersion')::integer
                      AS terminal_event_version,
                    (event.value->>'terminalAt')::timestamptz AS terminal_at
             FROM pg_catalog.jsonb_array_elements(
               reconciliation_manifest_json->'events'
             ) AS event(value)
           ), actual AS (
             SELECT binding.storage_event_id::text AS storage_event_id,
                    binding.request_sha256,
                    binding.object_path_sha256,
                    binding.bound_event_version,
                    binding.terminal_disposition,
                    binding.terminal_event_version,
                    binding.terminal_at
             FROM public.retention_action_storage_events AS binding
             WHERE binding.organisation_id = NEW.organisation_id
               AND binding.retention_action_id = NEW.id
           )
           SELECT 1
           FROM actual
           FULL OUTER JOIN claimed USING (storage_event_id)
           WHERE actual.storage_event_id IS NULL
              OR claimed.storage_event_id IS NULL
              OR actual.request_sha256 IS DISTINCT FROM claimed.request_sha256
              OR actual.object_path_sha256
                   IS DISTINCT FROM claimed.object_path_sha256
              OR actual.bound_event_version
                   IS DISTINCT FROM claimed.bound_event_version
              OR actual.terminal_disposition
                   IS DISTINCT FROM claimed.terminal_disposition
              OR actual.terminal_event_version
                   IS DISTINCT FROM claimed.terminal_event_version
              OR pg_catalog.date_trunc('milliseconds', actual.terminal_at)
                   IS DISTINCT FROM pg_catalog.date_trunc(
                     'milliseconds', claimed.terminal_at
                   )
         )
         OR (
           SELECT pg_catalog.count(*)
           FROM pg_catalog.jsonb_array_elements(
             reconciliation_manifest_json->'events'
           ) AS event(value)
         ) <> (
           SELECT pg_catalog.count(DISTINCT event.value->>'storageEventId')
           FROM pg_catalog.jsonb_array_elements(
             reconciliation_manifest_json->'events'
           ) AS event(value)
         ) THEN
        RAISE EXCEPTION 'reconciliation manifest does not exactly bind terminal storage evidence'
          USING ERRCODE = '55000';
      END IF;
      NEW.prepared_at := NEW.updated_at;
    ELSIF OLD.status = 'reconciled' AND NEW.status = 'certified' THEN
      IF NEW.source_manifest IS DISTINCT FROM OLD.source_manifest
         OR NEW.source_manifest_sha256 IS DISTINCT FROM OLD.source_manifest_sha256
         OR NEW.purge_receipt IS DISTINCT FROM OLD.purge_receipt
         OR NEW.purge_receipt_sha256 IS DISTINCT FROM OLD.purge_receipt_sha256
         OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
         OR NEW.purge_receipt IS NULL
         OR EXISTS (
           SELECT 1
           FROM public.projects AS project
           WHERE project.organisation_id = NEW.organisation_id
             AND project.id = NEW.subject_project_id
         )
         OR NOT EXISTS (
           SELECT 1
           FROM public.retention_requests AS request
           WHERE request.id = NEW.retention_request_id
             AND request.organisation_id = NEW.organisation_id
             AND request.subject_project_id = NEW.subject_project_id
             AND request.project_id IS NULL
             AND request.status = 'reconciling'
         )
         OR NEW.reconciliation_manifest IS DISTINCT FROM OLD.reconciliation_manifest
         OR NEW.reconciliation_manifest_sha256 IS DISTINCT FROM OLD.reconciliation_manifest_sha256
         OR NEW.prepared_by_user_id IS DISTINCT FROM OLD.prepared_by_user_id
         OR NEW.prepared_by_name IS DISTINCT FROM OLD.prepared_by_name
         OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at
         OR NEW.evidence IS DISTINCT FROM OLD.evidence
         OR NEW.executed_by_user_id IS DISTINCT FROM OLD.executed_by_user_id
         OR NEW.executed_by_name IS DISTINCT FROM OLD.executed_by_name
         OR NEW.executed_at IS DISTINCT FROM OLD.executed_at
         OR NEW.checked_by_user_id IS NULL
         OR NEW.checked_by_name IS NULL
         OR NEW.checked_by_user_id = NEW.prepared_by_user_id THEN
        RAISE EXCEPTION 'invalid retention certification transition'
          USING ERRCODE = '55000';
      END IF;
      NEW.checked_at := NEW.updated_at;
    ELSIF OLD.status IN ('pending', 'detached', 'reconciled')
          AND NEW.status = 'blocked' THEN
      IF (
        pg_catalog.to_jsonb(NEW) - ARRAY['status', 'version', 'updated_at']::text[]
      ) IS DISTINCT FROM (
        pg_catalog.to_jsonb(OLD) - ARRAY['status', 'version', 'updated_at']::text[]
      ) THEN
        RAISE EXCEPTION 'blocking cannot rewrite retention evidence'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'retention action transition is not monotonic'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'retention_action_storage_events' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'retention storage binding is immutable'
        USING ERRCODE = '55000';
    END IF;

    SELECT action.completion_protocol_version, action.organisation_id,
           action.subject_project_id, action.status
      INTO action_completion_protocol_version, action_organisation_id,
           action_subject_project_id, action_status
    FROM public.retention_actions AS action
    WHERE action.id = NEW.retention_action_id;

    SELECT event.organisation_id, event.project_id,
           event.status, event.version,
           event.storage_terminal_at, event.payload
      INTO event_organisation_id, event_project_id,
           event_status, event_version,
           event_terminal_at, event_payload
    FROM public.notification_events AS event
    WHERE event.id = NEW.storage_event_id
      AND event.channel = 'internal_storage'
      AND event.template = 'valo.storage-deletion-intent/v1';

    IF action_completion_protocol_version IS DISTINCT FROM 1
       OR action_organisation_id IS DISTINCT FROM NEW.organisation_id
       OR action_subject_project_id IS NULL
       OR action_status NOT IN ('pending', 'detached')
       OR event_organisation_id IS DISTINCT FROM NEW.organisation_id
       OR event_project_id IS NOT NULL
       OR event_payload IS NULL
       OR event_payload::jsonb->>'schema'
            IS DISTINCT FROM 'valo.storage-deletion-intent/v1'
       OR event_payload::jsonb->>'organisationId'
            IS DISTINCT FROM NEW.organisation_id::text
       OR event_payload::jsonb->>'requestSha256' IS DISTINCT FROM NEW.request_sha256
       OR event_payload::jsonb->>'projectId' IS DISTINCT FROM action_subject_project_id::text
       OR event_payload::jsonb->>'aggregateType'
            IS DISTINCT FROM 'project_retention'
       OR event_payload::jsonb->>'aggregateId'
            IS DISTINCT FROM NEW.retention_action_id::text
       OR event_payload::jsonb->>'reason'
            IS DISTINCT FROM 'retention_completion'
       OR event_payload::jsonb->>'maximumAttempts' IS DISTINCT FROM '5'
       OR event_payload::jsonb->>'objectPath' IS NULL
       OR event_payload::jsonb->>'objectPath'
            NOT LIKE '/objects/tenants/' || NEW.organisation_id::text || '/%'
       OR pg_catalog.encode(
            pg_catalog.sha256(
              pg_catalog.convert_to(
                event_payload::jsonb->>'objectPath', 'UTF8'
              )
            ),
            'hex'
          ) IS DISTINCT FROM NEW.object_path_sha256
       OR pg_catalog.encode(
            pg_catalog.sha256(
              pg_catalog.convert_to(
                '{"aggregateId":' || pg_catalog.to_json(
                  event_payload::jsonb->>'aggregateId'
                )::text || ',"aggregateType":' || pg_catalog.to_json(
                  event_payload::jsonb->>'aggregateType'
                )::text || ',"maximumAttempts":5,"objectPath":' ||
                pg_catalog.to_json(
                  event_payload::jsonb->>'objectPath'
                )::text || ',"organisationId":' || pg_catalog.to_json(
                  event_payload::jsonb->>'organisationId'
                )::text || ',"projectId":' || pg_catalog.to_json(
                  event_payload::jsonb->>'projectId'
                )::text || ',"reason":' || pg_catalog.to_json(
                  event_payload::jsonb->>'reason'
                )::text || ',"requestedAt":' || pg_catalog.to_json(
                  event_payload::jsonb->>'requestedAt'
                )::text || ',"schema":' || pg_catalog.to_json(
                  event_payload::jsonb->>'schema'
                )::text || '}',
                'UTF8'
              )
            ),
            'hex'
          ) IS DISTINCT FROM NEW.request_sha256
       OR event_payload IS DISTINCT FROM
            '{"aggregateId":' || pg_catalog.to_json(
              event_payload::jsonb->>'aggregateId'
            )::text || ',"aggregateType":' || pg_catalog.to_json(
              event_payload::jsonb->>'aggregateType'
            )::text || ',"maximumAttempts":5,"objectPath":' ||
            pg_catalog.to_json(
              event_payload::jsonb->>'objectPath'
            )::text || ',"organisationId":' || pg_catalog.to_json(
              event_payload::jsonb->>'organisationId'
            )::text || ',"projectId":' || pg_catalog.to_json(
              event_payload::jsonb->>'projectId'
            )::text || ',"reason":' || pg_catalog.to_json(
              event_payload::jsonb->>'reason'
            )::text || ',"requestSha256":' || pg_catalog.to_json(
              event_payload::jsonb->>'requestSha256'
            )::text || ',"requestedAt":' || pg_catalog.to_json(
              event_payload::jsonb->>'requestedAt'
            )::text || ',"schema":' || pg_catalog.to_json(
              event_payload::jsonb->>'schema'
            )::text || '}' THEN
      RAISE EXCEPTION 'retention storage binding does not match its action and event'
        USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.version <> 1
         OR event_status <> 'queued'
         OR event_version <> 1
         OR event_terminal_at IS NOT NULL
         OR NEW.terminal_disposition IS NOT NULL
         OR NEW.terminal_event_version IS NOT NULL
         OR NEW.terminal_at IS NOT NULL THEN
        RAISE EXCEPTION 'retention storage binding must begin unterminated at version one'
          USING ERRCODE = '55000';
      END IF;
      NEW.bound_event_version := event_version;
      NEW.created_at := pg_catalog.transaction_timestamp();
      NEW.updated_at := NEW.created_at;
      RETURN NEW;
    END IF;

    IF NEW.version <> OLD.version + 1
       OR OLD.terminal_disposition IS NOT NULL
       OR (
         pg_catalog.to_jsonb(NEW) - ARRAY[
           'terminal_disposition', 'terminal_event_version', 'terminal_at',
           'version', 'updated_at'
         ]::text[]
       ) IS DISTINCT FROM (
         pg_catalog.to_jsonb(OLD) - ARRAY[
           'terminal_disposition', 'terminal_event_version', 'terminal_at',
           'version', 'updated_at'
         ]::text[]
       ) THEN
      RAISE EXCEPTION 'invalid or stale retention storage terminal transition'
        USING ERRCODE = '55000';
    END IF;

    NEW.terminal_event_version := event_version;
    NEW.terminal_at := event_terminal_at;

    SELECT attempt.status, attempt.response_code
      INTO latest_attempt_status, latest_response_code
    FROM public.notification_attempts AS attempt
    WHERE attempt.organisation_id = NEW.organisation_id
      AND attempt.notification_event_id = NEW.storage_event_id
    ORDER BY attempt.attempt_number DESC
    LIMIT 1;

    IF NOT (
      (event_status = 'completed'
        AND latest_attempt_status = 'completed'
        AND latest_response_code = NEW.terminal_disposition
        AND NEW.terminal_disposition IN ('deleted', 'already_absent'))
      OR (event_status = 'cancelled'
        AND latest_attempt_status = 'cancelled_referenced'
        AND NEW.terminal_disposition = 'cancelled_referenced')
      OR (event_status = 'resolved'
        AND NEW.terminal_disposition = 'accepted_unresolved')
    ) THEN
      RAISE EXCEPTION 'storage disposition does not match the terminal event receipt'
        USING ERRCODE = '55000';
    END IF;
    NEW.updated_at := pg_catalog.transaction_timestamp();
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'deletion_certificates' THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'deletion certificate is immutable'
        USING ERRCODE = '55000';
    END IF;

    SELECT action.completion_protocol_version, action.organisation_id,
           action.retention_request_id,
           action.subject_project_id, action.status,
           action.source_manifest_sha256,
           action.purge_receipt_sha256, action.purged_at,
           action.reconciliation_manifest_sha256,
           action.prepared_by_user_id, action.prepared_by_name,
           action.prepared_at, action.checked_by_user_id,
           action.checked_by_name, action.checked_at
      INTO action_completion_protocol_version, action_organisation_id,
           action_retention_request_id,
           action_subject_project_id, action_status,
           action_source_manifest_sha256,
           action_purge_receipt_sha256, action_purged_at,
           action_reconciliation_manifest_sha256,
           action_prepared_by_user_id, action_prepared_by_name,
           action_prepared_at, action_checked_by_user_id,
           action_checked_by_name, action_checked_at
    FROM public.retention_actions AS action
    WHERE action.id = NEW.retention_action_id;

    IF action_completion_protocol_version IS DISTINCT FROM 1
       OR action_organisation_id IS DISTINCT FROM NEW.organisation_id
       OR action_subject_project_id IS NULL
       OR action_status <> 'certified'
       OR action_source_manifest_sha256 IS NULL
       OR action_purge_receipt_sha256 IS NULL
       OR action_purged_at IS NULL
       OR action_reconciliation_manifest_sha256 IS NULL
       OR action_prepared_by_user_id IS NULL
       OR action_checked_by_user_id IS NULL
       OR action_checked_by_user_id = action_prepared_by_user_id
       OR NOT EXISTS (
         SELECT 1
         FROM public.users AS actor
         INNER JOIN public.organisation_memberships AS membership
           ON membership.user_id = actor.id
         INNER JOIN public.organisations AS organisation
           ON organisation.id = membership.organisation_id
         INNER JOIN public.role_grants AS grant_row
           ON grant_row.membership_id = membership.id
         WHERE actor.id = action_checked_by_user_id
           AND actor.status = 'active'
           AND actor.name IS NOT NULL
           AND actor.name = pg_catalog.btrim(actor.name)
           AND actor.name = action_checked_by_name
           AND membership.organisation_id = NEW.organisation_id
           AND membership.status = 'active'
           AND membership.delegated_by_membership_id IS NULL
           AND (membership.access_starts_at IS NULL
             OR membership.access_starts_at <= pg_catalog.transaction_timestamp())
           AND (membership.access_expires_at IS NULL
             OR membership.access_expires_at > pg_catalog.transaction_timestamp())
           AND organisation.status = 'active'
           AND grant_row.revoked_at IS NULL
           AND (grant_row.starts_at IS NULL
             OR grant_row.starts_at <= pg_catalog.transaction_timestamp())
           AND (grant_row.expires_at IS NULL
             OR grant_row.expires_at > pg_catalog.transaction_timestamp())
           AND (
             (organisation.type = 'client' AND grant_row.role IN (
               'client_organisation_owner', 'client_administrator'
             ))
             OR (organisation.type = 'valo'
               AND grant_row.role = 'valo_operations_administrator')
           )
       )
       OR NEW.signed_by_user_id IS DISTINCT FROM action_checked_by_user_id
       OR NEW.signed_by_name IS DISTINCT FROM action_checked_by_name
       OR NEW.scope_manifest_hash IS DISTINCT FROM action_source_manifest_sha256
       OR NEW.certificate_manifest IS NULL
       OR NEW.certificate_manifest_sha256 IS NULL
       OR pg_catalog.encode(
            pg_catalog.sha256(
              pg_catalog.convert_to(NEW.certificate_manifest, 'UTF8')
            ),
            'hex'
          ) IS DISTINCT FROM NEW.certificate_manifest_sha256
       OR NOT EXISTS (
         SELECT 1
         FROM public.retention_requests AS request
         WHERE request.id = action_retention_request_id
           AND request.organisation_id = action_organisation_id
           AND request.subject_project_id = action_subject_project_id
           AND request.project_id IS NULL
           AND request.completion_protocol_version = 1
           AND request.status = 'reconciling'
       )
       OR EXISTS (
         SELECT 1
         FROM public.projects AS project
         WHERE project.organisation_id = action_organisation_id
           AND project.id = action_subject_project_id
       )
       OR EXISTS (
         SELECT 1
         FROM public.retention_action_storage_events AS binding
         WHERE binding.organisation_id = NEW.organisation_id
           AND binding.retention_action_id = NEW.retention_action_id
           AND (
             binding.terminal_disposition IS NULL
             OR binding.terminal_disposition NOT IN ('deleted', 'already_absent')
           )
       ) THEN
      RAISE EXCEPTION 'deletion certificate does not match certified retention evidence'
        USING ERRCODE = '55000';
    END IF;
    certificate_manifest_json := NEW.certificate_manifest::jsonb;
    IF certificate_manifest_json->>'schema'
         IS DISTINCT FROM 'valo.retention-completion-certificate-manifest/v1'
       OR certificate_manifest_json->>'organisationId'
         IS DISTINCT FROM action_organisation_id::text
       OR certificate_manifest_json->>'retentionRequestId'
         IS DISTINCT FROM action_retention_request_id::text
       OR certificate_manifest_json->>'retentionActionId'
         IS DISTINCT FROM NEW.retention_action_id::text
       OR certificate_manifest_json->>'subjectProjectId'
         IS DISTINCT FROM action_subject_project_id::text
       OR certificate_manifest_json->>'sourceManifestSha256'
         IS DISTINCT FROM action_source_manifest_sha256
       OR certificate_manifest_json->>'purgeReceiptSha256'
         IS DISTINCT FROM action_purge_receipt_sha256
       OR pg_catalog.date_trunc(
            'milliseconds',
            (certificate_manifest_json->>'purgedAt')::timestamptz
          ) IS DISTINCT FROM pg_catalog.date_trunc(
            'milliseconds', action_purged_at
          )
       OR certificate_manifest_json->>'reconciliationManifestSha256'
         IS DISTINCT FROM action_reconciliation_manifest_sha256
       OR certificate_manifest_json->>'preparedByUserId'
         IS DISTINCT FROM action_prepared_by_user_id::text
       OR certificate_manifest_json->>'preparedByName'
         IS DISTINCT FROM action_prepared_by_name
       OR pg_catalog.date_trunc(
            'milliseconds',
            (certificate_manifest_json->>'preparedAt')::timestamptz
          ) IS DISTINCT FROM pg_catalog.date_trunc(
            'milliseconds', action_prepared_at
          )
       OR certificate_manifest_json->>'checkedByUserId'
         IS DISTINCT FROM action_checked_by_user_id::text
       OR certificate_manifest_json->>'checkedByName'
         IS DISTINCT FROM action_checked_by_name
       OR pg_catalog.date_trunc(
            'milliseconds',
            (certificate_manifest_json->>'checkedAt')::timestamptz
          ) IS DISTINCT FROM pg_catalog.date_trunc(
            'milliseconds', action_checked_at
          )
       OR certificate_manifest_json->>'method'
         IS DISTINCT FROM 'durable_two_phase_detach_reconcile_certify'
       OR (
         SELECT pg_catalog.count(*)
         FROM pg_catalog.jsonb_object_keys(
           CASE
             WHEN pg_catalog.jsonb_typeof(certificate_manifest_json) = 'object'
               THEN certificate_manifest_json
             ELSE '{}'::jsonb
           END
         ) AS root_key(value)
       ) <> 18
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(
           CASE
             WHEN pg_catalog.jsonb_typeof(certificate_manifest_json) = 'object'
               THEN certificate_manifest_json
             ELSE '{}'::jsonb
           END
         ) AS root_key(value)
         WHERE root_key.value NOT IN (
           'schema', 'organisationId', 'retentionRequestId',
           'retentionActionId', 'subjectProjectId',
           'sourceManifestSha256', 'purgeReceiptSha256', 'purgedAt',
           'reconciliationManifestSha256', 'preparedByUserId',
           'preparedByName', 'preparedAt', 'checkedByUserId',
           'checkedByName', 'checkedAt', 'idempotencyKeySha256',
           'attestationSha256', 'method'
         )
       ) THEN
      RAISE EXCEPTION 'canonical deletion certificate manifest is invalid'
        USING ERRCODE = '55000';
    END IF;
    NEW.completed_at := action_checked_at;
    NEW.created_at := pg_catalog.transaction_timestamp();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'unsupported retention completion table %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  valo_security.enforce_retention_completion_transition()
  FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER retention_request_completion_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.retention_requests
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_retention_completion_transition();
--> statement-breakpoint
CREATE TRIGGER retention_action_completion_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.retention_actions
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_retention_completion_transition();
--> statement-breakpoint
CREATE TRIGGER retention_action_storage_event_completion_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.retention_action_storage_events
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_retention_completion_transition();
--> statement-breakpoint
CREATE TRIGGER deletion_certificate_completion_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.deletion_certificates
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_retention_completion_transition();
--> statement-breakpoint

-- Project deletion is no longer a general runtime table privilege. This
-- owner-held primitive can remove exactly one manifest-bound project graph
-- only after the protocol-one action and request have reached the detach
-- boundary. It verifies the canonical manifest bytes and every relational
-- identity that will be removed, preserves released holds and accounting rows,
-- and deletes the otherwise-restricting immutable extraction snapshots before
-- the project cascade. Vault-backed document-version references remain a hard
-- foreign-key blocker rather than being silently erased.
CREATE FUNCTION valo_security.purge_retention_project(
  p_organisation_id uuid,
  p_retention_request_id uuid,
  p_retention_action_id uuid,
  p_subject_project_id uuid,
  p_source_manifest_sha256 text,
  p_expected_action_version integer
)
RETURNS TABLE (
  deleted_project_rows integer,
  deleted_document_version_snapshot_rows integer,
  detached_legal_hold_rows integer,
  detached_order_rows integer,
  detached_entitlement_usage_rows integer,
  purge_receipt_sha256 text,
  post_purge_action_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_manifest_text text;
  source_manifest_json jsonb;
  request_version integer;
  project_version integer;
  project_status text;
  manifest_inventory_drifted boolean;
  manifest_storage_drifted boolean;
  manifest_binding_drifted boolean;
  manifest_retained_drifted boolean;
  purge_receipt_text text;
  purge_receipt_digest text;
  purge_timestamp_text text;
  stamped_action_rows integer;
  deleted_internal_rows integer;
BEGIN
  IF p_organisation_id IS DISTINCT FROM valo_security.current_organisation_id()
     OR p_retention_request_id IS NULL
     OR p_retention_action_id IS NULL
     OR p_subject_project_id IS NULL
     OR p_source_manifest_sha256 IS NULL
     OR p_source_manifest_sha256 !~ '^[0-9a-f]{64}$'
     OR p_expected_action_version IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'invalid tenant-scoped retention purge authority'
      USING ERRCODE = '42501';
  END IF;

  SELECT action.source_manifest, request.version,
         project.version, project.status
    INTO source_manifest_text, request_version,
         project_version, project_status
  FROM public.retention_actions AS action
  INNER JOIN public.retention_requests AS request
    ON request.id = action.retention_request_id
   AND request.organisation_id = action.organisation_id
  INNER JOIN public.projects AS project
    ON project.id = action.subject_project_id
   AND project.organisation_id = action.organisation_id
  WHERE action.id = p_retention_action_id
    AND action.organisation_id = p_organisation_id
    AND action.retention_request_id = p_retention_request_id
    AND action.subject_project_id = p_subject_project_id
    AND action.object_type = 'project'
    AND action.object_id = p_subject_project_id
    AND action.action = 'delete'
    AND action.completion_protocol_version = 1
    AND action.status = 'detached'
    AND action.version = p_expected_action_version
    AND action.source_manifest_sha256 = p_source_manifest_sha256
    AND request.completion_protocol_version = 1
    AND request.subject_project_id = p_subject_project_id
    AND request.project_id = p_subject_project_id
    AND request.status = 'reconciling'
    AND project.id = p_subject_project_id
  FOR UPDATE OF action, request, project;

  IF NOT FOUND
     OR source_manifest_text IS NULL
     OR project_status NOT IN ('signed_off', 'exported') THEN
    RAISE EXCEPTION 'retention purge is not bound to a detached action'
      USING ERRCODE = '55000';
  END IF;

  -- These two retained ledgers are not project-FK children. A brief SHARE ROW
  -- EXCLUSIVE lock closes phantom INSERT/UPDATE races while their path/project
  -- projections are compared with the source manifest. The owner routine is
  -- activation-gated and keeps the locks only for this transaction.
  LOCK TABLE public.vault_items, public.audit_events
    IN SHARE ROW EXCLUSIVE MODE;

  -- Freeze the mutable project-owned ancestors and rows used by the source and
  -- storage manifests. Project's UPDATE lock prevents new direct children;
  -- locking documents/packages and their versions also conflicts with the
  -- foreign-key key-share locks needed for new descendant rows. Work-task
  -- locks preserve the logical Claims Desk record projection through purge.
  PERFORM document.id
  FROM public.documents AS document
  WHERE document.organisation_id = p_organisation_id
    AND document.project_id = p_subject_project_id
  FOR UPDATE OF document;

  PERFORM version.id
  FROM public.document_versions AS version
  INNER JOIN public.documents AS document
    ON document.id = version.document_id
  WHERE version.organisation_id = p_organisation_id
    AND document.organisation_id = p_organisation_id
    AND document.project_id = p_subject_project_id
  FOR UPDATE OF version;

  PERFORM package_row.id
  FROM public.packages AS package_row
  WHERE package_row.organisation_id = p_organisation_id
    AND package_row.project_id = p_subject_project_id
  FOR UPDATE OF package_row;

  PERFORM version.id
  FROM public.package_versions AS version
  INNER JOIN public.packages AS package_row
    ON package_row.id = version.package_id
  WHERE version.organisation_id = p_organisation_id
    AND package_row.organisation_id = p_organisation_id
    AND package_row.project_id = p_subject_project_id
  FOR UPDATE OF version;

  PERFORM task.id
  FROM public.work_tasks AS task
  WHERE task.organisation_id = p_organisation_id
    AND task.project_id = p_subject_project_id
  FOR UPDATE OF task;

  PERFORM report.id
  FROM public.reports AS report
  WHERE report.organisation_id = p_organisation_id
    AND report.project_id = p_subject_project_id
  FOR UPDATE OF report;

  PERFORM upload.id
  FROM public.upload_sessions AS upload
  WHERE upload.organisation_id = p_organisation_id
    AND upload.project_id = p_subject_project_id
  FOR UPDATE OF upload;

  PERFORM evidence.id
  FROM public.evidence_items AS evidence
  WHERE evidence.organisation_id = p_organisation_id
    AND evidence.project_id = p_subject_project_id
  FOR UPDATE OF evidence;

  PERFORM check_row.id
  FROM public.boq_checks AS check_row
  WHERE check_row.organisation_id = p_organisation_id
    AND check_row.project_id = p_subject_project_id
  FOR UPDATE OF check_row;

  PERFORM run.id
  FROM public.llm_runs AS run
  WHERE run.organisation_id = p_organisation_id
    AND run.project_id = p_subject_project_id
  FOR UPDATE OF run;

  PERFORM engagement.id
  FROM public.engagement_tender_lots AS engagement
  WHERE engagement.organisation_id = p_organisation_id
    AND engagement.project_id = p_subject_project_id
  FOR UPDATE OF engagement;

  PERFORM comment.id
  FROM public.comments AS comment
  WHERE comment.organisation_id = p_organisation_id
    AND comment.project_id = p_subject_project_id
  FOR UPDATE OF comment;

  PERFORM review.id
  FROM public.reviews AS review
  WHERE review.organisation_id = p_organisation_id
    AND review.project_id = p_subject_project_id
  FOR UPDATE OF review;

  PERFORM approval.id
  FROM public.approvals AS approval
  WHERE approval.organisation_id = p_organisation_id
    AND approval.project_id = p_subject_project_id
  FOR UPDATE OF approval;

  PERFORM usage.id
  FROM public.vault_usage AS usage
  WHERE usage.organisation_id = p_organisation_id
    AND usage.project_id = p_subject_project_id
  FOR UPDATE OF usage;

  PERFORM usage.id
  FROM public.capability_usage AS usage
  WHERE usage.organisation_id = p_organisation_id
    AND usage.project_id = p_subject_project_id
  FOR UPDATE OF usage;

  PERFORM evaluation.id
  FROM public.rule_evaluations AS evaluation
  WHERE evaluation.organisation_id = p_organisation_id
    AND evaluation.project_id = p_subject_project_id
  FOR UPDATE OF evaluation;

  PERFORM outcome.id
  FROM public.outcomes AS outcome
  WHERE outcome.organisation_id = p_organisation_id
    AND outcome.project_id = p_subject_project_id
  FOR UPDATE OF outcome;

  PERFORM requirement.id
  FROM public.requirements AS requirement
  WHERE requirement.organisation_id = p_organisation_id
    AND requirement.project_id = p_subject_project_id
  FOR UPDATE OF requirement;

  PERFORM citation.id
  FROM public.requirement_citations AS citation
  INNER JOIN public.requirements AS requirement
    ON requirement.id = citation.requirement_id
  WHERE citation.organisation_id = p_organisation_id
    AND requirement.organisation_id = p_organisation_id
    AND requirement.project_id = p_subject_project_id
  FOR UPDATE OF citation;

  PERFORM defect.id
  FROM public.defects AS defect
  WHERE defect.organisation_id = p_organisation_id
    AND defect.project_id = p_subject_project_id
  FOR UPDATE OF defect;

  PERFORM decision.id
  FROM public.defect_decisions AS decision
  INNER JOIN public.defects AS defect
    ON defect.id = decision.defect_id
  WHERE decision.organisation_id = p_organisation_id
    AND decision.project_id = p_subject_project_id
    AND defect.organisation_id = p_organisation_id
    AND defect.project_id = p_subject_project_id
  FOR UPDATE OF decision;

  PERFORM context.id
  FROM public.tender_context_versions AS context
  WHERE context.organisation_id = p_organisation_id
    AND context.project_id = p_subject_project_id
  FOR UPDATE OF context;

  PERFORM context_requirement.id
  FROM public.tender_context_requirements AS context_requirement
  WHERE context_requirement.organisation_id = p_organisation_id
    AND context_requirement.project_id = p_subject_project_id
  FOR UPDATE OF context_requirement;

  PERFORM artifact.id
  FROM public.tender_context_artifacts AS artifact
  WHERE artifact.organisation_id = p_organisation_id
    AND artifact.project_id = p_subject_project_id
  FOR UPDATE OF artifact;

  PERFORM passport.id
  FROM public.tender_eligibility_passports AS passport
  WHERE passport.organisation_id = p_organisation_id
    AND passport.project_id = p_subject_project_id
  FOR UPDATE OF passport;

  PERFORM job.id
  FROM public.processing_jobs AS job
  WHERE job.organisation_id = p_organisation_id
    AND job.project_id = p_subject_project_id
  FOR UPDATE OF job;

  PERFORM run.id
  FROM public.processing_runs AS run
  INNER JOIN public.processing_jobs AS job
    ON job.id = run.job_id
  WHERE run.organisation_id = p_organisation_id
    AND job.organisation_id = p_organisation_id
    AND job.project_id = p_subject_project_id
  FOR UPDATE OF run;

  PERFORM event.id
  FROM public.notification_events AS event
  WHERE event.organisation_id = p_organisation_id
    AND event.project_id = p_subject_project_id
  FOR UPDATE OF event;

  PERFORM attempt.id
  FROM public.notification_attempts AS attempt
  INNER JOIN public.notification_events AS event
    ON event.id = attempt.notification_event_id
  WHERE attempt.organisation_id = p_organisation_id
    AND event.organisation_id = p_organisation_id
    AND event.project_id = p_subject_project_id
  FOR UPDATE OF attempt;

  PERFORM run.id
  FROM public.boq_runs AS run
  WHERE run.organisation_id = p_organisation_id
    AND run.project_id = p_subject_project_id
  FOR UPDATE OF run;

  PERFORM exception_row.id
  FROM public.boq_exceptions AS exception_row
  INNER JOIN public.boq_runs AS run
    ON run.id = exception_row.boq_run_id
  WHERE exception_row.organisation_id = p_organisation_id
    AND run.organisation_id = p_organisation_id
    AND run.project_id = p_subject_project_id
  FOR UPDATE OF exception_row;

  PERFORM draft.id
  FROM public.drafts AS draft
  WHERE draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id
  FOR UPDATE OF draft;

  PERFORM version.id
  FROM public.draft_versions AS version
  INNER JOIN public.drafts AS draft
    ON draft.id = version.draft_id
  WHERE version.organisation_id = p_organisation_id
    AND draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id
  FOR UPDATE OF version;

  PERFORM claim.id
  FROM public.draft_claims AS claim
  INNER JOIN public.draft_versions AS version
    ON version.id = claim.draft_version_id
  INNER JOIN public.drafts AS draft
    ON draft.id = version.draft_id
  WHERE claim.organisation_id = p_organisation_id
    AND version.organisation_id = p_organisation_id
    AND draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id
  FOR UPDATE OF claim;

  PERFORM link.id
  FROM public.claim_evidence_links AS link
  INNER JOIN public.draft_claims AS claim
    ON claim.id = link.draft_claim_id
  INNER JOIN public.draft_versions AS version
    ON version.id = claim.draft_version_id
  INNER JOIN public.drafts AS draft
    ON draft.id = version.draft_id
  WHERE link.organisation_id = p_organisation_id
    AND claim.organisation_id = p_organisation_id
    AND version.organisation_id = p_organisation_id
    AND draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id
  FOR UPDATE OF link;

  PERFORM run.id
  FROM public.red_team_runs AS run
  WHERE run.organisation_id = p_organisation_id
    AND run.project_id = p_subject_project_id
  FOR UPDATE OF run;

  PERFORM finding.id
  FROM public.red_team_findings AS finding
  INNER JOIN public.red_team_runs AS run
    ON run.id = finding.red_team_run_id
  WHERE finding.organisation_id = p_organisation_id
    AND run.organisation_id = p_organisation_id
    AND run.project_id = p_subject_project_id
  FOR UPDATE OF finding;

  PERFORM assessment.id
  FROM public.addendum_impact_assessments AS assessment
  WHERE assessment.organisation_id = p_organisation_id
    AND assessment.project_id = p_subject_project_id
  FOR UPDATE OF assessment;

  PERFORM item.id
  FROM public.addendum_impact_items AS item
  INNER JOIN public.addendum_impact_assessments AS assessment
    ON assessment.id = item.assessment_id
  WHERE item.organisation_id = p_organisation_id
    AND assessment.organisation_id = p_organisation_id
    AND assessment.project_id = p_subject_project_id
  FOR UPDATE OF item;

  PERFORM item.id
  FROM public.package_manifest_items AS item
  INNER JOIN public.package_versions AS version
    ON version.id = item.package_version_id
  INNER JOIN public.packages AS package_row
    ON package_row.id = version.package_id
  WHERE item.organisation_id = p_organisation_id
    AND version.organisation_id = p_organisation_id
    AND package_row.organisation_id = p_organisation_id
    AND package_row.project_id = p_subject_project_id
  FOR UPDATE OF item;

  PERFORM conflict.id
  FROM public.conflict_records AS conflict
  WHERE conflict.organisation_id = p_organisation_id
    AND conflict.project_id = p_subject_project_id
  FOR UPDATE OF conflict;

  -- Lock the retained finance/control rows whose mutable status is rechecked
  -- below. The locked project/order/invoice keys also close concurrent child
  -- insertion races through their foreign-key key-share locks.
  PERFORM hold.id
  FROM public.legal_holds AS hold
  WHERE hold.organisation_id = p_organisation_id
    AND hold.project_id = p_subject_project_id
  FOR UPDATE OF hold;

  PERFORM retained_order.id
  FROM public.orders AS retained_order
  WHERE retained_order.organisation_id = p_organisation_id
    AND retained_order.project_id = p_subject_project_id
  FOR UPDATE OF retained_order;

  PERFORM line.id
  FROM public.invoice_lines AS line
  INNER JOIN public.orders AS retained_order
    ON retained_order.id = line.order_id
  WHERE retained_order.organisation_id = p_organisation_id
    AND retained_order.project_id = p_subject_project_id
  FOR UPDATE OF line;

  PERFORM invoice.id
  FROM public.invoices AS invoice
  WHERE invoice.organisation_id = p_organisation_id
    AND EXISTS (
      SELECT 1
      FROM public.invoice_lines AS line
      INNER JOIN public.orders AS retained_order
        ON retained_order.id = line.order_id
      WHERE line.invoice_id = invoice.id
        AND retained_order.organisation_id = p_organisation_id
        AND retained_order.project_id = p_subject_project_id
    )
  FOR UPDATE OF invoice;

  PERFORM payment.id
  FROM public.payments AS payment
  WHERE payment.organisation_id = p_organisation_id
    AND EXISTS (
      SELECT 1
      FROM public.invoice_lines AS line
      INNER JOIN public.orders AS retained_order
        ON retained_order.id = line.order_id
      WHERE line.invoice_id = payment.invoice_id
        AND retained_order.organisation_id = p_organisation_id
        AND retained_order.project_id = p_subject_project_id
    )
  FOR UPDATE OF payment;

  PERFORM usage.id
  FROM public.entitlement_usage AS usage
  WHERE usage.organisation_id = p_organisation_id
    AND usage.project_id = p_subject_project_id
  FOR UPDATE OF usage;

  IF pg_catalog.encode(
       pg_catalog.sha256(
         pg_catalog.convert_to(source_manifest_text, 'UTF8')
       ),
       'hex'
     ) IS DISTINCT FROM p_source_manifest_sha256 THEN
    RAISE EXCEPTION 'retention source manifest digest does not match its bytes'
      USING ERRCODE = '55000';
  END IF;

  source_manifest_json := source_manifest_text::jsonb;
  IF source_manifest_json->>'schema'
       IS DISTINCT FROM 'valo.retention-completion-source-manifest/v1'
     OR source_manifest_json->>'organisationId'
       IS DISTINCT FROM p_organisation_id::text
     OR source_manifest_json->>'retentionRequestId'
       IS DISTINCT FROM p_retention_request_id::text
     OR source_manifest_json->>'retentionActionId'
       IS DISTINCT FROM p_retention_action_id::text
     OR source_manifest_json->>'subjectProjectId'
       IS DISTINCT FROM p_subject_project_id::text
     OR (source_manifest_json->>'requestVersion')::integer
       IS DISTINCT FROM request_version - 1
     OR (source_manifest_json->>'projectVersion')::integer
       IS DISTINCT FROM project_version
     OR source_manifest_json->>'projectStatus'
       IS DISTINCT FROM project_status
     OR pg_catalog.jsonb_typeof(source_manifest_json->'categories')
       IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(source_manifest_json->'storageObjects')
       IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(source_manifest_json->'retainedCategories')
       IS DISTINCT FROM 'array'
     OR pg_catalog.octet_length(source_manifest_text) > 1048576
     OR pg_catalog.jsonb_array_length(
          source_manifest_json->'categories'
        ) > 100
     OR pg_catalog.jsonb_array_length(
          source_manifest_json->'storageObjects'
        ) > 1000
     OR pg_catalog.jsonb_array_length(
          source_manifest_json->'retainedCategories'
        ) > 25 THEN
    RAISE EXCEPTION 'retention source manifest identity is invalid'
      USING ERRCODE = '55000';
  END IF;

  WITH inventory(category, id) AS (
    SELECT 'projects'::text, project.id::text
    FROM public.projects AS project
    WHERE project.organisation_id = p_organisation_id
      AND project.id = p_subject_project_id
    UNION ALL
    SELECT 'documents', row.id::text
    FROM public.documents AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'document_versions', version.id::text
    FROM public.document_versions AS version
    INNER JOIN public.documents AS document
      ON document.id = version.document_id
    WHERE version.organisation_id = p_organisation_id
      AND document.organisation_id = p_organisation_id
      AND document.project_id = p_subject_project_id
    UNION ALL
    SELECT 'document_version_snapshots', snapshot.id::text
    FROM public.document_version_snapshots AS snapshot
    INNER JOIN public.document_versions AS version
      ON version.id = snapshot.document_version_id
    INNER JOIN public.documents AS document
      ON document.id = version.document_id
    WHERE snapshot.organisation_id = p_organisation_id
      AND version.organisation_id = p_organisation_id
      AND document.organisation_id = p_organisation_id
      AND document.project_id = p_subject_project_id
    UNION ALL
    SELECT 'requirements', row.id::text
    FROM public.requirements AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'requirement_citations', citation.id::text
    FROM public.requirement_citations AS citation
    INNER JOIN public.requirements AS requirement
      ON requirement.id = citation.requirement_id
    WHERE citation.organisation_id = p_organisation_id
      AND requirement.organisation_id = p_organisation_id
      AND requirement.project_id = p_subject_project_id
    UNION ALL
    SELECT 'evidence_items', row.id::text
    FROM public.evidence_items AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'defects', row.id::text
    FROM public.defects AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'boq_checks', row.id::text
    FROM public.boq_checks AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'reports', row.id::text
    FROM public.reports AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'llm_runs', row.id::text
    FROM public.llm_runs AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'engagement_tender_lots',
           row.project_id::text || ':' || row.tender_lot_id::text
    FROM public.engagement_tender_lots AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'upload_sessions', row.id::text
    FROM public.upload_sessions AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'processing_jobs', row.id::text
    FROM public.processing_jobs AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'processing_runs', run.id::text
    FROM public.processing_runs AS run
    INNER JOIN public.processing_jobs AS job
      ON job.id = run.job_id
    WHERE run.organisation_id = p_organisation_id
      AND job.organisation_id = p_organisation_id
      AND job.project_id = p_subject_project_id
    UNION ALL
    SELECT 'notification_events', event.id::text
    FROM public.notification_events AS event
    WHERE event.organisation_id = p_organisation_id
      AND event.project_id = p_subject_project_id
    UNION ALL
    SELECT 'notification_attempts', attempt.id::text
    FROM public.notification_attempts AS attempt
    INNER JOIN public.notification_events AS event
      ON event.id = attempt.notification_event_id
    WHERE attempt.organisation_id = p_organisation_id
      AND event.organisation_id = p_organisation_id
      AND event.project_id = p_subject_project_id
    UNION ALL
    SELECT 'work_tasks', row.id::text
    FROM public.work_tasks AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT DISTINCT 'claims_desk_records',
           row.description::jsonb->>'recordId'
    FROM public.work_tasks AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
      AND row.title LIKE '[CLAIMS-DESK:%'
    UNION ALL
    SELECT 'comments', row.id::text
    FROM public.comments AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'reviews', row.id::text
    FROM public.reviews AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'approvals', row.id::text
    FROM public.approvals AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'defect_decisions', row.id::text
    FROM public.defect_decisions AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'vault_usage', row.id::text
    FROM public.vault_usage AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'capability_usage', row.id::text
    FROM public.capability_usage AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'boq_runs', row.id::text
    FROM public.boq_runs AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'boq_exceptions', exception_row.id::text
    FROM public.boq_exceptions AS exception_row
    INNER JOIN public.boq_runs AS run
      ON run.id = exception_row.boq_run_id
    WHERE exception_row.organisation_id = p_organisation_id
      AND run.organisation_id = p_organisation_id
      AND run.project_id = p_subject_project_id
    UNION ALL
    SELECT 'drafts', row.id::text
    FROM public.drafts AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'draft_versions', version.id::text
    FROM public.draft_versions AS version
    INNER JOIN public.drafts AS draft
      ON draft.id = version.draft_id
    WHERE version.organisation_id = p_organisation_id
      AND draft.organisation_id = p_organisation_id
      AND draft.project_id = p_subject_project_id
    UNION ALL
    SELECT 'draft_claims', claim.id::text
    FROM public.draft_claims AS claim
    INNER JOIN public.draft_versions AS version
      ON version.id = claim.draft_version_id
    INNER JOIN public.drafts AS draft
      ON draft.id = version.draft_id
    WHERE claim.organisation_id = p_organisation_id
      AND version.organisation_id = p_organisation_id
      AND draft.organisation_id = p_organisation_id
      AND draft.project_id = p_subject_project_id
    UNION ALL
    SELECT 'claim_evidence_links', link.id::text
    FROM public.claim_evidence_links AS link
    INNER JOIN public.draft_claims AS claim
      ON claim.id = link.draft_claim_id
    INNER JOIN public.draft_versions AS version
      ON version.id = claim.draft_version_id
    INNER JOIN public.drafts AS draft
      ON draft.id = version.draft_id
    WHERE link.organisation_id = p_organisation_id
      AND claim.organisation_id = p_organisation_id
      AND version.organisation_id = p_organisation_id
      AND draft.organisation_id = p_organisation_id
      AND draft.project_id = p_subject_project_id
    UNION ALL
    SELECT 'red_team_runs', row.id::text
    FROM public.red_team_runs AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'red_team_findings', finding.id::text
    FROM public.red_team_findings AS finding
    INNER JOIN public.red_team_runs AS run
      ON run.id = finding.red_team_run_id
    WHERE finding.organisation_id = p_organisation_id
      AND run.organisation_id = p_organisation_id
      AND run.project_id = p_subject_project_id
    UNION ALL
    SELECT 'packages', row.id::text
    FROM public.packages AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'package_versions', version.id::text
    FROM public.package_versions AS version
    INNER JOIN public.packages AS package_row
      ON package_row.id = version.package_id
    WHERE version.organisation_id = p_organisation_id
      AND package_row.organisation_id = p_organisation_id
      AND package_row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'package_manifest_items', item.id::text
    FROM public.package_manifest_items AS item
    INNER JOIN public.package_versions AS version
      ON version.id = item.package_version_id
    INNER JOIN public.packages AS package_row
      ON package_row.id = version.package_id
    WHERE item.organisation_id = p_organisation_id
      AND version.organisation_id = p_organisation_id
      AND package_row.organisation_id = p_organisation_id
      AND package_row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'tender_context_versions', row.id::text
    FROM public.tender_context_versions AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'tender_context_requirements', row.id::text
    FROM public.tender_context_requirements AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'tender_context_artifacts', row.id::text
    FROM public.tender_context_artifacts AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'tender_eligibility_passports', row.id::text
    FROM public.tender_eligibility_passports AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'addendum_impact_assessments', row.id::text
    FROM public.addendum_impact_assessments AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'addendum_impact_items', item.id::text
    FROM public.addendum_impact_items AS item
    INNER JOIN public.addendum_impact_assessments AS assessment
      ON assessment.id = item.assessment_id
    WHERE item.organisation_id = p_organisation_id
      AND assessment.organisation_id = p_organisation_id
      AND assessment.project_id = p_subject_project_id
    UNION ALL
    SELECT 'rule_evaluations', row.id::text
    FROM public.rule_evaluations AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'outcomes', row.id::text
    FROM public.outcomes AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'conflict_records', row.id::text
    FROM public.conflict_records AS row
    WHERE row.organisation_id = p_organisation_id
      AND row.project_id = p_subject_project_id
    UNION ALL
    SELECT 'legal_holds', hold.id::text
    FROM public.legal_holds AS hold
    WHERE hold.organisation_id = p_organisation_id
      AND hold.project_id = p_subject_project_id
    UNION ALL
    SELECT 'orders', retained_order.id::text
    FROM public.orders AS retained_order
    WHERE retained_order.organisation_id = p_organisation_id
      AND retained_order.project_id = p_subject_project_id
    UNION ALL
    SELECT DISTINCT 'invoices', invoice.id::text
    FROM public.invoices AS invoice
    INNER JOIN public.invoice_lines AS line
      ON line.invoice_id = invoice.id
    INNER JOIN public.orders AS retained_order
      ON retained_order.id = line.order_id
    WHERE invoice.organisation_id = p_organisation_id
      AND retained_order.organisation_id = p_organisation_id
      AND retained_order.project_id = p_subject_project_id
    UNION ALL
    SELECT DISTINCT 'payments', payment.id::text
    FROM public.payments AS payment
    INNER JOIN public.invoices AS invoice
      ON invoice.id = payment.invoice_id
    INNER JOIN public.invoice_lines AS line
      ON line.invoice_id = invoice.id
    INNER JOIN public.orders AS retained_order
      ON retained_order.id = line.order_id
    WHERE payment.organisation_id = p_organisation_id
      AND invoice.organisation_id = p_organisation_id
      AND retained_order.organisation_id = p_organisation_id
      AND retained_order.project_id = p_subject_project_id
    UNION ALL
    SELECT 'entitlement_usage', usage.id::text
    FROM public.entitlement_usage AS usage
    WHERE usage.organisation_id = p_organisation_id
      AND usage.project_id = p_subject_project_id
    UNION ALL
    SELECT DISTINCT 'vault_items', vault.id::text
    FROM public.vault_items AS vault
    INNER JOIN (
      SELECT candidate.object_path
      FROM (
        SELECT document.object_path
        FROM public.documents AS document
        WHERE document.organisation_id = p_organisation_id
          AND document.project_id = p_subject_project_id
        UNION ALL
        SELECT version.object_path
        FROM public.document_versions AS version
        INNER JOIN public.documents AS document
          ON document.id = version.document_id
        WHERE version.organisation_id = p_organisation_id
          AND document.organisation_id = p_organisation_id
          AND document.project_id = p_subject_project_id
        UNION ALL
        SELECT report.docx_path
        FROM public.reports AS report
        WHERE report.organisation_id = p_organisation_id
          AND report.project_id = p_subject_project_id
        UNION ALL
        SELECT report.pdf_path
        FROM public.reports AS report
        WHERE report.organisation_id = p_organisation_id
          AND report.project_id = p_subject_project_id
        UNION ALL
        SELECT version.docx_object_path
        FROM public.package_versions AS version
        INNER JOIN public.packages AS package_row
          ON package_row.id = version.package_id
        WHERE version.organisation_id = p_organisation_id
          AND package_row.organisation_id = p_organisation_id
          AND package_row.project_id = p_subject_project_id
        UNION ALL
        SELECT version.pdf_object_path
        FROM public.package_versions AS version
        INNER JOIN public.packages AS package_row
          ON package_row.id = version.package_id
        WHERE version.organisation_id = p_organisation_id
          AND package_row.organisation_id = p_organisation_id
          AND package_row.project_id = p_subject_project_id
        UNION ALL
        SELECT version.zip_object_path
        FROM public.package_versions AS version
        INNER JOIN public.packages AS package_row
          ON package_row.id = version.package_id
        WHERE version.organisation_id = p_organisation_id
          AND package_row.organisation_id = p_organisation_id
          AND package_row.project_id = p_subject_project_id
        UNION ALL
        SELECT '/objects/tenants/' || p_organisation_id::text ||
               '/uploads/' || upload.id::text
        FROM public.upload_sessions AS upload
        WHERE upload.organisation_id = p_organisation_id
          AND upload.project_id = p_subject_project_id
        UNION ALL
        SELECT '/objects/tenants/' || p_organisation_id::text ||
               '/documents/' || upload.id::text
        FROM public.upload_sessions AS upload
        WHERE upload.organisation_id = p_organisation_id
          AND upload.project_id = p_subject_project_id
        UNION ALL
        SELECT '/objects/tenants/' || p_organisation_id::text ||
               '/quarantine/' || upload.id::text
        FROM public.upload_sessions AS upload
        WHERE upload.organisation_id = p_organisation_id
          AND upload.project_id = p_subject_project_id
      ) AS candidate(object_path)
      WHERE candidate.object_path IS NOT NULL
      GROUP BY candidate.object_path
    ) AS storage_path
      ON storage_path.object_path = vault.object_path
    WHERE vault.organisation_id = p_organisation_id
    UNION ALL
    SELECT 'audit_events', audit.id::text || ':' ||
           audit.seq::text || ':' || audit.hash
    FROM public.audit_events AS audit
    WHERE audit.organisation_id = p_organisation_id
      AND audit.project_id = p_subject_project_id
  ), actual AS (
    SELECT inventory.category,
           pg_catalog.count(*)::bigint AS row_count,
           pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(
                 '[' || pg_catalog.string_agg(
                   pg_catalog.to_json(inventory.id)::text,
                   ',' ORDER BY inventory.id
                 ) || ']',
                 'UTF8'
               )
             ),
             'hex'
           ) AS identities_sha256
    FROM inventory
    GROUP BY inventory.category
  ), claimed AS (
    SELECT category.value->>'category' AS category,
           (category.value->>'count')::bigint AS row_count,
           category.value->>'identitiesSha256' AS identities_sha256
    FROM pg_catalog.jsonb_array_elements(
      source_manifest_json->'categories'
    ) AS category(value)
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM actual
      FULL OUTER JOIN claimed USING (category)
      WHERE actual.category IS NULL
         OR claimed.category IS NULL
         OR actual.row_count IS DISTINCT FROM claimed.row_count
         OR actual.identities_sha256
              IS DISTINCT FROM claimed.identities_sha256
    )
    OR (SELECT pg_catalog.count(*) FROM claimed)
       <> (SELECT pg_catalog.count(DISTINCT claimed.category) FROM claimed)
    INTO manifest_inventory_drifted;

  IF manifest_inventory_drifted THEN
    RAISE EXCEPTION 'retention project inventory changed after manifest capture'
      USING ERRCODE = '55000';
  END IF;

  WITH storage_candidates(object_path, source_kind, precedence) AS (
    SELECT document.object_path, 'document'::text, 1
    FROM public.documents AS document
    WHERE document.organisation_id = p_organisation_id
      AND document.project_id = p_subject_project_id
    UNION ALL
    SELECT version.object_path, 'document_version', 2
    FROM public.document_versions AS version
    INNER JOIN public.documents AS document
      ON document.id = version.document_id
    WHERE version.organisation_id = p_organisation_id
      AND document.organisation_id = p_organisation_id
      AND document.project_id = p_subject_project_id
    UNION ALL
    SELECT report.docx_path, 'report', 3
    FROM public.reports AS report
    WHERE report.organisation_id = p_organisation_id
      AND report.project_id = p_subject_project_id
    UNION ALL
    SELECT report.pdf_path, 'report', 3
    FROM public.reports AS report
    WHERE report.organisation_id = p_organisation_id
      AND report.project_id = p_subject_project_id
    UNION ALL
    SELECT version.docx_object_path, 'package_version', 4
    FROM public.package_versions AS version
    INNER JOIN public.packages AS package_row
      ON package_row.id = version.package_id
    WHERE version.organisation_id = p_organisation_id
      AND package_row.organisation_id = p_organisation_id
      AND package_row.project_id = p_subject_project_id
    UNION ALL
    SELECT version.pdf_object_path, 'package_version', 4
    FROM public.package_versions AS version
    INNER JOIN public.packages AS package_row
      ON package_row.id = version.package_id
    WHERE version.organisation_id = p_organisation_id
      AND package_row.organisation_id = p_organisation_id
      AND package_row.project_id = p_subject_project_id
    UNION ALL
    SELECT version.zip_object_path, 'package_version', 4
    FROM public.package_versions AS version
    INNER JOIN public.packages AS package_row
      ON package_row.id = version.package_id
    WHERE version.organisation_id = p_organisation_id
      AND package_row.organisation_id = p_organisation_id
      AND package_row.project_id = p_subject_project_id
    UNION ALL
    SELECT '/objects/tenants/' || p_organisation_id::text ||
           '/uploads/' || upload.id::text,
           'upload_session', 5
    FROM public.upload_sessions AS upload
    WHERE upload.organisation_id = p_organisation_id
      AND upload.project_id = p_subject_project_id
    UNION ALL
    SELECT '/objects/tenants/' || p_organisation_id::text ||
           '/documents/' || upload.id::text,
           'upload_session', 5
    FROM public.upload_sessions AS upload
    WHERE upload.organisation_id = p_organisation_id
      AND upload.project_id = p_subject_project_id
    UNION ALL
    SELECT '/objects/tenants/' || p_organisation_id::text ||
           '/quarantine/' || upload.id::text,
           'upload_session', 5
    FROM public.upload_sessions AS upload
    WHERE upload.organisation_id = p_organisation_id
      AND upload.project_id = p_subject_project_id
  ), storage_paths AS (
    SELECT DISTINCT ON (candidate.object_path)
           candidate.object_path, candidate.source_kind
    FROM storage_candidates AS candidate
    WHERE candidate.object_path IS NOT NULL
    ORDER BY candidate.object_path, candidate.precedence
  ), vault_references AS (
    SELECT vault.id, vault.object_path
    FROM public.vault_items AS vault
    INNER JOIN storage_paths AS storage_path
      ON storage_path.object_path = vault.object_path
    WHERE vault.organisation_id = p_organisation_id
  ), live_storage AS (
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(storage_path.object_path, 'UTF8')
             ),
             'hex'
           ) AS object_path_sha256,
           storage_path.source_kind
    FROM storage_paths AS storage_path
    WHERE storage_path.object_path LIKE
            '/objects/tenants/' || p_organisation_id::text || '/%'
      AND NOT EXISTS (
        SELECT 1
        FROM vault_references AS vault
        WHERE vault.object_path = storage_path.object_path
      )
  ), claimed_storage AS (
    SELECT object.value->>'objectPathSha256' AS object_path_sha256,
           object.value->>'sourceKind' AS source_kind
    FROM pg_catalog.jsonb_array_elements(
      source_manifest_json->'storageObjects'
    ) AS object(value)
  ), bound_storage AS (
    SELECT binding.object_path_sha256
    FROM public.retention_action_storage_events AS binding
    WHERE binding.organisation_id = p_organisation_id
      AND binding.retention_action_id = p_retention_action_id
  ), actual_retained(category, reason, row_count) AS (
    SELECT 'audit_evidence'::text,
           'tamper-evident project history remains in the tenant audit chain'::text,
           pg_catalog.count(*)::bigint
    FROM public.audit_events AS audit
    WHERE audit.organisation_id = p_organisation_id
      AND audit.project_id = p_subject_project_id
    HAVING pg_catalog.count(*) > 0
    UNION ALL
    SELECT 'financial_accounting',
           'settled orders, invoices and payments are retained accounting records',
           (
             SELECT pg_catalog.count(*)
             FROM public.orders AS retained_order
             WHERE retained_order.organisation_id = p_organisation_id
               AND retained_order.project_id = p_subject_project_id
           ) + (
             SELECT pg_catalog.count(DISTINCT invoice.id)
             FROM public.invoices AS invoice
             INNER JOIN public.invoice_lines AS line
               ON line.invoice_id = invoice.id
             INNER JOIN public.orders AS retained_order
               ON retained_order.id = line.order_id
             WHERE invoice.organisation_id = p_organisation_id
               AND retained_order.organisation_id = p_organisation_id
               AND retained_order.project_id = p_subject_project_id
           ) + (
             SELECT pg_catalog.count(DISTINCT payment.id)
             FROM public.payments AS payment
             INNER JOIN public.invoices AS invoice
               ON invoice.id = payment.invoice_id
             INNER JOIN public.invoice_lines AS line
               ON line.invoice_id = invoice.id
             INNER JOIN public.orders AS retained_order
               ON retained_order.id = line.order_id
             WHERE payment.organisation_id = p_organisation_id
               AND invoice.organisation_id = p_organisation_id
               AND retained_order.organisation_id = p_organisation_id
               AND retained_order.project_id = p_subject_project_id
           ) AS row_count
    WHERE EXISTS (
      SELECT 1
      FROM public.orders AS retained_order
      WHERE retained_order.organisation_id = p_organisation_id
        AND retained_order.project_id = p_subject_project_id
    )
    UNION ALL
    SELECT 'legal_hold_evidence',
           'released legal-hold evidence is retained independently of project content',
           pg_catalog.count(*)::bigint
    FROM public.legal_holds AS hold
    WHERE hold.organisation_id = p_organisation_id
      AND hold.project_id = p_subject_project_id
    HAVING pg_catalog.count(*) > 0
    UNION ALL
    SELECT 'retention_control',
           'the request, action, storage bindings and certificate remain immutable control evidence',
           2::bigint + (SELECT pg_catalog.count(*) FROM live_storage)
    UNION ALL
    SELECT 'vault_reference',
           'tenant vault objects remain while referenced by the governed vault',
           pg_catalog.count(*)::bigint
    FROM vault_references
    HAVING pg_catalog.count(*) > 0
  ), claimed_retained AS (
    SELECT retained.value->>'category' AS category,
           retained.value->>'reason' AS reason,
           (retained.value->>'count')::bigint AS row_count
    FROM pg_catalog.jsonb_array_elements(
      source_manifest_json->'retainedCategories'
    ) AS retained(value)
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM storage_candidates AS candidate
      WHERE candidate.object_path IS NOT NULL
        AND candidate.object_path NOT LIKE
              '/objects/tenants/' || p_organisation_id::text || '/%'
    ) OR EXISTS (
      SELECT 1
      FROM live_storage
      FULL OUTER JOIN claimed_storage
        USING (object_path_sha256, source_kind)
      WHERE live_storage.object_path_sha256 IS NULL
         OR claimed_storage.object_path_sha256 IS NULL
    ) OR (
      SELECT pg_catalog.count(*) FROM claimed_storage
    ) <> (
      SELECT pg_catalog.count(DISTINCT (
        claimed_storage.object_path_sha256,
        claimed_storage.source_kind
      )) FROM claimed_storage
    ),
    EXISTS (
      SELECT 1
      FROM claimed_storage
      FULL OUTER JOIN bound_storage USING (object_path_sha256)
      WHERE claimed_storage.object_path_sha256 IS NULL
         OR bound_storage.object_path_sha256 IS NULL
    ) OR (
      SELECT pg_catalog.count(*) FROM bound_storage
    ) <> (
      SELECT pg_catalog.count(DISTINCT object_path_sha256)
      FROM bound_storage
    ),
    EXISTS (
      SELECT 1
      FROM actual_retained
      FULL OUTER JOIN claimed_retained USING (category)
      WHERE actual_retained.category IS NULL
         OR claimed_retained.category IS NULL
         OR actual_retained.reason IS DISTINCT FROM claimed_retained.reason
         OR actual_retained.row_count
              IS DISTINCT FROM claimed_retained.row_count
    ) OR (
      SELECT pg_catalog.count(*) FROM claimed_retained
    ) <> (
      SELECT pg_catalog.count(DISTINCT category) FROM claimed_retained
    )
    INTO manifest_storage_drifted,
         manifest_binding_drifted,
         manifest_retained_drifted;

  IF manifest_storage_drifted
     OR manifest_binding_drifted
     OR manifest_retained_drifted THEN
    RAISE EXCEPTION 'retention storage, binding or retained inventory changed after manifest capture'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.legal_holds AS hold
       WHERE hold.organisation_id = p_organisation_id
         AND hold.project_id = p_subject_project_id
         AND hold.status <> 'released'
     )
     OR EXISTS (
       SELECT 1 FROM public.orders AS retained_order
       WHERE retained_order.organisation_id = p_organisation_id
         AND retained_order.project_id = p_subject_project_id
         AND (
           retained_order.status <> 'paid_manual'
           OR NOT EXISTS (
             SELECT 1
             FROM public.invoice_lines AS line
             INNER JOIN public.invoices AS invoice
               ON invoice.id = line.invoice_id
             WHERE line.order_id = retained_order.id
               AND invoice.organisation_id = p_organisation_id
           )
           OR EXISTS (
             SELECT 1
             FROM public.invoice_lines AS line
             INNER JOIN public.invoices AS invoice
               ON invoice.id = line.invoice_id
             WHERE line.order_id = retained_order.id
               AND invoice.organisation_id = p_organisation_id
               AND (
                 invoice.status <> 'paid_manual'
                 OR NOT EXISTS (
                   SELECT 1
                   FROM public.payments AS payment
                   WHERE payment.organisation_id = p_organisation_id
                     AND payment.invoice_id = invoice.id
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM public.payments AS payment
                   WHERE payment.organisation_id = p_organisation_id
                     AND payment.invoice_id = invoice.id
                     AND (
                       payment.status <> 'settled'
                       OR payment.reconciliation_status <> 'verified_manual'
                     )
                 )
               )
           )
         )
     )
     OR EXISTS (
       SELECT 1
       FROM public.work_tasks AS task
       WHERE task.organisation_id = p_organisation_id
         AND task.project_id = p_subject_project_id
         AND task.title LIKE '[RETAINER-DESK:v1:%'
         AND task.status NOT IN ('completed', 'cancelled')
     )
     OR EXISTS (
       SELECT 1
       FROM public.work_tasks AS task
       WHERE task.organisation_id = p_organisation_id
         AND task.project_id = p_subject_project_id
         AND task.title LIKE '[CLAIMS-DESK:%'
         AND (
           task.description IS NULL
           OR task.description::jsonb->>'schema'
                IS DISTINCT FROM 'valo.claims-desk-ledger/v1'
           OR task.description::jsonb->>'eventId'
                IS DISTINCT FROM task.id::text
           OR task.description::jsonb->>'organisationId'
                IS DISTINCT FROM p_organisation_id::text
           OR task.description::jsonb->>'projectId'
                IS DISTINCT FROM p_subject_project_id::text
           OR task.description::jsonb->>'recordId'
                !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR task.title IS DISTINCT FROM '[CLAIMS-DESK:' ||
                (task.description::jsonb->>'kind') || '] ' ||
                (task.description::jsonb->>'recordId')
         )
     )
     OR EXISTS (
       WITH claims_events AS (
         SELECT task.description::jsonb AS event
         FROM public.work_tasks AS task
         WHERE task.organisation_id = p_organisation_id
           AND task.project_id = p_subject_project_id
           AND task.title LIKE '[CLAIMS-DESK:%'
       ), latest AS (
         SELECT DISTINCT ON (event->>'recordId') event
         FROM claims_events
         ORDER BY event->>'recordId', (event->>'aggregateVersion')::integer DESC
       )
       SELECT 1
       FROM latest
       WHERE CASE
         WHEN event->>'kind' = 'transition_recorded'
           THEN event->'transition'->>'toStatus'
         ELSE 'registered'
       END NOT IN ('closed', 'withdrawn')
     )
     OR EXISTS (
       SELECT 1
       FROM public.vault_item_versions AS vault_version
       INNER JOIN public.document_versions AS version
         ON version.id = vault_version.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE vault_version.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.capability_evidence_links AS capability_link
       INNER JOIN public.document_versions AS version
         ON version.id = capability_link.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE capability_link.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.rule_overrides AS override
       INNER JOIN public.rule_evaluations AS evaluation
         ON evaluation.id = override.rule_evaluation_id
       WHERE override.organisation_id = p_organisation_id
         AND evaluation.organisation_id = p_organisation_id
         AND evaluation.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.package_signoffs AS signoff
       INNER JOIN public.package_versions AS version
         ON version.id = signoff.package_version_id
       INNER JOIN public.packages AS package_row
         ON package_row.id = version.package_id
       WHERE signoff.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND package_row.organisation_id = p_organisation_id
         AND package_row.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.export_deliveries AS delivery
       INNER JOIN public.package_versions AS version
         ON version.id = delivery.package_version_id
       INNER JOIN public.packages AS package_row
         ON package_row.id = version.package_id
       WHERE delivery.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND package_row.organisation_id = p_organisation_id
         AND package_row.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.conflict_records AS conflict_row
       WHERE conflict_row.organisation_id = p_organisation_id
         AND conflict_row.matched_project_id = p_subject_project_id
         AND conflict_row.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.retention_requests AS other_request
       WHERE other_request.organisation_id = p_organisation_id
         AND other_request.project_id = p_subject_project_id
         AND other_request.id <> p_retention_request_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.capability_items AS capability
       INNER JOIN public.documents AS document
         ON document.id = capability.evidence_doc_id
       WHERE capability.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.renewal_monitors AS monitor
       INNER JOIN public.notification_events AS event
         ON event.id = monitor.last_notification_event_id
       WHERE monitor.organisation_id = p_organisation_id
         AND event.organisation_id = p_organisation_id
         AND event.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.retention_action_storage_events AS binding
       INNER JOIN public.notification_events AS event
         ON event.id = binding.storage_event_id
       WHERE binding.organisation_id = p_organisation_id
         AND event.organisation_id = p_organisation_id
         AND event.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.vault_items AS vault
       INNER JOIN public.documents AS document
         ON document.id = vault.source_document_id
       WHERE vault.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.requirements AS external_requirement
       INNER JOIN public.documents AS document
         ON document.id = external_requirement.source_doc_id
       WHERE external_requirement.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_requirement.project_id
               IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.evidence_items AS external_evidence
       INNER JOIN public.documents AS document
         ON document.id = external_evidence.document_id
       WHERE external_evidence.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_evidence.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.boq_checks AS external_check
       INNER JOIN public.documents AS document
         ON document.id = external_check.source_doc_id
       WHERE external_check.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_check.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.defects AS external_defect
       INNER JOIN public.requirements AS requirement
         ON requirement.id = external_defect.requirement_id
       WHERE external_defect.organisation_id = p_organisation_id
         AND requirement.organisation_id = p_organisation_id
         AND requirement.project_id = p_subject_project_id
         AND external_defect.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.defect_decisions AS external_decision
       INNER JOIN public.defects AS defect
         ON defect.id = external_decision.defect_id
       WHERE external_decision.organisation_id = p_organisation_id
         AND defect.organisation_id = p_organisation_id
         AND defect.project_id = p_subject_project_id
         AND external_decision.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.addendum_impact_assessments AS external_assessment
       INNER JOIN public.document_versions AS version
         ON version.id = external_assessment.baseline_document_version_id
         OR version.id = external_assessment.revision_document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE external_assessment.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_assessment.project_id
               IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.boq_runs AS external_run
       INNER JOIN public.document_versions AS version
         ON version.id = external_run.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE external_run.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_run.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_context_artifacts AS external_artifact
       INNER JOIN public.document_versions AS version
         ON version.id = external_artifact.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE external_artifact.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_artifact.project_id
               IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_context_versions AS external_context
       INNER JOIN public.document_versions AS version
         ON version.id = external_context.primary_document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE external_context.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_context.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.draft_versions AS external_version
       INNER JOIN public.drafts AS external_draft
         ON external_draft.id = external_version.draft_id
       INNER JOIN public.processing_runs AS run
         ON run.id = external_version.model_run_id
       INNER JOIN public.processing_jobs AS job
         ON job.id = run.job_id
       WHERE external_version.organisation_id = p_organisation_id
         AND external_draft.organisation_id = p_organisation_id
         AND run.organisation_id = p_organisation_id
         AND job.organisation_id = p_organisation_id
         AND job.project_id = p_subject_project_id
         AND external_draft.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_context_requirements AS external_binding
       INNER JOIN public.requirements AS requirement
         ON requirement.id = external_binding.requirement_id
       INNER JOIN public.requirement_citations AS citation
         ON citation.id = external_binding.requirement_citation_id
       INNER JOIN public.requirements AS citation_requirement
         ON citation_requirement.id = citation.requirement_id
       WHERE external_binding.organisation_id = p_organisation_id
         AND requirement.organisation_id = p_organisation_id
         AND citation.organisation_id = p_organisation_id
         AND citation_requirement.organisation_id = p_organisation_id
         AND (
           requirement.project_id = p_subject_project_id
           OR citation_requirement.project_id = p_subject_project_id
         )
         AND external_binding.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_eligibility_passports AS external_passport
       INNER JOIN public.tender_context_versions AS context
         ON context.id = external_passport.tender_context_version_id
       WHERE external_passport.organisation_id = p_organisation_id
         AND context.organisation_id = p_organisation_id
         AND context.project_id = p_subject_project_id
         AND external_passport.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.requirement_citations AS external_citation
       INNER JOIN public.requirements AS external_requirement
         ON external_requirement.id = external_citation.requirement_id
       INNER JOIN public.document_versions AS version
         ON version.id = external_citation.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE external_citation.organisation_id = p_organisation_id
         AND external_requirement.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_requirement.project_id
               IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.processing_jobs AS external_job
       INNER JOIN public.document_versions AS version
         ON version.id = external_job.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       WHERE external_job.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND external_job.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_context_versions AS successor
       INNER JOIN public.tender_context_versions AS context
         ON context.id = successor.supersedes_context_version_id
       WHERE successor.organisation_id = p_organisation_id
         AND context.organisation_id = p_organisation_id
         AND context.project_id = p_subject_project_id
         AND successor.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.evidence_items AS external_evidence
       INNER JOIN public.requirements AS requirement
         ON requirement.id = external_evidence.requirement_id
       WHERE external_evidence.organisation_id = p_organisation_id
         AND requirement.organisation_id = p_organisation_id
         AND requirement.project_id = p_subject_project_id
         AND external_evidence.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.work_tasks AS external_task
       INNER JOIN public.requirements AS requirement
         ON requirement.id = external_task.requirement_id
       WHERE external_task.organisation_id = p_organisation_id
         AND requirement.organisation_id = p_organisation_id
         AND requirement.project_id = p_subject_project_id
         AND external_task.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_context_artifacts AS external_artifact
       INNER JOIN public.tender_context_versions AS context
         ON context.id = external_artifact.tender_context_version_id
       WHERE external_artifact.organisation_id = p_organisation_id
         AND context.organisation_id = p_organisation_id
         AND context.project_id = p_subject_project_id
         AND external_artifact.project_id
               IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.tender_context_requirements AS external_binding
       INNER JOIN public.tender_context_versions AS context
         ON context.id = external_binding.tender_context_version_id
       WHERE external_binding.organisation_id = p_organisation_id
         AND context.organisation_id = p_organisation_id
         AND context.project_id = p_subject_project_id
         AND external_binding.project_id IS DISTINCT FROM p_subject_project_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.claim_evidence_links AS external_link
       INNER JOIN public.document_versions AS version
         ON version.id = external_link.document_version_id
       INNER JOIN public.documents AS document
         ON document.id = version.document_id
       INNER JOIN public.draft_claims AS claim
         ON claim.id = external_link.draft_claim_id
       INNER JOIN public.draft_versions AS draft_version
         ON draft_version.id = claim.draft_version_id
       INNER JOIN public.drafts AS draft
         ON draft.id = draft_version.draft_id
       WHERE external_link.organisation_id = p_organisation_id
         AND version.organisation_id = p_organisation_id
         AND document.organisation_id = p_organisation_id
         AND claim.organisation_id = p_organisation_id
         AND draft_version.organisation_id = p_organisation_id
         AND draft.organisation_id = p_organisation_id
         AND document.project_id = p_subject_project_id
         AND draft.project_id IS DISTINCT FROM p_subject_project_id
     ) THEN
    RAISE EXCEPTION 'protected retention records are not releasable'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.legal_holds AS hold
  SET project_id = NULL,
      version = hold.version + 1,
      updated_at = pg_catalog.transaction_timestamp()
  WHERE hold.organisation_id = p_organisation_id
    AND hold.project_id = p_subject_project_id
    AND hold.status = 'released';
  GET DIAGNOSTICS detached_legal_hold_rows = ROW_COUNT;

  UPDATE public.orders AS retained_order
  SET project_id = NULL,
      version = retained_order.version + 1,
      updated_at = pg_catalog.transaction_timestamp()
  WHERE retained_order.organisation_id = p_organisation_id
    AND retained_order.project_id = p_subject_project_id
    AND retained_order.status = 'paid_manual';
  GET DIAGNOSTICS detached_order_rows = ROW_COUNT;

  UPDATE public.entitlement_usage AS usage
  SET project_id = NULL
  WHERE usage.organisation_id = p_organisation_id
    AND usage.project_id = p_subject_project_id;
  GET DIAGNOSTICS detached_entitlement_usage_rows = ROW_COUNT;

  -- Delete manifest-bound cross-branch leaves in a deterministic order before
  -- the project cascade. Their RESTRICT references point at other rows in the
  -- same governed graph; relying on PostgreSQL cascade-trigger creation order
  -- would make otherwise valid purges nondeterministic.
  DELETE FROM public.tender_eligibility_passports AS passport
  WHERE passport.organisation_id = p_organisation_id
    AND passport.project_id = p_subject_project_id;

  DELETE FROM public.tender_context_requirements AS context_requirement
  WHERE context_requirement.organisation_id = p_organisation_id
    AND context_requirement.project_id = p_subject_project_id;

  DELETE FROM public.tender_context_artifacts AS artifact
  WHERE artifact.organisation_id = p_organisation_id
    AND artifact.project_id = p_subject_project_id;

  DELETE FROM public.addendum_impact_assessments AS assessment
  WHERE assessment.organisation_id = p_organisation_id
    AND assessment.project_id = p_subject_project_id;

  DELETE FROM public.boq_runs AS run
  WHERE run.organisation_id = p_organisation_id
    AND run.project_id = p_subject_project_id;

  DELETE FROM public.claim_evidence_links AS link
  USING public.draft_claims AS claim,
        public.draft_versions AS version,
        public.drafts AS draft
  WHERE link.organisation_id = p_organisation_id
    AND link.draft_claim_id = claim.id
    AND claim.organisation_id = p_organisation_id
    AND claim.draft_version_id = version.id
    AND version.organisation_id = p_organisation_id
    AND version.draft_id = draft.id
    AND draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id;

  DELETE FROM public.draft_claims AS claim
  USING public.draft_versions AS version,
        public.drafts AS draft
  WHERE claim.organisation_id = p_organisation_id
    AND claim.draft_version_id = version.id
    AND version.organisation_id = p_organisation_id
    AND version.draft_id = draft.id
    AND draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id;

  DELETE FROM public.draft_versions AS version
  USING public.drafts AS draft
  WHERE version.organisation_id = p_organisation_id
    AND version.draft_id = draft.id
    AND draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id;

  DELETE FROM public.drafts AS draft
  WHERE draft.organisation_id = p_organisation_id
    AND draft.project_id = p_subject_project_id;

  DELETE FROM public.requirement_citations AS citation
  USING public.requirements AS requirement
  WHERE citation.organisation_id = p_organisation_id
    AND citation.requirement_id = requirement.id
    AND requirement.organisation_id = p_organisation_id
    AND requirement.project_id = p_subject_project_id;

  DELETE FROM public.defect_decisions AS decision
  WHERE decision.organisation_id = p_organisation_id
    AND decision.project_id = p_subject_project_id;

  -- Superseded tender-context versions use a self-RESTRICT lineage. Remove
  -- leaves first; a cycle or external successor leaves rows behind and fails
  -- closed rather than rewriting the immutable lineage.
  LOOP
    DELETE FROM public.tender_context_versions AS context
    WHERE context.organisation_id = p_organisation_id
      AND context.project_id = p_subject_project_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.tender_context_versions AS successor
        WHERE successor.supersedes_context_version_id = context.id
      );
    GET DIAGNOSTICS deleted_internal_rows = ROW_COUNT;
    EXIT WHEN deleted_internal_rows = 0;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.tender_context_versions AS context
    WHERE context.organisation_id = p_organisation_id
      AND context.project_id = p_subject_project_id
  ) THEN
    RAISE EXCEPTION 'tender context lineage cannot be safely purged'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.document_version_snapshots AS snapshot
  USING public.document_versions AS version,
        public.documents AS document
  WHERE snapshot.organisation_id = p_organisation_id
    AND snapshot.document_version_id = version.id
    AND version.organisation_id = p_organisation_id
    AND version.document_id = document.id
    AND document.organisation_id = p_organisation_id
    AND document.project_id = p_subject_project_id;
  GET DIAGNOSTICS deleted_document_version_snapshot_rows = ROW_COUNT;

  post_purge_action_version := p_expected_action_version + 1;
  purge_timestamp_text := pg_catalog.to_char(
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  purge_receipt_text :=
    '{"actionVersionAfter":' || post_purge_action_version::text ||
    ',"actionVersionBefore":' || p_expected_action_version::text ||
    ',"deletedDocumentVersionSnapshotRows":' ||
      deleted_document_version_snapshot_rows::text ||
    ',"deletedProjectRows":1' ||
    ',"detachedEntitlementUsageRows":' ||
      detached_entitlement_usage_rows::text ||
    ',"detachedLegalHoldRows":' || detached_legal_hold_rows::text ||
    ',"detachedOrderRows":' || detached_order_rows::text ||
    ',"method":"owner_held_manifest_bound_project_purge"' ||
    ',"organisationId":' ||
      pg_catalog.to_json(p_organisation_id::text)::text ||
    ',"purgedAt":' || pg_catalog.to_json(purge_timestamp_text)::text ||
    ',"retentionActionId":' ||
      pg_catalog.to_json(p_retention_action_id::text)::text ||
    ',"retentionRequestId":' ||
      pg_catalog.to_json(p_retention_request_id::text)::text ||
    ',"schema":"valo.retention-project-purge-receipt/v1"' ||
    ',"sourceManifestSha256":' ||
      pg_catalog.to_json(p_source_manifest_sha256)::text ||
    ',"subjectProjectId":' ||
      pg_catalog.to_json(p_subject_project_id::text)::text || '}';
  purge_receipt_digest := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(purge_receipt_text, 'UTF8')
    ),
    'hex'
  );

  UPDATE public.retention_actions AS action
  SET purge_receipt = purge_receipt_text,
      purge_receipt_sha256 = purge_receipt_digest,
      purged_at = pg_catalog.transaction_timestamp(),
      version = post_purge_action_version,
      updated_at = pg_catalog.transaction_timestamp()
  WHERE action.id = p_retention_action_id
    AND action.organisation_id = p_organisation_id
    AND action.retention_request_id = p_retention_request_id
    AND action.subject_project_id = p_subject_project_id
    AND action.completion_protocol_version = 1
    AND action.status = 'detached'
    AND action.version = p_expected_action_version
    AND action.source_manifest_sha256 = p_source_manifest_sha256
    AND action.purge_receipt IS NULL;
  GET DIAGNOSTICS stamped_action_rows = ROW_COUNT;
  IF stamped_action_rows <> 1 THEN
    RAISE EXCEPTION 'retention purge receipt CAS stamp failed'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.projects AS project
  WHERE project.organisation_id = p_organisation_id
    AND project.id = p_subject_project_id
    AND project.version = project_version;
  GET DIAGNOSTICS deleted_project_rows = ROW_COUNT;

  IF deleted_project_rows <> 1 THEN
    RAISE EXCEPTION 'retention project CAS delete failed'
      USING ERRCODE = '55000';
  END IF;
  purge_receipt_sha256 := purge_receipt_digest;
  RETURN NEXT;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.purge_retention_project(
  uuid,uuid,uuid,uuid,text,integer
) FROM PUBLIC;
--> statement-breakpoint

-- Preserve the exact 0010 graph as its own attestable boundary, then extend
-- only the two direct tenant-parent edges introduced by the binding table.
ALTER FUNCTION valo_security.expected_tenant_parent_edges()
  RENAME TO expected_tenant_parent_edges_v10;
--> statement-breakpoint
CREATE FUNCTION valo_security.expected_tenant_parent_edges()
RETURNS TABLE (
  child_table text,
  child_column text,
  parent_table text,
  parent_column text,
  allow_global_parent boolean
)
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT *
  FROM valo_security.expected_tenant_parent_edges_v10()
  UNION ALL
  SELECT *
  FROM (VALUES
    ('retention_action_storage_events','retention_action_id','retention_actions','id',false),
    ('retention_action_storage_events','storage_event_id','notification_events','id',false)
  ) AS edge(child_table, child_column, parent_table, parent_column, allow_global_parent);
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.expected_tenant_parent_edges_v10()
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.expected_tenant_parent_edges()
  FROM PUBLIC;
--> statement-breakpoint

DO $retention_tenant_parent_triggers$
DECLARE
  edge record;
  trigger_name text;
BEGIN
  FOR edge IN
    SELECT * FROM (VALUES
      ('retention_action_storage_events','retention_action_id','retention_actions','id',false),
      ('retention_action_storage_events','storage_event_id','notification_events','id',false)
    ) AS manifest(child_table, child_column, parent_table, parent_column, allow_global_parent)
    ORDER BY child_table, child_column
  LOOP
    trigger_name := pg_catalog.left('tenant_parent_' || edge.child_column, 63);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organisation_id, %I ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_tenant_parent(%L, %L, %L, %L)',
      trigger_name,
      edge.child_column,
      edge.child_table,
      edge.parent_table,
      edge.parent_column,
      edge.child_column,
      edge.allow_global_parent::text
    );
  END LOOP;
END;
$retention_tenant_parent_triggers$;
--> statement-breakpoint

ALTER TABLE public.retention_action_storage_events
  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_action_storage_events
  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation
  ON public.retention_action_storage_events
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (organisation_id = valo_security.current_organisation_id())
  WITH CHECK (organisation_id = valo_security.current_organisation_id());
--> statement-breakpoint

-- The application may advance CAS-governed state, but it cannot erase any
-- request, action, binding or certificate, nor rewrite an issued certificate.
-- Production activation is still blocked, so the owner-held purge routine has
-- no runtime grant; a separately reviewed workload identity is required later.
DO $retention_runtime_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.retention_action_storage_events
      TO valo_app_runtime;
    GRANT SELECT, INSERT ON TABLE
      public.deletion_certificates
      TO valo_app_runtime;
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.retention_actions,
      public.retention_requests
      TO valo_app_runtime;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
      public.deletion_certificates,
      public.retention_actions,
      public.retention_action_storage_events,
      public.retention_requests
      FROM valo_app_runtime;
    REVOKE UPDATE ON TABLE public.deletion_certificates
      FROM valo_app_runtime;
    REVOKE DELETE ON TABLE
      public.document_version_snapshots,
      public.projects
      FROM valo_app_runtime;
    REVOKE EXECUTE ON FUNCTION valo_security.purge_retention_project(
      uuid,uuid,uuid,uuid,text,integer
    ) FROM valo_app_runtime;
  END IF;
END;
$retention_runtime_grant$;
