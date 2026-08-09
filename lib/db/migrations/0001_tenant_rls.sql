-- Valo tenant row-level security.
--
-- Runtime contract (fail closed): every tenant-scoped unit of work must use one
-- checked-out connection and one explicit transaction, call
--
--   SELECT valo_security.set_current_organisation_id($1::uuid);
--
-- after authenticating/authorising the requested organisation, and perform all
-- tenant queries before COMMIT/ROLLBACK on that same connection. The setter uses
-- set_config(..., true), so the value cannot survive the transaction. Missing,
-- blank and malformed contexts expose no tenant rows (malformed UUIDs error).
--
-- There is deliberately no role-name, user-role or platform-admin bypass. FORCE
-- ROW LEVEL SECURITY applies the policies to table owners too. PostgreSQL
-- superusers and roles explicitly created WITH BYPASSRLS remain an operational
-- deployment concern and must never be used by the application pool.
--
-- Five control-plane discovery tables are deliberately outside this migration:
-- organisations, organisation_memberships, role_grants, partner_relationships,
-- and break_glass_sessions. Authentication must read those tables to prove an
-- organisation before the tenant transaction/GUC exists. They are not tenant
-- resource repositories and must remain reachable only through the narrowly
-- filtered control-plane authorisation queries. This exception is not an admin
-- bypass and must not be copied to any tenant-resource table.

