-- Valo Replit legacy-v1 -> Nigeria v2.5 bridge.
--
-- This is one self-contained PostgreSQL transaction. It is intentionally not
-- part of the normal fresh-database migration chain: it upgrades only the
-- exact 19-table, unjournalled schema at commit
-- b71adcec4a7060c0ce2192266c81d880c5e56277, or the exact pinned Replit
-- production push-managed lineage. The canonical 0000/0001/0002
-- definitions are embedded below and checked by scripts/run-legacy-bridge.mjs.
--
-- Replace every __VALO_BRIDGE_*__ token only through the runner (preferred) or
-- from a reviewed deployment record before using a provider SQL console.
-- Unknown, partial, or already-different schemas abort before durable changes.

BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '10min';
SET LOCAL statement_timeout = '10min';
SET LOCAL search_path = pg_catalog, public;
SET LOCAL TIME ZONE 'UTC';

-- Acquire the data lock before the first source snapshot. NOWAIT prevents an
-- apparently successful bridge over a database the application is still using.
LOCK TABLE
  public.app_config, public.audit_events, public.boq_checks,
  public.capability_items, public.clients, public.conflict_records,
  public.defects, public.documents, public.evidence_items, public.llm_runs,
  public.notification_events, public.projects, public.reports,
  public.requirements, public.retention_requests, public.sbd_annotations,
  public.sbd_templates, public.users, public.vault_items
IN ACCESS EXCLUSIVE MODE NOWAIT;

SELECT pg_advisory_xact_lock(564142502025::bigint);

-- VALO_BRIDGE_RUNNER_BODY_BEGIN

CREATE TEMPORARY TABLE _valo_bridge_inputs (
  acknowledgement text NOT NULL,
  expected_database text NOT NULL,
  expected_legacy_lineage text NOT NULL,
  expected_counts_text text NOT NULL,
  expected_audit_head_seq_text text NOT NULL,
  expected_audit_head_hash text NOT NULL,
  runtime_role text NOT NULL,
  runtime_password text NOT NULL,
  expected_audit_export_content text NOT NULL,
  platform_admin_clerk_user_id text NOT NULL,
  archive_digest text NOT NULL,
  boundary_created_at text NOT NULL,
  boundary_details text NOT NULL,
  boundary_hash text NOT NULL,
  source_backup_sha256 text NOT NULL,
  source_audit_export_sha256 text NOT NULL,
  rehearsal_evidence_sha256 text NOT NULL,
  migration_0000_hash text NOT NULL,
  migration_0001_hash text NOT NULL,
  migration_0002_hash text NOT NULL
) ON COMMIT DROP;

INSERT INTO _valo_bridge_inputs VALUES (
  '__VALO_BRIDGE_ACK__',
  '__VALO_BRIDGE_EXPECTED_DATABASE__',
  '__VALO_BRIDGE_EXPECTED_LEGACY_LINEAGE__',
  '__VALO_BRIDGE_EXPECTED_COUNTS_JSON__',
  '__VALO_BRIDGE_EXPECTED_AUDIT_HEAD_SEQ__',
  '__VALO_BRIDGE_EXPECTED_AUDIT_HEAD_HASH__',
  '__VALO_BRIDGE_RUNTIME_ROLE__',
  COALESCE(current_setting('valo.bridge.runtime_password', true), ''),
  COALESCE(current_setting('valo.bridge.source_audit_export', true), ''),
  '__VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID__',
  '__VALO_BRIDGE_ARCHIVE_DIGEST__',
  '__VALO_BRIDGE_BOUNDARY_CREATED_AT__',
  '__VALO_BRIDGE_BOUNDARY_DETAILS__',
  '__VALO_BRIDGE_BOUNDARY_HASH__',
  '__VALO_BRIDGE_SOURCE_BACKUP_SHA256__',
  '__VALO_BRIDGE_SOURCE_AUDIT_EXPORT_SHA256__',
  '__VALO_BRIDGE_REHEARSAL_EVIDENCE_SHA256__',
  '__VALO_BRIDGE_MIGRATION_0000_HASH__',
  '__VALO_BRIDGE_MIGRATION_0001_HASH__',
  '__VALO_BRIDGE_MIGRATION_0002_HASH__'
);

CREATE TEMPORARY TABLE _valo_bridge_state (
  is_legacy boolean NOT NULL,
  is_complete boolean NOT NULL,
  production_assurance_expected boolean NOT NULL,
  retrieval_registry_expected boolean NOT NULL,
  tender_context_expected boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMPORARY TABLE _valo_expected_legacy_columns (
  table_name text PRIMARY KEY,
  column_names text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO _valo_expected_legacy_columns VALUES
  ('app_config', ARRAY['id','severity_weight_fatal','severity_weight_likely_fatal','severity_weight_scoring_risk','severity_weight_cosmetic','missing_evidence_weight','band_medium_cutoff','band_high_cutoff','band_critical_cutoff','firm_name','confidentiality_legend','retention_default_days','updated_at','updated_by']),
  ('audit_events', ARRAY['id','user_id','user_name','project_id','event_type','object_type','object_id','details','seq','prev_hash','hash','row_no','created_at']),
  ('boq_checks', ARRAY['id','project_id','source_doc_id','line_ref','description','quantity','unit_rate','extension','computed_extension','quantity_raw','unit_rate_kobo','extension_kobo','computed_extension_kobo','check_type','finding','severity','status','created_at']),
  ('capability_items', ARRAY['id','client_id','claim_type','description','evidence_doc_id','approved_status','verifier_id','verifier_name','verified_at','created_at']),
  ('clients', ARRAY['id','name','sector','segment','contact_name','contact_email','nda_status','notes','decision_maker_conversations','junior_conversations','created_at']),
  ('conflict_records', ARRAY['id','client_id','project_id','tender_ref','lot','matched_project_id','status','decision','rationale','decided_by','decided_at','created_at']),
  ('defects', ARRAY['id','project_id','requirement_id','type','severity','description','evidence_snapshot','remediation','owner','status','suggested','created_at']),
  ('documents', ARRAY['id','project_id','type','filename','object_path','content_type','size','sha256','source','date_received','redaction_status','uploaded_by','content_text','extracted_chars','extraction_status','extraction_method','extraction_confidence','extraction_notes','created_at']),
  ('evidence_items', ARRAY['id','project_id','requirement_id','document_id','evidence_status','excerpt','notes','suggested','confirmed_by','created_at']),
  ('llm_runs', ARRAY['id','project_id','task','model','prompt_version','input_hash','output_summary','prompt_tokens','completion_tokens','error','created_at']),
  ('notification_events', ARRAY['id','project_id','client_id','vault_item_id','channel','template','recipient','payload','status','created_by','created_at']),
  ('projects', ARRAY['id','client_id','tender_title','issuing_entity','tender_ref','lot','deadline','value_band','segment','submission_status','status','reviewer_id','sla_class','payment_status','payment_confirmed_by_founder','payment_confirmed_by_advisor','payment_confirmed_at','payment_founder_confirmed_by','payment_founder_confirmed_by_name','payment_founder_confirmed_at','payment_advisor_confirmed_by','payment_advisor_confirmed_by_name','payment_advisor_confirmed_at','conflict_status','conflict_decision','conflict_rationale','physical_archive_instruction','redaction_scope','restricted_mode','risk_score','risk_band','risk_override_band','risk_override_note','risk_override_by','outcome','mandate_quality','scope','limitations','responsiveness_review','responsiveness_suggested','created_at']),
  ('reports', ARRAY['id','project_id','version','status','docx_path','pdf_path','reviewer_id','reviewer_name','attestation','engine_version','prompt_pack_version','model_id','taxonomy_version','signed_off_at','generated_by','created_at']),
  ('requirements', ARRAY['id','project_id','source_doc_id','page_ref','clause_ref','text','category','expected_evidence','is_mandatory','confidence','review_status','reviewer_notes','origin','engine_text','merged_citations','reviewed_by','reviewed_by_name','reviewed_at','created_at']),
  ('retention_requests', ARRAY['id','project_id','requested_by','reason','due_at','completed_at','certificate_text','status','created_at']),
  ('sbd_annotations', ARRAY['id','template_id','agency','section','kind','quirk','created_at']),
  ('sbd_templates', ARRAY['id','code','title','category','version','status','issuing_circular','summary','created_at']),
  ('users', ARRAY['id','clerk_user_id','email','name','role','status','last_login_at','created_at']),
  ('vault_items', ARRAY['id','client_id','artefact_type','issuer','issue_date','expiry_date','renewal_lead_days','status','object_path','sha256','source_document_id','created_at']);

DO $preflight$
DECLARE
  inputs _valo_bridge_inputs%ROWTYPE;
  legacy_tables constant text[] := ARRAY[
    'app_config','audit_events','boq_checks','capability_items','clients',
    'conflict_records','defects','documents','evidence_items','llm_runs',
    'notification_events','projects','reports','requirements',
    'retention_requests','sbd_annotations','sbd_templates','users','vault_items'
  ];
  target_tables constant text[] := ARRAY[
    'app_config','approvals','audit_anchors','audit_events','benchmark_cohorts',
    'benchmark_consents','benchmark_releases','boq_checks','boq_exceptions',
    'boq_runs','break_glass_sessions','capability_evidence_links',
    'capability_items','capability_usage','capability_versions',
    'claim_evidence_links','clients','comments','conflict_records',
    'consent_records','cross_border_transfers','data_subject_requests',
    'defect_decisions','defects','deletion_certificates','document_versions',
    'documents','draft_claims','draft_versions','drafts',
    'engagement_tender_lots','entitlement_usage','entitlements',
    'evaluation_cases','evaluation_results','evaluation_runs','evidence_items',
    'export_deliveries','feature_flags','integration_configurations',
    'integration_receipts','invoice_lines','invoices','jurisdiction_rule_packs',
    'jurisdiction_rules','legal_holds','legacy_audit_events',
    'legacy_audit_integrity_assessments','llm_runs','model_configurations',
    'nda_records','notification_attempts','notification_events','orders',
    'organisation_memberships','organisations','outcomes',
    'package_manifest_items','package_signoffs','package_versions','packages',
    'partner_branding','partner_relationships','partner_revenue_share_entries',
    'payments','price_book_entries','price_books','privacy_records',
    'processing_jobs','processing_runs','projects','prompt_configurations',
    'red_team_findings','red_team_runs','renewal_monitors','reports',
    'requirement_citations','requirements','retention_actions',
    'retention_requests','reviews','role_grants','rule_evaluations',
    'rule_overrides','sbd_annotations','sbd_templates','subprocessors',
    'subscriptions','tender_lots','tenders','upload_sessions','users',
    'vault_item_versions','vault_items','vault_usage','work_tasks'
  ];
  rls_tables constant text[] := ARRAY[
    'approvals','audit_anchors','audit_events','benchmark_consents','boq_checks',
    'boq_exceptions','boq_runs','capability_evidence_links','capability_items',
    'capability_usage','capability_versions','claim_evidence_links','clients',
    'comments','conflict_records','consent_records','cross_border_transfers',
    'data_subject_requests','defect_decisions','defects','deletion_certificates',
    'document_versions','documents','draft_claims','draft_versions','drafts',
    'engagement_tender_lots','entitlement_usage','entitlements',
    'evaluation_cases','evaluation_results','evaluation_runs','evidence_items',
    'export_deliveries','feature_flags','integration_configurations',
    'integration_receipts','invoice_lines','invoices','legal_holds',
    'legacy_audit_events','legacy_audit_integrity_assessments','llm_runs',
    'model_configurations','nda_records','notification_attempts',
    'notification_events','orders','outcomes','package_manifest_items',
    'package_signoffs','package_versions','packages','partner_branding',
    'partner_revenue_share_entries','payments','price_book_entries',
    'price_books','privacy_records','processing_jobs','processing_runs',
    'projects','prompt_configurations','red_team_findings','red_team_runs',
    'renewal_monitors','reports','requirement_citations','requirements',
    'retention_actions','retention_requests','reviews','rule_evaluations',
    'rule_overrides','sbd_annotations','sbd_templates','subprocessors',
    'subscriptions','tender_lots','tenders','upload_sessions',
    'vault_item_versions','vault_items','vault_usage','work_tasks'
  ];
  tender_context_tables constant text[] := ARRAY[
    'addendum_impact_assessments','addendum_impact_items',
    'document_version_snapshots','tender_context_artifacts',
    'tender_context_requirements','tender_context_versions',
    'tender_eligibility_passports'
  ];
  actual_tables text[];
  actual_rls_tables text[];
  any_rls_table_count integer;
  actual_sequence_names text[];
  unexpected_relation_count integer;
  public_enum_count integer;
  expected_count_keys text[];
  policy_count integer;
  authenticated_rate_limit_policy_matches boolean;
  has_hash_version boolean;
  legacy_match boolean;
  complete_match boolean;
  production_assurance_match boolean;
  retrieval_registry_match boolean;
  tender_context_match boolean;
  tender_context_policy_matches boolean;
BEGIN
  SELECT * INTO STRICT inputs FROM _valo_bridge_inputs;
  IF inputs.acknowledgement <> 'RESTORE_VERIFIED_AND_APPLICATION_QUIESCED' THEN
    RAISE EXCEPTION 'bridge acknowledgement is absent or incorrect';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='public'
  ) THEN
    RAISE EXCEPTION 'unexpected public-schema function could shadow privileged bridge SQL';
  END IF;
  IF inputs.expected_database <> current_database() THEN
    RAISE EXCEPTION 'wrong database: expected %, connected to %',
      inputs.expected_database, current_database();
  END IF;
  IF inputs.expected_legacy_lineage NOT IN (
    'replit-legacy-v1-canonical',
    'replit-legacy-v1-production-push-managed'
  ) THEN
    RAISE EXCEPTION 'legacy lineage is not one of the two pinned fingerprints';
  END IF;
  IF inputs.runtime_role <> 'valo_app_runtime' THEN
    RAISE EXCEPTION 'runtime role must be the fixed valo_app_runtime login';
  END IF;
  IF inputs.runtime_role = current_user THEN
    RAISE EXCEPTION 'runtime role must be separate from the migration/owner role';
  END IF;
  IF length(inputs.runtime_password) < 32
     OR inputs.runtime_password LIKE '%__VALO_BRIDGE_%' THEN
    RAISE EXCEPTION 'runtime password must be an injected secret of at least 32 characters';
  END IF;
  IF inputs.expected_audit_export_content = '' THEN
    RAISE EXCEPTION 'private source audit export was not injected';
  END IF;
  IF inputs.platform_admin_clerk_user_id = ''
     OR inputs.platform_admin_clerk_user_id LIKE '%__VALO_BRIDGE_%' THEN
    RAISE EXCEPTION 'one explicit platform-admin Clerk user ID is required';
  END IF;
  IF inputs.expected_audit_head_seq_text !~ '^[1-9][0-9]*$'
     OR inputs.expected_audit_head_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'expected audit head must be a positive sequence and lower-case SHA-256';
  END IF;
  IF inputs.migration_0000_hash !~ '^[0-9a-f]{64}$'
     OR inputs.migration_0001_hash !~ '^[0-9a-f]{64}$'
     OR inputs.migration_0002_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'migration hashes must be lower-case SHA-256 values';
  END IF;
  IF inputs.archive_digest !~ '^[0-9a-f]{64}$'
     OR inputs.boundary_hash !~ '^[0-9a-f]{64}$'
     OR inputs.source_backup_sha256 !~ '^[0-9a-f]{64}$'
     OR inputs.source_audit_export_sha256 !~ '^[0-9a-f]{64}$'
     OR inputs.rehearsal_evidence_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'evidence/archive/boundary hashes must be lower-case SHA-256 values';
  END IF;
  BEGIN
    PERFORM inputs.boundary_created_at::timestamptz;
    PERFORM inputs.boundary_details::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'boundary timestamp/details are malformed';
  END;

  BEGIN
    IF jsonb_typeof(inputs.expected_counts_text::jsonb) <> 'object' THEN
      RAISE EXCEPTION 'expected counts must be a JSON object';
    END IF;
    SELECT array_agg(key ORDER BY key)
      INTO expected_count_keys
      FROM jsonb_object_keys(inputs.expected_counts_text::jsonb) AS key;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'expected counts is not valid JSON';
  END;
  IF cardinality(expected_count_keys) IS DISTINCT FROM cardinality(legacy_tables)
     OR NOT COALESCE(
       expected_count_keys @> legacy_tables
       AND legacy_tables @> expected_count_keys,
       false
     ) THEN
    RAISE EXCEPTION 'expected counts must contain exactly the 19 legacy table names';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each_text(inputs.expected_counts_text::jsonb) AS entry
    WHERE entry.value !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'every expected table count must be a non-negative integer';
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO actual_tables
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_events'
      AND column_name = 'hash_version'
  ) INTO has_hash_version;

  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO actual_rls_tables
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity AND c.relforcerowsecurity;
  SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname='public';
  SELECT count(*) = 1
      AND COALESCE(bool_and(
        policy.polname = 'tenant_isolation'
        AND policy.polpermissive
        AND policy.polcmd = '*'
        AND policy.polroles = ARRAY[0::oid]
        AND pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
        AND pg_catalog.pg_get_expr(
          policy.polwithcheck, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
      ), false)
    INTO authenticated_rate_limit_policy_matches
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid=policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND relation.relname='authenticated_rate_limit_buckets';
  SELECT count(*) = cardinality(tender_context_tables)
      AND COALESCE(bool_and(
        policy.polname = 'tenant_isolation'
        AND policy.polpermissive
        AND policy.polcmd = '*'
        AND policy.polroles = ARRAY[0::oid]
        AND pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
        AND pg_catalog.pg_get_expr(
          policy.polwithcheck, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
      ), false)
    INTO tender_context_policy_matches
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid=policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND relation.relname = ANY(tender_context_tables);
  SELECT count(*) INTO any_rls_table_count
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (c.relrowsecurity OR c.relforcerowsecurity);
  SELECT array_agg(c.relname ORDER BY c.relname) INTO actual_sequence_names
    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S';
  SELECT count(*) INTO unexpected_relation_count
    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m','f','p');
  SELECT count(*) INTO public_enum_count
    FROM pg_type AS t JOIN pg_namespace AS n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typtype='e';

  legacy_match := COALESCE(
      cardinality(actual_tables)=cardinality(legacy_tables)
      AND actual_tables @> legacy_tables
      AND legacy_tables @> actual_tables,
      false
    )
    AND NOT has_hash_version
    AND any_rls_table_count = 0
    AND policy_count = 0
    AND actual_sequence_names = ARRAY['audit_events_row_no_seq']::text[]
    AND unexpected_relation_count = 0
    AND public_enum_count = 0
    AND to_regnamespace('valo_legacy_bridge_archive') IS NULL
    AND to_regnamespace('valo_security') IS NULL
    AND to_regclass('drizzle.__drizzle_migrations') IS NULL;

  complete_match := false;
  production_assurance_match := false;
  -- 0009's registry table is global (never RLS) and only ever exists on top
  -- of the 0008 production-assurance catalog, so it adjusts the table count
  -- without touching the RLS or policy expectations.
  retrieval_registry_match := COALESCE(
    'ai_retrieval_registry' = ANY(actual_tables),
    false
  );
  tender_context_match := COALESCE(
    actual_tables @> tender_context_tables
      AND actual_rls_tables @> tender_context_tables
      AND retrieval_registry_match
      AND tender_context_policy_matches,
    false
  );
  IF has_hash_version
     AND to_regnamespace('valo_legacy_bridge_archive') IS NULL THEN
    production_assurance_match := COALESCE(
      cardinality(actual_tables) = cardinality(target_tables) + 1
        + retrieval_registry_match::integer
        + (tender_context_match::integer * cardinality(tender_context_tables))
      AND actual_tables @> target_tables
      AND 'authenticated_rate_limit_buckets' = ANY(actual_tables)
      AND NOT ('ai_retrieval_registry' = ANY(actual_rls_tables))
      AND cardinality(actual_rls_tables) = cardinality(rls_tables) + 1
        + (tender_context_match::integer * cardinality(tender_context_tables))
      AND actual_rls_tables @> rls_tables
      AND 'authenticated_rate_limit_buckets' = ANY(actual_rls_tables)
      AND policy_count = 105
        + (tender_context_match::integer * cardinality(tender_context_tables))
      AND authenticated_rate_limit_policy_matches,
      false
    );
    IF COALESCE(
         cardinality(actual_tables)=cardinality(target_tables)
         AND actual_tables @> target_tables
         AND target_tables @> actual_tables
         AND cardinality(actual_rls_tables)=cardinality(rls_tables)
         AND actual_rls_tables @> rls_tables
         AND rls_tables @> actual_rls_tables
         AND policy_count = 104,
         false
       ) OR production_assurance_match THEN
      SELECT EXISTS (
        SELECT 1 FROM public.organisations
        WHERE id = '56414c4f-0000-5000-8000-000000000025'::uuid
          AND name = 'Valo Nigeria' AND slug = 'valo-nigeria' AND type = 'valo'
      ) INTO complete_match;
    END IF;
  END IF;

  IF legacy_match THEN
    INSERT INTO _valo_bridge_state VALUES (true, false, false, false, false);
  ELSIF complete_match THEN
    INSERT INTO _valo_bridge_state
      VALUES (
        false,
        true,
        production_assurance_match,
        production_assurance_match AND retrieval_registry_match,
        production_assurance_match AND tender_context_match
      );
  ELSE
    RAISE EXCEPTION
      'schema is neither the exact unjournalled legacy baseline nor the fully reconciled v2.5 target';
  END IF;
END;
$preflight$;

CREATE TEMPORARY TABLE _valo_effective_legacy_columns (
  table_name text PRIMARY KEY,
  column_names text[] NOT NULL
) ON COMMIT DROP;

CREATE TEMPORARY TABLE _valo_production_push_managed_columns (
  table_name text PRIMARY KEY,
  column_names text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO _valo_production_push_managed_columns VALUES
  ('app_config', ARRAY['id','severity_weight_fatal','severity_weight_likely_fatal','severity_weight_scoring_risk','severity_weight_cosmetic','missing_evidence_weight','band_medium_cutoff','band_high_cutoff','band_critical_cutoff','firm_name','confidentiality_legend','retention_default_days','updated_at','updated_by']),
  ('audit_events', ARRAY['id','user_id','user_name','project_id','event_type','object_type','object_id','details','created_at','seq','prev_hash','hash','row_no']),
  ('boq_checks', ARRAY['id','project_id','source_doc_id','line_ref','description','quantity','unit_rate','extension','computed_extension','check_type','finding','severity','status','created_at','quantity_raw','unit_rate_kobo','extension_kobo','computed_extension_kobo']),
  ('capability_items', ARRAY['id','client_id','claim_type','description','evidence_doc_id','approved_status','created_at','verifier_id','verifier_name','verified_at']),
  ('clients', ARRAY['id','name','sector','segment','contact_name','contact_email','nda_status','notes','created_at','decision_maker_conversations','junior_conversations']),
  ('conflict_records', ARRAY['id','client_id','project_id','tender_ref','lot','matched_project_id','status','decision','rationale','decided_by','decided_at','created_at']),
  ('defects', ARRAY['id','project_id','requirement_id','type','severity','description','evidence_snapshot','remediation','owner','status','suggested','created_at']),
  ('documents', ARRAY['id','project_id','type','filename','object_path','content_type','size','source','date_received','redaction_status','uploaded_by','content_text','extracted_chars','extraction_status','created_at','sha256']),
  ('evidence_items', ARRAY['id','project_id','requirement_id','document_id','evidence_status','excerpt','notes','suggested','confirmed_by','created_at']),
  ('llm_runs', ARRAY['id','project_id','task','model','prompt_version','input_hash','output_summary','error','created_at']),
  ('notification_events', ARRAY['id','project_id','client_id','vault_item_id','channel','template','recipient','payload','status','created_by','created_at']),
  ('projects', ARRAY['id','client_id','tender_title','issuing_entity','tender_ref','deadline','value_band','segment','submission_status','status','reviewer_id','risk_score','risk_band','risk_override_band','risk_override_note','risk_override_by','outcome','scope','limitations','responsiveness_review','responsiveness_suggested','created_at','lot','sla_class','payment_status','payment_confirmed_by_founder','payment_confirmed_by_advisor','payment_confirmed_at','conflict_status','conflict_decision','conflict_rationale','physical_archive_instruction','redaction_scope','restricted_mode','payment_founder_confirmed_by','payment_founder_confirmed_by_name','payment_founder_confirmed_at','payment_advisor_confirmed_by','payment_advisor_confirmed_by_name','payment_advisor_confirmed_at','mandate_quality']),
  ('reports', ARRAY['id','project_id','version','status','docx_path','reviewer_id','reviewer_name','attestation','engine_version','signed_off_at','generated_by','created_at','prompt_pack_version','model_id','pdf_path']),
  ('requirements', ARRAY['id','project_id','source_doc_id','page_ref','clause_ref','text','category','expected_evidence','is_mandatory','confidence','review_status','reviewer_notes','created_at','origin','engine_text','reviewed_by','reviewed_by_name','reviewed_at','merged_citations']),
  ('retention_requests', ARRAY['id','project_id','requested_by','reason','due_at','completed_at','certificate_text','status','created_at']),
  ('sbd_annotations', ARRAY['id','template_id','agency','section','kind','quirk','created_at']),
  ('sbd_templates', ARRAY['id','code','title','category','version','status','issuing_circular','summary','created_at']),
  ('users', ARRAY['id','clerk_user_id','email','name','role','status','last_login_at','created_at']),
  ('vault_items', ARRAY['id','client_id','artefact_type','issuer','issue_date','expiry_date','renewal_lead_days','status','created_at','object_path','sha256','source_document_id']);

INSERT INTO _valo_effective_legacy_columns
SELECT expected.table_name,
  CASE
    WHEN inputs.expected_legacy_lineage =
      'replit-legacy-v1-production-push-managed'
    THEN production.column_names
    ELSE expected.column_names
  END
FROM _valo_expected_legacy_columns AS expected
JOIN _valo_production_push_managed_columns AS production
  ON production.table_name = expected.table_name
CROSS JOIN _valo_bridge_inputs AS inputs;

DO $complete_state_validation$
DECLARE
  inputs _valo_bridge_inputs%ROWTYPE;
  broken_links bigint;
  actual_audit_export_content text;
BEGIN
  IF NOT (SELECT is_complete FROM _valo_bridge_state) THEN
    RETURN;
  END IF;
  SELECT * INTO STRICT inputs FROM _valo_bridge_inputs;

  IF (SELECT count(*) FROM public.legacy_audit_integrity_assessments
      WHERE id='56414c4f-0000-5000-8000-000000000026'::uuid
        AND organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
        AND source_commit='b71adcec4a7060c0ce2192266c81d880c5e56277'
        AND source_event_count=28
        AND verified_ranges='1-7,27-28'
        AND discontinuity_ranges='8-26'
        AND finding LIKE 'KNOWN_DISCONTINUITY:%'
        AND external_head_seq=inputs.expected_audit_head_seq_text::integer
        AND external_head_hash=inputs.expected_audit_head_hash
        AND source_backup_sha256=inputs.source_backup_sha256
        AND source_audit_export_sha256=inputs.source_audit_export_sha256
        AND rehearsal_evidence_sha256=inputs.rehearsal_evidence_sha256
        AND archive_digest=inputs.archive_digest) <> 1 THEN
    RAISE EXCEPTION 'completed bridge assessment does not match supplied evidence';
  END IF;

  IF (SELECT count(*) FROM public.legacy_audit_events
      WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid) <> 28
     OR (SELECT count(*) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
           AND assessment_id='56414c4f-0000-5000-8000-000000000026'::uuid
           AND integrity_status='known_discontinuity') <> 19
     OR (SELECT count(*) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
           AND assessment_id='56414c4f-0000-5000-8000-000000000026'::uuid
           AND integrity_status='payload_hash_verified') <> 9
     OR (SELECT min(seq) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid) <> 1
     OR (SELECT max(seq) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid) <> 28
     OR (SELECT min(row_no) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid) <> 49
     OR (SELECT max(row_no) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid) <> 560
     OR NOT EXISTS (
       SELECT 1 FROM public.legacy_audit_events
       WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
         AND seq=inputs.expected_audit_head_seq_text::integer
         AND hash=inputs.expected_audit_head_hash
     ) THEN
    RAISE EXCEPTION 'completed bridge archive inventory/classification/anchor changed';
  END IF;

  SELECT count(*) INTO broken_links
  FROM (
    SELECT seq, prev_hash,
      lag(hash, 1, repeat('0',64)) OVER (ORDER BY seq) AS expected_prev_hash
    FROM public.legacy_audit_events
    WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
  ) AS chain
  WHERE prev_hash <> expected_prev_hash;
  IF broken_links <> 0 THEN
    RAISE EXCEPTION 'completed bridge archive predecessor links changed';
  END IF;

  SELECT string_agg(row_to_json(source_row)::text, E'\n' ORDER BY source_row.seq)
           || E'\n'
    INTO actual_audit_export_content
  FROM (
    SELECT id,user_id,user_name,project_id,event_type,object_type,object_id,
      details,seq,prev_hash,hash,row_no,created_at
    FROM public.legacy_audit_events
    WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
    ORDER BY seq
  ) AS source_row;
  IF actual_audit_export_content IS DISTINCT FROM inputs.expected_audit_export_content THEN
    RAISE EXCEPTION 'completed bridge archive differs byte-for-byte from private evidence';
  END IF;

  IF (SELECT count(*) FROM public.audit_events
      WHERE id='56414c4f-0000-5000-8000-000000000027'::uuid
        AND organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
        AND event_type='audit.legacy_boundary_registered'
        AND object_type='legacy_audit_integrity_assessment'
        AND object_id='56414c4f-0000-5000-8000-000000000026'
        AND seq=1 AND prev_hash=repeat('0',64)
        AND hash=inputs.boundary_hash AND hash_version=2
        AND details=inputs.boundary_details
        AND created_at=inputs.boundary_created_at::timestamptz
        AND row_no=561) <> 1 THEN
    RAISE EXCEPTION 'completed bridge v2 boundary changed';
  END IF;
END;
$complete_state_validation$;

DO $legacy_validation$
DECLARE
  inputs _valo_bridge_inputs%ROWTYPE;
  expected record;
  actual_columns text[];
  actual_count bigint;
  broken_links bigint;
  external_dependencies bigint;
  actual_audit_export_content text;
BEGIN
  IF NOT (SELECT is_legacy FROM _valo_bridge_state) THEN
    RETURN;
  END IF;
  SELECT * INTO STRICT inputs FROM _valo_bridge_inputs;

  FOR expected IN SELECT * FROM _valo_effective_legacy_columns ORDER BY table_name LOOP
    SELECT array_agg(column_name ORDER BY ordinal_position)
      INTO actual_columns
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = expected.table_name;
    IF actual_columns IS DISTINCT FROM expected.column_names THEN
      RAISE EXCEPTION 'legacy column fingerprint mismatch for % in lineage %: expected %, got %',
        expected.table_name, inputs.expected_legacy_lineage,
        expected.column_names, actual_columns;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', expected.table_name)
      INTO actual_count;
    IF actual_count <> (inputs.expected_counts_text::jsonb ->> expected.table_name)::bigint THEN
      RAISE EXCEPTION 'source count changed for %: expected %, got %',
        expected.table_name,
        (inputs.expected_counts_text::jsonb ->> expected.table_name)::bigint,
        actual_count;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.users WHERE role NOT IN ('none','admin','reviewer','analyst')) THEN
    RAISE EXCEPTION 'unknown legacy user role; no role was guessed or discarded';
  END IF;
  IF (SELECT count(*) FROM public.users
      WHERE clerk_user_id=inputs.platform_admin_clerk_user_id
        AND status='active' AND role='admin') <> 1 THEN
    RAISE EXCEPTION 'platform-admin Clerk ID must match exactly one active legacy admin';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal
      AND relation.relname IN (SELECT table_name FROM _valo_expected_legacy_columns)
  ) THEN
    RAISE EXCEPTION 'unexpected user trigger exists on the legacy schema';
  END IF;

  SELECT count(*) INTO external_dependencies
  FROM pg_constraint AS constraint_record
  JOIN pg_class AS source_relation ON source_relation.oid = constraint_record.conrelid
  JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_relation.relnamespace
  WHERE constraint_record.contype = 'f'
    AND constraint_record.confrelid IN (
      SELECT format('public.%I', table_name)::regclass
      FROM _valo_expected_legacy_columns
    )
    AND NOT (
      source_namespace.nspname = 'public'
      AND source_relation.relname IN (SELECT table_name FROM _valo_expected_legacy_columns)
    );
  IF external_dependencies > 0 THEN
    RAISE EXCEPTION 'external foreign keys depend on the legacy tables';
  END IF;

  SELECT count(*) INTO external_dependencies
  FROM pg_depend AS dependency
  JOIN pg_rewrite AS rewrite ON rewrite.oid = dependency.objid
  JOIN pg_class AS view_relation ON view_relation.oid = rewrite.ev_class
  JOIN pg_namespace AS view_namespace ON view_namespace.oid = view_relation.relnamespace
  WHERE dependency.refobjid IN (
      SELECT format('public.%I', table_name)::regclass
      FROM _valo_expected_legacy_columns
    )
    AND view_relation.relkind IN ('v','m')
    AND view_namespace.nspname NOT IN ('pg_catalog','information_schema');
  IF external_dependencies > 0 THEN
    RAISE EXCEPTION 'user views depend on the legacy tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audit_events
    WHERE seq IS NULL OR prev_hash IS NULL OR hash IS NULL
       OR prev_hash !~ '^[0-9a-f]{64}$' OR hash !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'audit history contains unchained or malformed rows';
  END IF;
  IF (SELECT count(*) FROM public.audit_events) = 0 THEN
    RAISE EXCEPTION 'the recorded legacy audit anchor requires a non-empty chain';
  END IF;
  IF (SELECT min(seq) FROM public.audit_events) <> 1
     OR (SELECT max(seq) FROM public.audit_events) <> (SELECT count(*) FROM public.audit_events)
     OR (SELECT count(DISTINCT seq) FROM public.audit_events) <> (SELECT count(*) FROM public.audit_events)
     OR (SELECT count(DISTINCT row_no) FROM public.audit_events) <> (SELECT count(*) FROM public.audit_events) THEN
    RAISE EXCEPTION 'audit sequence/row ordinal uniqueness or contiguity failed';
  END IF;
  IF (SELECT min(row_no) FROM public.audit_events) <> 49
     OR (SELECT max(row_no) FROM public.audit_events) <> 560 THEN
    RAISE EXCEPTION 'legacy audit row_no recovery-point bounds changed';
  END IF;
  SELECT count(*) INTO broken_links
  FROM (
    SELECT seq, prev_hash,
      lag(hash, 1, repeat('0', 64)) OVER (ORDER BY seq) AS expected_prev_hash
    FROM public.audit_events
  ) AS chain
  WHERE prev_hash <> expected_prev_hash;
  IF broken_links > 0 THEN
    RAISE EXCEPTION 'audit predecessor links are broken';
  END IF;
  IF (SELECT count(*) FROM public.audit_events WHERE seq BETWEEN 8 AND 26) <> 19
     OR EXISTS (
       SELECT 1 FROM public.audit_events
       WHERE seq BETWEEN 8 AND 26
         AND (event_type <> 'project.export_denied'
              OR user_id IS NOT NULL OR user_name IS NULL)
     ) THEN
    RAISE EXCEPTION 'known legacy audit discontinuity shape is not the reviewed 8-26 segment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_events
    WHERE seq = inputs.expected_audit_head_seq_text::integer
      AND hash = inputs.expected_audit_head_hash
      AND seq = (SELECT max(seq) FROM public.audit_events)
  ) THEN
    RAISE EXCEPTION 'live audit head does not match the externally recorded head';
  END IF;

  SELECT string_agg(row_to_json(source_row)::text, E'\n' ORDER BY source_row.seq)
           || E'\n'
    INTO actual_audit_export_content
  FROM (
    SELECT id,user_id,user_name,project_id,event_type,object_type,object_id,
      details,seq,prev_hash,hash,row_no,created_at
    FROM public.audit_events
    ORDER BY seq
  ) AS source_row;
  IF actual_audit_export_content IS DISTINCT FROM inputs.expected_audit_export_content THEN
    RAISE EXCEPTION 'locked legacy audit bytes differ from the private evidence export';
  END IF;

