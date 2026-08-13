-- MANUAL, DESTRUCTIVE, NON-PRODUCTION ROLLBACK ONLY.
--
-- This file is intentionally outside migrations/ so the forward migrator can
-- never discover it. Run it only from a controlled psql session after setting
-- both session values below (do not edit the guard out):
--
--   SET app.environment = 'development';
--   SET app.allow_tenant_rls_rollback =
--     'I_UNDERSTAND_DATA_ISOLATION_WILL_BE_DISABLED';
--   \i lib/db/tenant-rls.rollback.dev.sql
--
-- The script refuses unset/production environments, refuses database names
-- containing "prod", and requires the exact acknowledgement. It removes only
-- policies created by 0001_tenant_rls.sql. Re-applying the forward migration is
-- the recovery path. Never use this to troubleshoot a production incident.

BEGIN;

DO $guard$
DECLARE
  declared_environment text := lower(
    COALESCE(pg_catalog.current_setting('app.environment', true), '')
  );
  acknowledgement text := COALESCE(
    pg_catalog.current_setting('app.allow_tenant_rls_rollback', true),
    ''
  );
BEGIN
  IF declared_environment NOT IN ('local', 'development', 'test', 'ci') THEN
    RAISE EXCEPTION
      'tenant RLS rollback refused: app.environment must explicitly be local, development, test, or ci';
  END IF;

  IF pg_catalog.current_database() ~* 'prod' THEN
    RAISE EXCEPTION
      'tenant RLS rollback refused: database name appears to be production';
  END IF;

  IF acknowledgement <> 'I_UNDERSTAND_DATA_ISOLATION_WILL_BE_DISABLED' THEN
    RAISE EXCEPTION
      'tenant RLS rollback refused: explicit acknowledgement is missing';
  END IF;
END;
$guard$;

DO $rollback$
DECLARE
  tenant_table text;
  policy_name text;
  protected_tables constant text[] := ARRAY[
    'approvals',
    'authenticated_rate_limit_buckets',
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
    'evaluation_cases',
    'evaluation_results',
    'evaluation_runs',
    'evidence_items',
    'export_deliveries',
    'feature_flags',
    'integration_configurations',
    'integration_receipts',
    'invoice_lines',
    'invoices',
    'legal_holds',
    'legacy_audit_events',
    'legacy_audit_integrity_assessments',
    'llm_runs',
    'model_configurations',
    'nda_records',
    'notification_attempts',
    'notification_events',
    'orders',
    'outcomes',
    'package_manifest_items',
    'package_signoffs',
    'package_versions',
    'packages',
    'partner_branding',
    'partner_revenue_share_entries',
    'payments',
    'price_book_entries',
    'price_books',
    'privacy_records',
    'processing_jobs',
    'processing_runs',
    'projects',
    'prompt_configurations',
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
  migration_policy_names constant text[] := ARRAY[
    'tenant_isolation',
    'tenant_select',
    'tenant_or_global_select',
    'tenant_insert',
    'tenant_update',
    'tenant_delete'
  ]::text[];
BEGIN
  FOREACH tenant_table IN ARRAY protected_tables LOOP
    FOREACH policy_name IN ARRAY migration_policy_names LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_name,
        tenant_table
      );
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tenant_table);
  END LOOP;
END;
$rollback$;

DROP FUNCTION IF EXISTS valo_security.set_current_organisation_id(uuid);
DROP FUNCTION IF EXISTS valo_security.current_organisation_id();

-- Audit immutability is independent of tenant RLS and deliberately survives
-- this development-only rollback. Therefore valo_security is retained with
-- only the append-only trigger functions if no other objects remain.

COMMIT;
