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