END;
$legacy_validation$;

CREATE TEMPORARY TABLE _valo_bridge_orphans (
  relationship text NOT NULL,
  child_id text NOT NULL
) ON COMMIT DROP;

DO $orphan_validation$
BEGIN
  IF NOT (SELECT is_legacy FROM _valo_bridge_state) THEN
    RETURN;
  END IF;

  INSERT INTO _valo_bridge_orphans
  SELECT 'projects.client_id', p.id::text FROM public.projects p LEFT JOIN public.clients x ON x.id=p.client_id WHERE x.id IS NULL
  UNION ALL SELECT 'projects.reviewer_id', p.id::text FROM public.projects p LEFT JOIN public.users x ON x.id=p.reviewer_id WHERE p.reviewer_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'projects.payment_founder_confirmed_by', p.id::text FROM public.projects p LEFT JOIN public.users x ON x.id=p.payment_founder_confirmed_by WHERE p.payment_founder_confirmed_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'projects.payment_advisor_confirmed_by', p.id::text FROM public.projects p LEFT JOIN public.users x ON x.id=p.payment_advisor_confirmed_by WHERE p.payment_advisor_confirmed_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'documents.project_id', c.id::text FROM public.documents c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'documents.uploaded_by', c.id::text FROM public.documents c LEFT JOIN public.users x ON x.id=c.uploaded_by WHERE c.uploaded_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'requirements.project_id', c.id::text FROM public.requirements c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'requirements.source_doc_id', c.id::text FROM public.requirements c LEFT JOIN public.documents x ON x.id=c.source_doc_id WHERE c.source_doc_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'requirements.reviewed_by', c.id::text FROM public.requirements c LEFT JOIN public.users x ON x.id=c.reviewed_by WHERE c.reviewed_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'evidence_items.project_id', c.id::text FROM public.evidence_items c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'evidence_items.requirement_id', c.id::text FROM public.evidence_items c LEFT JOIN public.requirements x ON x.id=c.requirement_id WHERE x.id IS NULL
  UNION ALL SELECT 'evidence_items.document_id', c.id::text FROM public.evidence_items c LEFT JOIN public.documents x ON x.id=c.document_id WHERE c.document_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'evidence_items.confirmed_by', c.id::text FROM public.evidence_items c LEFT JOIN public.users x ON x.id=c.confirmed_by WHERE c.confirmed_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'defects.project_id', c.id::text FROM public.defects c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'defects.requirement_id', c.id::text FROM public.defects c LEFT JOIN public.requirements x ON x.id=c.requirement_id WHERE c.requirement_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'boq_checks.project_id', c.id::text FROM public.boq_checks c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'boq_checks.source_doc_id', c.id::text FROM public.boq_checks c LEFT JOIN public.documents x ON x.id=c.source_doc_id WHERE c.source_doc_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'vault_items.client_id', c.id::text FROM public.vault_items c LEFT JOIN public.clients x ON x.id=c.client_id WHERE x.id IS NULL
  UNION ALL SELECT 'vault_items.source_document_id', c.id::text FROM public.vault_items c LEFT JOIN public.documents x ON x.id=c.source_document_id WHERE c.source_document_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'capability_items.client_id', c.id::text FROM public.capability_items c LEFT JOIN public.clients x ON x.id=c.client_id WHERE x.id IS NULL
  UNION ALL SELECT 'capability_items.evidence_doc_id', c.id::text FROM public.capability_items c LEFT JOIN public.documents x ON x.id=c.evidence_doc_id WHERE c.evidence_doc_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'capability_items.verifier_id', c.id::text FROM public.capability_items c LEFT JOIN public.users x ON x.id=c.verifier_id WHERE c.verifier_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'conflict_records.client_id', c.id::text FROM public.conflict_records c LEFT JOIN public.clients x ON x.id=c.client_id WHERE c.client_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'conflict_records.project_id', c.id::text FROM public.conflict_records c LEFT JOIN public.projects x ON x.id=c.project_id WHERE c.project_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'conflict_records.matched_project_id', c.id::text FROM public.conflict_records c LEFT JOIN public.projects x ON x.id=c.matched_project_id WHERE c.matched_project_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'conflict_records.decided_by', c.id::text FROM public.conflict_records c LEFT JOIN public.users x ON x.id=c.decided_by WHERE c.decided_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'notification_events.project_id', c.id::text FROM public.notification_events c LEFT JOIN public.projects x ON x.id=c.project_id WHERE c.project_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'notification_events.client_id', c.id::text FROM public.notification_events c LEFT JOIN public.clients x ON x.id=c.client_id WHERE c.client_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'notification_events.vault_item_id', c.id::text FROM public.notification_events c LEFT JOIN public.vault_items x ON x.id=c.vault_item_id WHERE c.vault_item_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'notification_events.created_by', c.id::text FROM public.notification_events c LEFT JOIN public.users x ON x.id=c.created_by WHERE c.created_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'retention_requests.project_id', c.id::text FROM public.retention_requests c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'retention_requests.requested_by', c.id::text FROM public.retention_requests c LEFT JOIN public.users x ON x.id=c.requested_by WHERE c.requested_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'app_config.updated_by', c.id::text FROM public.app_config c LEFT JOIN public.users x ON x.id=c.updated_by WHERE c.updated_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'sbd_annotations.template_id', c.id::text FROM public.sbd_annotations c LEFT JOIN public.sbd_templates x ON x.id=c.template_id WHERE x.id IS NULL
  UNION ALL SELECT 'reports.project_id', c.id::text FROM public.reports c LEFT JOIN public.projects x ON x.id=c.project_id WHERE x.id IS NULL
  UNION ALL SELECT 'reports.reviewer_id', c.id::text FROM public.reports c LEFT JOIN public.users x ON x.id=c.reviewer_id WHERE c.reviewer_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'reports.generated_by', c.id::text FROM public.reports c LEFT JOIN public.users x ON x.id=c.generated_by WHERE c.generated_by IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'llm_runs.project_id', c.id::text FROM public.llm_runs c LEFT JOIN public.projects x ON x.id=c.project_id WHERE c.project_id IS NOT NULL AND x.id IS NULL
  UNION ALL SELECT 'audit_events.user_id', c.id::text FROM public.audit_events c LEFT JOIN public.users x ON x.id=c.user_id WHERE c.user_id IS NOT NULL AND x.id IS NULL;

  -- audit_events.project_id is deliberately not a foreign key: historical
  -- accountability events survive project deletion and are preserved exactly.
  IF EXISTS (SELECT 1 FROM _valo_bridge_orphans) THEN
    RAISE EXCEPTION 'legacy foreign-key orphans found: %',
      (SELECT string_agg(relationship || ':' || child_id, ', ' ORDER BY relationship, child_id)
       FROM _valo_bridge_orphans);
  END IF;
END;
$orphan_validation$;

DO $archive$
DECLARE
  table_to_move text;
BEGIN
  IF NOT (SELECT is_legacy FROM _valo_bridge_state) THEN
    RETURN;
  END IF;
  CREATE SCHEMA valo_legacy_bridge_archive;
  FOR table_to_move IN
    SELECT table_name FROM _valo_expected_legacy_columns ORDER BY table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I SET SCHEMA valo_legacy_bridge_archive',
      table_to_move
    );
  END LOOP;
END;
$archive$;

SET LOCAL search_path = pg_catalog, public;

