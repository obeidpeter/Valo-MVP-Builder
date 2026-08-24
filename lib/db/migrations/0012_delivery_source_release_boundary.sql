-- Delivery Studio release boundary.
--
-- Every row that contributes to the exact Delivery Studio source hash or the
-- report release decision takes a project KEY SHARE lock before it changes.
-- Report sign-off takes FOR UPDATE on the same project row, so an in-flight
-- mutation completes before the final readiness check, while a mutation
-- queued behind sign-off observes the terminal project state and fails closed.

CREATE OR REPLACE FUNCTION public.valo_delivery_source_project_id(
  source_table name,
  source_row jsonb
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  resolved_project_id uuid;
BEGIN
  CASE source_table
    WHEN 'documents' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'requirements' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'evidence_items' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'drafts' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'defects' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'boq_checks' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'red_team_runs' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'reviews' THEN
      resolved_project_id := NULLIF(source_row ->> 'project_id', '')::uuid;
    WHEN 'document_versions' THEN
      SELECT document.project_id
      INTO resolved_project_id
      FROM public.documents AS document
      WHERE document.id = NULLIF(source_row ->> 'document_id', '')::uuid;
    WHEN 'document_version_snapshots' THEN
      SELECT document.project_id
      INTO resolved_project_id
      FROM public.document_versions AS version
      INNER JOIN public.documents AS document ON document.id = version.document_id
      WHERE version.id = NULLIF(source_row ->> 'document_version_id', '')::uuid;
    WHEN 'draft_versions' THEN
      SELECT draft.project_id
      INTO resolved_project_id
      FROM public.drafts AS draft
      WHERE draft.id = NULLIF(source_row ->> 'draft_id', '')::uuid;
    WHEN 'draft_claims' THEN
      SELECT draft.project_id
      INTO resolved_project_id
      FROM public.draft_versions AS version
      INNER JOIN public.drafts AS draft ON draft.id = version.draft_id
      WHERE version.id = NULLIF(source_row ->> 'draft_version_id', '')::uuid;
    WHEN 'claim_evidence_links' THEN
      SELECT draft.project_id
      INTO resolved_project_id
      FROM public.draft_claims AS claim
      INNER JOIN public.draft_versions AS version ON version.id = claim.draft_version_id
      INNER JOIN public.drafts AS draft ON draft.id = version.draft_id
      WHERE claim.id = NULLIF(source_row ->> 'draft_claim_id', '')::uuid;
    WHEN 'red_team_findings' THEN
      SELECT run.project_id
      INTO resolved_project_id
      FROM public.red_team_runs AS run
      WHERE run.id = NULLIF(source_row ->> 'red_team_run_id', '')::uuid;
    ELSE
      RAISE EXCEPTION 'Unsupported Delivery Studio source table: %', source_table
        USING ERRCODE = '22023';
  END CASE;

  RETURN resolved_project_id;
END;
$$;

-- A client DELETE cascades into projects before any project-scoped child
-- trigger can distinguish the original statement. Require the effective
-- identity of the governed SECURITY DEFINER purge at the project boundary so
-- direct and client-cascade deletion share the same owner-held authority.
CREATE OR REPLACE FUNCTION public.valo_guard_delivery_project_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  retention_purge_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(routine.proowner)::name
  INTO retention_purge_owner
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(
    'valo_security.purge_retention_project(uuid,uuid,uuid,uuid,text,integer)'
  )
    AND routine.prosecdef;

  IF CURRENT_USER::name IS DISTINCT FROM retention_purge_owner THEN
    RAISE EXCEPTION 'Project deletion requires the governed retention purge owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS delivery_project_delete_guard ON public.projects;
CREATE TRIGGER delivery_project_delete_guard
BEFORE DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_project_delete();

CREATE OR REPLACE FUNCTION public.valo_assert_delivery_project_mutable(
  source_project_id uuid,
  allow_terminal_delete boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  project_status text;
  retention_purge_owner name;
  authorized_retention_owner boolean := false;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(routine.proowner)::name
  INTO retention_purge_owner
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(
    'valo_security.purge_retention_project(uuid,uuid,uuid,uuid,text,integer)'
  )
    AND routine.prosecdef;
  authorized_retention_owner :=
    retention_purge_owner IS NOT NULL
    AND CURRENT_USER::name = retention_purge_owner;

  IF source_project_id IS NULL THEN
    -- A child BEFORE DELETE trigger can run after its guarded parent row has
    -- already been removed, so the FK-resolved project id is no longer
    -- available. Updates may only lose the binding during the governed
    -- retention purge's ON DELETE SET NULL cascades.
    IF allow_terminal_delete OR authorized_retention_owner THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Delivery Studio source row is not bound to a project'
      USING ERRCODE = '23503';
  END IF;

  SELECT project.status
  INTO project_status
  FROM public.projects AS project
  WHERE project.id = source_project_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    -- FK cascades run after their guarded owner has been deleted. Ordinary
    -- child deletes may pass, while SET NULL updates are reserved for the
    -- governed SECURITY DEFINER retention purge.
    IF allow_terminal_delete OR authorized_retention_owner THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Delivery Studio source project % does not exist', source_project_id
      USING ERRCODE = '23503';
  END IF;

  IF
    project_status IN ('signed_off', 'exported', 'archived')
    AND NOT authorized_retention_owner
  THEN
    RAISE EXCEPTION 'Delivery Studio source is immutable after project release'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.valo_guard_delivery_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_project_id uuid;
  next_project_id uuid;
  guarded_project_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    previous_project_id := public.valo_delivery_source_project_id(
      TG_TABLE_NAME::name,
      to_jsonb(OLD)
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    next_project_id := public.valo_delivery_source_project_id(
      TG_TABLE_NAME::name,
      to_jsonb(NEW)
    );
  END IF;

  IF TG_OP = 'UPDATE' AND previous_project_id IS DISTINCT FROM next_project_id THEN
    RAISE EXCEPTION 'Delivery Studio source rows cannot move between projects'
      USING ERRCODE = '55000';
  END IF;

  guarded_project_id := COALESCE(next_project_id, previous_project_id);
  -- Only the SECURITY DEFINER owner identity reached through the governed
  -- retention purge may delete released source material. Ordinary deletes
  -- still serialize with sign-off and remain forbidden once terminal.
  PERFORM public.valo_assert_delivery_project_mutable(
    guarded_project_id,
    TG_OP = 'DELETE'
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.documents;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.document_versions;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.document_versions
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.document_version_snapshots;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.document_version_snapshots
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.requirements;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.requirements
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.evidence_items;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_items
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.drafts;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.drafts
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.draft_versions;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.draft_versions
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.draft_claims;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.draft_claims
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.claim_evidence_links;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.claim_evidence_links
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.defects;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.defects
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.boq_checks;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.boq_checks
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.red_team_runs;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.red_team_runs
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.red_team_findings;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.red_team_findings
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

DROP TRIGGER IF EXISTS delivery_source_project_guard ON public.reviews;
CREATE TRIGGER delivery_source_project_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.valo_guard_delivery_source_mutation();

-- The project trigger is the authoritative cascade boundary; these revokes
-- additionally prevent the production runtime from initiating either a
-- direct project DELETE or its client-owned cascade path.
DO $delivery_runtime_privilege_boundary$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    REVOKE DELETE ON TABLE public.clients, public.projects
      FROM valo_app_runtime;
  END IF;
END;
$delivery_runtime_privilege_boundary$;