CREATE SCHEMA IF NOT EXISTS valo_security;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA valo_security FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION valo_security.current_organisation_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('app.current_organisation_id', true), '')::uuid
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION valo_security.set_current_organisation_id(
  p_organisation_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_organisation_id IS NULL THEN
    RAISE EXCEPTION 'organisation context cannot be null'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.set_config(
    'app.current_organisation_id',
    p_organisation_id::text,
    true
  );
END;
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION valo_security.current_organisation_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.set_current_organisation_id(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA valo_security TO PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION valo_security.current_organisation_id() TO PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION valo_security.set_current_organisation_id(uuid) TO PUBLIC;
--> statement-breakpoint

COMMENT ON FUNCTION valo_security.set_current_organisation_id(uuid) IS
  'Sets app.current_organisation_id transaction-locally; call only after application authorisation and inside an explicit transaction.';
--> statement-breakpoint

-- Audit chains are tenant-local under RLS. Every organisation begins at seq=1,
-- so a global sequence uniqueness constraint would make the second tenant's
-- first event fail. The tenant key is also included in the application hash.
ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_seq_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS public.audit_events_seq_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_organisation_seq_unique
  ON public.audit_events (organisation_id, seq)
  WHERE seq IS NOT NULL;
--> statement-breakpoint
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.audit_events WHERE organisation_id IS NULL) THEN
    RAISE EXCEPTION
      'audit_events contains legacy NULL organisation_id rows; backfill them to an authorised tenant before applying RLS';
  END IF;
END;
$migration$;
--> statement-breakpoint
ALTER TABLE public.audit_events
  ALTER COLUMN organisation_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.audit_anchors
  ALTER COLUMN organisation_id SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_anchors_organisation_sequence_idx
  ON public.audit_anchors (organisation_id, last_sequence);
--> statement-breakpoint

-- Report versions are immutable project-local sequence numbers. This unique
-- backstop prevents concurrent generators from silently creating two vN rows.
CREATE UNIQUE INDEX IF NOT EXISTS reports_project_version_unique
  ON public.reports (project_id, version);
--> statement-breakpoint

-- Direct tenant tables. NULL organisation_id values are legacy/unassigned and
-- intentionally become invisible until an authorised backfill assigns them.
DO $migration$
DECLARE
  tenant_table text;
  strict_organisation_tables constant text[] := ARRAY[
    'approvals',
    'audit_anchors',
    'audit_events',
    'benchmark_consents',
    'boq_checks',
    'boq_exceptions',
    'boq_runs',
    'capability_evidence_links',
    'capability_items',
    'capability_usage',
    'capability_versions',
    'claim_evidence_links',
    'clients',
    'comments',
    'conflict_records',
    'consent_records',
    'cross_border_transfers',
    'data_subject_requests',
    'defect_decisions',
    'defects',
    'deletion_certificates',
    'document_versions',
    'documents',
    'draft_claims',
    'draft_versions',
    'drafts',
    'engagement_tender_lots',
    'entitlement_usage',
    'entitlements',
    'evaluation_runs',
    'evidence_items',
    'export_deliveries',
    'integration_configurations',
    'integration_receipts',
    'invoices',
    'legal_holds',
    'llm_runs',
    'nda_records',
    'notification_attempts',
    'notification_events',
    'orders',
    'outcomes',
    'package_manifest_items',
    'package_signoffs',
    'package_versions',
    'packages',
    'payments',
    'privacy_records',
    'processing_jobs',
    'processing_runs',
    'projects',
    'red_team_findings',
    'red_team_runs',
    'renewal_monitors',
    'reports',
    'requirement_citations',
    'requirements',
    'retention_actions',
    'retention_requests',
    'reviews',
    'rule_evaluations',
    'rule_overrides',
    'sbd_annotations',
    'sbd_templates',
    'subprocessors',
    'subscriptions',
    'tender_lots',
    'tenders',
    'upload_sessions',
    'vault_item_versions',
    'vault_items',
    'vault_usage',
    'work_tasks'
  ]::text[];
BEGIN
  FOREACH tenant_table IN ARRAY strict_organisation_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO PUBLIC USING (organisation_id = valo_security.current_organisation_id()) WITH CHECK (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
  END LOOP;
END;
$migration$;
--> statement-breakpoint

-- These tables intentionally support immutable global defaults. A tenant may
-- SELECT a NULL-scoped default, but tenant traffic can INSERT/UPDATE/DELETE only
-- rows stamped with its exact organisation. This prevents a tenant from
-- mutating global defaults through an ALL policy's USING clause.
DO $migration$
DECLARE
  tenant_table text;
  shared_organisation_tables constant text[] := ARRAY[
    'evaluation_cases',
    'feature_flags',
    'model_configurations',
    'price_books',
    'prompt_configurations'
  ]::text[];
BEGIN
  FOREACH tenant_table IN ARRAY shared_organisation_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_or_global_select ON public.%I FOR SELECT TO PUBLIC USING (organisation_id = valo_security.current_organisation_id() OR organisation_id IS NULL)',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT TO PUBLIC WITH CHECK (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE TO PUBLIC USING (organisation_id = valo_security.current_organisation_id()) WITH CHECK (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE TO PUBLIC USING (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
  END LOOP;
END;
$migration$;
--> statement-breakpoint

ALTER TABLE public.partner_branding ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.partner_branding FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.partner_branding
  FOR ALL TO PUBLIC
  USING (partner_organisation_id = valo_security.current_organisation_id())
  WITH CHECK (partner_organisation_id = valo_security.current_organisation_id());
--> statement-breakpoint

ALTER TABLE public.partner_revenue_share_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.partner_revenue_share_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.partner_revenue_share_entries
  FOR ALL TO PUBLIC
  USING (
    partner_organisation_id = valo_security.current_organisation_id()
    OR client_organisation_id = valo_security.current_organisation_id()
  )
  WITH CHECK (
    partner_organisation_id = valo_security.current_organisation_id()
    OR client_organisation_id = valo_security.current_organisation_id()
  );
--> statement-breakpoint

-- Parent-derived child table: global price-book entries are readable, but only
-- entries under a tenant-owned price book are mutable by tenant traffic.
ALTER TABLE public.price_book_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.price_book_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_or_global_select ON public.price_book_entries
  FOR SELECT TO PUBLIC
  USING (
    EXISTS (
      SELECT 1
      FROM public.price_books AS book
      WHERE book.id = price_book_entries.price_book_id
        AND (
          book.organisation_id = valo_security.current_organisation_id()
          OR book.organisation_id IS NULL
        )
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_insert ON public.price_book_entries
  FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.price_books AS book
      WHERE book.id = price_book_entries.price_book_id
        AND book.organisation_id = valo_security.current_organisation_id()
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_update ON public.price_book_entries
  FOR UPDATE TO PUBLIC
  USING (
    EXISTS (
      SELECT 1
      FROM public.price_books AS book
      WHERE book.id = price_book_entries.price_book_id
        AND book.organisation_id = valo_security.current_organisation_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.price_books AS book
      WHERE book.id = price_book_entries.price_book_id
        AND book.organisation_id = valo_security.current_organisation_id()
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_delete ON public.price_book_entries
  FOR DELETE TO PUBLIC
  USING (
    EXISTS (
      SELECT 1
      FROM public.price_books AS book
      WHERE book.id = price_book_entries.price_book_id
        AND book.organisation_id = valo_security.current_organisation_id()
    )
  );
--> statement-breakpoint

-- Parent-derived child table: invoice lines inherit exactly one invoice tenant.
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invoice_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.invoice_lines
  FOR ALL TO PUBLIC
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices AS invoice
      WHERE invoice.id = invoice_lines.invoice_id
        AND invoice.organisation_id = valo_security.current_organisation_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices AS invoice
      WHERE invoice.id = invoice_lines.invoice_id
        AND invoice.organisation_id = valo_security.current_organisation_id()
    )
  );
--> statement-breakpoint

-- Parent-derived child table: the run must be tenant-owned. A result may use a
-- tenant case or immutable global case, never another tenant's case.
ALTER TABLE public.evaluation_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.evaluation_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.evaluation_results
  FOR ALL TO PUBLIC
  USING (
    EXISTS (
      SELECT 1
      FROM public.evaluation_runs AS run
      WHERE run.id = evaluation_results.evaluation_run_id
        AND run.organisation_id = valo_security.current_organisation_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.evaluation_cases AS evaluation_case
      WHERE evaluation_case.id = evaluation_results.evaluation_case_id
        AND (
          evaluation_case.organisation_id = valo_security.current_organisation_id()
          OR evaluation_case.organisation_id IS NULL
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.evaluation_runs AS run
      WHERE run.id = evaluation_results.evaluation_run_id
        AND run.organisation_id = valo_security.current_organisation_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.evaluation_cases AS evaluation_case
      WHERE evaluation_case.id = evaluation_results.evaluation_case_id
        AND (
          evaluation_case.organisation_id = valo_security.current_organisation_id()
          OR evaluation_case.organisation_id IS NULL
        )
    )
  );
--> statement-breakpoint

-- Intentionally global/non-tenant relations are not RLS-scoped here:
-- app_config (single platform configuration), users (identity directory only),
-- jurisdiction_rule_packs/jurisdiction_rules (approved shared rules), and
-- benchmark_cohorts/benchmark_releases (privacy-reviewed aggregate products).
-- Tenant-owned consent and outcome source rows remain protected above. The
-- separately listed control-plane discovery exception is security-sensitive and
-- exists only because organisation proof necessarily precedes the tenant GUC.