-- BEGIN EMBEDDED IDEMPOTENT 0000 (generated from the checked-in migration).
CREATE TABLE IF NOT EXISTS public."app_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"severity_weight_fatal" integer DEFAULT 40 NOT NULL,
	"severity_weight_likely_fatal" integer DEFAULT 25 NOT NULL,
	"severity_weight_scoring_risk" integer DEFAULT 10 NOT NULL,
	"severity_weight_cosmetic" integer DEFAULT 3 NOT NULL,
	"missing_evidence_weight" integer DEFAULT 5 NOT NULL,
	"band_medium_cutoff" integer DEFAULT 15 NOT NULL,
	"band_high_cutoff" integer DEFAULT 40 NOT NULL,
	"band_critical_cutoff" integer DEFAULT 70 NOT NULL,
	"firm_name" text DEFAULT 'VALO' NOT NULL,
	"confidentiality_legend" text DEFAULT 'CONFIDENTIAL — Prepared for internal review. Not for external distribution.' NOT NULL,
	"retention_default_days" integer DEFAULT 14 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"approval_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"decision" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"evidence_snapshot_hash" text,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."audit_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"first_sequence" integer NOT NULL,
	"last_sequence" integer NOT NULL,
	"chain_head_hash" text NOT NULL,
	"provider" text NOT NULL,
	"immutable_object_reference" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"receipt_signature" text,
	"anchored_at" timestamp with time zone NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"user_id" uuid,
	"user_name" text,
	"project_id" uuid,
	"event_type" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"details" text,
	"seq" integer,
	"prev_hash" text,
	"hash" text,
	"row_no" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."benchmark_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"definition" text NOT NULL,
	"minimum_cohort_size" integer NOT NULL,
	"differencing_controls" text NOT NULL,
	"suppression_policy" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."benchmark_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"consent_record_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."benchmark_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"consent_snapshot_hash" text NOT NULL,
	"contributing_organisation_count" integer NOT NULL,
	"suppressed" boolean DEFAULT true NOT NULL,
	"aggregate_payload" text,
	"disclosure_review" text NOT NULL,
	"approved_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."boq_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"line_ref" text,
	"description" text,
	"quantity" double precision,
	"unit_rate" double precision,
	"extension" double precision,
	"computed_extension" double precision,
	"quantity_raw" text,
	"unit_rate_kobo" bigint,
	"extension_kobo" bigint,
	"computed_extension_kobo" bigint,
	"check_type" text NOT NULL,
	"finding" text NOT NULL,
	"severity" text DEFAULT 'scoring_risk' NOT NULL,
	"status" text DEFAULT 'flagged' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."boq_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"boq_run_id" uuid NOT NULL,
	"lot_reference" text,
	"sheet_name" text,
	"cell_reference" text,
	"exception_code" text NOT NULL,
	"severity" text NOT NULL,
	"expected_minor" bigint,
	"actual_minor" bigint,
	"currency" text,
	"finding" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_reason" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."boq_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"rule_pack_id" text NOT NULL,
	"verifier_version" text NOT NULL,
	"workbook_manifest" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"started_by_user_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."break_glass_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_organisation_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"reason" text NOT NULL,
	"incident_reference" text NOT NULL,
	"requested_permissions" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."capability_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"capability_version_id" uuid NOT NULL,
	"vault_item_version_id" uuid,
	"document_version_id" uuid,
	"citation" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."capability_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"description" text,
	"evidence_doc_id" uuid,
	"approved_status" text DEFAULT 'pending' NOT NULL,
	"verifier_id" uuid,
	"verifier_name" text,
	"verified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."capability_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"capability_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"draft_claim_id" uuid,
	"used_by_user_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."capability_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"capability_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"approved_claim" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"restrictions" text,
	"approval_state" text DEFAULT 'draft' NOT NULL,
	"reviewer_user_id" uuid,
	"approved_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."claim_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"draft_claim_id" uuid NOT NULL,
	"capability_version_id" uuid,
	"vault_item_version_id" uuid,
	"document_version_id" uuid,
	"evidence_citation" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"name" text NOT NULL,
	"sector" text,
	"segment" text,
	"contact_name" text,
	"contact_email" text,
	"nda_status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"decision_maker_conversations" integer DEFAULT 0 NOT NULL,
	"junior_conversations" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."conflict_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"tender_ref" text,
	"lot" text,
	"matched_project_id" uuid,
	"status" text DEFAULT 'blocked' NOT NULL,
	"decision" text,
	"rationale" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"privacy_record_id" uuid,
	"subject_reference" text NOT NULL,
	"purpose" text NOT NULL,
	"notice_version" text NOT NULL,
	"affirmative_action" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"evidence_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."cross_border_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"subprocessor_id" uuid,
	"exporter_role" text NOT NULL,
	"importer_role" text NOT NULL,
	"origin_country" text NOT NULL,
	"destination_country" text NOT NULL,
	"data_categories" text NOT NULL,
	"purpose" text NOT NULL,
	"transfer_basis" text NOT NULL,
	"approval_evidence" text,
	"legal_review_status" text DEFAULT 'pending' NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"requester_reference" text NOT NULL,
	"identity_verification_status" text DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"assigned_to_user_id" uuid,
	"response_evidence" text,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."defect_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"defect_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_severity" text NOT NULL,
	"proposed_severity" text,
	"reason" text NOT NULL,
	"evidence_ids" text NOT NULL,
	"initiated_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"evidence_snapshot" text,
	"remediation" text,
	"owner" text,
	"status" text DEFAULT 'open' NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."deletion_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"retention_action_id" uuid NOT NULL,
	"certificate_number" text NOT NULL,
	"scope_manifest_hash" text NOT NULL,
	"method" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"exceptions" text,
	"signed_by_user_id" uuid NOT NULL,
	"signature_evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"supersedes_version_id" uuid,
	"object_path" text NOT NULL,
	"sha256" text NOT NULL,
	"detected_mime" text NOT NULL,
	"detected_format" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"page_count" integer,
	"malware_status" text DEFAULT 'pending' NOT NULL,
	"quarantine_status" text DEFAULT 'quarantined' NOT NULL,
	"integrity_manifest" text NOT NULL,
	"addendum_status" text DEFAULT 'not_assessed' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"filename" text NOT NULL,
	"object_path" text NOT NULL,
	"content_type" text,
	"size" integer,
	"sha256" text,
	"source" text,
	"date_received" text,
	"redaction_status" text DEFAULT 'excluded' NOT NULL,
	"uploaded_by" uuid,
	"content_text" text,
	"extracted_chars" integer,
	"extraction_status" text DEFAULT 'pending',
	"extraction_method" text,
	"extraction_confidence" double precision,
	"extraction_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."draft_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"draft_version_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"claim_text" text NOT NULL,
	"claim_kind" text NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"grounding_status" text DEFAULT 'unverified' NOT NULL,
	"reviewer_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."draft_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_requirement_version_snapshot" text NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" uuid,
	"model_run_id" uuid,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_number" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."engagement_tender_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"tender_lot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."entitlement_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"project_id" uuid,
	"units" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_user_id" uuid,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"order_id" uuid,
	"subscription_id" uuid,
	"product_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"usage_consumed" integer DEFAULT 0 NOT NULL,
	"payment_state" text DEFAULT 'pending' NOT NULL,
	"feature_flag_key" text,
	"rules_version" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."evaluation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"corpus_version" text NOT NULL,
	"split" text NOT NULL,
	"task" text NOT NULL,
	"fixture_reference" text NOT NULL,
	"label_hash" text NOT NULL,
	"fatal_label_count" integer DEFAULT 0 NOT NULL,
	"likely_fatal_label_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."evaluation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"evaluation_case_id" uuid NOT NULL,
	"passed" boolean NOT NULL,
	"result_metrics" text NOT NULL,
	"output_hash" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"task" text NOT NULL,
	"corpus_version" text NOT NULL,
	"model_configuration_id" uuid,
	"prompt_configuration_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"metrics" text,
	"limitations" text,
	"release_decision" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"document_id" uuid,
	"evidence_status" text DEFAULT 'pending' NOT NULL,
	"excerpt" text,
	"notes" text,
	"suggested" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."export_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"delivery_channel" text NOT NULL,
	"recipient_reference" text,
	"signed_url_expires_at" timestamp with time zone,
	"delivery_receipt_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"exported_by_user_id" uuid NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"configuration" text,
	"commercial_gate" text,
	"updated_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."integration_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"adapter_type" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"secret_reference" text,
	"configuration" text NOT NULL,
	"production_approved" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."integration_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"adapter_type" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"signature_status" text NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"line_amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"currency" text NOT NULL,
	"net_amount_minor" bigint NOT NULL,
	"vat_rate_basis_points" integer NOT NULL,
	"vat_amount_minor" bigint NOT NULL,
	"gross_amount_minor" bigint NOT NULL,
	"wht_rate_basis_points" integer,
	"wht_amount_minor" bigint,
	"net_payable_minor" bigint NOT NULL,
	"tax_rule_id" text NOT NULL,
	"tax_point_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."jurisdiction_rule_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_key" text NOT NULL,
	"version" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"source_manifest_hash" text NOT NULL,
	"advisory_only" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."jurisdiction_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_pack_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"domain" text NOT NULL,
	"instrument" text NOT NULL,
	"source_urls" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"entity_scope" text NOT NULL,
	"category_scope" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"monetary_bands" text,
	"approval_owner" text,
	"evidence_requirements" text NOT NULL,
	"severity" text NOT NULL,
	"legal_review_status" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"supersedes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"placed_by_user_id" uuid NOT NULL,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid,
	"task" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_hash" text,
	"output_summary" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."model_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"configuration_version" integer NOT NULL,
	"configuration" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"evaluation_run_id" uuid,
	"promoted_by_user_id" uuid,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."nda_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid,
	"document_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"signer_name" text,
	"signer_authority" text,
	"signed_at" timestamp with time zone,
	"document_hash" text,
	"signature_evidence" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"notification_event_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"response_code" text,
	"response_summary" text,
	"next_attempt_at" timestamp with time zone,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid,
	"client_id" uuid,
	"vault_item_id" uuid,
	"channel" text DEFAULT 'manual' NOT NULL,
	"template" text NOT NULL,
	"recipient" text,
	"payload" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid,
	"price_book_entry_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"placed_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."organisation_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_starts_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"delegated_by_membership_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"country_code" text DEFAULT 'NG' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"captured_by_user_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_confirmed" boolean DEFAULT false NOT NULL,
	"debrief_reference" text,
	"reasons" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."package_manifest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"item_type" text NOT NULL,
	"source_object_id" uuid,
	"source_version" integer,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."package_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"signer_role" text NOT NULL,
	"signer_authority" text NOT NULL,
	"intent_statement" text NOT NULL,
	"document_hash" text NOT NULL,
	"trusted_timestamp" timestamp with time zone NOT NULL,
	"mfa_evidence" text NOT NULL,
	"device_event_evidence" text NOT NULL,
	"certificate_verification" text,
	"audit_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"docx_object_path" text,
	"docx_sha256" text,
	"pdf_object_path" text,
	"pdf_sha256" text,
	"zip_object_path" text,
	"zip_sha256" text,
	"render_qa_status" text DEFAULT 'pending' NOT NULL,
	"readiness_snapshot" text NOT NULL,
	"generated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"package_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_number" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."partner_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_organisation_id" uuid NOT NULL,
	"brand_name" text NOT NULL,
	"logo_object_path" text,
	"primary_colour" text,
	"secondary_colour" text,
	"footer_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."partner_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_organisation_id" uuid NOT NULL,
	"client_organisation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"client_ownership_rule" text DEFAULT 'client_retained' NOT NULL,
	"qa_responsibility" text,
	"co_signing_required" boolean DEFAULT false NOT NULL,
	"access_starts_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"approved_by_membership_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."partner_revenue_share_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_organisation_id" uuid NOT NULL,
	"client_organisation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"gross_revenue_minor" bigint NOT NULL,
	"share_rate_basis_points" integer NOT NULL,
	"share_amount_minor" bigint NOT NULL,
	"rule_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_id" uuid,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reconciliation_status" text DEFAULT 'pending' NOT NULL,
	"provider_event_hash" text,
	"settled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."price_book_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_kind" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"minor_unit_digits" integer DEFAULT 2 NOT NULL,
	"billing_cadence" text,
	"usage_configuration" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"name" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."privacy_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"controller_processor_role" text NOT NULL,
	"purpose" text NOT NULL,
	"lawful_basis" text NOT NULL,
	"data_categories" text NOT NULL,
	"subject_categories" text NOT NULL,
	"notice_version" text,
	"retention_schedule" text NOT NULL,
	"dpia_status" text DEFAULT 'not_required' NOT NULL,
	"dcpmi_designation" text,
	"designation_confirmed_by" text,
	"legal_review_status" text DEFAULT 'pending' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid,
	"document_version_id" uuid,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_summary" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_type" text NOT NULL,
	"provider" text NOT NULL,
	"model_configuration_id" uuid,
	"prompt_configuration_id" uuid,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"status" text DEFAULT 'running' NOT NULL,
	"latency_ms" integer,
	"cost_minor" bigint,
	"cost_currency" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"confidence_calibration_version" text,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid NOT NULL,
	"tender_title" text NOT NULL,
	"issuing_entity" text,
	"tender_ref" text,
	"lot" text,
	"deadline" text,
	"value_band" text,
	"segment" text,
	"submission_status" text,
	"status" text DEFAULT 'intake' NOT NULL,
	"reviewer_id" uuid,
	"sla_class" text DEFAULT 'standard' NOT NULL,
	"payment_status" text DEFAULT 'not_required' NOT NULL,
	"payment_confirmed_by_founder" boolean DEFAULT false NOT NULL,
	"payment_confirmed_by_advisor" boolean DEFAULT false NOT NULL,
	"payment_confirmed_at" timestamp with time zone,
	"payment_founder_confirmed_by" uuid,
	"payment_founder_confirmed_by_name" text,
	"payment_founder_confirmed_at" timestamp with time zone,
	"payment_advisor_confirmed_by" uuid,
	"payment_advisor_confirmed_by_name" text,
	"payment_advisor_confirmed_at" timestamp with time zone,
	"conflict_status" text DEFAULT 'clear' NOT NULL,
	"conflict_decision" text,
	"conflict_rationale" text,
	"physical_archive_instruction" text,
	"redaction_scope" text,
	"restricted_mode" boolean DEFAULT false NOT NULL,
	"risk_score" double precision,
	"risk_band" text,
	"risk_override_band" text,
	"risk_override_note" text,
	"risk_override_by" text,
	"outcome" text DEFAULT 'none' NOT NULL,
	"mandate_quality" text DEFAULT 'none' NOT NULL,
	"scope" text,
	"limitations" text,
	"responsiveness_review" text,
	"responsiveness_suggested" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."prompt_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"task" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"template_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"evaluation_run_id" uuid,
	"promoted_by_user_id" uuid,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."red_team_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"red_team_run_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"object_type" text,
	"object_id" uuid,
	"finding" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."red_team_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"initiated_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."renewal_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vault_item_version_id" uuid NOT NULL,
	"next_notification_at" timestamp with time zone NOT NULL,
	"cadence_days" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_notification_event_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"docx_path" text,
	"pdf_path" text,
	"reviewer_id" uuid,
	"reviewer_name" text,
	"attestation" text,
	"engine_version" text,
	"prompt_pack_version" text,
	"model_id" text,
	"taxonomy_version" text,
	"signed_off_at" timestamp with time zone,
	"generated_by" uuid,
	"optimistic_lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."requirement_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page_number" integer,
	"paragraph_ref" text,
	"table_ref" text,
	"coordinate_json" text,
	"source_snippet" text NOT NULL,
	"source_snippet_hash" text NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"page_ref" text,
	"clause_ref" text,
	"text" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"expected_evidence" text,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"confidence" text,
	"review_status" text DEFAULT 'suggested' NOT NULL,
	"reviewer_notes" text,
	"origin" text,
	"engine_text" text,
	"merged_citations" text,
	"reviewed_by" uuid,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."retention_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"retention_request_id" uuid,
	"legal_hold_id" uuid,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" text,
	"executed_by_user_id" uuid,
	"executed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."retention_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"requested_by" uuid,
	"reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"certificate_text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"review_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"findings" text,
	"source_version" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_membership_id" uuid,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."rule_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"jurisdiction_rule_id" uuid NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"result" text NOT NULL,
	"advisory_message" text NOT NULL,
	"evidence_snapshot" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."rule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"rule_evaluation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" text NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."sbd_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"template_id" uuid NOT NULL,
	"agency" text,
	"section" text,
	"kind" text DEFAULT 'format' NOT NULL,
	"quirk" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."sbd_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'goods' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issuing_circular" text,
	"summary" text,
	"optimistic_lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."subprocessors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"service" text NOT NULL,
	"country_code" text NOT NULL,
	"dpa_status" text DEFAULT 'pending' NOT NULL,
	"security_review_status" text DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"price_book_entry_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"current_period_ends_at" timestamp with time zone,
	"cancels_at" timestamp with time zone,
	"provider_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."tender_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"lot_reference" text NOT NULL,
	"title" text,
	"submission_deadline" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"procuring_entity" text NOT NULL,
	"jurisdiction" text DEFAULT 'NG' NOT NULL,
	"funding_source" text,
	"procurement_category" text,
	"source_type" text NOT NULL,
	"source_licence_reference" text,
	"submission_deadline" timestamp with time zone,
	"status" text DEFAULT 'identified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"expected_sha256" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."vault_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vault_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"document_version_id" uuid NOT NULL,
	"issue_date" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"issuing_authority" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"restrictions" text,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid NOT NULL,
	"artefact_type" text NOT NULL,
	"issuer" text,
	"issue_date" text,
	"expiry_date" text,
	"renewal_lead_days" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"object_path" text,
	"sha256" text,
	"source_document_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."vault_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vault_item_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"used_by_user_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public."work_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"owner_membership_id" uuid,
	"due_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_config_updated_by_users_id_fk'
      AND conrelid = 'public.app_config'::regclass
  ) THEN
    ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approvals_organisation_id_organisations_id_fk'
      AND conrelid = 'public.approvals'::regclass
  ) THEN
    ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approvals_project_id_projects_id_fk'
      AND conrelid = 'public.approvals'::regclass
  ) THEN
    ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approvals_requested_by_user_id_users_id_fk'
      AND conrelid = 'public.approvals'::regclass
  ) THEN
    ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approvals_decided_by_user_id_users_id_fk'
      AND conrelid = 'public.approvals'::regclass
  ) THEN
    ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_anchors_organisation_id_organisations_id_fk'
      AND conrelid = 'public.audit_anchors'::regclass
  ) THEN
    ALTER TABLE "audit_anchors" ADD CONSTRAINT "audit_anchors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_events_organisation_id_organisations_id_fk'
      AND conrelid = 'public.audit_events'::regclass
  ) THEN
    ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_events_user_id_users_id_fk'
      AND conrelid = 'public.audit_events'::regclass
  ) THEN
    ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'benchmark_consents_organisation_id_organisations_id_fk'
      AND conrelid = 'public.benchmark_consents'::regclass
  ) THEN
    ALTER TABLE "benchmark_consents" ADD CONSTRAINT "benchmark_consents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'benchmark_consents_consent_record_id_consent_records_id_fk'
      AND conrelid = 'public.benchmark_consents'::regclass
  ) THEN
    ALTER TABLE "benchmark_consents" ADD CONSTRAINT "benchmark_consents_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'benchmark_releases_cohort_id_benchmark_cohorts_id_fk'
      AND conrelid = 'public.benchmark_releases'::regclass
  ) THEN
    ALTER TABLE "benchmark_releases" ADD CONSTRAINT "benchmark_releases_cohort_id_benchmark_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."benchmark_cohorts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'benchmark_releases_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.benchmark_releases'::regclass
  ) THEN
    ALTER TABLE "benchmark_releases" ADD CONSTRAINT "benchmark_releases_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_checks_organisation_id_organisations_id_fk'
      AND conrelid = 'public.boq_checks'::regclass
  ) THEN
    ALTER TABLE "boq_checks" ADD CONSTRAINT "boq_checks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_checks_project_id_projects_id_fk'
      AND conrelid = 'public.boq_checks'::regclass
  ) THEN
    ALTER TABLE "boq_checks" ADD CONSTRAINT "boq_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_checks_source_doc_id_documents_id_fk'
      AND conrelid = 'public.boq_checks'::regclass
  ) THEN
    ALTER TABLE "boq_checks" ADD CONSTRAINT "boq_checks_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_exceptions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.boq_exceptions'::regclass
  ) THEN
    ALTER TABLE "boq_exceptions" ADD CONSTRAINT "boq_exceptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_exceptions_boq_run_id_boq_runs_id_fk'
      AND conrelid = 'public.boq_exceptions'::regclass
  ) THEN
    ALTER TABLE "boq_exceptions" ADD CONSTRAINT "boq_exceptions_boq_run_id_boq_runs_id_fk" FOREIGN KEY ("boq_run_id") REFERENCES "public"."boq_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_exceptions_resolved_by_user_id_users_id_fk'
      AND conrelid = 'public.boq_exceptions'::regclass
  ) THEN
    ALTER TABLE "boq_exceptions" ADD CONSTRAINT "boq_exceptions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_runs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.boq_runs'::regclass
  ) THEN
    ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_runs_project_id_projects_id_fk'
      AND conrelid = 'public.boq_runs'::regclass
  ) THEN
    ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_runs_document_version_id_document_versions_id_fk'
      AND conrelid = 'public.boq_runs'::regclass
  ) THEN
    ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boq_runs_started_by_user_id_users_id_fk'
      AND conrelid = 'public.boq_runs'::regclass
  ) THEN
    ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'break_glass_sessions_target_organisation_id_organisations_id_fk'
      AND conrelid = 'public.break_glass_sessions'::regclass
  ) THEN
    ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_target_organisation_id_organisations_id_fk" FOREIGN KEY ("target_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'break_glass_sessions_requested_by_user_id_users_id_fk'
      AND conrelid = 'public.break_glass_sessions'::regclass
  ) THEN
    ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'break_glass_sessions_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.break_glass_sessions'::regclass
  ) THEN
    ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'break_glass_sessions_revoked_by_user_id_users_id_fk'
      AND conrelid = 'public.break_glass_sessions'::regclass
  ) THEN
    ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_evidence_links_organisation_id_organisations_id_fk'
      AND conrelid = 'public.capability_evidence_links'::regclass
  ) THEN
    ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_evidence_links_capability_version_id_capability_versions_id_fk'
      AND conrelid = 'public.capability_evidence_links'::regclass
  ) THEN
    ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_evidence_links_vault_item_version_id_vault_item_versions_id_fk'
      AND conrelid = 'public.capability_evidence_links'::regclass
  ) THEN
    ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_evidence_links_document_version_id_document_versions_id_fk'
      AND conrelid = 'public.capability_evidence_links'::regclass
  ) THEN
    ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_items_organisation_id_organisations_id_fk'
      AND conrelid = 'public.capability_items'::regclass
  ) THEN
    ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_items_client_id_clients_id_fk'
      AND conrelid = 'public.capability_items'::regclass
  ) THEN
    ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_items_evidence_doc_id_documents_id_fk'
      AND conrelid = 'public.capability_items'::regclass
  ) THEN
    ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_evidence_doc_id_documents_id_fk" FOREIGN KEY ("evidence_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_items_verifier_id_users_id_fk'
      AND conrelid = 'public.capability_items'::regclass
  ) THEN
    ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_verifier_id_users_id_fk" FOREIGN KEY ("verifier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_usage_organisation_id_organisations_id_fk'
      AND conrelid = 'public.capability_usage'::regclass
  ) THEN
    ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_usage_capability_version_id_capability_versions_id_fk'
      AND conrelid = 'public.capability_usage'::regclass
  ) THEN
    ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_usage_project_id_projects_id_fk'
      AND conrelid = 'public.capability_usage'::regclass
  ) THEN
    ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_usage_used_by_user_id_users_id_fk'
      AND conrelid = 'public.capability_usage'::regclass
  ) THEN
    ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_versions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.capability_versions'::regclass
  ) THEN
    ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_versions_capability_item_id_capability_items_id_fk'
      AND conrelid = 'public.capability_versions'::regclass
  ) THEN
    ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_capability_item_id_capability_items_id_fk" FOREIGN KEY ("capability_item_id") REFERENCES "public"."capability_items"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_versions_reviewer_user_id_users_id_fk'
      AND conrelid = 'public.capability_versions'::regclass
  ) THEN
    ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'claim_evidence_links_organisation_id_organisations_id_fk'
      AND conrelid = 'public.claim_evidence_links'::regclass
  ) THEN
    ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'claim_evidence_links_draft_claim_id_draft_claims_id_fk'
      AND conrelid = 'public.claim_evidence_links'::regclass
  ) THEN
    ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_draft_claim_id_draft_claims_id_fk" FOREIGN KEY ("draft_claim_id") REFERENCES "public"."draft_claims"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'claim_evidence_links_capability_version_id_capability_versions_id_fk'
      AND conrelid = 'public.claim_evidence_links'::regclass
  ) THEN
    ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'claim_evidence_links_vault_item_version_id_vault_item_versions_id_fk'
      AND conrelid = 'public.claim_evidence_links'::regclass
  ) THEN
    ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'claim_evidence_links_document_version_id_document_versions_id_fk'
      AND conrelid = 'public.claim_evidence_links'::regclass
  ) THEN
    ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_organisation_id_organisations_id_fk'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comments_organisation_id_organisations_id_fk'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE "comments" ADD CONSTRAINT "comments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comments_project_id_projects_id_fk'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comments_created_by_user_id_users_id_fk'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'comments_resolved_by_user_id_users_id_fk'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conflict_records_organisation_id_organisations_id_fk'
      AND conrelid = 'public.conflict_records'::regclass
  ) THEN
    ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conflict_records_client_id_clients_id_fk'
      AND conrelid = 'public.conflict_records'::regclass
  ) THEN
    ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conflict_records_project_id_projects_id_fk'
      AND conrelid = 'public.conflict_records'::regclass
  ) THEN
    ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conflict_records_matched_project_id_projects_id_fk'
      AND conrelid = 'public.conflict_records'::regclass
  ) THEN
    ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_matched_project_id_projects_id_fk" FOREIGN KEY ("matched_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conflict_records_decided_by_users_id_fk'
      AND conrelid = 'public.conflict_records'::regclass
  ) THEN
    ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_records_organisation_id_organisations_id_fk'
      AND conrelid = 'public.consent_records'::regclass
  ) THEN
    ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_records_privacy_record_id_privacy_records_id_fk'
      AND conrelid = 'public.consent_records'::regclass
  ) THEN
    ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_privacy_record_id_privacy_records_id_fk" FOREIGN KEY ("privacy_record_id") REFERENCES "public"."privacy_records"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cross_border_transfers_organisation_id_organisations_id_fk'
      AND conrelid = 'public.cross_border_transfers'::regclass
  ) THEN
    ALTER TABLE "cross_border_transfers" ADD CONSTRAINT "cross_border_transfers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cross_border_transfers_subprocessor_id_subprocessors_id_fk'
      AND conrelid = 'public.cross_border_transfers'::regclass
  ) THEN
    ALTER TABLE "cross_border_transfers" ADD CONSTRAINT "cross_border_transfers_subprocessor_id_subprocessors_id_fk" FOREIGN KEY ("subprocessor_id") REFERENCES "public"."subprocessors"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'data_subject_requests_organisation_id_organisations_id_fk'
      AND conrelid = 'public.data_subject_requests'::regclass
  ) THEN
    ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'data_subject_requests_assigned_to_user_id_users_id_fk'
      AND conrelid = 'public.data_subject_requests'::regclass
  ) THEN
    ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defect_decisions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.defect_decisions'::regclass
  ) THEN
    ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defect_decisions_project_id_projects_id_fk'
      AND conrelid = 'public.defect_decisions'::regclass
  ) THEN
    ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defect_decisions_defect_id_defects_id_fk'
      AND conrelid = 'public.defect_decisions'::regclass
  ) THEN
    ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_defect_id_defects_id_fk" FOREIGN KEY ("defect_id") REFERENCES "public"."defects"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defect_decisions_initiated_by_user_id_users_id_fk'
      AND conrelid = 'public.defect_decisions'::regclass
  ) THEN
    ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defect_decisions_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.defect_decisions'::regclass
  ) THEN
    ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defects_organisation_id_organisations_id_fk'
      AND conrelid = 'public.defects'::regclass
  ) THEN
    ALTER TABLE "defects" ADD CONSTRAINT "defects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defects_project_id_projects_id_fk'
      AND conrelid = 'public.defects'::regclass
  ) THEN
    ALTER TABLE "defects" ADD CONSTRAINT "defects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'defects_requirement_id_requirements_id_fk'
      AND conrelid = 'public.defects'::regclass
  ) THEN
    ALTER TABLE "defects" ADD CONSTRAINT "defects_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deletion_certificates_organisation_id_organisations_id_fk'
      AND conrelid = 'public.deletion_certificates'::regclass
  ) THEN
    ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deletion_certificates_retention_action_id_retention_actions_id_fk'
      AND conrelid = 'public.deletion_certificates'::regclass
  ) THEN
    ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_retention_action_id_retention_actions_id_fk" FOREIGN KEY ("retention_action_id") REFERENCES "public"."retention_actions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deletion_certificates_signed_by_user_id_users_id_fk'
      AND conrelid = 'public.deletion_certificates'::regclass
  ) THEN
    ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_versions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.document_versions'::regclass
  ) THEN
    ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_versions_document_id_documents_id_fk'
      AND conrelid = 'public.document_versions'::regclass
  ) THEN
    ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_versions_uploaded_by_users_id_fk'
      AND conrelid = 'public.document_versions'::regclass
  ) THEN
    ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_organisation_id_organisations_id_fk'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_project_id_projects_id_fk'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_uploaded_by_users_id_fk'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_claims_organisation_id_organisations_id_fk'
      AND conrelid = 'public.draft_claims'::regclass
  ) THEN
    ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_claims_draft_version_id_draft_versions_id_fk'
      AND conrelid = 'public.draft_claims'::regclass
  ) THEN
    ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_draft_version_id_draft_versions_id_fk" FOREIGN KEY ("draft_version_id") REFERENCES "public"."draft_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_claims_reviewer_user_id_users_id_fk'
      AND conrelid = 'public.draft_claims'::regclass
  ) THEN
    ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_versions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.draft_versions'::regclass
  ) THEN
    ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_versions_draft_id_drafts_id_fk'
      AND conrelid = 'public.draft_versions'::regclass
  ) THEN
    ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_versions_author_user_id_users_id_fk'
      AND conrelid = 'public.draft_versions'::regclass
  ) THEN
    ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'draft_versions_model_run_id_processing_runs_id_fk'
      AND conrelid = 'public.draft_versions'::regclass
  ) THEN
    ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_model_run_id_processing_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."processing_runs"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drafts_organisation_id_organisations_id_fk'
      AND conrelid = 'public.drafts'::regclass
  ) THEN
    ALTER TABLE "drafts" ADD CONSTRAINT "drafts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drafts_project_id_projects_id_fk'
      AND conrelid = 'public.drafts'::regclass
  ) THEN
    ALTER TABLE "drafts" ADD CONSTRAINT "drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_tender_lots_organisation_id_organisations_id_fk'
      AND conrelid = 'public.engagement_tender_lots'::regclass
  ) THEN
    ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_tender_lots_project_id_projects_id_fk'
      AND conrelid = 'public.engagement_tender_lots'::regclass
  ) THEN
    ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_tender_lots_tender_id_tenders_id_fk'
      AND conrelid = 'public.engagement_tender_lots'::regclass
  ) THEN
    ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_tender_lots_tender_lot_id_tender_lots_id_fk'
      AND conrelid = 'public.engagement_tender_lots'::regclass
  ) THEN
    ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_tender_lot_id_tender_lots_id_fk" FOREIGN KEY ("tender_lot_id") REFERENCES "public"."tender_lots"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlement_usage_organisation_id_organisations_id_fk'
      AND conrelid = 'public.entitlement_usage'::regclass
  ) THEN
    ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlement_usage_entitlement_id_entitlements_id_fk'
      AND conrelid = 'public.entitlement_usage'::regclass
  ) THEN
    ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlement_usage_project_id_projects_id_fk'
      AND conrelid = 'public.entitlement_usage'::regclass
  ) THEN
    ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlement_usage_actor_user_id_users_id_fk'
      AND conrelid = 'public.entitlement_usage'::regclass
  ) THEN
    ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlements_organisation_id_organisations_id_fk'
      AND conrelid = 'public.entitlements'::regclass
  ) THEN
    ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlements_order_id_orders_id_fk'
      AND conrelid = 'public.entitlements'::regclass
  ) THEN
    ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlements_subscription_id_subscriptions_id_fk'
      AND conrelid = 'public.entitlements'::regclass
  ) THEN
    ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_cases_organisation_id_organisations_id_fk'
      AND conrelid = 'public.evaluation_cases'::regclass
  ) THEN
    ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_results_evaluation_run_id_evaluation_runs_id_fk'
      AND conrelid = 'public.evaluation_results'::regclass
  ) THEN
    ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_results_evaluation_case_id_evaluation_cases_id_fk'
      AND conrelid = 'public.evaluation_results'::regclass
  ) THEN
    ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_case_id_evaluation_cases_id_fk" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_runs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.evaluation_runs'::regclass
  ) THEN
    ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_runs_model_configuration_id_model_configurations_id_fk'
      AND conrelid = 'public.evaluation_runs'::regclass
  ) THEN
    ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_model_configuration_id_model_configurations_id_fk" FOREIGN KEY ("model_configuration_id") REFERENCES "public"."model_configurations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_runs_prompt_configuration_id_prompt_configurations_id_fk'
      AND conrelid = 'public.evaluation_runs'::regclass
  ) THEN
    ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_prompt_configuration_id_prompt_configurations_id_fk" FOREIGN KEY ("prompt_configuration_id") REFERENCES "public"."prompt_configurations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evidence_items_organisation_id_organisations_id_fk'
      AND conrelid = 'public.evidence_items'::regclass
  ) THEN
    ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evidence_items_project_id_projects_id_fk'
      AND conrelid = 'public.evidence_items'::regclass
  ) THEN
    ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evidence_items_requirement_id_requirements_id_fk'
      AND conrelid = 'public.evidence_items'::regclass
  ) THEN
    ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evidence_items_document_id_documents_id_fk'
      AND conrelid = 'public.evidence_items'::regclass
  ) THEN
    ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evidence_items_confirmed_by_users_id_fk'
      AND conrelid = 'public.evidence_items'::regclass
  ) THEN
    ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'export_deliveries_organisation_id_organisations_id_fk'
      AND conrelid = 'public.export_deliveries'::regclass
  ) THEN
    ALTER TABLE "export_deliveries" ADD CONSTRAINT "export_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'export_deliveries_package_version_id_package_versions_id_fk'
      AND conrelid = 'public.export_deliveries'::regclass
  ) THEN
    ALTER TABLE "export_deliveries" ADD CONSTRAINT "export_deliveries_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'export_deliveries_exported_by_user_id_users_id_fk'
      AND conrelid = 'public.export_deliveries'::regclass
  ) THEN
    ALTER TABLE "export_deliveries" ADD CONSTRAINT "export_deliveries_exported_by_user_id_users_id_fk" FOREIGN KEY ("exported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feature_flags_organisation_id_organisations_id_fk'
      AND conrelid = 'public.feature_flags'::regclass
  ) THEN
    ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feature_flags_updated_by_user_id_users_id_fk'
      AND conrelid = 'public.feature_flags'::regclass
  ) THEN
    ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_configurations_organisation_id_organisations_id_fk'
      AND conrelid = 'public.integration_configurations'::regclass
  ) THEN
    ALTER TABLE "integration_configurations" ADD CONSTRAINT "integration_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_receipts_organisation_id_organisations_id_fk'
      AND conrelid = 'public.integration_receipts'::regclass
  ) THEN
    ALTER TABLE "integration_receipts" ADD CONSTRAINT "integration_receipts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_lines_invoice_id_invoices_id_fk'
      AND conrelid = 'public.invoice_lines'::regclass
  ) THEN
    ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_lines_order_id_orders_id_fk'
      AND conrelid = 'public.invoice_lines'::regclass
  ) THEN
    ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_organisation_id_organisations_id_fk'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jurisdiction_rule_packs_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.jurisdiction_rule_packs'::regclass
  ) THEN
    ALTER TABLE "jurisdiction_rule_packs" ADD CONSTRAINT "jurisdiction_rule_packs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jurisdiction_rules_rule_pack_id_jurisdiction_rule_packs_id_fk'
      AND conrelid = 'public.jurisdiction_rules'::regclass
  ) THEN
    ALTER TABLE "jurisdiction_rules" ADD CONSTRAINT "jurisdiction_rules_rule_pack_id_jurisdiction_rule_packs_id_fk" FOREIGN KEY ("rule_pack_id") REFERENCES "public"."jurisdiction_rule_packs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'legal_holds_organisation_id_organisations_id_fk'
      AND conrelid = 'public.legal_holds'::regclass
  ) THEN
    ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'legal_holds_project_id_projects_id_fk'
      AND conrelid = 'public.legal_holds'::regclass
  ) THEN
    ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'legal_holds_placed_by_user_id_users_id_fk'
      AND conrelid = 'public.legal_holds'::regclass
  ) THEN
    ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'legal_holds_released_by_user_id_users_id_fk'
      AND conrelid = 'public.legal_holds'::regclass
  ) THEN
    ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'llm_runs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.llm_runs'::regclass
  ) THEN
    ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'llm_runs_project_id_projects_id_fk'
      AND conrelid = 'public.llm_runs'::regclass
  ) THEN
    ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_configurations_organisation_id_organisations_id_fk'
      AND conrelid = 'public.model_configurations'::regclass
  ) THEN
    ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_configurations_promoted_by_user_id_users_id_fk'
      AND conrelid = 'public.model_configurations'::regclass
  ) THEN
    ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nda_records_organisation_id_organisations_id_fk'
      AND conrelid = 'public.nda_records'::regclass
  ) THEN
    ALTER TABLE "nda_records" ADD CONSTRAINT "nda_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nda_records_client_id_clients_id_fk'
      AND conrelid = 'public.nda_records'::regclass
  ) THEN
    ALTER TABLE "nda_records" ADD CONSTRAINT "nda_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_attempts_organisation_id_organisations_id_fk'
      AND conrelid = 'public.notification_attempts'::regclass
  ) THEN
    ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_attempts_notification_event_id_notification_events_id_fk'
      AND conrelid = 'public.notification_attempts'::regclass
  ) THEN
    ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_event_id_notification_events_id_fk" FOREIGN KEY ("notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_events_organisation_id_organisations_id_fk'
      AND conrelid = 'public.notification_events'::regclass
  ) THEN
    ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_events_project_id_projects_id_fk'
      AND conrelid = 'public.notification_events'::regclass
  ) THEN
    ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_events_client_id_clients_id_fk'
      AND conrelid = 'public.notification_events'::regclass
  ) THEN
    ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_events_vault_item_id_vault_items_id_fk'
      AND conrelid = 'public.notification_events'::regclass
  ) THEN
    ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_vault_item_id_vault_items_id_fk" FOREIGN KEY ("vault_item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_events_created_by_users_id_fk'
      AND conrelid = 'public.notification_events'::regclass
  ) THEN
    ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_organisation_id_organisations_id_fk'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_project_id_projects_id_fk'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_price_book_entry_id_price_book_entries_id_fk'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_price_book_entry_id_price_book_entries_id_fk" FOREIGN KEY ("price_book_entry_id") REFERENCES "public"."price_book_entries"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_placed_by_user_id_users_id_fk'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organisation_memberships_organisation_id_organisations_id_fk'
      AND conrelid = 'public.organisation_memberships'::regclass
  ) THEN
    ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organisation_memberships_user_id_users_id_fk'
      AND conrelid = 'public.organisation_memberships'::regclass
  ) THEN
    ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organisation_memberships_delegated_by_fk'
      AND conrelid = 'public.organisation_memberships'::regclass
  ) THEN
    ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_delegated_by_fk" FOREIGN KEY ("delegated_by_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organisations_created_by_users_id_fk'
      AND conrelid = 'public.organisations'::regclass
  ) THEN
    ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'outcomes_organisation_id_organisations_id_fk'
      AND conrelid = 'public.outcomes'::regclass
  ) THEN
    ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'outcomes_project_id_projects_id_fk'
      AND conrelid = 'public.outcomes'::regclass
  ) THEN
    ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'outcomes_captured_by_user_id_users_id_fk'
      AND conrelid = 'public.outcomes'::regclass
  ) THEN
    ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_manifest_items_organisation_id_organisations_id_fk'
      AND conrelid = 'public.package_manifest_items'::regclass
  ) THEN
    ALTER TABLE "package_manifest_items" ADD CONSTRAINT "package_manifest_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_manifest_items_package_version_id_package_versions_id_fk'
      AND conrelid = 'public.package_manifest_items'::regclass
  ) THEN
    ALTER TABLE "package_manifest_items" ADD CONSTRAINT "package_manifest_items_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_signoffs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.package_signoffs'::regclass
  ) THEN
    ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_signoffs_package_version_id_package_versions_id_fk'
      AND conrelid = 'public.package_signoffs'::regclass
  ) THEN
    ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_signoffs_signer_user_id_users_id_fk'
      AND conrelid = 'public.package_signoffs'::regclass
  ) THEN
    ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_signoffs_audit_event_id_audit_events_id_fk'
      AND conrelid = 'public.package_signoffs'::regclass
  ) THEN
    ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_audit_event_id_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_versions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.package_versions'::regclass
  ) THEN
    ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_versions_package_id_packages_id_fk'
      AND conrelid = 'public.package_versions'::regclass
  ) THEN
    ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_versions_generated_by_user_id_users_id_fk'
      AND conrelid = 'public.package_versions'::regclass
  ) THEN
    ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_organisation_id_organisations_id_fk'
      AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE "packages" ADD CONSTRAINT "packages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_project_id_projects_id_fk'
      AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE "packages" ADD CONSTRAINT "packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_branding_partner_organisation_id_organisations_id_fk'
      AND conrelid = 'public.partner_branding'::regclass
  ) THEN
    ALTER TABLE "partner_branding" ADD CONSTRAINT "partner_branding_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_branding_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.partner_branding'::regclass
  ) THEN
    ALTER TABLE "partner_branding" ADD CONSTRAINT "partner_branding_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_relationships_partner_organisation_id_organisations_id_fk'
      AND conrelid = 'public.partner_relationships'::regclass
  ) THEN
    ALTER TABLE "partner_relationships" ADD CONSTRAINT "partner_relationships_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_relationships_client_organisation_id_organisations_id_fk'
      AND conrelid = 'public.partner_relationships'::regclass
  ) THEN
    ALTER TABLE "partner_relationships" ADD CONSTRAINT "partner_relationships_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_relationships_approved_by_membership_id_organisation_memberships_id_fk'
      AND conrelid = 'public.partner_relationships'::regclass
  ) THEN
    ALTER TABLE "partner_relationships" ADD CONSTRAINT "partner_relationships_approved_by_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_revenue_share_entries_partner_organisation_id_organisations_id_fk'
      AND conrelid = 'public.partner_revenue_share_entries'::regclass
  ) THEN
    ALTER TABLE "partner_revenue_share_entries" ADD CONSTRAINT "partner_revenue_share_entries_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_revenue_share_entries_client_organisation_id_organisations_id_fk'
      AND conrelid = 'public.partner_revenue_share_entries'::regclass
  ) THEN
    ALTER TABLE "partner_revenue_share_entries" ADD CONSTRAINT "partner_revenue_share_entries_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'partner_revenue_share_entries_order_id_orders_id_fk'
      AND conrelid = 'public.partner_revenue_share_entries'::regclass
  ) THEN
    ALTER TABLE "partner_revenue_share_entries" ADD CONSTRAINT "partner_revenue_share_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_organisation_id_organisations_id_fk'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_invoice_id_invoices_id_fk'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_book_entries_price_book_id_price_books_id_fk'
      AND conrelid = 'public.price_book_entries'::regclass
  ) THEN
    ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_books_organisation_id_organisations_id_fk'
      AND conrelid = 'public.price_books'::regclass
  ) THEN
    ALTER TABLE "price_books" ADD CONSTRAINT "price_books_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_books_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.price_books'::regclass
  ) THEN
    ALTER TABLE "price_books" ADD CONSTRAINT "price_books_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'privacy_records_organisation_id_organisations_id_fk'
      AND conrelid = 'public.privacy_records'::regclass
  ) THEN
    ALTER TABLE "privacy_records" ADD CONSTRAINT "privacy_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_jobs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.processing_jobs'::regclass
  ) THEN
    ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_jobs_project_id_projects_id_fk'
      AND conrelid = 'public.processing_jobs'::regclass
  ) THEN
    ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_jobs_document_version_id_document_versions_id_fk'
      AND conrelid = 'public.processing_jobs'::regclass
  ) THEN
    ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_runs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.processing_runs'::regclass
  ) THEN
    ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_runs_job_id_processing_jobs_id_fk'
      AND conrelid = 'public.processing_runs'::regclass
  ) THEN
    ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_job_id_processing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_runs_model_configuration_id_model_configurations_id_fk'
      AND conrelid = 'public.processing_runs'::regclass
  ) THEN
    ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_model_configuration_id_model_configurations_id_fk" FOREIGN KEY ("model_configuration_id") REFERENCES "public"."model_configurations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_runs_prompt_configuration_id_prompt_configurations_id_fk'
      AND conrelid = 'public.processing_runs'::regclass
  ) THEN
    ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_prompt_configuration_id_prompt_configurations_id_fk" FOREIGN KEY ("prompt_configuration_id") REFERENCES "public"."prompt_configurations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_organisation_id_organisations_id_fk'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_client_id_clients_id_fk'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_reviewer_id_users_id_fk'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_payment_founder_confirmed_by_users_id_fk'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_payment_founder_confirmed_by_users_id_fk" FOREIGN KEY ("payment_founder_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_payment_advisor_confirmed_by_users_id_fk'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_payment_advisor_confirmed_by_users_id_fk" FOREIGN KEY ("payment_advisor_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_configurations_organisation_id_organisations_id_fk'
      AND conrelid = 'public.prompt_configurations'::regclass
  ) THEN
    ALTER TABLE "prompt_configurations" ADD CONSTRAINT "prompt_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_configurations_promoted_by_user_id_users_id_fk'
      AND conrelid = 'public.prompt_configurations'::regclass
  ) THEN
    ALTER TABLE "prompt_configurations" ADD CONSTRAINT "prompt_configurations_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_findings_organisation_id_organisations_id_fk'
      AND conrelid = 'public.red_team_findings'::regclass
  ) THEN
    ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_findings_red_team_run_id_red_team_runs_id_fk'
      AND conrelid = 'public.red_team_findings'::regclass
  ) THEN
    ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_red_team_run_id_red_team_runs_id_fk" FOREIGN KEY ("red_team_run_id") REFERENCES "public"."red_team_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_findings_resolved_by_user_id_users_id_fk'
      AND conrelid = 'public.red_team_findings'::regclass
  ) THEN
    ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_runs_organisation_id_organisations_id_fk'
      AND conrelid = 'public.red_team_runs'::regclass
  ) THEN
    ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_runs_project_id_projects_id_fk'
      AND conrelid = 'public.red_team_runs'::regclass
  ) THEN
    ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_runs_initiated_by_user_id_users_id_fk'
      AND conrelid = 'public.red_team_runs'::regclass
  ) THEN
    ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'red_team_runs_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.red_team_runs'::regclass
  ) THEN
    ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'renewal_monitors_organisation_id_organisations_id_fk'
      AND conrelid = 'public.renewal_monitors'::regclass
  ) THEN
    ALTER TABLE "renewal_monitors" ADD CONSTRAINT "renewal_monitors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'renewal_monitors_vault_item_version_id_vault_item_versions_id_fk'
      AND conrelid = 'public.renewal_monitors'::regclass
  ) THEN
    ALTER TABLE "renewal_monitors" ADD CONSTRAINT "renewal_monitors_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'renewal_monitors_last_notification_event_id_notification_events_id_fk'
      AND conrelid = 'public.renewal_monitors'::regclass
  ) THEN
    ALTER TABLE "renewal_monitors" ADD CONSTRAINT "renewal_monitors_last_notification_event_id_notification_events_id_fk" FOREIGN KEY ("last_notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_organisation_id_organisations_id_fk'
      AND conrelid = 'public.reports'::regclass
  ) THEN
    ALTER TABLE "reports" ADD CONSTRAINT "reports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_project_id_projects_id_fk'
      AND conrelid = 'public.reports'::regclass
  ) THEN
    ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_reviewer_id_users_id_fk'
      AND conrelid = 'public.reports'::regclass
  ) THEN
    ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_generated_by_users_id_fk'
      AND conrelid = 'public.reports'::regclass
  ) THEN
    ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirement_citations_organisation_id_organisations_id_fk'
      AND conrelid = 'public.requirement_citations'::regclass
  ) THEN
    ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirement_citations_requirement_id_requirements_id_fk'
      AND conrelid = 'public.requirement_citations'::regclass
  ) THEN
    ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirement_citations_document_version_id_document_versions_id_fk'
      AND conrelid = 'public.requirement_citations'::regclass
  ) THEN
    ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirement_citations_verified_by_user_id_users_id_fk'
      AND conrelid = 'public.requirement_citations'::regclass
  ) THEN
    ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirements_organisation_id_organisations_id_fk'
      AND conrelid = 'public.requirements'::regclass
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirements_project_id_projects_id_fk'
      AND conrelid = 'public.requirements'::regclass
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirements_source_doc_id_documents_id_fk'
      AND conrelid = 'public.requirements'::regclass
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'requirements_reviewed_by_users_id_fk'
      AND conrelid = 'public.requirements'::regclass
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_actions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.retention_actions'::regclass
  ) THEN
    ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_actions_retention_request_id_retention_requests_id_fk'
      AND conrelid = 'public.retention_actions'::regclass
  ) THEN
    ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_retention_request_id_retention_requests_id_fk" FOREIGN KEY ("retention_request_id") REFERENCES "public"."retention_requests"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_actions_legal_hold_id_legal_holds_id_fk'
      AND conrelid = 'public.retention_actions'::regclass
  ) THEN
    ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_legal_hold_id_legal_holds_id_fk" FOREIGN KEY ("legal_hold_id") REFERENCES "public"."legal_holds"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_actions_executed_by_user_id_users_id_fk'
      AND conrelid = 'public.retention_actions'::regclass
  ) THEN
    ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_requests_organisation_id_organisations_id_fk'
      AND conrelid = 'public.retention_requests'::regclass
  ) THEN
    ALTER TABLE "retention_requests" ADD CONSTRAINT "retention_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_requests_project_id_projects_id_fk'
      AND conrelid = 'public.retention_requests'::regclass
  ) THEN
    ALTER TABLE "retention_requests" ADD CONSTRAINT "retention_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'retention_requests_requested_by_users_id_fk'
      AND conrelid = 'public.retention_requests'::regclass
  ) THEN
    ALTER TABLE "retention_requests" ADD CONSTRAINT "retention_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_organisation_id_organisations_id_fk'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_project_id_projects_id_fk'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_reviewer_user_id_users_id_fk'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_grants_membership_id_organisation_memberships_id_fk'
      AND conrelid = 'public.role_grants'::regclass
  ) THEN
    ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_grants_granted_by_membership_id_organisation_memberships_id_fk'
      AND conrelid = 'public.role_grants'::regclass
  ) THEN
    ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("granted_by_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_evaluations_organisation_id_organisations_id_fk'
      AND conrelid = 'public.rule_evaluations'::regclass
  ) THEN
    ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_evaluations_project_id_projects_id_fk'
      AND conrelid = 'public.rule_evaluations'::regclass
  ) THEN
    ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_evaluations_jurisdiction_rule_id_jurisdiction_rules_id_fk'
      AND conrelid = 'public.rule_evaluations'::regclass
  ) THEN
    ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_jurisdiction_rule_id_jurisdiction_rules_id_fk" FOREIGN KEY ("jurisdiction_rule_id") REFERENCES "public"."jurisdiction_rules"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_overrides_organisation_id_organisations_id_fk'
      AND conrelid = 'public.rule_overrides'::regclass
  ) THEN
    ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_overrides_rule_evaluation_id_rule_evaluations_id_fk'
      AND conrelid = 'public.rule_overrides'::regclass
  ) THEN
    ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_rule_evaluation_id_rule_evaluations_id_fk" FOREIGN KEY ("rule_evaluation_id") REFERENCES "public"."rule_evaluations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_overrides_requested_by_user_id_users_id_fk'
      AND conrelid = 'public.rule_overrides'::regclass
  ) THEN
    ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_overrides_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.rule_overrides'::regclass
  ) THEN
    ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sbd_annotations_organisation_id_organisations_id_fk'
      AND conrelid = 'public.sbd_annotations'::regclass
  ) THEN
    ALTER TABLE "sbd_annotations" ADD CONSTRAINT "sbd_annotations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sbd_annotations_template_id_sbd_templates_id_fk'
      AND conrelid = 'public.sbd_annotations'::regclass
  ) THEN
    ALTER TABLE "sbd_annotations" ADD CONSTRAINT "sbd_annotations_template_id_sbd_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sbd_templates"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sbd_templates_organisation_id_organisations_id_fk'
      AND conrelid = 'public.sbd_templates'::regclass
  ) THEN
    ALTER TABLE "sbd_templates" ADD CONSTRAINT "sbd_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subprocessors_organisation_id_organisations_id_fk'
      AND conrelid = 'public.subprocessors'::regclass
  ) THEN
    ALTER TABLE "subprocessors" ADD CONSTRAINT "subprocessors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_price_book_entry_id_price_book_entries_id_fk'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_book_entry_id_price_book_entries_id_fk" FOREIGN KEY ("price_book_entry_id") REFERENCES "public"."price_book_entries"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tender_lots_organisation_id_organisations_id_fk'
      AND conrelid = 'public.tender_lots'::regclass
  ) THEN
    ALTER TABLE "tender_lots" ADD CONSTRAINT "tender_lots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tender_lots_tender_id_tenders_id_fk'
      AND conrelid = 'public.tender_lots'::regclass
  ) THEN
    ALTER TABLE "tender_lots" ADD CONSTRAINT "tender_lots_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenders_organisation_id_organisations_id_fk'
      AND conrelid = 'public.tenders'::regclass
  ) THEN
    ALTER TABLE "tenders" ADD CONSTRAINT "tenders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'upload_sessions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.upload_sessions'::regclass
  ) THEN
    ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'upload_sessions_project_id_projects_id_fk'
      AND conrelid = 'public.upload_sessions'::regclass
  ) THEN
    ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_item_versions_organisation_id_organisations_id_fk'
      AND conrelid = 'public.vault_item_versions'::regclass
  ) THEN
    ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_item_versions_vault_item_id_vault_items_id_fk'
      AND conrelid = 'public.vault_item_versions'::regclass
  ) THEN
    ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_vault_item_id_vault_items_id_fk" FOREIGN KEY ("vault_item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_item_versions_document_version_id_document_versions_id_fk'
      AND conrelid = 'public.vault_item_versions'::regclass
  ) THEN
    ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_item_versions_approved_by_user_id_users_id_fk'
      AND conrelid = 'public.vault_item_versions'::regclass
  ) THEN
    ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_items_organisation_id_organisations_id_fk'
      AND conrelid = 'public.vault_items'::regclass
  ) THEN
    ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_items_client_id_clients_id_fk'
      AND conrelid = 'public.vault_items'::regclass
  ) THEN
    ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_items_source_document_id_documents_id_fk'
      AND conrelid = 'public.vault_items'::regclass
  ) THEN
    ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_usage_organisation_id_organisations_id_fk'
      AND conrelid = 'public.vault_usage'::regclass
  ) THEN
    ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_usage_vault_item_version_id_vault_item_versions_id_fk'
      AND conrelid = 'public.vault_usage'::regclass
  ) THEN
    ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_usage_project_id_projects_id_fk'
      AND conrelid = 'public.vault_usage'::regclass
  ) THEN
    ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_usage_used_by_user_id_users_id_fk'
      AND conrelid = 'public.vault_usage'::regclass
  ) THEN
    ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_tasks_organisation_id_organisations_id_fk'
      AND conrelid = 'public.work_tasks'::regclass
  ) THEN
    ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_tasks_project_id_projects_id_fk'
      AND conrelid = 'public.work_tasks'::regclass
  ) THEN
    ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_tasks_requirement_id_requirements_id_fk'
      AND conrelid = 'public.work_tasks'::regclass
  ) THEN
    ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
DO $bridge_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_tasks_owner_membership_id_organisation_memberships_id_fk'
      AND conrelid = 'public.work_tasks'::regclass
  ) THEN
    ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_owner_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END;
$bridge_constraint$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_org_type_decision_idx" ON "approvals" USING btree ("organisation_id","approval_type","decision");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_anchors_provider_reference_unique" ON "audit_anchors" USING btree ("provider","immutable_object_reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_events_seq_unique" ON "audit_events" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "benchmark_cohorts_key_version_unique" ON "benchmark_cohorts" USING btree ("cohort_key","definition_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benchmark_consents_org_status_idx" ON "benchmark_consents" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "benchmark_releases_cohort_period_unique" ON "benchmark_releases" USING btree ("cohort_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boq_exceptions_run_status_idx" ON "boq_exceptions" USING btree ("boq_run_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boq_runs_org_project_status_idx" ON "boq_runs" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_target_status_expiry_idx" ON "break_glass_sessions" USING btree ("target_organisation_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capability_evidence_links_version_idx" ON "capability_evidence_links" USING btree ("capability_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capability_usage_org_project_idx" ON "capability_usage" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capability_versions_item_number_unique" ON "capability_versions" USING btree ("capability_item_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_evidence_links_claim_idx" ON "claim_evidence_links" USING btree ("draft_claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_org_created_idx" ON "clients" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_org_object_idx" ON "comments" USING btree ("organisation_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_records_org_subject_idx" ON "consent_records" USING btree ("organisation_id","subject_reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cross_border_transfers_org_review_idx" ON "cross_border_transfers" USING btree ("organisation_id","next_review_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dsr_org_status_due_idx" ON "data_subject_requests" USING btree ("organisation_id","status","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "defect_decisions_defect_status_idx" ON "defect_decisions" USING btree ("defect_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_certificates_org_number_unique" ON "deletion_certificates" USING btree ("organisation_id","certificate_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_document_number_unique" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_org_hash_unique" ON "document_versions" USING btree ("organisation_id","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_org_project_idx" ON "documents" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "draft_claims_version_key_unique" ON "draft_claims" USING btree ("draft_version_id","claim_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "draft_versions_draft_number_unique" ON "draft_versions" USING btree ("draft_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drafts_project_section_unique" ON "drafts" USING btree ("project_id","section_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engagement_tender_lots_project_lot_unique" ON "engagement_tender_lots" USING btree ("project_id","tender_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entitlement_usage_entitlement_key_unique" ON "entitlement_usage" USING btree ("entitlement_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entitlements_org_kind_status_idx" ON "entitlements" USING btree ("organisation_id","product_kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evaluation_cases_corpus_fixture_unique" ON "evaluation_cases" USING btree ("corpus_version","fixture_reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evaluation_results_run_case_unique" ON "evaluation_results" USING btree ("evaluation_run_id","evaluation_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evaluation_runs_task_status_idx" ON "evaluation_runs" USING btree ("task","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_deliveries_org_status_idx" ON "export_deliveries" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_tenant_key_unique" ON "feature_flags" USING btree ("organisation_id","key") WHERE "feature_flags"."organisation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_global_key_unique" ON "feature_flags" USING btree ("key") WHERE "feature_flags"."organisation_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_configs_scope_type_provider_unique" ON "integration_configurations" USING btree ("organisation_id","adapter_type","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_receipts_type_event_unique" ON "integration_receipts" USING btree ("adapter_type","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_number_unique" ON "invoices" USING btree ("organisation_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jurisdiction_rule_packs_key_version_unique" ON "jurisdiction_rule_packs" USING btree ("pack_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jurisdiction_rules_pack_key_unique" ON "jurisdiction_rules" USING btree ("rule_pack_id","rule_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legal_holds_org_project_status_idx" ON "legal_holds" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_configs_scope_task_version_unique" ON "model_configurations" USING btree ("organisation_id","task","configuration_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nda_records_org_client_status_idx" ON "nda_records" USING btree ("organisation_id","client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_attempt_event_number_unique" ON "notification_attempts" USING btree ("notification_event_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_attempt_idempotency_unique" ON "notification_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_org_idempotency_unique" ON "orders" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organisation_memberships_org_user_unique" ON "organisation_memberships" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organisation_memberships_user_status_idx" ON "organisation_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outcomes_project_unique" ON "outcomes" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "package_manifest_items_version_ordinal_unique" ON "package_manifest_items" USING btree ("package_version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "package_signoffs_version_signer_unique" ON "package_signoffs" USING btree ("package_version_id","signer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "package_versions_package_number_unique" ON "package_versions" USING btree ("package_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packages_org_project_status_idx" ON "packages" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_branding_partner_unique" ON "partner_branding" USING btree ("partner_organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_relationships_partner_client_unique" ON "partner_relationships" USING btree ("partner_organisation_id","client_organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_revenue_share_partner_period_idx" ON "partner_revenue_share_entries" USING btree ("partner_organisation_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_reference_unique" ON "payments" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_org_idempotency_unique" ON "payments" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_book_entries_book_product_unique" ON "price_book_entries" USING btree ("price_book_id","product_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_books_scope_name_version_unique" ON "price_books" USING btree ("organisation_id","name","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_records_org_type_effective_idx" ON "privacy_records" USING btree ("organisation_id","record_type","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "processing_jobs_org_idempotency_unique" ON "processing_jobs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processing_jobs_status_available_priority_idx" ON "processing_jobs" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processing_runs_org_job_idx" ON "processing_runs" USING btree ("organisation_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_created_idx" ON "projects" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_client_idx" ON "projects" USING btree ("organisation_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_tender_lot_idx" ON "projects" USING btree ("organisation_id","tender_ref","lot");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prompt_configs_scope_task_version_unique" ON "prompt_configurations" USING btree ("organisation_id","task","prompt_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "red_team_findings_run_status_idx" ON "red_team_findings" USING btree ("red_team_run_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "red_team_runs_org_project_status_idx" ON "red_team_runs" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_monitors_status_next_idx" ON "renewal_monitors" USING btree ("status","next_notification_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requirement_citations_requirement_idx" ON "requirement_citations" USING btree ("requirement_id","verification_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_actions_org_status_idx" ON "retention_actions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retention_requests_one_pending_per_project" ON "retention_requests" USING btree ("project_id") WHERE "retention_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_org_type_status_idx" ON "reviews" USING btree ("organisation_id","review_type","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_grants_membership_active_idx" ON "role_grants" USING btree ("membership_id","revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rule_evaluations_org_project_idx" ON "rule_evaluations" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rule_overrides_evaluation_unique" ON "rule_overrides" USING btree ("rule_evaluation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subprocessors_org_name_service_unique" ON "subprocessors" USING btree ("organisation_id","legal_name","service");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_org_status_idx" ON "subscriptions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tender_lots_tender_reference_unique" ON "tender_lots" USING btree ("tender_id","lot_reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenders_org_reference_unique" ON "tenders" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "upload_sessions_org_idempotency_unique" ON "upload_sessions" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vault_item_versions_item_number_unique" ON "vault_item_versions" USING btree ("vault_item_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_usage_org_project_idx" ON "vault_usage" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_tasks_org_owner_status_due_idx" ON "work_tasks" USING btree ("organisation_id","owner_membership_id","status","due_at");
-- END EMBEDDED IDEMPOTENT 0000.

-- Pre-create the 0002 audit boundary relations without RLS. The checked-in
-- 0002 migration is replayed after data reconciliation and after 0001 has
-- installed valo_security; this split keeps RLS as the final fail-closed gate.
-- BEGIN EMBEDDED IDEMPOTENT 0002 SCHEMA.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS hash_version integer DEFAULT 2 NOT NULL;
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
ALTER TABLE public.audit_events
  ALTER COLUMN seq SET NOT NULL,
  ALTER COLUMN prev_hash SET NOT NULL,
  ALTER COLUMN hash SET NOT NULL;
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
DROP INDEX IF EXISTS public.audit_events_organisation_seq_unique;
CREATE UNIQUE INDEX audit_events_organisation_seq_unique
  ON public.audit_events(organisation_id, seq);
ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_user_id_users_id_fk;

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
CREATE UNIQUE INDEX IF NOT EXISTS legacy_audit_assessments_org_digest_unique
  ON public.legacy_audit_integrity_assessments(organisation_id, archive_digest);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_audit_events_org_seq_unique
  ON public.legacy_audit_events(organisation_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_audit_events_org_row_no_unique
  ON public.legacy_audit_events(organisation_id, row_no);
-- END EMBEDDED IDEMPOTENT 0002 SCHEMA.

DO $copy_and_reconcile$
DECLARE
  inputs _valo_bridge_inputs%ROWTYPE;
  table_to_copy text;
  copy_order constant text[] := ARRAY[
    'users','clients','projects','documents','requirements','evidence_items',
    'defects','boq_checks','vault_items','capability_items','conflict_records',
    'notification_events','retention_requests','app_config','sbd_templates',
    'sbd_annotations','reports','llm_runs'
  ];
  tenant_tables constant text[] := ARRAY[
    'audit_events','boq_checks','capability_items','clients','conflict_records',
    'defects','documents','evidence_items','llm_runs','notification_events',
    'projects','reports','requirements','retention_requests','sbd_annotations',
    'sbd_templates','vault_items'
  ];
  column_list text;
  copy_columns text[];
  mismatch_exists boolean;
  copied_count bigint;
  archived_count bigint;
  table_has_created_at boolean;
  table_has_updated_at boolean;
  table_has_version boolean;
  null_tenant_count bigint;
BEGIN
  IF NOT (SELECT is_legacy FROM _valo_bridge_state) THEN
    RETURN;
  END IF;
  SELECT * INTO STRICT inputs FROM _valo_bridge_inputs;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS archived
    JOIN information_schema.columns AS target
      ON target.table_schema = 'public'
     AND target.table_name = archived.table_name
     AND target.column_name = archived.column_name
    WHERE archived.table_schema = 'valo_legacy_bridge_archive'
      AND (archived.data_type, archived.udt_name)
          IS DISTINCT FROM (target.data_type, target.udt_name)
  ) THEN
    RAISE EXCEPTION 'legacy/current shared-column type mismatch';
  END IF;

  IF inputs.expected_legacy_lineage =
       'replit-legacy-v1-production-push-managed'
     AND (
       SELECT count(*)
       FROM information_schema.columns AS target
       WHERE target.table_schema = 'public'
         AND target.is_nullable = 'YES'
         AND target.column_default IS NULL
         AND (target.table_name, target.column_name) IN (
           ('documents','extraction_method'),
           ('documents','extraction_confidence'),
           ('documents','extraction_notes'),
           ('llm_runs','prompt_tokens'),
           ('llm_runs','completion_tokens'),
           ('reports','taxonomy_version')
         )
     ) <> 6 THEN
    RAISE EXCEPTION 'the six push-managed target additions must remain nullable with NULL defaults';
  END IF;

  FOREACH table_to_copy IN ARRAY copy_order LOOP
    SELECT expected.column_names
      INTO STRICT copy_columns
      FROM _valo_effective_legacy_columns AS expected
      WHERE expected.table_name = table_to_copy;
    IF EXISTS (
      SELECT 1
      FROM unnest(copy_columns) AS source_column(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns AS target
        WHERE target.table_schema = 'public'
          AND target.table_name = table_to_copy
          AND target.column_name = source_column.column_name
      )
    ) THEN
      RAISE EXCEPTION 'pinned source column has no canonical target for %',
        table_to_copy;
    END IF;
    SELECT string_agg(format('%I', source_column.column_name), ', '
                      ORDER BY source_column.ordinality)
      INTO column_list
      FROM unnest(copy_columns) WITH ORDINALITY
        AS source_column(column_name, ordinality);
    IF column_list IS NULL THEN
      RAISE EXCEPTION 'pinned copy columns are absent for %', table_to_copy;
    END IF;
    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM valo_legacy_bridge_archive.%1$I',
      table_to_copy, column_list
    );

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='valo_legacy_bridge_archive'
        AND table_name=table_to_copy AND column_name='created_at'
    ) INTO table_has_created_at;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=table_to_copy AND column_name='updated_at'
    ) INTO table_has_updated_at;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=table_to_copy AND column_name='version'
    ) INTO table_has_version;
    IF table_has_updated_at AND table_has_created_at THEN
      EXECUTE format('UPDATE public.%I SET updated_at = created_at', table_to_copy);
    END IF;
    IF table_has_version
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='valo_legacy_bridge_archive'
           AND table_name=table_to_copy AND column_name='version'
       ) THEN
      EXECUTE format('UPDATE public.%I SET version = 1', table_to_copy);
    END IF;
  END LOOP;

  IF inputs.expected_legacy_lineage =
       'replit-legacy-v1-production-push-managed'
     AND (
       EXISTS (
         SELECT 1 FROM public.documents
         WHERE extraction_method IS NOT NULL
            OR extraction_confidence IS NOT NULL
            OR extraction_notes IS NOT NULL
       )
       OR EXISTS (
         SELECT 1 FROM public.llm_runs
         WHERE prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL
       )
       OR EXISTS (
         SELECT 1 FROM public.reports WHERE taxonomy_version IS NOT NULL
       )
     ) THEN
    RAISE EXCEPTION 'six absent push-managed fields were not initialized to NULL';
  END IF;

  INSERT INTO public.organisations (
    id, name, slug, type, status, country_code, created_by,
    version, created_at, updated_at
  )
  SELECT
    '56414c4f-0000-5000-8000-000000000025'::uuid,
    'Valo Nigeria',
    'valo-nigeria',
    'valo',
    'active',
    'NG',
    (SELECT id FROM public.users
     WHERE clerk_user_id=inputs.platform_admin_clerk_user_id
       AND status='active' AND role='admin'),
    1,
    COALESCE((SELECT min(created_at) FROM public.users), transaction_timestamp()),
    COALESCE((SELECT min(created_at) FROM public.users), transaction_timestamp());

  INSERT INTO public.legacy_audit_integrity_assessments (
    id, organisation_id, source_commit, source_event_count,
    verified_ranges, discontinuity_ranges, finding, probable_cause,
    external_head_seq, external_head_hash,
    source_backup_sha256, source_audit_export_sha256,
    rehearsal_evidence_sha256, archive_digest,
    assessed_at, created_at
  ) VALUES (
    '56414c4f-0000-5000-8000-000000000026'::uuid,
    '56414c4f-0000-5000-8000-000000000025'::uuid,
    'b71adcec4a7060c0ce2192266c81d880c5e56277',
    (SELECT count(*) FROM valo_legacy_bridge_archive.audit_events),
    '1-7,27-28',
    '8-26',
    'KNOWN_DISCONTINUITY: predecessor links and the external head are preserved, but the current payload bytes for events 8-26 do not reproduce their stored v1 hashes.',
    'Probable historical cause: audit_events.user_id used ON DELETE SET NULL even though user_id was hash-covered. The original deleted UUIDs are unavailable, so this is not asserted as proven.',
    inputs.expected_audit_head_seq_text::integer,
    inputs.expected_audit_head_hash,
    inputs.source_backup_sha256,
    inputs.source_audit_export_sha256,
    inputs.rehearsal_evidence_sha256,
    inputs.archive_digest,
    inputs.boundary_created_at::timestamptz,
    inputs.boundary_created_at::timestamptz
  );

  INSERT INTO public.legacy_audit_events (
    id, organisation_id, assessment_id, user_id, user_name, project_id,
    event_type, object_type, object_id, details, seq, prev_hash, hash, row_no,
    integrity_status, archived_at, created_at
  )
  SELECT
    id,
    '56414c4f-0000-5000-8000-000000000025'::uuid,
    '56414c4f-0000-5000-8000-000000000026'::uuid,
    user_id, user_name, project_id, event_type, object_type, object_id, details,
    seq, prev_hash, hash, row_no,
    CASE WHEN seq BETWEEN 8 AND 26
      THEN 'known_discontinuity' ELSE 'payload_hash_verified' END,
    inputs.boundary_created_at::timestamptz,
    created_at
  FROM valo_legacy_bridge_archive.audit_events
  ORDER BY seq;

  PERFORM setval(
    pg_get_serial_sequence('public.audit_events', 'row_no'),
    (SELECT max(row_no) FROM valo_legacy_bridge_archive.audit_events),
    true
  );

  INSERT INTO public.audit_events (
    id, organisation_id, user_id, user_name, project_id, event_type,
    object_type, object_id, details, seq, prev_hash, hash, hash_version,
    created_at
  ) VALUES (
    '56414c4f-0000-5000-8000-000000000027'::uuid,
    '56414c4f-0000-5000-8000-000000000025'::uuid,
    NULL,
    'Valo migration bridge',
    NULL,
    'audit.legacy_boundary_registered',
    'legacy_audit_integrity_assessment',
    '56414c4f-0000-5000-8000-000000000026',
    inputs.boundary_details,
    1,
    repeat('0', 64),
    inputs.boundary_hash,
    2,
    inputs.boundary_created_at::timestamptz
  );

  INSERT INTO public.organisation_memberships (
    id, organisation_id, user_id, status, access_starts_at,
    version, created_at, updated_at
  )
  SELECT
    id,
    '56414c4f-0000-5000-8000-000000000025'::uuid,
    id,
    'active',
    created_at,
    1,
    created_at,
    created_at
  FROM public.users
  WHERE status='active' AND role IN ('admin','reviewer','analyst');

  INSERT INTO public.role_grants (
    id, membership_id, role, starts_at, created_at
  )
  SELECT
    id,
    id,
    CASE role
      WHEN 'admin' THEN 'valo_operations_administrator'
      WHEN 'reviewer' THEN 'valo_quality_adviser'
      WHEN 'analyst' THEN 'valo_analyst'
    END,
    created_at,
    created_at
  FROM public.users
  WHERE status='active' AND role IN ('admin','reviewer','analyst');

  FOREACH table_to_copy IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'UPDATE public.%I SET organisation_id = $1 WHERE organisation_id IS NULL',
      table_to_copy
    ) USING '56414c4f-0000-5000-8000-000000000025'::uuid;
  END LOOP;

  FOREACH table_to_copy IN ARRAY copy_order LOOP
    SELECT string_agg(format('%I', archived.column_name), ', ' ORDER BY archived.ordinal_position)
      INTO column_list
      FROM information_schema.columns AS archived
      WHERE archived.table_schema = 'valo_legacy_bridge_archive'
        AND archived.table_name = table_to_copy;
    EXECUTE format('SELECT count(*) FROM valo_legacy_bridge_archive.%I', table_to_copy)
      INTO archived_count;
    EXECUTE format('SELECT count(*) FROM public.%I', table_to_copy)
      INTO copied_count;
    IF copied_count <> archived_count THEN
      RAISE EXCEPTION 'row-count reconciliation failed for %: source %, target %',
        table_to_copy, archived_count, copied_count;
    END IF;
    EXECUTE format(
      'SELECT EXISTS ((SELECT %2$s FROM valo_legacy_bridge_archive.%1$I EXCEPT ALL SELECT %2$s FROM public.%1$I) UNION ALL (SELECT %2$s FROM public.%1$I EXCEPT ALL SELECT %2$s FROM valo_legacy_bridge_archive.%1$I))',
      table_to_copy, column_list
    ) INTO mismatch_exists;
    IF mismatch_exists THEN
      RAISE EXCEPTION 'value/ID/timestamp reconciliation failed for %', table_to_copy;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.organisation_memberships)
       <> (SELECT count(*) FROM public.users WHERE status='active' AND role IN ('admin','reviewer','analyst'))
     OR (SELECT count(*) FROM public.role_grants)
       <> (SELECT count(*) FROM public.users WHERE status='active' AND role IN ('admin','reviewer','analyst')) THEN
    RAISE EXCEPTION 'legacy membership/role grant reconciliation failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.role_grants AS grant_record
    JOIN public.organisation_memberships AS membership ON membership.id=grant_record.membership_id
    JOIN public.users AS identity ON identity.id=membership.user_id
    WHERE grant_record.role <> CASE identity.role
      WHEN 'admin' THEN 'valo_operations_administrator'
      WHEN 'reviewer' THEN 'valo_quality_adviser'
      WHEN 'analyst' THEN 'valo_analyst'
    END
  ) THEN
    RAISE EXCEPTION 'legacy role mapping is not exact';
  END IF;

  FOREACH table_to_copy IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE organisation_id IS NULL OR organisation_id <> $1',
      table_to_copy
    ) INTO null_tenant_count
      USING '56414c4f-0000-5000-8000-000000000025'::uuid;
    IF null_tenant_count > 0 THEN
      RAISE EXCEPTION 'tenant reconciliation failed for %', table_to_copy;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.legacy_audit_events)
       <> (SELECT count(*) FROM valo_legacy_bridge_archive.audit_events)
     OR EXISTS (
       (SELECT id,user_id,user_name,project_id,event_type,object_type,object_id,details,
               seq,prev_hash,hash,row_no,created_at
        FROM valo_legacy_bridge_archive.audit_events
        EXCEPT ALL
        SELECT id,user_id,user_name,project_id,event_type,object_type,object_id,details,
               seq,prev_hash,hash,row_no,created_at
        FROM public.legacy_audit_events)
       UNION ALL
       (SELECT id,user_id,user_name,project_id,event_type,object_type,object_id,details,
               seq,prev_hash,hash,row_no,created_at
        FROM public.legacy_audit_events
        EXCEPT ALL
        SELECT id,user_id,user_name,project_id,event_type,object_type,object_id,details,
               seq,prev_hash,hash,row_no,created_at
        FROM valo_legacy_bridge_archive.audit_events)
     ) THEN
    RAISE EXCEPTION 'legacy audit byte/value reconciliation failed';
  END IF;
  IF (SELECT count(*) FROM public.legacy_audit_events WHERE integrity_status='known_discontinuity') <> 19
     OR EXISTS (
       SELECT 1 FROM public.legacy_audit_events
       WHERE (seq BETWEEN 8 AND 26) <> (integrity_status='known_discontinuity')
     ) THEN
    RAISE EXCEPTION 'legacy audit discontinuity classification failed';
  END IF;
  IF (SELECT count(*) FROM public.audit_events) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_events
       WHERE id='56414c4f-0000-5000-8000-000000000027'::uuid
         AND seq=1 AND prev_hash=repeat('0',64)
         AND hash=inputs.boundary_hash AND hash_version=2
         AND organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
         AND row_no > (SELECT max(row_no) FROM public.legacy_audit_events)
     ) THEN
    RAISE EXCEPTION 'active v2 audit boundary reconciliation failed';
  END IF;

  PERFORM setval(
    pg_get_serial_sequence('public.audit_events', 'row_no'),
    COALESCE((SELECT max(row_no) FROM public.audit_events), 1),
    EXISTS (SELECT 1 FROM public.audit_events)
  );
  IF (SELECT last_value FROM public.audit_events_row_no_seq)
       < (SELECT max(row_no) FROM public.audit_events) THEN
    RAISE EXCEPTION 'audit row_no sequence was not advanced safely';
  END IF;

  -- Retire legacy aliases after their tenant grants are safely materialised.
  UPDATE public.users
  SET role = CASE
    WHEN role='admin' AND clerk_user_id=inputs.platform_admin_clerk_user_id
      THEN 'restricted_platform_administrator'
    WHEN role='admin' THEN 'none'
    WHEN role='reviewer' THEN 'none'
    WHEN role='analyst' THEN 'none'
    ELSE role
  END,
  updated_at = transaction_timestamp()
  WHERE role IN ('admin','reviewer','analyst');
END;
$copy_and_reconcile$;

-- BEGIN EMBEDDED IDEMPOTENT 0001 (generated from the checked-in migration).
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
      'DROP POLICY IF EXISTS tenant_isolation ON public.%I',
      tenant_table
    );
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
      'DROP POLICY IF EXISTS tenant_or_global_select ON public.%I',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_or_global_select ON public.%I FOR SELECT TO PUBLIC USING (organisation_id = valo_security.current_organisation_id() OR organisation_id IS NULL)',
      tenant_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_insert ON public.%I',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT TO PUBLIC WITH CHECK (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_update ON public.%I',
      tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE TO PUBLIC USING (organisation_id = valo_security.current_organisation_id()) WITH CHECK (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_delete ON public.%I',
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
DROP POLICY IF EXISTS tenant_isolation ON public.partner_branding;
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
DROP POLICY IF EXISTS tenant_isolation ON public.partner_revenue_share_entries;
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
DROP POLICY IF EXISTS tenant_or_global_select ON public.price_book_entries;
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
DROP POLICY IF EXISTS tenant_insert ON public.price_book_entries;
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
DROP POLICY IF EXISTS tenant_update ON public.price_book_entries;
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
DROP POLICY IF EXISTS tenant_delete ON public.price_book_entries;
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
DROP POLICY IF EXISTS tenant_isolation ON public.invoice_lines;
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
DROP POLICY IF EXISTS tenant_isolation ON public.evaluation_results;
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
-- END EMBEDDED IDEMPOTENT 0001.

-- FORCE RLS applies to an ordinary table owner. Establish the one reviewed
-- tenant context transaction-locally so reconciliation does not depend on the
-- migration owner having Replit's BYPASSRLS capability.
SELECT valo_security.set_current_organisation_id(
  '56414c4f-0000-5000-8000-000000000025'::uuid
);

-- Complete checked-in 0002 after tenant reconciliation and the 0001 security
-- primitives. Reapplying this block is definitionally idempotent.
-- BEGIN EMBEDDED IDEMPOTENT 0002 SECURITY.
-- The active stream is SELECT+INSERT only. Archive evidence and its assessment
-- are SELECT only, FORCE-RLS protected, and owner-resistant against mutation.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint

-- A child row's own organisation_id policy is not enough: PostgreSQL foreign
-- keys do not apply the referenced table's RLS policy while checking the key.
-- Install an owner-independent, fail-closed trigger for every single-column FK
-- whose child and parent both carry organisation_id. The only global-parent
-- exceptions are the two pinned prompt-configuration edges. Archived audit
-- evidence is intentionally excluded; it is an exact historical snapshot and
-- is protected by its immutable archive controls.
-- Canonical LF-joined edge manifest SHA-256:
-- 0240790c357b1461feb2f48d1a1930750e4a09dbaf2502b1260b35c4fe706172
CREATE OR REPLACE FUNCTION valo_security.expected_tenant_parent_edges()
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
  VALUES
    ('approvals','project_id','projects','id',false),
    ('benchmark_consents','consent_record_id','consent_records','id',false),
    ('boq_checks','project_id','projects','id',false),
    ('boq_checks','source_doc_id','documents','id',false),
    ('boq_exceptions','boq_run_id','boq_runs','id',false),
    ('boq_runs','document_version_id','document_versions','id',false),
    ('boq_runs','project_id','projects','id',false),
    ('capability_evidence_links','capability_version_id','capability_versions','id',false),
    ('capability_evidence_links','document_version_id','document_versions','id',false),
    ('capability_evidence_links','vault_item_version_id','vault_item_versions','id',false),
    ('capability_items','client_id','clients','id',false),
    ('capability_items','evidence_doc_id','documents','id',false),
    ('capability_usage','capability_version_id','capability_versions','id',false),
    ('capability_usage','project_id','projects','id',false),
    ('capability_versions','capability_item_id','capability_items','id',false),
    ('claim_evidence_links','capability_version_id','capability_versions','id',false),
    ('claim_evidence_links','document_version_id','document_versions','id',false),
    ('claim_evidence_links','draft_claim_id','draft_claims','id',false),
    ('claim_evidence_links','vault_item_version_id','vault_item_versions','id',false),
    ('comments','project_id','projects','id',false),
    ('conflict_records','client_id','clients','id',false),
    ('conflict_records','matched_project_id','projects','id',false),
    ('conflict_records','project_id','projects','id',false),
    ('consent_records','privacy_record_id','privacy_records','id',false),
    ('cross_border_transfers','subprocessor_id','subprocessors','id',false),
    ('defect_decisions','defect_id','defects','id',false),
    ('defect_decisions','project_id','projects','id',false),
    ('defects','project_id','projects','id',false),
    ('defects','requirement_id','requirements','id',false),
    ('deletion_certificates','retention_action_id','retention_actions','id',false),
    ('document_versions','document_id','documents','id',false),
    ('documents','project_id','projects','id',false),
    ('draft_claims','draft_version_id','draft_versions','id',false),
    ('draft_versions','draft_id','drafts','id',false),
    ('draft_versions','model_run_id','processing_runs','id',false),
    ('drafts','project_id','projects','id',false),
    ('engagement_tender_lots','project_id','projects','id',false),
    ('engagement_tender_lots','tender_id','tenders','id',false),
    ('engagement_tender_lots','tender_lot_id','tender_lots','id',false),
    ('entitlement_usage','entitlement_id','entitlements','id',false),
    ('entitlement_usage','project_id','projects','id',false),
    ('entitlements','order_id','orders','id',false),
    ('entitlements','subscription_id','subscriptions','id',false),
    ('evaluation_runs','model_configuration_id','model_configurations','id',false),
    ('evaluation_runs','prompt_configuration_id','prompt_configurations','id',true),
    ('evidence_items','document_id','documents','id',false),
    ('evidence_items','project_id','projects','id',false),
    ('evidence_items','requirement_id','requirements','id',false),
    ('export_deliveries','package_version_id','package_versions','id',false),
    ('legal_holds','project_id','projects','id',false),
    ('llm_runs','project_id','projects','id',false),
    ('nda_records','client_id','clients','id',false),
    ('notification_attempts','notification_event_id','notification_events','id',false),
    ('notification_events','client_id','clients','id',false),
    ('notification_events','project_id','projects','id',false),
    ('notification_events','vault_item_id','vault_items','id',false),
    ('orders','project_id','projects','id',false),
    ('organisation_memberships','delegated_by_membership_id','organisation_memberships','id',false),
    ('outcomes','project_id','projects','id',false),
    ('package_manifest_items','package_version_id','package_versions','id',false),
    ('package_signoffs','audit_event_id','audit_events','id',false),
    ('package_signoffs','package_version_id','package_versions','id',false),
    ('package_versions','package_id','packages','id',false),
    ('packages','project_id','projects','id',false),
    ('payments','invoice_id','invoices','id',false),
    ('processing_jobs','document_version_id','document_versions','id',false),
    ('processing_jobs','project_id','projects','id',false),
    ('processing_runs','job_id','processing_jobs','id',false),
    ('processing_runs','model_configuration_id','model_configurations','id',false),
    ('processing_runs','prompt_configuration_id','prompt_configurations','id',true),
    ('projects','client_id','clients','id',false),
    ('red_team_findings','red_team_run_id','red_team_runs','id',false),
    ('red_team_runs','project_id','projects','id',false),
    ('renewal_monitors','last_notification_event_id','notification_events','id',false),
    ('renewal_monitors','vault_item_version_id','vault_item_versions','id',false),
    ('reports','project_id','projects','id',false),
    ('requirement_citations','document_version_id','document_versions','id',false),
    ('requirement_citations','requirement_id','requirements','id',false),
    ('requirements','project_id','projects','id',false),
    ('requirements','source_doc_id','documents','id',false),
    ('retention_actions','legal_hold_id','legal_holds','id',false),
    ('retention_actions','retention_request_id','retention_requests','id',false),
    ('retention_requests','project_id','projects','id',false),
    ('reviews','project_id','projects','id',false),
    ('rule_evaluations','project_id','projects','id',false),
    ('rule_overrides','rule_evaluation_id','rule_evaluations','id',false),
    ('sbd_annotations','template_id','sbd_templates','id',false),
    ('tender_lots','tender_id','tenders','id',false),
    ('upload_sessions','project_id','projects','id',false),
    ('vault_item_versions','document_version_id','document_versions','id',false),
    ('vault_item_versions','vault_item_id','vault_items','id',false),
    ('vault_items','client_id','clients','id',false),
    ('vault_items','source_document_id','documents','id',false),
    ('vault_usage','project_id','projects','id',false),
    ('vault_usage','vault_item_version_id','vault_item_versions','id',false),
    ('work_tasks','owner_membership_id','organisation_memberships','id',false),
    ('work_tasks','project_id','projects','id',false),
    ('work_tasks','requirement_id','requirements','id',false)
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.expected_tenant_parent_edges() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION valo_security.enforce_tenant_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  parent_relation text := TG_ARGV[0];
  parent_key_column text := TG_ARGV[1];
  child_foreign_key_column text := TG_ARGV[2];
  allow_global_parent boolean := TG_ARGV[3]::boolean;
  parent_reference uuid;
  child_organisation_id uuid;
  valid_parent boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (pg_catalog.to_jsonb(OLD) ->> child_foreign_key_column)
       IS NOT DISTINCT FROM
       (pg_catalog.to_jsonb(NEW) ->> child_foreign_key_column)
     AND (pg_catalog.to_jsonb(OLD) ->> 'organisation_id')
       IS NOT DISTINCT FROM
       (pg_catalog.to_jsonb(NEW) ->> 'organisation_id') THEN
    RETURN NEW;
  END IF;

  parent_reference := NULLIF(
    pg_catalog.to_jsonb(NEW) ->> child_foreign_key_column,
    ''
  )::uuid;
  IF parent_reference IS NULL THEN
    RETURN NEW;
  END IF;

  child_organisation_id := NULLIF(
    pg_catalog.to_jsonb(NEW) ->> 'organisation_id',
    ''
  )::uuid;
  IF child_organisation_id IS NULL THEN
    valid_parent := false;
  ELSE
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (' ||
      'SELECT 1 FROM public.%I AS parent ' ||
      'WHERE parent.%I = $1 ' ||
      'AND (parent.organisation_id = $2%s))',
      parent_relation,
      parent_key_column,
      CASE
        WHEN allow_global_parent THEN ' OR parent.organisation_id IS NULL'
        ELSE ''
      END
    )
    INTO valid_parent
    USING parent_reference, child_organisation_id;
  END IF;

  IF NOT valid_parent THEN
    RAISE EXCEPTION
      'tenant relationship rejected for %.%',
      TG_TABLE_NAME,
      child_foreign_key_column
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.enforce_tenant_parent() FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION valo_security.enforce_tenant_parent() IS
  'Rejects cross-organisation parent references that ordinary foreign keys and direct tenant RLS cannot detect.';
--> statement-breakpoint

DO $tenant_parent_triggers$
DECLARE
  tenant_link record;
  tenant_organisation record;
  mismatch_exists boolean;
  mismatch_predicate text;
  previous_organisation_context text;
  trigger_name text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS child_relation
      ON child_relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS child_namespace
      ON child_namespace.oid = child_relation.relnamespace
    JOIN pg_catalog.pg_class AS parent_relation
      ON parent_relation.oid = constraint_record.confrelid
    JOIN pg_catalog.pg_namespace AS parent_namespace
      ON parent_namespace.oid = parent_relation.relnamespace
    WHERE constraint_record.contype = 'f'
      AND child_namespace.nspname = 'public'
      AND parent_namespace.nspname = 'public'
      AND (
        pg_catalog.cardinality(constraint_record.conkey) <> 1
        OR pg_catalog.cardinality(constraint_record.confkey) <> 1
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS child_organisation
        WHERE child_organisation.attrelid = child_relation.oid
          AND child_organisation.attname = 'organisation_id'
          AND NOT child_organisation.attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS parent_organisation
        WHERE parent_organisation.attrelid = parent_relation.oid
          AND parent_organisation.attname = 'organisation_id'
          AND NOT parent_organisation.attisdropped
      )
  ) THEN
    RAISE EXCEPTION
      'unexpected composite tenant parent edge is outside the pinned manifest';
  END IF;

  IF EXISTS (
    WITH actual_edges AS (
      SELECT
        child_relation.relname::text AS child_table,
        child_key.attname::text AS child_column,
        parent_relation.relname::text AS parent_table,
        parent_key.attname::text AS parent_column,
        child_relation.relname IN ('evaluation_runs','processing_runs')
          AND child_key.attname = 'prompt_configuration_id'
          AND parent_relation.relname = 'prompt_configurations'
            AS allow_global_parent
      FROM pg_catalog.pg_constraint AS constraint_record
      JOIN pg_catalog.pg_class AS child_relation
        ON child_relation.oid = constraint_record.conrelid
      JOIN pg_catalog.pg_namespace AS child_namespace
        ON child_namespace.oid = child_relation.relnamespace
      JOIN pg_catalog.pg_class AS parent_relation
        ON parent_relation.oid = constraint_record.confrelid
      JOIN pg_catalog.pg_namespace AS parent_namespace
        ON parent_namespace.oid = parent_relation.relnamespace
      JOIN pg_catalog.pg_attribute AS child_key
        ON child_key.attrelid = child_relation.oid
       AND child_key.attnum = constraint_record.conkey[1]
      JOIN pg_catalog.pg_attribute AS parent_key
        ON parent_key.attrelid = parent_relation.oid
       AND parent_key.attnum = constraint_record.confkey[1]
      WHERE constraint_record.contype = 'f'
        AND pg_catalog.array_length(constraint_record.conkey, 1) = 1
        AND pg_catalog.array_length(constraint_record.confkey, 1) = 1
        AND child_namespace.nspname = 'public'
        AND parent_namespace.nspname = 'public'
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS child_organisation
          WHERE child_organisation.attrelid = child_relation.oid
            AND child_organisation.attname = 'organisation_id'
            AND NOT child_organisation.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS parent_organisation
          WHERE parent_organisation.attrelid = parent_relation.oid
            AND parent_organisation.attname = 'organisation_id'
            AND NOT parent_organisation.attisdropped
        )
    ), expected_edges AS (
      SELECT * FROM valo_security.expected_tenant_parent_edges()
      UNION ALL
      SELECT
        'legacy_audit_events',
        'assessment_id',
        'legacy_audit_integrity_assessments',
        'id',
        false
    )
    (
      SELECT * FROM actual_edges
      EXCEPT ALL
      SELECT * FROM expected_edges
    )
    UNION ALL
    (
      SELECT * FROM expected_edges
      EXCEPT ALL
      SELECT * FROM actual_edges
    )
  ) THEN
    RAISE EXCEPTION
      'tenant parent edge catalog differs from the pinned 98-edge manifest plus immutable archive exception';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND policy.polname = 'valo_tenant_preflight_null'
  ) THEN
    RAISE EXCEPTION
      'reserved migration policy name valo_tenant_preflight_null already exists';
  END IF;

  previous_organisation_context :=
    pg_catalog.current_setting('app.current_organisation_id', true);

  FOR tenant_link IN
    SELECT
      child_relation.relname::text AS child_table,
      parent_relation.relname::text AS parent_table,
      child_key.attname::text AS child_column,
      parent_key.attname::text AS parent_column,
      child_relation.relname IN ('evaluation_runs','processing_runs')
        AND child_key.attname = 'prompt_configuration_id'
        AND parent_relation.relname = 'prompt_configurations'
          AS allow_global_parent
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS child_relation
      ON child_relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS child_namespace
      ON child_namespace.oid = child_relation.relnamespace
    JOIN pg_catalog.pg_class AS parent_relation
      ON parent_relation.oid = constraint_record.confrelid
    JOIN pg_catalog.pg_namespace AS parent_namespace
      ON parent_namespace.oid = parent_relation.relnamespace
    JOIN pg_catalog.pg_attribute AS child_key
      ON child_key.attrelid = child_relation.oid
     AND child_key.attnum = constraint_record.conkey[1]
    JOIN pg_catalog.pg_attribute AS parent_key
      ON parent_key.attrelid = parent_relation.oid
     AND parent_key.attnum = constraint_record.confkey[1]
    WHERE constraint_record.contype = 'f'
      AND pg_catalog.array_length(constraint_record.conkey, 1) = 1
      AND pg_catalog.array_length(constraint_record.confkey, 1) = 1
      AND child_namespace.nspname = 'public'
      AND parent_namespace.nspname = 'public'
      AND NOT (
        child_relation.relname = 'legacy_audit_events'
        AND child_key.attname = 'assessment_id'
        AND parent_relation.relname = 'legacy_audit_integrity_assessments'
        AND parent_key.attname = 'id'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS child_organisation
        WHERE child_organisation.attrelid = child_relation.oid
          AND child_organisation.attname = 'organisation_id'
          AND NOT child_organisation.attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS parent_organisation
        WHERE parent_organisation.attrelid = parent_relation.oid
          AND parent_organisation.attname = 'organisation_id'
          AND NOT parent_organisation.attisdropped
      )

    ORDER BY child_table, child_column
  LOOP
    mismatch_predicate := CASE
      WHEN tenant_link.allow_global_parent THEN
        'child.organisation_id IS NULL OR (' ||
        'parent.organisation_id IS NOT NULL AND ' ||
        'parent.organisation_id IS DISTINCT FROM child.organisation_id)'
      ELSE
        'child.organisation_id IS NULL OR ' ||
        'parent.organisation_id IS DISTINCT FROM child.organisation_id'
    END;

    -- Strict child NULLs are invisible under every normal tenant policy. A
    -- transaction-only policy exposes just those rows to the migration role;
    -- it is dropped before this transaction can commit and is never visible to
    -- concurrent sessions.
    EXECUTE pg_catalog.format(
      'CREATE POLICY valo_tenant_preflight_null ON public.%I ' ||
      'FOR SELECT TO %I USING (organisation_id IS NULL)',
      tenant_link.child_table,
      CURRENT_USER
    );
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (' ||
      'SELECT 1 FROM public.%1$I AS child ' ||
      'WHERE child.%2$I IS NOT NULL ' ||
      'AND child.organisation_id IS NULL)',
      tenant_link.child_table,
      tenant_link.child_column
    ) INTO mismatch_exists;
    EXECUTE pg_catalog.format(
      'DROP POLICY valo_tenant_preflight_null ON public.%I',
      tenant_link.child_table
    );

    IF mismatch_exists THEN
      PERFORM pg_catalog.set_config(
        'app.current_organisation_id',
        COALESCE(previous_organisation_context, ''),
        true
      );
      RAISE EXCEPTION
        'existing tenant parent mismatch: %.% -> %',
        tenant_link.child_table,
        tenant_link.child_column,
        tenant_link.parent_table;
    END IF;

    mismatch_exists := false;
    FOR tenant_organisation IN
      SELECT organisation.id
      FROM public.organisations AS organisation
      ORDER BY organisation.id
    LOOP
      PERFORM pg_catalog.set_config(
        'app.current_organisation_id',
        tenant_organisation.id::text,
        true
      );
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (' ||
        'SELECT 1 FROM public.%1$I AS child ' ||
        'LEFT JOIN public.%2$I AS parent ' ||
        'ON parent.%3$I = child.%4$I ' ||
        'WHERE child.%4$I IS NOT NULL ' ||
        'AND (parent.tableoid IS NULL OR %5$s))',
        tenant_link.child_table,
        tenant_link.parent_table,
        tenant_link.parent_column,
        tenant_link.child_column,
        mismatch_predicate
      ) INTO mismatch_exists;
      EXIT WHEN mismatch_exists;
    END LOOP;

    IF mismatch_exists THEN
      PERFORM pg_catalog.set_config(
        'app.current_organisation_id',
        COALESCE(previous_organisation_context, ''),
        true
      );
      RAISE EXCEPTION
        'existing tenant parent mismatch: %.% -> %',
        tenant_link.child_table,
        tenant_link.child_column,
        tenant_link.parent_table;
    END IF;

    trigger_name := pg_catalog.left(
      'tenant_parent_' || tenant_link.child_column,
      63
    );
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      trigger_name,
      tenant_link.child_table
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organisation_id, %I ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION ' ||
      'valo_security.enforce_tenant_parent(%L, %L, %L, %L)',
      trigger_name,
      tenant_link.child_column,
      tenant_link.child_table,
      tenant_link.parent_table,
      tenant_link.parent_column,
      tenant_link.child_column,
      tenant_link.allow_global_parent::text
    );
  END LOOP;
  PERFORM pg_catalog.set_config(
    'app.current_organisation_id',
    COALESCE(previous_organisation_context, ''),
    true
  );
END;
$tenant_parent_triggers$;
--> statement-breakpoint

-- Derived/control-plane relationships do not all expose organisation_id on
-- both sides, so they cannot appear in the direct 98-edge manifest. This one
-- function covers the six audited gaps with one non-oracular rejection path.
CREATE OR REPLACE FUNCTION valo_security.enforce_derived_tenant_relationship()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  valid_relationship boolean := false;
  child_organisation_id uuid;
  parent_reference uuid;
  secondary_reference uuid;
  derived_partner_organisation_id uuid;
  derived_client_organisation_id uuid;
  relationship_status text;
BEGIN
  CASE
    WHEN TG_TABLE_NAME IN ('orders', 'subscriptions') THEN
      child_organisation_id := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'organisation_id',
        ''
      )::uuid;
      parent_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'price_book_entry_id',
        ''
      )::uuid;
      SELECT EXISTS (
        SELECT 1
        FROM public.price_book_entries AS entry
        JOIN public.price_books AS book ON book.id = entry.price_book_id
        WHERE entry.id = parent_reference
          AND child_organisation_id IS NOT NULL
          AND (
            book.organisation_id = child_organisation_id
            OR book.organisation_id IS NULL
          )
      ) INTO valid_relationship;

    WHEN TG_TABLE_NAME = 'invoice_lines' THEN
      parent_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'order_id',
        ''
      )::uuid;
      IF parent_reference IS NULL THEN
        RETURN NEW;
      END IF;
      secondary_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'invoice_id',
        ''
      )::uuid;
      SELECT EXISTS (
        SELECT 1
        FROM public.invoices AS invoice
        JOIN public.orders AS tenant_order
          ON tenant_order.id = parent_reference
         AND tenant_order.organisation_id = invoice.organisation_id
        WHERE invoice.id = secondary_reference
      ) INTO valid_relationship;

    WHEN TG_TABLE_NAME = 'partner_revenue_share_entries' THEN
      parent_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'order_id',
        ''
      )::uuid;
      derived_partner_organisation_id := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'partner_organisation_id',
        ''
      )::uuid;
      derived_client_organisation_id := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'client_organisation_id',
        ''
      )::uuid;
      -- Revenue mutations are client-controlled. This also ensures FORCE RLS
      -- can expose the client order without a definer/BYPASS data oracle.
      SELECT
        derived_client_organisation_id = valo_security.current_organisation_id()
        AND EXISTS (
          SELECT 1
          FROM public.orders AS tenant_order
          WHERE tenant_order.id = parent_reference
            AND tenant_order.organisation_id = derived_client_organisation_id
        )
        AND EXISTS (
          SELECT 1
          FROM public.partner_relationships AS relationship
          WHERE relationship.partner_organisation_id = derived_partner_organisation_id
            AND relationship.client_organisation_id = derived_client_organisation_id
            AND relationship.status = 'active'
        )
      INTO valid_relationship;

    WHEN TG_TABLE_NAME = 'role_grants' THEN
      parent_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'membership_id',
        ''
      )::uuid;
      secondary_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'granted_by_membership_id',
        ''
      )::uuid;
      SELECT EXISTS (
        SELECT 1
        FROM public.organisation_memberships AS subject_membership
        LEFT JOIN public.organisation_memberships AS grantor_membership
          ON grantor_membership.id = secondary_reference
        WHERE subject_membership.id = parent_reference
          AND (
            secondary_reference IS NULL
            OR grantor_membership.organisation_id =
              subject_membership.organisation_id
          )
      ) INTO valid_relationship;

    WHEN TG_TABLE_NAME = 'partner_relationships' THEN
      parent_reference := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'approved_by_membership_id',
        ''
      )::uuid;
      relationship_status := pg_catalog.to_jsonb(NEW) ->> 'status';
      IF parent_reference IS NULL AND relationship_status <> 'active' THEN
        RETURN NEW;
      END IF;
      derived_client_organisation_id := NULLIF(
        pg_catalog.to_jsonb(NEW) ->> 'client_organisation_id',
        ''
      )::uuid;
      SELECT EXISTS (
        SELECT 1
        FROM public.organisation_memberships AS approver_membership
        WHERE approver_membership.id = parent_reference
          AND approver_membership.organisation_id = derived_client_organisation_id
      ) AND (
        relationship_status <> 'active'
        OR parent_reference IS NOT NULL
      ) INTO valid_relationship;

    ELSE
      RAISE EXCEPTION 'unknown derived tenant relationship trigger target: %',
        TG_TABLE_NAME
        USING ERRCODE = '55000';
  END CASE;

  IF NOT valid_relationship THEN
    RAISE EXCEPTION 'tenant relationship rejected for %.derived_scope',
      TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.enforce_derived_tenant_relationship() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION valo_security.reject_tenant_identity_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'break_glass_sessions'
     AND OLD.target_organisation_id IS DISTINCT FROM
       NEW.target_organisation_id THEN
    RAISE EXCEPTION 'tenant identity reassignment rejected for break_glass_sessions'
      USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'organisation_memberships'
     AND OLD.organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'tenant identity reassignment rejected for organisation_memberships'
      USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'partner_relationships'
     AND (
       OLD.partner_organisation_id IS DISTINCT FROM NEW.partner_organisation_id
       OR OLD.client_organisation_id IS DISTINCT FROM NEW.client_organisation_id
     ) THEN
    RAISE EXCEPTION 'tenant identity reassignment rejected for partner_relationships'
      USING ERRCODE = '42501';
  ELSIF TG_TABLE_NAME = 'role_grants'
     AND (
       OLD.membership_id IS DISTINCT FROM NEW.membership_id
       OR OLD.granted_by_membership_id IS DISTINCT FROM NEW.granted_by_membership_id
     ) THEN
    RAISE EXCEPTION 'tenant identity reassignment rejected for role_grants'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.reject_tenant_identity_reassignment() FROM PUBLIC;
--> statement-breakpoint

-- Control-plane discovery tables cannot use ordinary tenant RLS because they
-- are needed to establish a tenant session. Mutations still require an already
-- established transaction-local tenant context and follow the API ownership
-- boundary: memberships/role grants belong to the current organisation,
-- partner requests are created by the partner, and client lifecycle updates
-- are performed by the client.
CREATE OR REPLACE FUNCTION valo_security.enforce_control_plane_tenant_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  current_organisation_id uuid := valo_security.current_organisation_id();
  subject_organisation_id uuid;
  valid_context boolean := false;
BEGIN
  -- Restore/migration and isolated test owners may be PostgreSQL superusers or
  -- explicit BYPASSRLS roles. The deployed runtime is startup-attested to be
  -- neither, so this cannot become an application authorization bypass.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
      AND (role.rolsuper OR role.rolbypassrls)
  ) THEN
    RETURN NEW;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'organisations' THEN
      valid_context := current_organisation_id IS NOT NULL
        AND TG_OP = 'INSERT'
        AND NEW.id = current_organisation_id;

    WHEN 'organisation_memberships' THEN
      valid_context := current_organisation_id IS NOT NULL
        AND NEW.organisation_id = current_organisation_id;

    WHEN 'role_grants' THEN
      SELECT membership.organisation_id
      INTO subject_organisation_id
      FROM public.organisation_memberships AS membership
      WHERE membership.id = NEW.membership_id;
      valid_context := current_organisation_id IS NOT NULL
        AND subject_organisation_id = current_organisation_id;

    WHEN 'break_glass_sessions' THEN
      valid_context := current_organisation_id IS NOT NULL
        AND NEW.target_organisation_id = current_organisation_id;

    WHEN 'partner_relationships' THEN
      valid_context := current_organisation_id IS NOT NULL
        AND (
          (TG_OP = 'INSERT'
            AND NEW.partner_organisation_id = current_organisation_id
            AND NEW.status = 'pending'
            AND NEW.approved_by_membership_id IS NULL
            AND NEW.access_starts_at IS NULL)
          OR (TG_OP = 'UPDATE'
            AND NEW.client_organisation_id = current_organisation_id)
        );

    ELSE
      RAISE EXCEPTION 'unknown control-plane tenant trigger target: %',
        TG_TABLE_NAME
        USING ERRCODE = '55000';
  END CASE;

  IF NOT valid_context THEN
    RAISE EXCEPTION 'tenant control-plane mutation rejected for %',
      TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.enforce_control_plane_tenant_context() FROM PUBLIC;
--> statement-breakpoint

DO $derived_tenant_preflight$
DECLARE
  tenant_organisation record;
  mismatch_exists boolean;
  previous_organisation_context text;
BEGIN
  previous_organisation_context :=
    pg_catalog.current_setting('app.current_organisation_id', true);

  FOR tenant_organisation IN
    SELECT organisation.id
    FROM public.organisations AS organisation
    ORDER BY organisation.id
  LOOP
    PERFORM pg_catalog.set_config(
      'app.current_organisation_id',
      tenant_organisation.id::text,
      true
    );
    SELECT
      EXISTS (
        SELECT 1
        FROM public.orders AS tenant_order
        LEFT JOIN public.price_book_entries AS entry
          ON entry.id = tenant_order.price_book_entry_id
        LEFT JOIN public.price_books AS book ON book.id = entry.price_book_id
        WHERE entry.tableoid IS NULL
           OR book.tableoid IS NULL
           OR (
             book.organisation_id IS NOT NULL
             AND book.organisation_id IS DISTINCT FROM
               tenant_order.organisation_id
           )
      ) OR EXISTS (
        SELECT 1
        FROM public.subscriptions AS subscription
        LEFT JOIN public.price_book_entries AS entry
          ON entry.id = subscription.price_book_entry_id
        LEFT JOIN public.price_books AS book ON book.id = entry.price_book_id
        WHERE entry.tableoid IS NULL
           OR book.tableoid IS NULL
           OR (
             book.organisation_id IS NOT NULL
             AND book.organisation_id IS DISTINCT FROM
               subscription.organisation_id
           )
      ) OR EXISTS (
        SELECT 1
        FROM public.invoice_lines AS invoice_line
        LEFT JOIN public.invoices AS invoice
          ON invoice.id = invoice_line.invoice_id
        LEFT JOIN public.orders AS tenant_order
          ON tenant_order.id = invoice_line.order_id
        WHERE invoice_line.order_id IS NOT NULL
          AND (
            invoice.tableoid IS NULL
            OR tenant_order.tableoid IS NULL
            OR tenant_order.organisation_id IS DISTINCT FROM
              invoice.organisation_id
          )
      ) OR EXISTS (
        SELECT 1
        FROM public.partner_revenue_share_entries AS revenue
        LEFT JOIN public.orders AS tenant_order
          ON tenant_order.id = revenue.order_id
        WHERE revenue.client_organisation_id = tenant_organisation.id
          AND (
            tenant_order.tableoid IS NULL
            OR tenant_order.organisation_id IS DISTINCT FROM
              revenue.client_organisation_id
            OR NOT EXISTS (
              SELECT 1
              FROM public.partner_relationships AS relationship
              WHERE relationship.partner_organisation_id =
                revenue.partner_organisation_id
                AND relationship.client_organisation_id =
                  revenue.client_organisation_id
                AND relationship.status = 'active'
            )
          )
      )
    INTO mismatch_exists;

    IF mismatch_exists THEN
      PERFORM pg_catalog.set_config(
        'app.current_organisation_id',
        COALESCE(previous_organisation_context, ''),
        true
      );
      RAISE EXCEPTION 'existing derived tenant relationship mismatch';
    END IF;
  END LOOP;

  PERFORM pg_catalog.set_config(
    'app.current_organisation_id',
    COALESCE(previous_organisation_context, ''),
    true
  );

  IF EXISTS (
    SELECT 1
    FROM public.role_grants AS role_grant
    LEFT JOIN public.organisation_memberships AS subject_membership
      ON subject_membership.id = role_grant.membership_id
    LEFT JOIN public.organisation_memberships AS grantor_membership
      ON grantor_membership.id = role_grant.granted_by_membership_id
    WHERE subject_membership.tableoid IS NULL
       OR (
         role_grant.granted_by_membership_id IS NOT NULL
         AND (
           grantor_membership.tableoid IS NULL
           OR grantor_membership.organisation_id IS DISTINCT FROM
             subject_membership.organisation_id
         )
       )
  ) OR EXISTS (
    SELECT 1
    FROM public.partner_relationships AS relationship
    LEFT JOIN public.organisation_memberships AS approver_membership
      ON approver_membership.id = relationship.approved_by_membership_id
    WHERE (
        relationship.status = 'active'
        AND relationship.approved_by_membership_id IS NULL
      ) OR (
        relationship.approved_by_membership_id IS NOT NULL
        AND approver_membership.organisation_id IS DISTINCT FROM
          relationship.client_organisation_id
      )
  ) THEN
    RAISE EXCEPTION 'existing derived tenant relationship mismatch';
  END IF;
END;
$derived_tenant_preflight$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tenant_derived_price_book_entry ON public.orders;
--> statement-breakpoint
CREATE TRIGGER tenant_derived_price_book_entry
  BEFORE INSERT OR UPDATE OF organisation_id, price_book_entry_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_derived_tenant_relationship();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_derived_price_book_entry ON public.subscriptions;
--> statement-breakpoint
CREATE TRIGGER tenant_derived_price_book_entry
  BEFORE INSERT OR UPDATE OF organisation_id, price_book_entry_id ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_derived_tenant_relationship();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_derived_invoice_order ON public.invoice_lines;
--> statement-breakpoint
CREATE TRIGGER tenant_derived_invoice_order
  BEFORE INSERT OR UPDATE OF invoice_id, order_id ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_derived_tenant_relationship();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_derived_partner_revenue ON public.partner_revenue_share_entries;
--> statement-breakpoint
CREATE TRIGGER tenant_derived_partner_revenue
  BEFORE INSERT OR UPDATE OF partner_organisation_id, client_organisation_id, order_id
  ON public.partner_revenue_share_entries
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_derived_tenant_relationship();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_derived_role_grant ON public.role_grants;
--> statement-breakpoint
CREATE TRIGGER tenant_derived_role_grant
  BEFORE INSERT ON public.role_grants
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_derived_tenant_relationship();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_derived_partner_approver ON public.partner_relationships;
--> statement-breakpoint
CREATE TRIGGER tenant_derived_partner_approver
  BEFORE INSERT OR UPDATE OF approved_by_membership_id, status
  ON public.partner_relationships
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_derived_tenant_relationship();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_membership_organisation_immutable ON public.organisation_memberships;
--> statement-breakpoint
CREATE TRIGGER tenant_membership_organisation_immutable
  BEFORE UPDATE OF organisation_id ON public.organisation_memberships
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_tenant_identity_reassignment();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_partner_parties_immutable ON public.partner_relationships;
--> statement-breakpoint
CREATE TRIGGER tenant_partner_parties_immutable
  BEFORE UPDATE OF partner_organisation_id, client_organisation_id
  ON public.partner_relationships
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_tenant_identity_reassignment();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_role_grant_identity_immutable ON public.role_grants;
--> statement-breakpoint
CREATE TRIGGER tenant_role_grant_identity_immutable
  BEFORE UPDATE OF membership_id, granted_by_membership_id ON public.role_grants
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_tenant_identity_reassignment();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tenant_control_membership_context ON public.organisation_memberships;
--> statement-breakpoint
CREATE TRIGGER tenant_control_membership_context
  BEFORE INSERT OR UPDATE ON public.organisation_memberships
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_control_plane_tenant_context();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_control_role_grant_context ON public.role_grants;
--> statement-breakpoint
CREATE TRIGGER tenant_control_role_grant_context
  BEFORE INSERT OR UPDATE ON public.role_grants
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_control_plane_tenant_context();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_control_partner_context ON public.partner_relationships;
--> statement-breakpoint
CREATE TRIGGER tenant_control_partner_context
  BEFORE INSERT OR UPDATE ON public.partner_relationships
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_control_plane_tenant_context();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_control_organisation_context ON public.organisations;
--> statement-breakpoint
CREATE TRIGGER tenant_control_organisation_context
  BEFORE INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_control_plane_tenant_context();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_control_break_glass_context ON public.break_glass_sessions;
--> statement-breakpoint
CREATE TRIGGER tenant_control_break_glass_context
  BEFORE INSERT OR UPDATE ON public.break_glass_sessions
  FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_control_plane_tenant_context();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_break_glass_target_immutable ON public.break_glass_sessions;
--> statement-breakpoint
CREATE TRIGGER tenant_break_glass_target_immutable
  BEFORE UPDATE OF target_organisation_id ON public.break_glass_sessions
  FOR EACH ROW EXECUTE FUNCTION valo_security.reject_tenant_identity_reassignment();
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
       CURRENT_USER,
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
-- END EMBEDDED IDEMPOTENT 0002 SECURITY.

-- A completed 0010 target retains the source-pinned 116-edge wrapper. The
-- embedded v2.5 refresh above repairs the preserved base function, while this
-- exact definition restores the additive wrapper before catalog validation.
DO $restore_tender_context_edges$
BEGIN
  IF (SELECT tender_context_expected FROM _valo_bridge_state) THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION valo_security.expected_tenant_parent_edges()
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
  FROM valo_security.expected_tenant_parent_edges_v25()
  UNION ALL
  SELECT *
  FROM (VALUES
    ('addendum_impact_assessments','baseline_document_version_id','document_versions','id',false),
    ('addendum_impact_assessments','project_id','projects','id',false),
    ('addendum_impact_assessments','revision_document_version_id','document_versions','id',false),
    ('addendum_impact_items','assessment_id','addendum_impact_assessments','id',false),
    ('document_version_snapshots','document_version_id','document_versions','id',false),
    ('tender_context_artifacts','document_version_id','document_versions','id',false),
    ('tender_context_artifacts','project_id','projects','id',false),
    ('tender_context_artifacts','tender_context_version_id','tender_context_versions','id',false),
    ('tender_context_artifacts','vault_item_version_id','vault_item_versions','id',false),
    ('tender_context_requirements','project_id','projects','id',false),
    ('tender_context_requirements','requirement_citation_id','requirement_citations','id',false),
    ('tender_context_requirements','requirement_id','requirements','id',false),
    ('tender_context_requirements','tender_context_version_id','tender_context_versions','id',false),
    ('tender_context_versions','primary_document_version_id','document_versions','id',false),
    ('tender_context_versions','project_id','projects','id',false),
    ('tender_context_versions','supersedes_context_version_id','tender_context_versions','id',false),
    ('tender_eligibility_passports','project_id','projects','id',false),
    ('tender_eligibility_passports','tender_context_version_id','tender_context_versions','id',false)
  ) AS edge(child_table, child_column, parent_table, parent_column, allow_global_parent);
      $function$
    $sql$;
  END IF;
END;
$restore_tender_context_edges$;
--> statement-breakpoint

DO $post_rls_validation$
DECLARE
  expected_rls_tables constant text[] := ARRAY[
    'approvals','audit_anchors','audit_events','benchmark_consents','boq_checks',
    'boq_exceptions','boq_runs','capability_evidence_links','capability_items',
    'capability_usage','capability_versions','claim_evidence_links','clients',
    'comments','conflict_records','consent_records','cross_border_transfers',
    'data_subject_requests','defect_decisions','defects','deletion_certificates',
    'document_versions','documents','draft_claims','draft_versions','drafts',
    'engagement_tender_lots','entitlement_usage','entitlements',
    'evaluation_cases','evaluation_results','evaluation_runs','evidence_items',
    'export_deliveries','feature_flags','integration_configurations',
    'integration_receipts','invoice_lines','invoices','legal_holds',
    'legacy_audit_events','legacy_audit_integrity_assessments','llm_runs',
    'model_configurations','nda_records','notification_attempts',
    'notification_events','orders','outcomes','package_manifest_items',
    'package_signoffs','package_versions','packages','partner_branding',
    'partner_revenue_share_entries','payments','price_book_entries',
    'price_books','privacy_records','processing_jobs','processing_runs',
    'projects','prompt_configurations','red_team_findings','red_team_runs',
    'renewal_monitors','reports','requirement_citations','requirements',
    'retention_actions','retention_requests','reviews','rule_evaluations',
    'rule_overrides','sbd_annotations','sbd_templates','subprocessors',
    'subscriptions','tender_lots','tenders','upload_sessions',
    'vault_item_versions','vault_items','vault_usage','work_tasks'
  ];
  tender_context_tables constant text[] := ARRAY[
    'addendum_impact_assessments','addendum_impact_items',
    'document_version_snapshots','tender_context_artifacts',
    'tender_context_requirements','tender_context_versions',
    'tender_eligibility_passports'
  ];
  actual_tables text[];
  actual_rls_tables text[];
  required_rls_tables text[];
  expected_table_count integer;
  expected_policy_count integer;
  assurance_expected boolean;
  registry_expected boolean;
  tender_expected boolean;
  policy_count integer;
  authenticated_rate_limit_policy_matches boolean;
  tender_context_policy_matches boolean;
BEGIN
  SELECT state.production_assurance_expected, state.retrieval_registry_expected,
      state.tender_context_expected
    INTO STRICT assurance_expected, registry_expected, tender_expected
    FROM _valo_bridge_state AS state;
  IF assurance_expected THEN
    expected_table_count := 97;
    expected_policy_count := 105;
    required_rls_tables := expected_rls_tables
      || ARRAY['authenticated_rate_limit_buckets']::text[];
  ELSE
    expected_table_count := 96;
    expected_policy_count := 104;
    required_rls_tables := expected_rls_tables;
  END IF;
  -- The 0009 registry table is global-scope: it raises the table count but
  -- must never appear in the RLS inventory or the policy catalog.
  IF registry_expected THEN
    expected_table_count := expected_table_count + 1;
  END IF;
  IF tender_expected THEN
    expected_table_count := expected_table_count + cardinality(tender_context_tables);
    expected_policy_count := expected_policy_count
      + cardinality(tender_context_tables);
    required_rls_tables := required_rls_tables || tender_context_tables;
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO actual_tables
    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF cardinality(actual_tables) <> expected_table_count
     OR assurance_expected IS DISTINCT FROM
       ('authenticated_rate_limit_buckets' = ANY(actual_tables))
     OR registry_expected IS DISTINCT FROM
       ('ai_retrieval_registry' = ANY(actual_tables))
     OR tender_expected IS DISTINCT FROM COALESCE(
       actual_tables @> tender_context_tables,
       false
     ) THEN
    RAISE EXCEPTION 'target table inventory is not the exact expected % table variant',
      expected_table_count;
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO actual_rls_tables
    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relrowsecurity AND c.relforcerowsecurity;
  SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname='public';
  SELECT count(*) = 1
      AND COALESCE(bool_and(
        policy.polname = 'tenant_isolation'
        AND policy.polpermissive
        AND policy.polcmd = '*'
        AND policy.polroles = ARRAY[0::oid]
        AND pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
        AND pg_catalog.pg_get_expr(
          policy.polwithcheck, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
      ), false)
    INTO authenticated_rate_limit_policy_matches
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid=policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND relation.relname='authenticated_rate_limit_buckets';
  SELECT count(*) = cardinality(tender_context_tables)
      AND COALESCE(bool_and(
        policy.polname = 'tenant_isolation'
        AND policy.polpermissive
        AND policy.polcmd = '*'
        AND policy.polroles = ARRAY[0::oid]
        AND pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
        AND pg_catalog.pg_get_expr(
          policy.polwithcheck, policy.polrelid, false
        ) = '(organisation_id = valo_security.current_organisation_id())'
      ), false)
    INTO tender_context_policy_matches
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid=policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND relation.relname = ANY(tender_context_tables);
  IF cardinality(actual_rls_tables) IS DISTINCT FROM
       cardinality(required_rls_tables)
     OR NOT COALESCE(
       actual_rls_tables @> required_rls_tables
       AND required_rls_tables @> actual_rls_tables,
       false
     )
     OR policy_count <> expected_policy_count
     OR assurance_expected IS DISTINCT FROM
       authenticated_rate_limit_policy_matches
     OR tender_expected IS DISTINCT FROM tender_context_policy_matches THEN
    RAISE EXCEPTION 'RLS reconciliation failed: tables %, policies %',
      cardinality(actual_rls_tables), policy_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.audit_events WHERE hash_version <> 2)
     OR EXISTS (SELECT 1 FROM public.audit_events WHERE organisation_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.audit_events
                WHERE seq IS NULL OR prev_hash IS NULL OR hash IS NULL)
     OR (SELECT count(*) FROM public.legacy_audit_events
         WHERE organisation_id='56414c4f-0000-5000-8000-000000000025'::uuid
           AND integrity_status='known_discontinuity') <> 19 THEN
    RAISE EXCEPTION 'active/archive audit classification failed';
  END IF;
END;
$post_rls_validation$;

CREATE SCHEMA IF NOT EXISTS drizzle;

SET LOCAL password_encryption = 'scram-sha-256';

DO $runtime_role$
DECLARE
  role_name text := (SELECT runtime_role FROM _valo_bridge_inputs);
  role_oid oid;
  role_is_super boolean;
  role_bypasses_rls boolean;
  role_can_login boolean;
  role_can_create_database boolean;
  role_can_create_role boolean;
  role_can_replicate boolean;
  role_inherits boolean;
  role_connection_limit integer;
  role_valid_until timestamptz;
  role_config text[];
  privileged_memberships integer;
  schema_record record;
BEGIN
  SELECT oid INTO role_oid FROM pg_roles WHERE rolname=role_name;
  IF role_oid IS NULL THEN
    EXECUTE format(
      'CREATE ROLE %I LOGIN PASSWORD %L VALID UNTIL ''infinity'' CONNECTION LIMIT -1 NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
      role_name,
      (SELECT runtime_password FROM _valo_bridge_inputs)
    );
    SELECT oid INTO role_oid FROM pg_roles WHERE rolname=role_name;
  ELSE
    EXECUTE format(
      'ALTER ROLE %I LOGIN PASSWORD %L VALID UNTIL ''infinity'' CONNECTION LIMIT -1 NOCREATEROLE INHERIT',
      role_name,
      (SELECT runtime_password FROM _valo_bridge_inputs)
    );
  END IF;
  EXECUTE format('ALTER ROLE %I RESET ALL', role_name);
  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I RESET ALL',
    role_name,
    current_database()
  );

  SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole,
         rolreplication, rolinherit, rolconnlimit, rolvaliduntil, rolconfig
    INTO role_is_super, role_bypasses_rls, role_can_login,
         role_can_create_database, role_can_create_role, role_can_replicate,
         role_inherits, role_connection_limit, role_valid_until, role_config
    FROM pg_roles WHERE oid=role_oid;
  IF role_is_super OR role_bypasses_rls OR NOT role_can_login
     OR role_can_create_database OR role_can_create_role OR role_can_replicate
     OR NOT role_inherits OR role_connection_limit <> -1
     OR role_valid_until IS DISTINCT FROM 'infinity'::timestamptz
     OR COALESCE(cardinality(role_config), 0) <> 0
     OR EXISTS (
       SELECT 1 FROM pg_db_role_setting WHERE setrole=role_oid
     ) THEN
    RAISE EXCEPTION 'runtime login attributes/configuration are not fail-closed';
  END IF;

  WITH RECURSIVE inherited_roles(roleid) AS (
    SELECT granted.roleid FROM pg_auth_members AS granted WHERE granted.member=role_oid
    UNION
    SELECT granted.roleid
    FROM pg_auth_members AS granted
    JOIN inherited_roles AS inherited ON inherited.roleid=granted.member
  )
  SELECT count(*) INTO privileged_memberships
  FROM inherited_roles AS inherited
  JOIN pg_roles AS inherited_role ON inherited_role.oid=inherited.roleid
  WHERE inherited_role.rolsuper OR inherited_role.rolbypassrls
     OR inherited_role.oid=(SELECT oid FROM pg_roles WHERE rolname=current_user);
  IF privileged_memberships > 0 THEN
    RAISE EXCEPTION 'runtime group inherits an owner/superuser/BYPASSRLS role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=role_oid) THEN
    RAISE EXCEPTION 'runtime login must not inherit any role or SET ROLE path';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_database
       WHERE datname=current_database() AND datdba=role_oid
     ) OR EXISTS (
       SELECT 1 FROM pg_namespace
       WHERE nspname !~ '^pg_' AND nspname<>'information_schema'
         AND nspowner=role_oid
     ) OR EXISTS (
       SELECT 1 FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND relation.relowner=role_oid
     ) OR EXISTS (
       SELECT 1 FROM pg_proc AS routine
       JOIN pg_namespace AS namespace ON namespace.oid=routine.pronamespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND routine.proowner=role_oid
     ) OR EXISTS (
       SELECT 1 FROM pg_type AS type_record
       JOIN pg_namespace AS namespace ON namespace.oid=type_record.typnamespace
       WHERE namespace.nspname !~ '^pg_'
         AND namespace.nspname<>'information_schema'
         AND type_record.typowner=role_oid
     ) THEN
    RAISE EXCEPTION 'runtime login must own zero database/security objects';
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name);
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  EXECUTE format(
    'REVOKE CREATE ON DATABASE %I FROM %I',
    current_database(),
    role_name
  );
  FOR schema_record IN
    SELECT nspname FROM pg_namespace
    WHERE nspname !~ '^pg_' AND nspname<>'information_schema'
  LOOP
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM %I', schema_record.nspname, role_name);
  END LOOP;
  EXECUTE format('REVOKE USAGE ON SCHEMA drizzle FROM %I', role_name);
  EXECUTE format('GRANT USAGE ON SCHEMA public, valo_security TO %I', role_name);
  EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', role_name);
  EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
  EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA valo_security FROM %I', role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', role_name);
  EXECUTE format('REVOKE UPDATE ON TABLE public.document_versions FROM %I', role_name);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.jurisdiction_rule_packs, public.jurisdiction_rules FROM %I', role_name);
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.organisations FROM %I', role_name);
  EXECUTE format('REVOKE DELETE ON TABLE public.users FROM %I', role_name);
  EXECUTE format('REVOKE DELETE ON TABLE public.organisation_memberships, public.partner_relationships, public.break_glass_sessions FROM %I', role_name);
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.role_grants FROM %I', role_name);
  IF (SELECT production_assurance_expected FROM _valo_bridge_state) THEN
    EXECUTE format(
      'REVOKE DELETE ON TABLE public.authenticated_rate_limit_buckets FROM %I',
      role_name
    );
  END IF;
  IF (SELECT retrieval_registry_expected FROM _valo_bridge_state) THEN
    EXECUTE format(
      'REVOKE DELETE ON TABLE public.ai_retrieval_registry FROM %I',
      role_name
    );
  END IF;
  IF (SELECT tender_context_expected FROM _valo_bridge_state) THEN
    EXECUTE format(
      'REVOKE DELETE ON TABLE public.addendum_impact_assessments, public.addendum_impact_items, public.document_version_snapshots, public.tender_context_artifacts, public.tender_context_requirements, public.tender_context_versions, public.tender_eligibility_passports FROM %I',
      role_name
    );
    EXECUTE format(
      'REVOKE UPDATE ON TABLE public.tender_context_artifacts, public.tender_context_requirements FROM %I',
      role_name
    );
  END IF;
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);
  EXECUTE format('REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_events FROM %I', role_name);
  EXECUTE format(
    'GRANT INSERT (id, organisation_id, user_id, user_name, project_id, event_type, object_type, object_id, details, seq, prev_hash, hash, hash_version, created_at) ON TABLE public.audit_events TO %I',
    role_name
  );
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.legacy_audit_events FROM %I', role_name);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.legacy_audit_integrity_assessments FROM %I', role_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION valo_security.current_organisation_id() TO %I', role_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION valo_security.set_current_organisation_id(uuid) TO %I', role_name);
  IF (SELECT production_assurance_expected FROM _valo_bridge_state) THEN
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION valo_security.consume_authenticated_actor_rate_limit(text, integer, integer) TO %I',
      role_name
    );
  END IF;
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', current_user, role_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM %I', current_user, role_name);

  IF has_schema_privilege(role_name, 'public', 'CREATE')
     OR NOT has_table_privilege(role_name, 'public.audit_events', 'SELECT')
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         'id','organisation_id','user_id','user_name','project_id','event_type',
         'object_type','object_id','details','seq','prev_hash','hash',
         'hash_version','created_at'
       ]) AS required_columns(column_name)
       WHERE NOT has_column_privilege(
         role_name, 'public.audit_events', column_name, 'INSERT'
       )
     )
     OR has_column_privilege(role_name, 'public.audit_events', 'row_no', 'INSERT')
     OR has_table_privilege(role_name, 'public.audit_events', 'UPDATE')
     OR has_table_privilege(role_name, 'public.audit_events', 'DELETE')
     OR NOT has_table_privilege(role_name, 'public.legacy_audit_events', 'SELECT')
     OR has_table_privilege(role_name, 'public.legacy_audit_events', 'INSERT')
     OR has_table_privilege(role_name, 'public.legacy_audit_events', 'UPDATE')
     OR has_table_privilege(role_name, 'public.legacy_audit_events', 'DELETE')
     OR NOT has_table_privilege(role_name, 'public.legacy_audit_integrity_assessments', 'SELECT')
     OR has_table_privilege(role_name, 'public.legacy_audit_integrity_assessments', 'INSERT')
     OR has_table_privilege(role_name, 'public.legacy_audit_integrity_assessments', 'UPDATE')
     OR has_table_privilege(role_name, 'public.legacy_audit_integrity_assessments', 'DELETE')
     OR has_sequence_privilege(role_name, 'public.audit_events_row_no_seq', 'UPDATE')
     OR NOT has_table_privilege(role_name, 'public.organisations', 'SELECT')
     OR NOT has_table_privilege(role_name, 'public.organisations', 'INSERT')
      OR has_table_privilege(role_name, 'public.organisations', 'UPDATE')
      OR has_table_privilege(role_name, 'public.organisations', 'DELETE')
      OR has_table_privilege(role_name, 'public.users', 'DELETE')
      OR NOT has_table_privilege(role_name, 'public.organisation_memberships', 'SELECT')
     OR NOT has_table_privilege(role_name, 'public.organisation_memberships', 'INSERT')
     OR NOT has_table_privilege(role_name, 'public.organisation_memberships', 'UPDATE')
     OR has_table_privilege(role_name, 'public.organisation_memberships', 'DELETE')
     OR NOT has_table_privilege(role_name, 'public.role_grants', 'SELECT')
     OR NOT has_table_privilege(role_name, 'public.role_grants', 'INSERT')
     OR has_table_privilege(role_name, 'public.role_grants', 'UPDATE')
     OR has_table_privilege(role_name, 'public.role_grants', 'DELETE')
     OR NOT has_table_privilege(role_name, 'public.partner_relationships', 'SELECT')
     OR NOT has_table_privilege(role_name, 'public.partner_relationships', 'INSERT')
     OR NOT has_table_privilege(role_name, 'public.partner_relationships', 'UPDATE')
     OR has_table_privilege(role_name, 'public.partner_relationships', 'DELETE')
     OR NOT has_table_privilege(role_name, 'public.break_glass_sessions', 'SELECT')
      OR NOT has_table_privilege(role_name, 'public.break_glass_sessions', 'INSERT')
      OR NOT has_table_privilege(role_name, 'public.break_glass_sessions', 'UPDATE')
      OR has_table_privilege(role_name, 'public.break_glass_sessions', 'DELETE')
      OR has_database_privilege(role_name, current_database(), 'CREATE')
      OR has_schema_privilege(role_name, 'public', 'CREATE')
      OR has_schema_privilege(role_name, 'valo_security', 'CREATE')
      OR has_schema_privilege(role_name, 'drizzle', 'CREATE')
      OR EXISTS (
        SELECT 1 FROM pg_namespace AS namespace
        WHERE namespace.nspname !~ '^pg_'
          AND namespace.nspname<>'information_schema'
          AND has_schema_privilege(role_name, namespace.oid, 'CREATE')
      )
      OR NOT has_schema_privilege(role_name, 'public', 'USAGE')
      OR NOT has_schema_privilege(role_name, 'valo_security', 'USAGE')
      OR has_schema_privilege(role_name, 'drizzle', 'USAGE')
      OR NOT has_function_privilege(
        role_name, 'valo_security.current_organisation_id()', 'EXECUTE'
      )
      OR NOT has_function_privilege(
        role_name, 'valo_security.set_current_organisation_id(uuid)', 'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS routine
        JOIN pg_namespace AS namespace ON namespace.oid=routine.pronamespace
        WHERE namespace.nspname='valo_security'
          AND has_function_privilege(role_name, routine.oid, 'EXECUTE')
            IS DISTINCT FROM (
              routine.proname IN (
                'current_organisation_id','set_current_organisation_id'
              )
              OR (
                (SELECT production_assurance_expected
                 FROM _valo_bridge_state)
                AND routine.proname =
                  'consume_authenticated_actor_rate_limit'
              )
            )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
          AND (
            NOT has_table_privilege(role_name, relation.oid, 'SELECT')
            OR has_table_privilege(role_name, relation.oid, 'INSERT') IS DISTINCT FROM
              (relation.relname NOT IN (
                'audit_events','legacy_audit_events',
                'legacy_audit_integrity_assessments',
                'jurisdiction_rule_packs','jurisdiction_rules'
              ))
            OR has_table_privilege(role_name, relation.oid, 'UPDATE') IS DISTINCT FROM
              (relation.relname NOT IN (
                'audit_events','legacy_audit_events',
                'legacy_audit_integrity_assessments','document_versions',
                'jurisdiction_rule_packs','jurisdiction_rules',
                'organisations','role_grants',
                'tender_context_artifacts','tender_context_requirements'
              ))
            OR has_table_privilege(role_name, relation.oid, 'DELETE') IS DISTINCT FROM
              (relation.relname NOT IN (
                'ai_retrieval_registry','audit_events',
                'authenticated_rate_limit_buckets',
                'addendum_impact_assessments','addendum_impact_items',
                'break_glass_sessions','legacy_audit_events',
                'document_version_snapshots',
                'jurisdiction_rule_packs','jurisdiction_rules',
                'legacy_audit_integrity_assessments',
                'organisation_memberships','organisations',
                'partner_relationships','role_grants',
                'tender_context_artifacts','tender_context_requirements',
                'tender_context_versions','tender_eligibility_passports','users'
              ))
            OR has_table_privilege(role_name, relation.oid, 'TRUNCATE')
            OR has_table_privilege(role_name, relation.oid, 'REFERENCES')
            OR has_table_privilege(role_name, relation.oid, 'TRIGGER')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
        JOIN pg_attribute AS attribute
          ON attribute.attrelid=relation.oid
         AND attribute.attnum>0
         AND NOT attribute.attisdropped
        WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
          AND (
            NOT has_column_privilege(
              role_name, relation.oid, attribute.attnum, 'SELECT'
            )
            OR has_column_privilege(
              role_name, relation.oid, attribute.attnum, 'INSERT'
            ) IS DISTINCT FROM (
              CASE
                WHEN relation.relname='audit_events' THEN attribute.attname=ANY(ARRAY[
                  'id','organisation_id','user_id','user_name','project_id',
                  'event_type','object_type','object_id','details','seq',
                  'prev_hash','hash','hash_version','created_at'
                ]::text[])
                ELSE relation.relname NOT IN (
                  'legacy_audit_events','legacy_audit_integrity_assessments',
                  'jurisdiction_rule_packs','jurisdiction_rules'
                )
              END
            )
            OR has_column_privilege(
              role_name, relation.oid, attribute.attnum, 'UPDATE'
            ) IS DISTINCT FROM (relation.relname NOT IN (
              'audit_events','legacy_audit_events',
              'legacy_audit_integrity_assessments','document_versions',
              'jurisdiction_rule_packs','jurisdiction_rules',
              'organisations','role_grants'
            ))
            OR has_column_privilege(
              role_name, relation.oid, attribute.attnum, 'REFERENCES'
            )
          )
      )
      OR (SELECT count(*) FROM pg_class AS relation
          JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname='public' AND relation.relkind='S') <> 1
      OR EXISTS (
        SELECT 1
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='public' AND relation.relkind='S'
          AND (
            relation.relname <> 'audit_events_row_no_seq'
            OR NOT has_sequence_privilege(role_name, relation.oid, 'USAGE')
            OR NOT has_sequence_privilege(role_name, relation.oid, 'SELECT')
            OR has_sequence_privilege(role_name, relation.oid, 'UPDATE')
          )
      ) THEN
    RAISE EXCEPTION 'runtime audit/schema privilege reconciliation failed';
  END IF;
END;
$runtime_role$;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

DO $migration_journal$
DECLARE
  inputs _valo_bridge_inputs%ROWTYPE;
  migration_record record;
BEGIN
  SELECT * INTO STRICT inputs FROM _valo_bridge_inputs;
  FOR migration_record IN
    SELECT * FROM (VALUES
      (1786221409612::bigint, inputs.migration_0000_hash),
      (1786221441937::bigint, inputs.migration_0001_hash),
      (1786251600000::bigint, inputs.migration_0002_hash)
    ) AS migrations(created_at, hash)
  LOOP
    IF EXISTS (
      SELECT 1 FROM drizzle.__drizzle_migrations
      WHERE created_at=migration_record.created_at AND hash<>migration_record.hash
    ) THEN
      RAISE EXCEPTION 'migration journal hash mismatch at %', migration_record.created_at;
    END IF;
    INSERT INTO drizzle.__drizzle_migrations(hash, created_at)
    SELECT migration_record.hash, migration_record.created_at
    WHERE NOT EXISTS (
      SELECT 1 FROM drizzle.__drizzle_migrations
      WHERE created_at=migration_record.created_at
    );
  END LOOP;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at IN (
      1786221409612,1786221441937,1786251600000
    )) <> 3 THEN
    RAISE EXCEPTION 'migration journal reconciliation failed';
  END IF;
END;
$migration_journal$;

DO $drop_archive$
BEGIN
  IF (SELECT is_legacy FROM _valo_bridge_state) THEN
    DROP SCHEMA valo_legacy_bridge_archive CASCADE;
  END IF;
END;
$drop_archive$;

-- VALO_BRIDGE_RUNNER_BODY_END
COMMIT;
