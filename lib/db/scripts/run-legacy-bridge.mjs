#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const bridgePath = resolve(
  repositoryRoot,
  "scripts/migrations/replit-legacy-v1-to-v2.5.sql",
);
const migrationPaths = [
  resolve(repositoryRoot, "lib/db/migrations/0000_tense_vapor.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0001_tenant_rls.sql"),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0002_audit_integrity_boundary.sql",
  ),
];
const productionAssuranceMigrationPath = resolve(
  repositoryRoot,
  "lib/db/migrations/0008_production_assurance.sql",
);
const tenderContextMigrationPath = resolve(
  repositoryRoot,
  "lib/db/migrations/0010_tender_context_and_addendum.sql",
);

const ORGANISATION_ID = "56414c4f-0000-5000-8000-000000000025";
const ASSESSMENT_ID = "56414c4f-0000-5000-8000-000000000026";
const BOUNDARY_ID = "56414c4f-0000-5000-8000-000000000027";
const PROOF_ORGANISATION_ID = "56414c4f-0000-5000-8000-000000000099";
const PROOF_CLIENT_ID = "56414c4f-0000-5000-8000-000000000098";
const PROOF_DENIED_INSERT_ID = "56414c4f-0000-5000-8000-000000000097";
const LEGACY_TABLES = [
  "app_config",
  "audit_events",
  "boq_checks",
  "capability_items",
  "clients",
  "conflict_records",
  "defects",
  "documents",
  "evidence_items",
  "llm_runs",
  "notification_events",
  "projects",
  "reports",
  "requirements",
  "retention_requests",
  "sbd_annotations",
  "sbd_templates",
  "users",
  "vault_items",
].sort();
const LEGACY_LINEAGE_CANONICAL = "replit-legacy-v1-canonical";
const LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED =
  "replit-legacy-v1-production-push-managed";
const LEGACY_LINEAGE_IDS = [
  LEGACY_LINEAGE_CANONICAL,
  LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
];
const REPLIT_PRODUCTION_PUSH_MANAGED_COLUMNS = new Map([
  [
    "app_config",
    [
      "id",
      "severity_weight_fatal",
      "severity_weight_likely_fatal",
      "severity_weight_scoring_risk",
      "severity_weight_cosmetic",
      "missing_evidence_weight",
      "band_medium_cutoff",
      "band_high_cutoff",
      "band_critical_cutoff",
      "firm_name",
      "confidentiality_legend",
      "retention_default_days",
      "updated_at",
      "updated_by",
    ],
  ],
  [
    "audit_events",
    [
      "id",
      "user_id",
      "user_name",
      "project_id",
      "event_type",
      "object_type",
      "object_id",
      "details",
      "created_at",
      "seq",
      "prev_hash",
      "hash",
      "row_no",
    ],
  ],
  [
    "boq_checks",
    [
      "id",
      "project_id",
      "source_doc_id",
      "line_ref",
      "description",
      "quantity",
      "unit_rate",
      "extension",
      "computed_extension",
      "check_type",
      "finding",
      "severity",
      "status",
      "created_at",
      "quantity_raw",
      "unit_rate_kobo",
      "extension_kobo",
      "computed_extension_kobo",
    ],
  ],
  [
    "capability_items",
    [
      "id",
      "client_id",
      "claim_type",
      "description",
      "evidence_doc_id",
      "approved_status",
      "created_at",
      "verifier_id",
      "verifier_name",
      "verified_at",
    ],
  ],
  [
    "clients",
    [
      "id",
      "name",
      "sector",
      "segment",
      "contact_name",
      "contact_email",
      "nda_status",
      "notes",
      "created_at",
      "decision_maker_conversations",
      "junior_conversations",
    ],
  ],
  [
    "conflict_records",
    [
      "id",
      "client_id",
      "project_id",
      "tender_ref",
      "lot",
      "matched_project_id",
      "status",
      "decision",
      "rationale",
      "decided_by",
      "decided_at",
      "created_at",
    ],
  ],
  [
    "defects",
    [
      "id",
      "project_id",
      "requirement_id",
      "type",
      "severity",
      "description",
      "evidence_snapshot",
      "remediation",
      "owner",
      "status",
      "suggested",
      "created_at",
    ],
  ],
  [
    "documents",
    [
      "id",
      "project_id",
      "type",
      "filename",
      "object_path",
      "content_type",
      "size",
      "source",
      "date_received",
      "redaction_status",
      "uploaded_by",
      "content_text",
      "extracted_chars",
      "extraction_status",
      "created_at",
      "sha256",
    ],
  ],
  [
    "evidence_items",
    [
      "id",
      "project_id",
      "requirement_id",
      "document_id",
      "evidence_status",
      "excerpt",
      "notes",
      "suggested",
      "confirmed_by",
      "created_at",
    ],
  ],
  [
    "llm_runs",
    [
      "id",
      "project_id",
      "task",
      "model",
      "prompt_version",
      "input_hash",
      "output_summary",
      "error",
      "created_at",
    ],
  ],
  [
    "notification_events",
    [
      "id",
      "project_id",
      "client_id",
      "vault_item_id",
      "channel",
      "template",
      "recipient",
      "payload",
      "status",
      "created_by",
      "created_at",
    ],
  ],
  [
    "projects",
    [
      "id",
      "client_id",
      "tender_title",
      "issuing_entity",
      "tender_ref",
      "deadline",
      "value_band",
      "segment",
      "submission_status",
      "status",
      "reviewer_id",
      "risk_score",
      "risk_band",
      "risk_override_band",
      "risk_override_note",
      "risk_override_by",
      "outcome",
      "scope",
      "limitations",
      "responsiveness_review",
      "responsiveness_suggested",
      "created_at",
      "lot",
      "sla_class",
      "payment_status",
      "payment_confirmed_by_founder",
      "payment_confirmed_by_advisor",
      "payment_confirmed_at",
      "conflict_status",
      "conflict_decision",
      "conflict_rationale",
      "physical_archive_instruction",
      "redaction_scope",
      "restricted_mode",
      "payment_founder_confirmed_by",
      "payment_founder_confirmed_by_name",
      "payment_founder_confirmed_at",
      "payment_advisor_confirmed_by",
      "payment_advisor_confirmed_by_name",
      "payment_advisor_confirmed_at",
      "mandate_quality",
    ],
  ],
  [
    "reports",
    [
      "id",
      "project_id",
      "version",
      "status",
      "docx_path",
      "reviewer_id",
      "reviewer_name",
      "attestation",
      "engine_version",
      "signed_off_at",
      "generated_by",
      "created_at",
      "prompt_pack_version",
      "model_id",
      "pdf_path",
    ],
  ],
  [
    "requirements",
    [
      "id",
      "project_id",
      "source_doc_id",
      "page_ref",
      "clause_ref",
      "text",
      "category",
      "expected_evidence",
      "is_mandatory",
      "confidence",
      "review_status",
      "reviewer_notes",
      "created_at",
      "origin",
      "engine_text",
      "reviewed_by",
      "reviewed_by_name",
      "reviewed_at",
      "merged_citations",
    ],
  ],
  [
    "retention_requests",
    [
      "id",
      "project_id",
      "requested_by",
      "reason",
      "due_at",
      "completed_at",
      "certificate_text",
      "status",
      "created_at",
    ],
  ],
  [
    "sbd_annotations",
    ["id", "template_id", "agency", "section", "kind", "quirk", "created_at"],
  ],
  [
    "sbd_templates",
    [
      "id",
      "code",
      "title",
      "category",
      "version",
      "status",
      "issuing_circular",
      "summary",
      "created_at",
    ],
  ],
  [
    "users",
    [
      "id",
      "clerk_user_id",
      "email",
      "name",
      "role",
      "status",
      "last_login_at",
      "created_at",
    ],
  ],
  [
    "vault_items",
    [
      "id",
      "client_id",
      "artefact_type",
      "issuer",
      "issue_date",
      "expiry_date",
      "renewal_lead_days",
      "status",
      "created_at",
      "object_path",
      "sha256",
      "source_document_id",
    ],
  ],
]);
const PUSH_MANAGED_NULL_INITIALIZATIONS = new Map([
  [
    "documents",
    ["extraction_method", "extraction_confidence", "extraction_notes"],
  ],
  ["llm_runs", ["prompt_tokens", "completion_tokens"]],
  ["reports", ["taxonomy_version"]],
]);
const PUSH_MANAGED_ORDER_ONLY_TABLES = [
  "audit_events",
  "boq_checks",
  "capability_items",
  "clients",
  "projects",
  "requirements",
  "vault_items",
];
const LEGACY_COLUMN_FINGERPRINT_ALGORITHM =
  "sha256(UTF-8 JSON.stringify(ordered [tableName, orderedColumnNames] pairs))";
const SOURCE_COMMIT = "b71adcec4a7060c0ce2192266c81d880c5e56277";
const PAYLOAD_HASH_VERIFIED_SEQUENCES = [1, 2, 3, 4, 5, 6, 7, 27, 28];
const KNOWN_DISCONTINUITY_SEQUENCES = Array.from(
  { length: 19 },
  (_, index) => index + 8,
);
const SOURCE_DIGEST_ALGORITHM =
  "sha256(newline-delimited row_to_json(record)::text rows sorted lexicographically in UTC; trailing newline iff nonempty)";
const EXPECTED_POLICY_CATALOG_SHA256 =
  "92235aeea371cae756f06c6b9c6ec79f51515ea60825d2a3268129691950308c";
const EXPECTED_RLS_TABLE_CATALOG_SHA256 =
  "6d4fcb41d03b8e088d215f33243a78d98ffc963910e638407c5c6bb86f4c41ac";
const TENDER_CONTEXT_TABLES = Object.freeze([
  "addendum_impact_assessments",
  "addendum_impact_items",
  "document_version_snapshots",
  "tender_context_artifacts",
  "tender_context_requirements",
  "tender_context_versions",
  "tender_eligibility_passports",
]);
const TENDER_CONTEXT_SECURITY_FUNCTIONS = Object.freeze([
  Object.freeze({
    function_name: "enforce_governed_state_transition",
    source_sha256:
      "fc3ca21f64494b959a808a781d490d04306c9acb6fcb7604692c4f3418848ce2",
  }),
  Object.freeze({
    function_name: "expected_tenant_parent_edges",
    source_sha256:
      "9a7fe7e15ae45587b7326d1d648585714ee690da0f860816da1dece2201b5768",
  }),
  Object.freeze({
    function_name: "expected_tenant_parent_edges_v25",
    source_sha256:
      "bdc81a7d7148b2c016226525c3907ab30c975c59cea4e51839dad4baff842f70",
  }),
  Object.freeze({
    function_name: "reject_versioned_record_content_mutation",
    source_sha256:
      "ef751ed465bb43c61792f37d58ba9f4c8eb60f7bdbb33d1c7f5d4bec72bf028e",
  }),
]);
const BASE_SECURITY_FUNCTION_NAMES = Object.freeze([
  "current_organisation_id",
  "enforce_control_plane_tenant_context",
  "enforce_derived_tenant_relationship",
  "enforce_tenant_parent",
  "expected_tenant_parent_edges",
  "reject_active_audit_mutation",
  "reject_legacy_audit_mutation",
  "reject_tenant_identity_reassignment",
  "set_current_organisation_id",
]);
const PRODUCTION_ASSURANCE_SECURITY_FUNCTIONS = Object.freeze([
  Object.freeze({
    function_name: "consume_authenticated_actor_rate_limit",
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: true,
    leakproof: false,
    strict: false,
    volatility: "v",
    parallel_safety: "u",
    function_config: "search_path=pg_catalog",
    returns_trigger: false,
    argument_count: 3,
    argument_types: "text, integer, integer",
    identity_arguments:
      "p_bucket_key_sha256 text, p_window_seconds integer, p_max_requests integer",
    return_type: "record",
    function_result:
      "TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)",
    returns_set: true,
    owner_is_schema_owner: true,
    owner_is_runtime: false,
    runtime_can_execute: true,
    public_can_execute: false,
    execute_acl: ["OWNER:EXECUTE:false", "RUNTIME:EXECUTE:false"],
    source_sha256:
      "97f97bc16b5773684a9933bc4575916d4086dae9b352eb60d71b5c8478474030",
  }),
  Object.freeze({
    function_name: "purge_expired_authenticated_rate_limit_buckets",
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: false,
    leakproof: false,
    strict: false,
    volatility: "v",
    parallel_safety: "u",
    function_config: "search_path=pg_catalog",
    returns_trigger: false,
    argument_count: 0,
    argument_types: "",
    identity_arguments: "",
    return_type: "bigint",
    function_result: "bigint",
    returns_set: false,
    owner_is_schema_owner: true,
    owner_is_runtime: false,
    runtime_can_execute: false,
    public_can_execute: false,
    execute_acl: ["OWNER:EXECUTE:false"],
    source_sha256:
      "beeae6ab916be432aa0749085de35145912e9fd0d8277d186485f20c09c625bf",
  }),
]);
const LEGACY_CATALOG_DIGEST_ALGORITHM =
  "sha256(UTF-8 JSON.stringify(valo.legacy-catalog.v1 ordered pg_catalog relations/columns/constraints/indexes/sequences/triggers/views/policies; SQL whitespace collapsed; ownerClass=current_user|other))";
const RUNNER_BODY_BEGIN = "-- VALO_BRIDGE_RUNNER_BODY_BEGIN";
const RUNNER_BODY_END = "-- VALO_BRIDGE_RUNNER_BODY_END";
const LOCK_LEGACY_TABLES = `LOCK TABLE
  public.app_config, public.audit_events, public.boq_checks,
  public.capability_items, public.clients, public.conflict_records,
  public.defects, public.documents, public.evidence_items, public.llm_runs,
  public.notification_events, public.projects, public.reports,
  public.requirements, public.retention_requests, public.sbd_annotations,
  public.sbd_templates, public.users, public.vault_items
IN ACCESS EXCLUSIVE MODE NOWAIT`;
const LOCK_COMPLETED_EVIDENCE_TABLES = `LOCK TABLE
  public.organisations, public.organisation_memberships, public.role_grants,
  public.legacy_audit_events, public.legacy_audit_integrity_assessments,
  drizzle.__drizzle_migrations
IN ACCESS EXCLUSIVE MODE NOWAIT`;
let bridgeCommitted = false;
let bridgeCommitAttempted = false;
let bridgeCommitOutcomeUnknown = false;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function legacyColumnsForLineage(canonicalColumns, lineageId) {
  assert(
    canonicalColumns instanceof Map,
    "canonical legacy columns are absent",
  );
  assert(
    LEGACY_LINEAGE_IDS.includes(lineageId),
    `unsupported legacy lineage ${lineageId}`,
  );
  const source =
    lineageId === LEGACY_LINEAGE_CANONICAL
      ? canonicalColumns
      : REPLIT_PRODUCTION_PUSH_MANAGED_COLUMNS;
  assert.deepEqual(
    [...source.keys()].sort(),
    LEGACY_TABLES,
    `legacy relation inventory for ${lineageId}`,
  );
  return new Map(
    LEGACY_TABLES.map((table) => {
      const columns = source.get(table);
      assert(Array.isArray(columns), `legacy columns are absent for ${table}`);
      return [table, [...columns]];
    }),
  );
}

function legacyColumnFingerprint(columns) {
  assert(columns instanceof Map, "legacy columns are absent");
  assert.deepEqual([...columns.keys()].sort(), LEGACY_TABLES);
  return sha256(
    JSON.stringify(
      LEGACY_TABLES.map((table) => {
        const tableColumns = columns.get(table);
        assert(
          Array.isArray(tableColumns) && tableColumns.length > 0,
          `legacy columns are absent for ${table}`,
        );
        return [table, tableColumns];
      }),
    ),
  );
}

function classifyLegacyColumnMap(actualColumns, canonicalColumns) {
  assert(actualColumns instanceof Map, "actual legacy columns are absent");
  assert.deepEqual(
    [...actualColumns.keys()].sort(),
    LEGACY_TABLES,
    "legacy column relation inventory",
  );
  const matches = LEGACY_LINEAGE_IDS.filter((lineageId) => {
    const expected = legacyColumnsForLineage(canonicalColumns, lineageId);
    return LEGACY_TABLES.every((table) =>
      Object.is(
        JSON.stringify(actualColumns.get(table)),
        JSON.stringify(expected.get(table)),
      ),
    );
  });
  assert.equal(
    matches.length,
    1,
    "legacy columns do not match exactly one pinned lineage",
  );
  const id = matches[0];
  return {
    id,
    columnFingerprintAlgorithm: LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
    columnFingerprintSha256: legacyColumnFingerprint(actualColumns),
  };
}

async function detectLegacyLineage(client, canonicalColumns) {
  const result = await client.query(
    `SELECT table_name,
       array_agg(column_name ORDER BY ordinal_position)::text[] AS column_names
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=ANY($1::text[])
     GROUP BY table_name
     ORDER BY table_name`,
    [LEGACY_TABLES],
  );
  const actualColumns = new Map(
    result.rows.map((row) => [row.table_name, row.column_names]),
  );
  return {
    ...classifyLegacyColumnMap(actualColumns, canonicalColumns),
    columns: actualColumns,
  };
}

async function assertPrecommitSecurityCatalog(client) {
  await client.query("SET LOCAL search_path=pg_catalog");
  const bridgeState = await client.query(`
    SELECT production_assurance_expected, retrieval_registry_expected,
      tender_context_expected
    FROM pg_temp._valo_bridge_state
  `);
  assert.equal(
    bridgeState.rows.length,
    1,
    "bridge catalog variant state must have exactly one row",
  );
  const productionAssuranceExpected =
    bridgeState.rows[0]?.production_assurance_expected;
  assert.equal(
    typeof productionAssuranceExpected,
    "boolean",
    "bridge catalog variant state must be boolean",
  );
  const retrievalRegistryExpected =
    bridgeState.rows[0]?.retrieval_registry_expected;
  assert.equal(
    typeof retrievalRegistryExpected,
    "boolean",
    "bridge registry variant state must be boolean",
  );
  assert(
    !retrievalRegistryExpected || productionAssuranceExpected,
    "the 0009 registry variant requires the 0008 production-assurance catalog",
  );
  const tenderContextExpected = bridgeState.rows[0]?.tender_context_expected;
  assert.equal(
    typeof tenderContextExpected,
    "boolean",
    "bridge tender-context variant state must be boolean",
  );
  assert(
    !tenderContextExpected || retrievalRegistryExpected,
    "the 0010 tender-context variant requires the 0009 registry catalog",
  );
  const serverVersion = Number(
    (await client.query("SHOW server_version_num")).rows[0].server_version_num,
  );
  assert.equal(
    Math.trunc(serverVersion / 10_000),
    16,
    "bridge security catalog is pinned to PostgreSQL 16",
  );
  const rlsCatalog = await client.query(`
    SELECT relation.relname::text AS table_name,
      relation.relrowsecurity AS enabled,
      relation.relforcerowsecurity AS forced
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
    ORDER BY table_name
  `);
  assert.equal(
    rlsCatalog.rows.length,
    (productionAssuranceExpected ? 97 : 96) +
      (retrievalRegistryExpected ? 1 : 0) +
      (tenderContextExpected ? 7 : 0),
    "pre-commit public table inventory drift",
  );
  const retrievalRegistryRls = rlsCatalog.rows.find(
    (row) => row.table_name === "ai_retrieval_registry",
  );
  assert.deepEqual(
    retrievalRegistryRls,
    retrievalRegistryExpected
      ? {
          table_name: "ai_retrieval_registry",
          enabled: false,
          forced: false,
        }
      : undefined,
    "pre-commit retrieval registry global-table drift",
  );
  const authenticatedRateLimitRls = rlsCatalog.rows.find(
    (row) => row.table_name === "authenticated_rate_limit_buckets",
  );
  assert.deepEqual(
    authenticatedRateLimitRls,
    productionAssuranceExpected
      ? {
          table_name: "authenticated_rate_limit_buckets",
          enabled: true,
          forced: true,
        }
      : undefined,
    "pre-commit authenticated rate-limit RLS table drift",
  );
  const expectedRlsCount =
    (productionAssuranceExpected ? 86 : 85) + (tenderContextExpected ? 7 : 0);
  assert.deepEqual(
    {
      enabled: rlsCatalog.rows.filter((row) => row.enabled).length,
      forced: rlsCatalog.rows.filter((row) => row.forced).length,
    },
    { enabled: expectedRlsCount, forced: expectedRlsCount },
    "pre-commit enabled/FORCE RLS counts drift",
  );
  const baseRlsCatalog = rlsCatalog.rows.filter(
    (row) =>
      row.table_name !== "authenticated_rate_limit_buckets" &&
      row.table_name !== "ai_retrieval_registry" &&
      !TENDER_CONTEXT_TABLES.includes(row.table_name),
  );
  assert.deepEqual(
    rlsCatalog.rows.filter((row) =>
      TENDER_CONTEXT_TABLES.includes(row.table_name),
    ),
    tenderContextExpected
      ? TENDER_CONTEXT_TABLES.map((table_name) => ({
          table_name,
          enabled: true,
          forced: true,
        }))
      : [],
    "pre-commit tender-context FORCE RLS drift",
  );
  assert.equal(baseRlsCatalog.length, 96);
  assert.equal(
    sha256(
      baseRlsCatalog
        .map((row) => JSON.stringify([row.table_name, row.enabled, row.forced]))
        .sort()
        .join("\n"),
    ),
    EXPECTED_RLS_TABLE_CATALOG_SHA256,
    "pre-commit RLS table catalog drift",
  );
  const policies = await client.query(`
    SELECT relation.relname::text AS table_name,
      policy.polname::text AS policy_name,
      policy.polpermissive AS permissive,
      policy.polcmd::text AS command,
      ARRAY(
        SELECT CASE
          WHEN selected_role.role_oid=0 THEN 'PUBLIC'
          ELSE role.rolname::text
        END
        FROM pg_catalog.unnest(policy.polroles) AS selected_role(role_oid)
        LEFT JOIN pg_catalog.pg_roles AS role
          ON role.oid=selected_role.role_oid
        ORDER BY 1
      ) AS role_names,
      COALESCE(
        pg_catalog.pg_get_expr(policy.polqual,policy.polrelid,false),''
      ) AS using_expression,
      COALESCE(
        pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid,false),''
      ) AS check_expression
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid=policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
    ORDER BY table_name,policy_name
  `);
  assert.equal(
    policies.rows.length,
    (productionAssuranceExpected ? 105 : 104) + (tenderContextExpected ? 7 : 0),
    "pre-commit RLS policy count drift",
  );
  const authenticatedRateLimitPolicies = policies.rows.filter(
    (policy) => policy.table_name === "authenticated_rate_limit_buckets",
  );
  assert.deepEqual(
    authenticatedRateLimitPolicies,
    productionAssuranceExpected
      ? [
          {
            table_name: "authenticated_rate_limit_buckets",
            policy_name: "tenant_isolation",
            permissive: true,
            command: "*",
            role_names: ["PUBLIC"],
            using_expression:
              "(organisation_id = valo_security.current_organisation_id())",
            check_expression:
              "(organisation_id = valo_security.current_organisation_id())",
          },
        ]
      : [],
    "pre-commit authenticated rate-limit RLS policy drift",
  );
  const basePolicies = policies.rows.filter(
    (policy) =>
      policy.table_name !== "authenticated_rate_limit_buckets" &&
      !TENDER_CONTEXT_TABLES.includes(policy.table_name),
  );
  const expectedTenantPolicy = (table_name) => ({
    table_name,
    policy_name: "tenant_isolation",
    permissive: true,
    command: "*",
    role_names: ["PUBLIC"],
    using_expression:
      "(organisation_id = valo_security.current_organisation_id())",
    check_expression:
      "(organisation_id = valo_security.current_organisation_id())",
  });
  assert.deepEqual(
    policies.rows.filter((policy) =>
      TENDER_CONTEXT_TABLES.includes(policy.table_name),
    ),
    tenderContextExpected
      ? TENDER_CONTEXT_TABLES.map(expectedTenantPolicy)
      : [],
    "pre-commit tender-context RLS policy drift",
  );
  assert.equal(basePolicies.length, 104);
  assert.equal(
    sha256(
      basePolicies
        .map((policy) =>
          JSON.stringify([
            policy.table_name,
            policy.policy_name,
            policy.permissive,
            policy.command,
            policy.role_names,
            policy.using_expression,
            policy.check_expression,
          ]),
        )
        .sort()
        .join("\n"),
    ),
    EXPECTED_POLICY_CATALOG_SHA256,
    "pre-commit RLS policy catalog drift",
  );
  const securityInventory = await client.query(`SELECT
    (SELECT count(*)::integer
     FROM pg_catalog.pg_trigger AS guard
     JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname='public' AND NOT guard.tgisinternal)
      AS public_triggers,
    (SELECT count(*)::integer
     FROM pg_catalog.pg_proc AS routine
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=routine.pronamespace
     WHERE namespace.nspname='valo_security') AS security_functions`);
  assert.deepEqual(securityInventory.rows[0], {
    public_triggers: tenderContextExpected ? 147 : 116,
    security_functions:
      (productionAssuranceExpected ? 11 : 9) + (tenderContextExpected ? 3 : 0),
  });

  const securityFunctions = await client.query(`
    SELECT routine.proname::text AS function_name,
      language.lanname::text AS language_name,
      routine.prokind::text AS function_kind,
      routine.prosecdef AS security_definer,
      routine.proleakproof AS leakproof,
      routine.proisstrict AS strict,
      routine.provolatile::text AS volatility,
      routine.proparallel::text AS parallel_safety,
      COALESCE(pg_catalog.array_to_string(routine.proconfig,','),'')
        AS function_config,
      routine.prorettype='pg_catalog.trigger'::pg_catalog.regtype
        AS returns_trigger,
      routine.pronargs::integer AS argument_count,
      COALESCE((
        SELECT pg_catalog.string_agg(
          pg_catalog.format_type(argument_type.type_oid,NULL),
          ', ' ORDER BY argument_type.ordinality
        )
        FROM pg_catalog.unnest(routine.proargtypes::oid[])
          WITH ORDINALITY AS argument_type(type_oid,ordinality)
      ), '') AS argument_types,
      pg_catalog.pg_get_function_identity_arguments(routine.oid)
        AS identity_arguments,
      pg_catalog.format_type(routine.prorettype,NULL) AS return_type,
      pg_catalog.pg_get_function_result(routine.oid) AS function_result,
      routine.proretset AS returns_set,
      routine.proowner=namespace.nspowner AS owner_is_schema_owner,
      routine.proowner=(
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname='valo_app_runtime'
      ) AS owner_is_runtime,
      pg_catalog.has_function_privilege(
        'valo_app_runtime',routine.oid,'EXECUTE'
      ) AS runtime_can_execute,
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(COALESCE(
          routine.proacl,
          pg_catalog.acldefault('f',routine.proowner)
        )) AS function_acl
        WHERE function_acl.grantee=0
          AND function_acl.privilege_type='EXECUTE'
      ) AS public_can_execute,
      ARRAY(
        SELECT
          CASE
            WHEN function_acl.grantee=routine.proowner THEN 'OWNER'
            WHEN grantee_role.rolname='valo_app_runtime' THEN 'RUNTIME'
            WHEN function_acl.grantee=0 THEN 'PUBLIC'
            ELSE 'OTHER'
          END || ':' || function_acl.privilege_type || ':' ||
            function_acl.is_grantable::text
        FROM pg_catalog.aclexplode(COALESCE(
          routine.proacl,
          pg_catalog.acldefault('f',routine.proowner)
        )) AS function_acl
        LEFT JOIN pg_catalog.pg_roles AS grantee_role
          ON grantee_role.oid=function_acl.grantee
        WHERE function_acl.privilege_type='EXECUTE'
        ORDER BY 1
      )::text[] AS execute_acl,
      routine.prosrc AS function_source
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=routine.pronamespace
    JOIN pg_catalog.pg_language AS language ON language.oid=routine.prolang
    WHERE namespace.nspname='valo_security'
    ORDER BY function_name,identity_arguments
  `);
  const expectedFunctionNames = [
    ...BASE_SECURITY_FUNCTION_NAMES,
    ...(productionAssuranceExpected
      ? PRODUCTION_ASSURANCE_SECURITY_FUNCTIONS.map(
          (expected) => expected.function_name,
        )
      : []),
    ...(tenderContextExpected
      ? [
          "enforce_governed_state_transition",
          "expected_tenant_parent_edges_v25",
          "reject_versioned_record_content_mutation",
        ]
      : []),
  ].sort();
  assert.deepEqual(
    securityFunctions.rows.map((routine) => routine.function_name),
    expectedFunctionNames,
    "pre-commit valo_security function inventory drift",
  );
  if (productionAssuranceExpected) {
    for (const expected of PRODUCTION_ASSURANCE_SECURITY_FUNCTIONS) {
      const actual = securityFunctions.rows.find(
        (routine) => routine.function_name === expected.function_name,
      );
      assert(actual, `missing pre-commit ${expected.function_name}`);
      const { function_source: functionSource, ...actualCatalog } = actual;
      assert.deepEqual(
        {
          ...actualCatalog,
          source_sha256: sha256(functionSource.replaceAll("\r\n", "\n").trim()),
        },
        expected,
        `pre-commit ${expected.function_name} catalog drift`,
      );
    }
  }
  if (tenderContextExpected) {
    for (const expected of TENDER_CONTEXT_SECURITY_FUNCTIONS) {
      const actual = securityFunctions.rows.find(
        (routine) => routine.function_name === expected.function_name,
      );
      assert(actual, `missing pre-commit ${expected.function_name}`);
      assert.equal(actual.owner_is_schema_owner, true);
      assert.equal(actual.owner_is_runtime, false);
      assert.equal(actual.runtime_can_execute, false);
      assert.equal(actual.public_can_execute, false);
      assert.deepEqual(actual.execute_acl, ["OWNER:EXECUTE:false"]);
      assert.equal(
        sha256(actual.function_source.replaceAll("\r\n", "\n").trim()),
        expected.source_sha256,
        `pre-commit ${expected.function_name} source drift`,
      );
    }
  }
}

function canonicalAuditPayload(payload, version) {
  const common = [
    payload.seq,
    payload.userId,
    payload.userName,
    payload.projectId,
    payload.eventType,
    payload.objectType,
    payload.objectId,
    payload.details,
    payload.createdAt,
  ];
  return JSON.stringify(
    version === 1
      ? common
      : [payload.seq, payload.organisationId, ...common.slice(1)],
  );
}

function auditHash(previousHash, payload, version) {
  return sha256(`${previousHash}\n${canonicalAuditPayload(payload, version)}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function exactKeys(value, expected, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    `${label} keys`,
  );
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseRestoreManifest(bytes, expectedSha256) {
  assert(isSha256(expectedSha256), "expected manifest SHA-256 is malformed");
  assert.equal(
    sha256(bytes),
    expectedSha256,
    "restore manifest SHA-256 mismatch",
  );
  const manifest = JSON.parse(bytes.toString("utf8"));
  assert.equal(manifest.format, "valo.restore-rehearsal.v3");
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.target?.organisationId, ORGANISATION_ID);
  assert.equal(manifest.target?.organisationName, "Valo Nigeria");
  assert.equal(manifest.target?.organisationSlug, "valo-nigeria");
  exactKeys(
    manifest.legacyLineage,
    ["id", "columnFingerprintAlgorithm", "columnFingerprintSha256"],
    "manifest legacyLineage",
  );
  assert(
    LEGACY_LINEAGE_IDS.includes(manifest.legacyLineage.id),
    "manifest legacy lineage is unsupported",
  );
  assert.equal(
    manifest.legacyLineage.columnFingerprintAlgorithm,
    LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
  );
  assert(
    isSha256(manifest.legacyLineage.columnFingerprintSha256),
    "invalid legacy column fingerprint SHA-256",
  );
  assert(
    typeof manifest.target?.database === "string" &&
      manifest.target.database.length > 0,
  );
  assert(!Number.isNaN(Date.parse(manifest.capturedAt)));
  assert.equal(
    basename(manifest.backup?.fileName ?? ""),
    manifest.backup?.fileName,
  );
  assert.equal(
    basename(manifest.auditExport?.fileName ?? ""),
    manifest.auditExport?.fileName,
  );
  assert.equal(manifest.backup?.pgRestoreListVerified, true);
  assert.equal(manifest.backup?.scratchRestoreExitStatus, 0);
  assert.equal(manifest.backup?.postgresMajor, 16);
  assert(isSha256(manifest.backup?.sha256));
  assert(isSha256(manifest.auditExport?.sha256));
  exactKeys(manifest.rowCounts, LEGACY_TABLES, "manifest rowCounts");
  exactKeys(manifest.tableDigests, LEGACY_TABLES, "manifest tableDigests");
  for (const table of LEGACY_TABLES) {
    const count = manifest.rowCounts[table];
    const digest = manifest.tableDigests[table];
    assert(
      Number.isInteger(count) && count >= 0,
      `invalid row count for ${table}`,
    );
    assert.equal(
      digest?.rowCount,
      count,
      `digest row count mismatch for ${table}`,
    );
    assert(isSha256(digest?.sha256), `invalid table digest for ${table}`);
  }
  assert.equal(manifest.audit?.eventCount, manifest.rowCounts.audit_events);
  assert.equal(manifest.audit?.minSeq, 1);
  assert.equal(manifest.audit?.maxSeq, manifest.audit.eventCount);
  assert.equal(manifest.audit?.distinctSeq, manifest.audit.eventCount);
  assert.equal(manifest.audit?.linksContiguous, true);
  assert.equal(manifest.audit?.rowNoSequenceIsCalled, true);
  assert.equal(manifest.audit?.rowNoSequenceLastValue, 560);
  assert(Array.isArray(manifest.audit?.payloadHashVerifiedSequences));
  assert(Array.isArray(manifest.audit?.knownDiscontinuitySequences));
  const classified = [
    ...manifest.audit.payloadHashVerifiedSequences,
    ...manifest.audit.knownDiscontinuitySequences,
  ].sort((left, right) => left - right);
  assert.deepEqual(
    classified,
    Array.from({ length: manifest.audit.eventCount }, (_, index) => index + 1),
    "manifest audit classifications must partition the chain",
  );
  assert.deepEqual(
    manifest.audit.payloadHashVerifiedSequences,
    PAYLOAD_HASH_VERIFIED_SEQUENCES,
  );
  assert.deepEqual(
    manifest.audit.knownDiscontinuitySequences,
    KNOWN_DISCONTINUITY_SEQUENCES,
  );
  assert(Number.isInteger(manifest.audit.externalHead?.seq));
  assert(isSha256(manifest.audit.externalHead?.hash));
  assert(isSha256(manifest.audit.externalHead?.prevHash));
  assert.equal(manifest.audit.externalHead.seq, manifest.audit.maxSeq);
  assert(isSha256(manifest.componentManifestSha256));
  assert.equal(manifest.tableDigestAlgorithm, SOURCE_DIGEST_ALGORITHM);
  assert.equal(manifest.allTableDigestsMatchProduction, true);
  assert.equal(
    manifest.legacyCatalog?.algorithm,
    LEGACY_CATALOG_DIGEST_ALGORITHM,
  );
  assert(
    isSha256(manifest.legacyCatalog?.sha256),
    "invalid legacy catalog SHA-256",
  );
  return manifest;
}

async function readPrivateEvidence(name, encoding) {
  const path = required(name);
  const metadata = await stat(path);
  assert(metadata.isFile(), `${name} must name a regular file`);
  if (process.platform !== "win32") {
    assert.equal(
      metadata.mode & 0o077,
      0,
      `${name} must not be group/world-readable`,
    );
  }
  return encoding ? readFile(path, encoding) : readFile(path);
}

function sqlValue(value) {
  if (value.includes("\0"))
    throw new Error("NUL is not allowed in bridge input");
  return value.replaceAll("'", "''");
}

function replaceToken(sql, token, value) {
  const occurrences = sql.split(token).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected one ${token} token, found ${occurrences}`);
  }
  return sql.replace(token, sqlValue(value));
}

function normalizeSql(value) {
  return value.replaceAll("\r\n", "\n").trim();
}

function canonicalOperationalSql(value) {
  return normalizeSql(value)
    .replace(/^\s*--.*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function embeddedSection(bridge, startMarker, endMarker) {
  const start = bridge.indexOf(startMarker);
  const end = bridge.indexOf(endMarker);
  assert(start >= 0 && end > start, `missing embedded section ${startMarker}`);
  return normalizeSql(bridge.slice(start + startMarker.length, end));
}

function withoutBridgeOnlyExtension(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker);
  assert(
    start >= 0 && end > start,
    `missing bridge-only extension ${startMarker}`,
  );
  assert.equal(
    value.indexOf(startMarker, start + startMarker.length),
    -1,
    `duplicate bridge-only extension ${startMarker}`,
  );
  assert.equal(
    value.indexOf(endMarker, end + endMarker.length),
    -1,
    `duplicate bridge-only extension ${endMarker}`,
  );
  const startLine = value.lastIndexOf("\n", start) + 1;
  const endLineBreak = value.indexOf("\n", end + endMarker.length);
  const afterEndLine = endLineBreak === -1 ? value.length : endLineBreak + 1;
  return {
    base: normalizeSql(
      `${value.slice(0, startLine)}${value.slice(afterEndLine)}`,
    ),
    extension: normalizeSql(value.slice(start + startMarker.length, end)),
  };
}

function idempotentMigration0000(source) {
  return normalizeSql(source)
    .replace(/^CREATE TABLE "/gm, 'CREATE TABLE IF NOT EXISTS public."')
    .replace(
      /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" ([^\n]+);--> statement-breakpoint$/gm,
      (_statement, table, constraint, definition) =>
        [
          "DO $bridge_constraint$",
          "BEGIN",
          "  IF NOT EXISTS (",
          "    SELECT 1 FROM pg_constraint",
          `    WHERE conname = '${constraint}'`,
          `      AND conrelid = 'public.${table}'::regclass`,
          "  ) THEN",
          `    ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" ${definition};`,
          "  END IF;",
          "END;",
          "$bridge_constraint$;",
          "--> statement-breakpoint",
        ].join("\n"),
    )
    .replace(/^CREATE UNIQUE INDEX "/gm, 'CREATE UNIQUE INDEX IF NOT EXISTS "')
    .replace(/^CREATE INDEX "/gm, 'CREATE INDEX IF NOT EXISTS "');
}

function idempotentMigration0001(source) {
  return normalizeSql(source)
    .replace(
      /    EXECUTE format\(\n      'CREATE POLICY ([a-z_]+) ON public\.%I/g,
      (_statement, policy) =>
        [
          "    EXECUTE format(",
          `      'DROP POLICY IF EXISTS ${policy} ON public.%I',`,
          "      tenant_table",
          "    );",
          "    EXECUTE format(",
          `      'CREATE POLICY ${policy} ON public.%I`,
        ].join("\n"),
    )
    .replace(
      /^CREATE POLICY ([a-z_]+) ON (public\.[a-z_]+)$/gm,
      "DROP POLICY IF EXISTS $1 ON $2;\n--> statement-breakpoint\nCREATE POLICY $1 ON $2",
    );
}

async function checkArtifact() {
  const [
    bridge,
    migration0000,
    migration0001,
    migration0002,
    productionAssuranceMigration,
    tenderContextMigration,
  ] = await Promise.all(
    [
      bridgePath,
      ...migrationPaths,
      productionAssuranceMigrationPath,
      tenderContextMigrationPath,
    ].map((path) => readFile(path, "utf8")),
  );
  const runner = await readFile(fileURLToPath(import.meta.url), "utf8");
  assert(
    !bridge.includes("tokens truncated"),
    "bridge contains truncated tool output",
  );
  assert.equal(
    (bridge.match(/^END$/gm) ?? []).length,
    0,
    "bridge contains an unterminated PL/pgSQL END",
  );
  assert.doesNotMatch(
    bridge,
    /\bAS\s+constraint\b/i,
    "bridge uses reserved word constraint as a relation alias",
  );
  assert.equal(
    sha256(normalizeSql(migration0000)),
    "ae95d198bff43d732b27ed9e3f1ab5254141cad32f293510607fde6b0732c35e",
    "0000 changed from the pinned origin/main content",
  );
  assert.equal(
    sha256(normalizeSql(migration0001)),
    "71c58459a4e742e6b5fbb2230f12fb2af4b9cafffb297c56ab55ec131de7c467",
    "0001 changed from the pinned origin/main content",
  );
  for (const expected of PRODUCTION_ASSURANCE_SECURITY_FUNCTIONS) {
    const functionStart = productionAssuranceMigration.indexOf(
      `CREATE FUNCTION valo_security.${expected.function_name}(`,
    );
    const sourceStart = productionAssuranceMigration.indexOf(
      "AS $function$",
      functionStart,
    );
    const sourceEnd = productionAssuranceMigration.indexOf(
      "$function$;",
      sourceStart,
    );
    assert(
      functionStart >= 0 &&
        sourceStart > functionStart &&
        sourceEnd > sourceStart,
      `0008 is missing ${expected.function_name}`,
    );
    assert.equal(
      sha256(
        normalizeSql(
          productionAssuranceMigration.slice(
            sourceStart + "AS $function$".length,
            sourceEnd,
          ),
        ),
      ),
      expected.source_sha256,
      `0008 ${expected.function_name} source hash drift`,
    );
  }
  const precommitSecurityCatalog = runner.slice(
    runner.indexOf("async function assertPrecommitSecurityCatalog"),
    runner.indexOf("function canonicalAuditPayload"),
  );
  assert.match(
    precommitSecurityCatalog,
    /FROM pg_temp\._valo_bridge_state/u,
    "pre-commit proof must consume the exact bridge catalog variant",
  );
  assert.match(
    precommitSecurityCatalog,
    /productionAssuranceExpected \? 97 : 96/u,
  );
  assert.match(
    precommitSecurityCatalog,
    /productionAssuranceExpected \? 105 : 104/u,
  );
  assert.match(
    precommitSecurityCatalog,
    /productionAssuranceExpected \? 11 : 9/u,
  );
  const commitAttemptAt = runner.indexOf("bridgeCommitAttempted = true;");
  const commitCallAt = runner.indexOf('await owner.query("COMMIT")');
  assert(
    commitAttemptAt >= 0 && commitAttemptAt < commitCallAt,
    "runner must mark COMMIT attempted before sending COMMIT",
  );
  assert.match(runner, /BRIDGE_COMMIT_OUTCOME_UNKNOWN/);
  assert.match(
    runner,
    /bridgeCommitAttempted\s*&&\s*!bridgeCommitted/,
    "runner must conservatively classify a failed COMMIT call",
  );
  const embedded0000 = embeddedSection(
    bridge,
    "-- BEGIN EMBEDDED IDEMPOTENT 0000 (generated from the checked-in migration).",
    "-- END EMBEDDED IDEMPOTENT 0000.",
  );
  const embedded0001 = embeddedSection(
    bridge,
    "-- BEGIN EMBEDDED IDEMPOTENT 0001 (generated from the checked-in migration).",
    "-- END EMBEDDED IDEMPOTENT 0001.",
  );
  const embedded0002Schema = embeddedSection(
    bridge,
    "-- BEGIN EMBEDDED IDEMPOTENT 0002 SCHEMA.",
    "-- END EMBEDDED IDEMPOTENT 0002 SCHEMA.",
  );
  const embedded0002Security = embeddedSection(
    bridge,
    "-- BEGIN EMBEDDED IDEMPOTENT 0002 SECURITY.",
    "-- END EMBEDDED IDEMPOTENT 0002 SECURITY.",
  );
  assert.equal(
    embedded0000,
    idempotentMigration0000(migration0000),
    "embedded 0000 is not the deterministic idempotent transform",
  );
  assert.equal(
    embedded0001,
    idempotentMigration0001(migration0001),
    "embedded 0001 is not the deterministic idempotent transform",
  );
  const migration0002SecurityMarker = "-- AUDIT BOUNDARY SECURITY";
  const migration0002SecurityStart = migration0002.indexOf(
    migration0002SecurityMarker,
  );
  assert(migration0002SecurityStart > 0, "0002 security marker is absent");
  const bridge0010EdgeExtensionStart =
    "-- BEGIN BRIDGE-ONLY 0010 TENANT-PARENT PREFLIGHT EXTENSION.";
  const bridge0010EdgeExtensionEnd =
    "-- END BRIDGE-ONLY 0010 TENANT-PARENT PREFLIGHT EXTENSION.";
  const { base: embedded0002SecurityBase, extension: bridge0010EdgeExtension } =
    withoutBridgeOnlyExtension(
      embedded0002Security,
      bridge0010EdgeExtensionStart,
      bridge0010EdgeExtensionEnd,
    );
  assert.equal(
    sha256(canonicalOperationalSql(embedded0002Security)),
    "77c9be8467495f2299290c153ccd4739af1a7b3fe53d1bea1a6d67612d734f7b",
    "embedded 0002 security plus its bridge-only 0010 extension drifted",
  );
  const edgeTuplePattern =
    /\('([^']+)','([^']+)','([^']+)','([^']+)',(true|false)\)/gu;
  const extractEdgeTuples = (source) =>
    [...source.matchAll(edgeTuplePattern)].map((match) => match.slice(1));
  const migration0010EdgeFunctionStart = tenderContextMigration.indexOf(
    "CREATE FUNCTION valo_security.expected_tenant_parent_edges()",
  );
  assert(
    migration0010EdgeFunctionStart >= 0,
    "0010 tenant-parent extension function is absent",
  );
  const migration0010EdgeFunction = tenderContextMigration.slice(
    migration0010EdgeFunctionStart,
    tenderContextMigration.indexOf(
      "$function$;",
      migration0010EdgeFunctionStart,
    ),
  );
  const bridge0010Edges = extractEdgeTuples(bridge0010EdgeExtension);
  const migration0010Edges = extractEdgeTuples(migration0010EdgeFunction);
  assert.equal(
    bridge0010Edges.length,
    18,
    "bridge-only 0010 precommit extension must contain exactly 18 edges",
  );
  assert.deepEqual(
    bridge0010Edges,
    migration0010Edges,
    "bridge-only 0010 precommit extension differs from migration 0010",
  );
  assert.match(
    bridge0010EdgeExtension,
    /WHERE \(SELECT tender_context_expected FROM _valo_bridge_state\)\s+UNION ALL$/u,
    "bridge-only 0010 edges must be conditional and preserve the historical archive union",
  );
  assert.equal(
    sha256(canonicalOperationalSql(bridge0010EdgeExtension)),
    "8ec258cab2f02d5d03778ecf598b7b2176af35703ff9584d9b8d0ba488266d83",
    "bridge-only 0010 precommit operational SQL drifted",
  );
  const bridge0010EdgeManifest = bridge0010Edges
    .map(
      ([childTable, childColumn, parentTable, parentColumn, allowGlobal]) =>
        `${childTable}.${childColumn}->${parentTable}.${parentColumn}|${allowGlobal === "true" ? "global" : "strict"}`,
    )
    .sort()
    .join("\n");
  assert.equal(
    sha256(bridge0010EdgeManifest),
    "aac15a9e7e6c60892d326a66b2d4f49380a01fd1d391fb70916954b36826c121",
    "bridge-only 0010 edge manifest drifted",
  );
  assert.equal(
    canonicalOperationalSql(embedded0002Schema),
    canonicalOperationalSql(migration0002.slice(0, migration0002SecurityStart)),
    "embedded 0002 schema is not the checked-in migration segment",
  );
  assert.equal(
    canonicalOperationalSql(embedded0002SecurityBase),
    canonicalOperationalSql(
      migration0002.slice(
        migration0002SecurityStart + migration0002SecurityMarker.length,
      ),
    ),
    "embedded 0002 security is not the checked-in migration segment",
  );
  assert.equal((migration0000.match(/^CREATE TABLE /gm) ?? []).length, 94);
  assert.equal(
    (embedded0000.match(/^CREATE TABLE IF NOT EXISTS public\."/gm) ?? [])
      .length,
    94,
  );
  assert.equal(
    (migration0000.match(/^ALTER TABLE .* ADD CONSTRAINT /gm) ?? []).length,
    256,
  );
  assert.equal(
    (embedded0000.match(/^DO \$bridge_constraint\$/gm) ?? []).length,
    256,
  );
  assert.equal(
    (migration0000.match(/^CREATE (?:UNIQUE )?INDEX /gm) ?? []).length,
    86,
  );
  assert.equal(
    (embedded0000.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /gm) ?? [])
      .length,
    86,
  );
  assert(
    embedded0001.includes(
      "CREATE OR REPLACE FUNCTION valo_security.current_organisation_id",
    ),
  );
  assert(embedded0001.includes("DROP POLICY IF EXISTS tenant_isolation"));
  assert(migration0002.includes("legacy_audit_integrity_assessments"));
  assert(migration0002.includes("audit_events_append_only"));
  const legacyColumnSection = bridge.slice(
    bridge.indexOf("INSERT INTO _valo_expected_legacy_columns VALUES"),
    bridge.indexOf("DO $preflight$"),
  );
  const legacyColumns = new Map();
  for (const match of legacyColumnSection.matchAll(
    /\('([^']+)',\s*ARRAY\[([^\]]+)\]\)/g,
  )) {
    legacyColumns.set(
      match[1],
      [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
    );
  }
  assert.deepEqual([...legacyColumns.keys()].sort(), LEGACY_TABLES);
  const pushManagedColumnSection = bridge.slice(
    bridge.indexOf("INSERT INTO _valo_production_push_managed_columns VALUES"),
    bridge.indexOf("INSERT INTO _valo_effective_legacy_columns"),
  );
  const pushManagedColumns = new Map();
  for (const match of pushManagedColumnSection.matchAll(
    /\('([^']+)',\s*ARRAY\[([^\]]+)\]\)/g,
  )) {
    pushManagedColumns.set(
      match[1],
      [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
    );
  }
  assert.deepEqual(
    pushManagedColumns,
    REPLIT_PRODUCTION_PUSH_MANAGED_COLUMNS,
    "SQL and runner production push-managed lineages differ",
  );
  const absentPairs = [];
  for (const table of LEGACY_TABLES) {
    const canonical = legacyColumns.get(table);
    const pushManaged = pushManagedColumns.get(table);
    assert.deepEqual(
      pushManaged.filter((column) => !canonical.includes(column)),
      [],
      `push-managed lineage has an unknown ${table} column`,
    );
    absentPairs.push(
      ...canonical
        .filter((column) => !pushManaged.includes(column))
        .map((column) => `${table}.${column}`),
    );
  }
  const expectedAbsentPairs = [...PUSH_MANAGED_NULL_INITIALIZATIONS].flatMap(
    ([table, columns]) => columns.map((column) => `${table}.${column}`),
  );
  assert.deepEqual(
    absentPairs.sort(),
    expectedAbsentPairs.sort(),
    "push-managed lineage must omit exactly the six reviewed nullable fields",
  );
  for (const table of LEGACY_TABLES) {
    const canonical = legacyColumns.get(table);
    const pushManaged = pushManagedColumns.get(table);
    if (PUSH_MANAGED_ORDER_ONLY_TABLES.includes(table)) {
      assert.deepEqual(
        [...pushManaged].sort(),
        [...canonical].sort(),
        `push-managed ${table} drift must be order-only`,
      );
      assert.notDeepEqual(
        pushManaged,
        canonical,
        `push-managed ${table} must retain its reviewed physical order`,
      );
    } else if (!PUSH_MANAGED_NULL_INITIALIZATIONS.has(table)) {
      assert.deepEqual(
        pushManaged,
        canonical,
        `push-managed ${table} must match canonical order exactly`,
      );
    }
  }
  for (const [table, columns] of PUSH_MANAGED_NULL_INITIALIZATIONS) {
    const tableDefinition = migration0000.match(
      new RegExp(
        `^CREATE TABLE "${table}" \\(\\r?\\n([\\s\\S]*?)\\r?\\n\\);`,
        "m",
      ),
    )?.[1];
    assert(tableDefinition, `0000 definition is absent for ${table}`);
    for (const column of columns) {
      const definition = tableDefinition
        .split(/\r?\n/)
        .find((line) => line.trimStart().startsWith(`"${column}" `));
      assert(definition, `0000 definition is absent for ${table}.${column}`);
      assert.doesNotMatch(
        definition,
        /\bNOT NULL\b/,
        `${table}.${column} must remain nullable for the push-managed bridge`,
      );
      assert.doesNotMatch(
        definition,
        /\bDEFAULT\b/,
        `${table}.${column} must default to NULL for the push-managed bridge`,
      );
    }
  }
  const effectiveColumnSection = bridge.slice(
    bridge.indexOf("INSERT INTO _valo_effective_legacy_columns"),
    bridge.indexOf("DO $complete_state_validation$"),
  );
  assert.match(
    effectiveColumnSection,
    /THEN production\.column_names/,
    "effective push-managed columns must come from the full pinned map",
  );
  assert.equal(
    bridge.split("__VALO_BRIDGE_EXPECTED_LEGACY_LINEAGE__").length - 1,
    1,
    "bridge must contain one legacy-lineage input token",
  );
  return {
    bridge,
    runnerBody: embeddedSection(bridge, RUNNER_BODY_BEGIN, RUNNER_BODY_END),
    legacyColumns,
    migrationHashes: [migration0000, migration0001, migration0002].map(sha256),
  };
}

async function classifyTarget(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.audit_events') IS NOT NULL AS has_audit_events,
      to_regclass('public.legacy_audit_events') IS NOT NULL AS has_archive,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='audit_events'
          AND column_name='hash_version'
      ) AS has_hash_version
  `);
  const row = result.rows[0];
  if (row?.has_audit_events && !row.has_archive && !row.has_hash_version) {
    return "legacy";
  }
  if (row?.has_audit_events && row.has_archive && row.has_hash_version) {
    return "complete";
  }
  throw new Error(
    "database is neither the legacy source nor a completed bridge target",
  );
}

function collapseSqlWhitespace(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
}

/**
 * Non-PII schema fingerprint for the exact legacy source. Every query is
 * explicitly ordered; environment-specific role names are reduced to an
 * owner class, and parser-sensitive SQL definitions have whitespace folded.
 */
async function legacyCatalogDigest(client) {
  const tables = LEGACY_TABLES;
  const sections = {
    relations: (
      await client.query(
        `SELECT c.relname, c.relkind, c.relpersistence,
           c.relrowsecurity, c.relforcerowsecurity,
           CASE WHEN c.relowner=(SELECT oid FROM pg_catalog.pg_roles
             WHERE rolname=current_user) THEN 'current_user' ELSE 'other' END
             AS owner_class
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname=ANY($1::text[])
           AND c.relkind IN ('r','p')
         ORDER BY c.relname`,
        [tables],
      )
    ).rows,
    columns: (
      await client.query(
        `SELECT c.relname, a.attnum, a.attname,
           pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
           a.attnotnull, a.attidentity, a.attgenerated,
           CASE WHEN a.attcollation=0 THEN NULL
             ELSE coll.collname END AS collation,
           pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expression
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_catalog.pg_attrdef d
           ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=a.attcollation
         WHERE n.nspname='public' AND c.relname=ANY($1::text[])
           AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
         ORDER BY c.relname,a.attnum`,
        [tables],
      )
    ).rows.map((row) => ({
      ...row,
      default_expression: collapseSqlWhitespace(row.default_expression),
    })),
    constraints: (
      await client.query(
        `SELECT rel.relname, constraint_record.conname,
           constraint_record.contype, constraint_record.convalidated,
           constraint_record.condeferrable, constraint_record.condeferred,
           pg_catalog.pg_get_constraintdef(constraint_record.oid,false)
             AS definition
         FROM pg_catalog.pg_constraint constraint_record
         JOIN pg_catalog.pg_class rel ON rel.oid=constraint_record.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=rel.relnamespace
         WHERE n.nspname='public' AND rel.relname=ANY($1::text[])
           AND constraint_record.contype IN ('p','f','c','u')
         ORDER BY rel.relname,constraint_record.conname`,
        [tables],
      )
    ).rows.map((row) => ({
      ...row,
      definition: collapseSqlWhitespace(row.definition),
    })),
    indexes: (
      await client.query(
        `SELECT rel.relname, index_relation.relname AS index_name,
           index_record.indisunique, index_record.indisprimary,
           index_record.indisvalid, index_record.indisready,
           index_record.indisreplident,
           pg_catalog.pg_get_indexdef(index_record.indexrelid,0,false)
             AS definition
         FROM pg_catalog.pg_index index_record
         JOIN pg_catalog.pg_class rel ON rel.oid=index_record.indrelid
         JOIN pg_catalog.pg_class index_relation
           ON index_relation.oid=index_record.indexrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=rel.relnamespace
         WHERE n.nspname='public' AND rel.relname=ANY($1::text[])
         ORDER BY rel.relname,index_relation.relname`,
        [tables],
      )
    ).rows.map((row) => ({
      ...row,
      definition: collapseSqlWhitespace(row.definition),
    })),
    sequences: (
      await client.query(
        `SELECT sequence_relation.relname,
           CASE WHEN sequence_relation.relowner=(SELECT oid
             FROM pg_catalog.pg_roles WHERE rolname=current_user)
             THEN 'current_user' ELSE 'other' END AS owner_class,
           pg_catalog.format_type(sequence_record.seqtypid,NULL) AS data_type,
           sequence_record.seqstart::text, sequence_record.seqincrement::text,
           sequence_record.seqmax::text, sequence_record.seqmin::text,
           sequence_record.seqcache::text, sequence_record.seqcycle,
           owned_namespace.nspname AS owned_schema,
           owned_relation.relname AS owned_table,
           owned_attribute.attname AS owned_column
         FROM pg_catalog.pg_class sequence_relation
         JOIN pg_catalog.pg_namespace sequence_namespace
           ON sequence_namespace.oid=sequence_relation.relnamespace
         JOIN pg_catalog.pg_sequence sequence_record
           ON sequence_record.seqrelid=sequence_relation.oid
         LEFT JOIN pg_catalog.pg_depend dependency
           ON dependency.classid='pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency.objid=sequence_relation.oid
          AND dependency.objsubid=0 AND dependency.deptype IN ('a','i')
         LEFT JOIN pg_catalog.pg_class owned_relation
           ON owned_relation.oid=dependency.refobjid
         LEFT JOIN pg_catalog.pg_namespace owned_namespace
           ON owned_namespace.oid=owned_relation.relnamespace
         LEFT JOIN pg_catalog.pg_attribute owned_attribute
           ON owned_attribute.attrelid=dependency.refobjid
          AND owned_attribute.attnum=dependency.refobjsubid
         WHERE sequence_namespace.nspname='public'
           AND (sequence_relation.relname='audit_events_row_no_seq'
             OR owned_relation.relname=ANY($1::text[]))
         ORDER BY sequence_relation.relname,owned_table,owned_column`,
        [tables],
      )
    ).rows,
    triggers: (
      await client.query(
        `SELECT rel.relname, trigger_record.tgname, trigger_record.tgenabled,
           pg_catalog.pg_get_triggerdef(trigger_record.oid,false) AS definition
         FROM pg_catalog.pg_trigger trigger_record
         JOIN pg_catalog.pg_class rel ON rel.oid=trigger_record.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=rel.relnamespace
         WHERE n.nspname='public' AND rel.relname=ANY($1::text[])
           AND NOT trigger_record.tgisinternal
         ORDER BY rel.relname,trigger_record.tgname`,
        [tables],
      )
    ).rows.map((row) => ({
      ...row,
      definition: collapseSqlWhitespace(row.definition),
    })),
    views: (
      await client.query(
        `SELECT c.relname, c.relkind,
           pg_catalog.pg_get_viewdef(c.oid,false) AS definition
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind IN ('v','m')
         ORDER BY c.relkind,c.relname`,
      )
    ).rows.map((row) => ({
      ...row,
      definition: collapseSqlWhitespace(row.definition),
    })),
    policies: (
      await client.query(
        `SELECT tablename, policyname, permissive, roles::text, cmd,
           qual, with_check
         FROM pg_catalog.pg_policies
         WHERE schemaname='public'
         ORDER BY tablename,policyname`,
      )
    ).rows.map((row) => ({
      ...row,
      qual: collapseSqlWhitespace(row.qual),
      with_check: collapseSqlWhitespace(row.with_check),
    })),
  };
  assert.deepEqual(
    sections.relations.map((row) => row.relname),
    tables,
    "legacy catalog relation inventory",
  );
  assert.equal(
    sections.sequences.length,
    1,
    "legacy catalog sequence inventory",
  );
  assert.equal(
    sections.triggers.length,
    0,
    "legacy catalog must have no user triggers",
  );
  assert.equal(
    sections.views.length,
    0,
    "legacy catalog must have no public views",
  );
  assert.equal(
    sections.policies.length,
    0,
    "legacy catalog must have no policies",
  );
  const canonical = JSON.stringify({
    format: "valo.legacy-catalog.v1",
    ...sections,
  });
  return {
    algorithm: LEGACY_CATALOG_DIGEST_ALGORITHM,
    sha256: sha256(canonical),
  };
}

async function sourceEvidence(client, source, expectedMismatches) {
  const relation =
    source === "legacy"
      ? "public.audit_events"
      : source === "complete"
        ? "public.legacy_audit_events"
        : undefined;
  assert(relation, "invalid evidence source");
  const result = await client.query(`
    SELECT
      id::text, user_id::text, user_name, project_id::text, event_type,
      object_type, object_id, details, seq, prev_hash, hash, row_no::text,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM ${relation}
    ORDER BY seq
  `);
  let previousHash = "0".repeat(64);
  const mismatches = [];
  for (const row of result.rows) {
    assert.equal(
      row.prev_hash,
      previousHash,
      `broken predecessor at seq ${row.seq}`,
    );
    const computed = auditHash(
      previousHash,
      {
        seq: row.seq,
        organisationId: ORGANISATION_ID,
        userId: row.user_id,
        userName: row.user_name,
        projectId: row.project_id,
        eventType: row.event_type,
        objectType: row.object_type,
        objectId: row.object_id,
        details: row.details,
        createdAt: row.created_at,
      },
      1,
    );
    if (computed !== row.hash) mismatches.push(row.seq);
    previousHash = row.hash;
  }
  assert.deepEqual(mismatches, expectedMismatches);

  const ndjson = await client.query(`
    SELECT string_agg(row_to_json(source_row)::text, E'\\n' ORDER BY source_row.seq)
             || E'\\n' AS content
    FROM (
      SELECT id, user_id, user_name, project_id, event_type, object_type,
        object_id, details, seq, prev_hash, hash, row_no, created_at
      FROM ${relation}
      ORDER BY seq
    ) AS source_row
  `);
  return {
    rows: result.rows,
    mismatchSequences: mismatches,
    auditExportContent: ndjson.rows[0]?.content ?? "",
    auditExportSha256: sha256(ndjson.rows[0]?.content ?? ""),
  };
}

async function tableDigest(client, source, table, columns) {
  assert(LEGACY_TABLES.includes(table));
  assert(Array.isArray(columns) && columns.length > 0);
  const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
  let relation = `public.${quote(table)}`;
  let projection = columns.map(quote).join(", ");
  if (source === "complete" && table === "audit_events") {
    relation = "public.legacy_audit_events";
  } else if (source === "complete" && table === "users") {
    relation = "public.users AS identity";
    projection = columns
      .map((column) => {
        if (column !== "role")
          return `identity.${quote(column)} AS ${quote(column)}`;
        return `CASE (
          SELECT grant_record.role
          FROM public.organisation_memberships AS membership
          JOIN public.role_grants AS grant_record
            ON grant_record.membership_id=membership.id
          WHERE membership.organisation_id='${ORGANISATION_ID}'::uuid
            AND membership.user_id=identity.id
          ORDER BY grant_record.created_at
          LIMIT 1
        )
          WHEN 'valo_operations_administrator' THEN 'admin'
          WHEN 'valo_quality_adviser' THEN 'reviewer'
          WHEN 'valo_analyst' THEN 'analyst'
          ELSE identity.role
        END AS role`;
      })
      .join(", ");
  }
  const result = await client.query(`
    SELECT count(*)::integer AS row_count,
      COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json) || E'\\n', '')
        AS content
    FROM (
      SELECT row_to_json(source_row)::text AS row_json
      FROM (SELECT ${projection} FROM ${relation}) AS source_row
    ) AS rows
  `);
  return {
    rowCount: result.rows[0].row_count,
    sha256: sha256(result.rows[0].content),
  };
}

async function completedBoundary(client) {
  const result = await client.query(
    `SELECT
       assessment.source_event_count,
       assessment.verified_ranges,
       assessment.discontinuity_ranges,
       assessment.finding,
       assessment.external_head_seq,
       assessment.external_head_hash,
       assessment.source_backup_sha256,
       assessment.source_audit_export_sha256,
       assessment.rehearsal_evidence_sha256,
       assessment.archive_digest,
       boundary.organisation_id::text AS boundary_organisation_id,
       boundary.user_id::text AS boundary_user_id,
       boundary.user_name AS boundary_user_name,
       boundary.project_id::text AS boundary_project_id,
       boundary.event_type AS boundary_event_type,
       boundary.object_type AS boundary_object_type,
       boundary.object_id AS boundary_object_id,
       boundary.details,
       boundary.seq,
       boundary.hash,
       boundary.prev_hash,
       boundary.hash_version,
       boundary.row_no::integer,
       to_char(boundary.created_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS boundary_created_at
     FROM public.legacy_audit_integrity_assessments AS assessment
     JOIN public.audit_events AS boundary
       ON boundary.id=$3::uuid
      AND boundary.organisation_id=assessment.organisation_id
     WHERE assessment.id=$1::uuid AND assessment.organisation_id=$2::uuid`,
    [ASSESSMENT_ID, ORGANISATION_ID, BOUNDARY_ID],
  );
  assert.equal(
    result.rowCount,
    1,
    "completed target must have exactly one legacy boundary",
  );
  return result.rows[0];
}

function runtimeUrlProof(ownerRaw, runtimeRaw) {
  let owner;
  let runtime;
  try {
    owner = new URL(ownerRaw);
    runtime = new URL(runtimeRaw);
  } catch {
    throw new Error("owner/runtime database URL is malformed");
  }
  if (
    !["postgres:", "postgresql:"].includes(owner.protocol) ||
    !["postgres:", "postgresql:"].includes(runtime.protocol)
  ) {
    throw new Error("owner/runtime URL must use the PostgreSQL protocol");
  }
  if (owner.hash || runtime.hash) {
    throw new Error("database URLs must not contain fragments");
  }
  for (const candidate of [owner, runtime]) {
    for (const key of ["user", "username", "password"]) {
      if (candidate.searchParams.has(key)) {
        throw new Error(
          "database credentials must be carried only in URL userinfo",
        );
      }
    }
  }
  if (decodeURIComponent(runtime.username) !== "valo_app_runtime") {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL must authenticate as valo_app_runtime",
    );
  }
  const password = decodeURIComponent(runtime.password);
  if (password.length < 32) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL must contain a random 32+ character password",
    );
  }
  const ownerTarget = new URL(owner);
  const runtimeTarget = new URL(runtime);
  ownerTarget.username = "";
  ownerTarget.password = "";
  runtimeTarget.username = "";
  runtimeTarget.password = "";
  if (ownerTarget.href !== runtimeTarget.href) {
    throw new Error(
      "runtime URL must preserve the managed target and TLS parameters",
    );
  }
  return { runtimeUrl: runtime.toString(), password };
}

/**
 * Post-commit row-count reconciliation across every legacy table's v2.5
 * destination, written as a durable machine-readable artifact for the
 * deployment record. audit_events reconciles against the immutable
 * legacy archive; every other legacy table reconciles against its
 * same-named tenant table. Runs only after COMMIT, so a mismatch is
 * reported as a committed-postcheck failure, never as a rollback.
 */
async function writeReconciliationReport({
  ownerUrl,
  expectedCounts,
  archiveDigest,
  committedActiveHead,
  legacyLineageId,
}) {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  const tables = [];
  try {
    // Tenant tables carry FORCE RLS, which binds the owner too: the count
    // session must present the migrated organisation's tenant context or
    // every tenant-scoped table would reconcile to a false zero.
    await client.query(
      "SELECT set_config('app.current_organisation_id', $1, false)",
      [ORGANISATION_ID],
    );
    for (const table of LEGACY_TABLES) {
      const target = table === "audit_events" ? "legacy_audit_events" : table;
      const shape = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name=$1) AS present,
           EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=$1
               AND column_name='organisation_id') AS tenant_scoped`,
        [target],
      );
      const { present, tenant_scoped: tenantScoped } = shape.rows[0];
      let observed = null;
      if (present) {
        const filter = tenantScoped
          ? ` WHERE organisation_id='${ORGANISATION_ID}'::uuid`
          : "";
        observed = Number(
          (
            await client.query(
              `SELECT count(*) FROM public."${target}"${filter}`,
            )
          ).rows[0].count,
        );
      }
      const expected = Number(expectedCounts[table]);
      tables.push({
        table,
        target,
        targetPresent: present,
        tenantScoped,
        expected,
        observed,
        matches: present && observed === expected,
      });
    }
  } finally {
    await client.end();
  }
  const body = {
    schema: "valo.bridge-reconciliation-report/v1",
    generatedAt: new Date().toISOString(),
    legacyLineage: legacyLineageId,
    organisationId: ORGANISATION_ID,
    activeHead: committedActiveHead,
    archiveDigest,
    tables,
    allMatched: tables.every((entry) => entry.matches),
  };
  const report = { ...body, reportSha256: sha256(JSON.stringify(body)) };
  const reportPath = resolve(
    process.env.VALO_BRIDGE_RECONCILIATION_REPORT_PATH ??
      resolve(process.cwd(), "bridge-reconciliation-report.json"),
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath };
}

async function main() {
  const artifact = await checkArtifact();
  if (process.argv.includes("--check")) {
    console.log(
      "legacy bridge artifact: 94 tables / 256 FKs / 86 indexes verified",
    );
    return;
  }
  if (process.argv.includes("--catalog-evidence")) {
    const evidenceClient = new Client({
      connectionString: required("DATABASE_URL"),
    });
    await evidenceClient.connect();
    try {
      await evidenceClient.query(
        "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED",
      );
      await evidenceClient.query("SET LOCAL lock_timeout='15s'");
      await evidenceClient.query("SET LOCAL search_path=pg_catalog,public");
      await evidenceClient.query("SET LOCAL TIME ZONE 'UTC'");
      await evidenceClient.query(LOCK_LEGACY_TABLES);
      const evidence = await legacyCatalogDigest(evidenceClient);
      await evidenceClient.query("ROLLBACK");
      console.log(JSON.stringify(evidence));
    } catch (error) {
      await evidenceClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await evidenceClient.end();
    }
    return;
  }
  if (!process.argv.includes("--execute")) {
    throw new Error(
      "refusing to mutate a database without the explicit --execute flag",
    );
  }

  const ownerUrl = required("DATABASE_URL");
  const runtime = runtimeUrlProof(
    ownerUrl,
    required("VALO_RUNTIME_DATABASE_URL"),
  );
  const acknowledgement = required("VALO_BRIDGE_APPLICATION_QUIESCED_ACK");
  assert.equal(
    acknowledgement,
    "RESTORE_VERIFIED_AND_APPLICATION_QUIESCED",
    "application-quiescence acknowledgement is absent",
  );
  const platformAdminClerkId = required(
    "VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID",
  );
  const backupPath = required("VALO_BRIDGE_SOURCE_BACKUP_PATH");
  const auditExportPath = required("VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH");
  const expectedManifestSha256 = required(
    "VALO_BRIDGE_EXPECTED_REHEARSAL_MANIFEST_SHA256",
  );
  const [backupBytes, expectedAuditExport, rehearsalManifestBytes] =
    await Promise.all([
      readPrivateEvidence("VALO_BRIDGE_SOURCE_BACKUP_PATH"),
      readPrivateEvidence("VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH", "utf8"),
      readPrivateEvidence("VALO_BRIDGE_REHEARSAL_MANIFEST_PATH"),
    ]);
  const manifest = parseRestoreManifest(
    rehearsalManifestBytes,
    expectedManifestSha256,
  );
  const manifestLegacyColumns = legacyColumnsForLineage(
    artifact.legacyColumns,
    manifest.legacyLineage.id,
  );
  assert.equal(
    legacyColumnFingerprint(manifestLegacyColumns),
    manifest.legacyLineage.columnFingerprintSha256,
    "manifest legacy lineage fingerprint differs from the checked bridge artifact",
  );
  const backupSha256 = sha256(backupBytes);
  const auditExportSha256 = sha256(expectedAuditExport);
  const rehearsalEvidenceSha256 = sha256(rehearsalManifestBytes);
  assert.equal(basename(backupPath), manifest.backup.fileName);
  assert.equal(basename(auditExportPath), manifest.auditExport.fileName);
  assert.equal(backupSha256, manifest.backup.sha256);
  assert.equal(auditExportSha256, manifest.auditExport.sha256);
  assert.equal(rehearsalEvidenceSha256, expectedManifestSha256);
  const expectedDatabase = manifest.target.database;
  const expectedCounts = manifest.rowCounts;
  const expectedHead = manifest.audit.externalHead;

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  let ownerTransactionOpen = false;
  let committedActiveHead;
  try {
    await owner.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
    ownerTransactionOpen = true;
    await owner.query("SET LOCAL lock_timeout='15s'");
    await owner.query("SET LOCAL idle_in_transaction_session_timeout='10min'");
    await owner.query("SET LOCAL statement_timeout='10min'");
    await owner.query("SET LOCAL search_path=pg_catalog,public");
    await owner.query("SET LOCAL TIME ZONE 'UTC'");
    await owner.query(LOCK_LEGACY_TABLES);
    await owner.query("SELECT pg_advisory_xact_lock(564142502025::bigint)");

    const targetState = await classifyTarget(owner);
    // The fixed legacy-name tables are already locked before classification.
    // A completed target stores reconstructed legacy evidence and identity-role
    // provenance in these additional relations, so lock them before reading a
    // single byte from the completed-state evidence path as well.
    if (targetState === "complete") {
      await owner.query(LOCK_COMPLETED_EVIDENCE_TABLES);
      await owner.query(
        "SELECT valo_security.set_current_organisation_id($1::uuid)",
        [ORGANISATION_ID],
      );
    } else {
      const lockedLineage = await detectLegacyLineage(
        owner,
        artifact.legacyColumns,
      );
      assert.deepEqual(
        {
          id: lockedLineage.id,
          columnFingerprintAlgorithm: lockedLineage.columnFingerprintAlgorithm,
          columnFingerprintSha256: lockedLineage.columnFingerprintSha256,
        },
        manifest.legacyLineage,
        "locked legacy column lineage differs from the authenticated restore manifest",
      );
      assert.deepEqual(
        await legacyCatalogDigest(owner),
        manifest.legacyCatalog,
        "locked legacy catalog differs from the authenticated restore manifest",
      );
    }
    const expectedPlatformRole =
      targetState === "legacy" ? "admin" : "restricted_platform_administrator";
    const identity = await owner.query(
      `SELECT count(*)::integer AS count FROM public.users
       WHERE clerk_user_id=$1 AND status='active' AND role=$2`,
      [platformAdminClerkId, expectedPlatformRole],
    );
    assert.equal(
      identity.rows[0]?.count,
      1,
      "platform admin must match exactly one approved identity",
    );
    assert.equal(
      (await owner.query("SELECT current_database() AS database")).rows[0]
        .database,
      expectedDatabase,
    );
    const evidence = await sourceEvidence(
      owner,
      targetState,
      manifest.audit.knownDiscontinuitySequences,
    );
    assert.equal(evidence.rows.length, expectedCounts.audit_events);
    assert.equal(
      evidence.auditExportContent,
      expectedAuditExport,
      "database audit bytes differ from the private pre-mutation export",
    );
    assert.equal(evidence.auditExportSha256, auditExportSha256);
    const head = evidence.rows.at(-1);
    assert.equal(head?.seq, expectedHead.seq);
    assert.equal(head?.hash, expectedHead.hash);
    assert.equal(head?.prev_hash, expectedHead.prevHash);
    const verifiedSequences = evidence.rows
      .map((row) => row.seq)
      .filter(
        (sequence) =>
          !manifest.audit.knownDiscontinuitySequences.includes(sequence),
      );
    assert.deepEqual(
      verifiedSequences,
      manifest.audit.payloadHashVerifiedSequences,
    );
    for (const table of LEGACY_TABLES) {
      const digest = await tableDigest(
        owner,
        targetState,
        table,
        manifestLegacyColumns.get(table),
      );
      assert.deepEqual(
        digest,
        manifest.tableDigests[table],
        `locked table digest mismatch for ${table}`,
      );
    }
    if (targetState === "legacy") {
      const ordinal = await owner.query(
        "SELECT last_value::integer, is_called FROM public.audit_events_row_no_seq",
      );
      assert.deepEqual(ordinal.rows[0], {
        last_value: manifest.audit.rowNoSequenceLastValue,
        is_called: manifest.audit.rowNoSequenceIsCalled,
      });
    }

    let boundaryCreatedAt;
    let boundaryDetails;
    let boundaryHash;
    if (targetState === "complete") {
      const recorded = await completedBoundary(owner);
      assert.equal(recorded.source_event_count, evidence.rows.length);
      assert.equal(recorded.verified_ranges, "1-7,27-28");
      assert.equal(recorded.discontinuity_ranges, "8-26");
      assert.match(recorded.finding, /^KNOWN_DISCONTINUITY:/);
      assert.equal(recorded.external_head_seq, expectedHead.seq);
      assert.equal(recorded.external_head_hash, expectedHead.hash);
      assert.equal(recorded.source_backup_sha256, backupSha256);
      assert.equal(recorded.source_audit_export_sha256, auditExportSha256);
      assert.equal(recorded.rehearsal_evidence_sha256, rehearsalEvidenceSha256);
      assert.equal(recorded.archive_digest, evidence.auditExportSha256);
      assert.equal(recorded.boundary_organisation_id, ORGANISATION_ID);
      assert.equal(recorded.boundary_user_id, null);
      assert.equal(recorded.boundary_user_name, "Valo migration bridge");
      assert.equal(recorded.boundary_project_id, null);
      assert.equal(
        recorded.boundary_event_type,
        "audit.legacy_boundary_registered",
      );
      assert.equal(
        recorded.boundary_object_type,
        "legacy_audit_integrity_assessment",
      );
      assert.equal(recorded.boundary_object_id, ASSESSMENT_ID);
      assert.equal(recorded.seq, 1);
      assert.equal(recorded.prev_hash, "0".repeat(64));
      assert.equal(recorded.hash_version, 2);
      assert.equal(recorded.row_no, 561);
      boundaryCreatedAt = recorded.boundary_created_at;
      boundaryDetails = recorded.details;
      boundaryHash = recorded.hash;
      assert.equal(
        boundaryHash,
        auditHash(
          "0".repeat(64),
          {
            seq: recorded.seq,
            organisationId: recorded.boundary_organisation_id,
            userId: recorded.boundary_user_id,
            userName: recorded.boundary_user_name,
            projectId: recorded.boundary_project_id,
            eventType: recorded.boundary_event_type,
            objectType: recorded.boundary_object_type,
            objectId: recorded.boundary_object_id,
            details: boundaryDetails,
            createdAt: boundaryCreatedAt,
          },
          2,
        ),
        "persisted v2 boundary hash must recompute",
      );
      const classification = await owner.query(
        `SELECT
           count(*) FILTER (WHERE integrity_status='known_discontinuity')::integer AS known,
           count(*) FILTER (WHERE integrity_status='payload_hash_verified')::integer AS verified,
           count(DISTINCT assessment_id)::integer AS assessments,
           bool_and(assessment_id=$1::uuid) AS correct_assessment
         FROM public.legacy_audit_events
         WHERE organisation_id=$2::uuid`,
        [ASSESSMENT_ID, ORGANISATION_ID],
      );
      assert.deepEqual(classification.rows[0], {
        known: 19,
        verified: 9,
        assessments: 1,
        correct_assessment: true,
      });
    } else {
      boundaryCreatedAt = new Date().toISOString();
      boundaryDetails = JSON.stringify({
        integrityStatus: "KNOWN_DISCONTINUITY",
        legacyAssessmentId: ASSESSMENT_ID,
        sourceCommit: "b71adcec4a7060c0ce2192266c81d880c5e56277",
        sourceEventCount: evidence.rows.length,
        verifiedRanges: ["1-7", "27-28"],
        discontinuityRanges: ["8-26"],
        externalHead: expectedHead,
        sourceBackupSha256: backupSha256,
        sourceAuditExportSha256: auditExportSha256,
        rehearsalEvidenceSha256,
        archiveDigest: evidence.auditExportSha256,
      });
      boundaryHash = auditHash(
        "0".repeat(64),
        {
          seq: 1,
          organisationId: ORGANISATION_ID,
          userId: null,
          userName: "Valo migration bridge",
          projectId: null,
          eventType: "audit.legacy_boundary_registered",
          objectType: "legacy_audit_integrity_assessment",
          objectId: ASSESSMENT_ID,
          details: boundaryDetails,
          createdAt: boundaryCreatedAt,
        },
        2,
      );
    }

    const replacements = new Map([
      ["__VALO_BRIDGE_ACK__", acknowledgement],
      ["__VALO_BRIDGE_EXPECTED_DATABASE__", expectedDatabase],
      ["__VALO_BRIDGE_EXPECTED_LEGACY_LINEAGE__", manifest.legacyLineage.id],
      ["__VALO_BRIDGE_EXPECTED_COUNTS_JSON__", JSON.stringify(expectedCounts)],
      ["__VALO_BRIDGE_EXPECTED_AUDIT_HEAD_SEQ__", String(expectedHead.seq)],
      ["__VALO_BRIDGE_EXPECTED_AUDIT_HEAD_HASH__", expectedHead.hash],
      ["__VALO_BRIDGE_RUNTIME_ROLE__", "valo_app_runtime"],
      ["__VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID__", platformAdminClerkId],
      ["__VALO_BRIDGE_ARCHIVE_DIGEST__", evidence.auditExportSha256],
      ["__VALO_BRIDGE_BOUNDARY_CREATED_AT__", boundaryCreatedAt],
      ["__VALO_BRIDGE_BOUNDARY_DETAILS__", boundaryDetails],
      ["__VALO_BRIDGE_BOUNDARY_HASH__", boundaryHash],
      ["__VALO_BRIDGE_SOURCE_BACKUP_SHA256__", backupSha256],
      ["__VALO_BRIDGE_SOURCE_AUDIT_EXPORT_SHA256__", auditExportSha256],
      ["__VALO_BRIDGE_REHEARSAL_EVIDENCE_SHA256__", rehearsalEvidenceSha256],
      ["__VALO_BRIDGE_MIGRATION_0000_HASH__", artifact.migrationHashes[0]],
      ["__VALO_BRIDGE_MIGRATION_0001_HASH__", artifact.migrationHashes[1]],
      ["__VALO_BRIDGE_MIGRATION_0002_HASH__", artifact.migrationHashes[2]],
    ]);
    let sql = artifact.runnerBody;
    for (const [token, value] of replacements)
      sql = replaceToken(sql, token, value);
    if (/__VALO_BRIDGE_[A-Z0-9_]+__/.test(sql)) {
      throw new Error("unresolved bridge input token");
    }

    await owner.query(
      "SELECT set_config('valo.bridge.runtime_password', $1, false)",
      [runtime.password],
    );
    await owner.query(
      "SELECT set_config('valo.bridge.source_audit_export', $1, false)",
      [expectedAuditExport],
    );
    await owner.query(sql);
    await assertPrecommitSecurityCatalog(owner);

    const post = await owner.query(`
      SELECT
        (SELECT count(*)::integer FROM public.legacy_audit_events
         WHERE organisation_id='${ORGANISATION_ID}'::uuid) AS archived,
        (SELECT count(*)::integer FROM public.audit_events
         WHERE id='${BOUNDARY_ID}'::uuid
           AND organisation_id='${ORGANISATION_ID}'::uuid) AS boundary_count,
        (SELECT row_no::integer FROM public.audit_events
         WHERE id='${BOUNDARY_ID}'::uuid) AS boundary_row_no,
        (SELECT archive_digest FROM public.legacy_audit_integrity_assessments
         WHERE id='${ASSESSMENT_ID}'::uuid) AS archive_digest,
        (SELECT seq FROM public.audit_events
         WHERE organisation_id='${ORGANISATION_ID}'::uuid
         ORDER BY seq DESC LIMIT 1) AS active_head_seq,
        (SELECT hash FROM public.audit_events
         WHERE organisation_id='${ORGANISATION_ID}'::uuid
         ORDER BY seq DESC LIMIT 1) AS active_head_hash
    `);
    const { active_head_seq, active_head_hash, ...reconciliation } =
      post.rows[0];
    assert.deepEqual(reconciliation, {
      archived: evidence.rows.length,
      boundary_count: 1,
      boundary_row_no: 561,
      archive_digest: evidence.auditExportSha256,
    });
    assert(Number.isInteger(active_head_seq) && isSha256(active_head_hash));
    committedActiveHead = { seq: active_head_seq, hash: active_head_hash };
    // Once COMMIT is sent, a transport failure can make the server outcome
    // unknowable to this process. Mark the attempt first so the outer error
    // path never claims rollback or encourages a blind retry.
    bridgeCommitAttempted = true;
    await owner.query("COMMIT");
    ownerTransactionOpen = false;
    bridgeCommitted = true;
  } catch (error) {
    if (bridgeCommitAttempted && !bridgeCommitted) {
      bridgeCommitOutcomeUnknown = true;
    }
    if (ownerTransactionOpen) {
      await owner.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await owner.end();
  }

  const runtimeClient = new Client({ connectionString: runtime.runtimeUrl });
  await runtimeClient.connect();
  try {
    const role = await runtimeClient.query(`
      SELECT current_user AS role_name, session_user AS session_role_name,
        rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb,
        rolreplication, rolinherit, rolconnlimit,
        rolvaliduntil::text AS rolvaliduntil,
        COALESCE(cardinality(role.rolconfig),0)::integer AS role_settings,
        (SELECT count(*)::integer FROM pg_catalog.pg_db_role_setting
         WHERE setrole=role.oid) AS database_role_settings,
        (SELECT count(*)::integer FROM pg_catalog.pg_auth_members
         WHERE member=role.oid) AS memberships,
        (SELECT count(*)::integer FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relowner=role.oid)
          AS owned_public_relations,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_objects,
        has_sequence_privilege(current_user, 'public.audit_events_row_no_seq', 'UPDATE')
          AS can_set_audit_ordinal,
        has_table_privilege(current_user, 'public.audit_events', 'SELECT') AS can_select_audit,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(ARRAY[
            'id','organisation_id','user_id','user_name','project_id','event_type',
            'object_type','object_id','details','seq','prev_hash','hash',
            'hash_version','created_at'
          ]) AS required_columns(column_name)
          WHERE NOT has_column_privilege(
            current_user, 'public.audit_events', column_name, 'INSERT'
          )
        ) AS can_insert_audit,
        has_column_privilege(current_user, 'public.audit_events', 'row_no', 'INSERT')
          AS can_insert_audit_ordinal,
        (has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
          OR has_table_privilege(current_user, 'public.audit_events', 'DELETE')) AS can_mutate_audit,
        has_table_privilege(current_user, 'public.legacy_audit_events', 'SELECT')
          AS can_select_legacy_events,
        (has_table_privilege(current_user, 'public.legacy_audit_events', 'INSERT')
          OR has_table_privilege(current_user, 'public.legacy_audit_events', 'UPDATE')
          OR has_table_privilege(current_user, 'public.legacy_audit_events', 'DELETE'))
          AS can_mutate_legacy_events,
        has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'SELECT')
          AS can_select_legacy_assessment,
        (has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'INSERT')
          OR has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'UPDATE')
          OR has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'DELETE'))
          AS can_mutate_legacy_assessment,
        (has_table_privilege(current_user, 'public.organisation_memberships', 'SELECT')
          AND has_table_privilege(current_user, 'public.organisations', 'SELECT')
          AND has_table_privilege(current_user, 'public.organisations', 'INSERT')
          AND has_table_privilege(current_user, 'public.organisation_memberships', 'INSERT')
          AND has_table_privilege(current_user, 'public.organisation_memberships', 'UPDATE')
          AND has_table_privilege(current_user, 'public.role_grants', 'SELECT')
          AND has_table_privilege(current_user, 'public.role_grants', 'INSERT')
          AND has_table_privilege(current_user, 'public.partner_relationships', 'SELECT')
          AND has_table_privilege(current_user, 'public.partner_relationships', 'INSERT')
          AND has_table_privilege(current_user, 'public.partner_relationships', 'UPDATE')
          AND has_table_privilege(current_user, 'public.break_glass_sessions', 'SELECT')
          AND has_table_privilege(current_user, 'public.break_glass_sessions', 'INSERT')
          AND has_table_privilege(current_user, 'public.break_glass_sessions', 'UPDATE'))
          AS has_required_control_plane_privileges,
        has_table_privilege(current_user, 'public.organisations', 'UPDATE')
          AS can_update_organisations,
        has_table_privilege(current_user, 'public.role_grants', 'UPDATE')
          AS can_update_role_grants,
        (has_table_privilege(current_user, 'public.organisations', 'DELETE')
          OR has_table_privilege(current_user, 'public.organisation_memberships', 'DELETE')
          OR has_table_privilege(current_user, 'public.role_grants', 'DELETE')
          OR has_table_privilege(current_user, 'public.partner_relationships', 'DELETE')
          OR has_table_privilege(current_user, 'public.break_glass_sessions', 'DELETE')
          OR has_table_privilege(current_user, 'public.users', 'DELETE'))
          AS can_delete_control_plane
      FROM pg_catalog.pg_roles AS role WHERE role.rolname=current_user
    `);
    assert.deepEqual(role.rows[0], {
      role_name: "valo_app_runtime",
      session_role_name: "valo_app_runtime",
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: true,
      rolconnlimit: -1,
      rolvaliduntil: "infinity",
      role_settings: 0,
      database_role_settings: 0,
      memberships: 0,
      owned_public_relations: 0,
      can_create_public_objects: false,
      can_set_audit_ordinal: false,
      can_select_audit: true,
      can_insert_audit: true,
      can_insert_audit_ordinal: false,
      can_mutate_audit: false,
      can_select_legacy_events: true,
      can_mutate_legacy_events: false,
      can_select_legacy_assessment: true,
      can_mutate_legacy_assessment: false,
      has_required_control_plane_privileges: true,
      can_update_organisations: false,
      can_update_role_grants: false,
      can_delete_control_plane: false,
    });
    await runtimeClient.query("BEGIN");
    assert.equal(
      Number(
        (await runtimeClient.query("SELECT count(*) FROM public.clients"))
          .rows[0].count,
      ),
      0,
    );
    await runtimeClient.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [ORGANISATION_ID],
    );
    assert.equal(
      Number(
        (await runtimeClient.query("SELECT count(*) FROM public.clients"))
          .rows[0].count,
      ),
      Number(expectedCounts.clients),
    );
    const tenantClient = await runtimeClient.query(
      "SELECT id FROM public.clients ORDER BY id LIMIT 1",
    );
    assert.equal(
      tenantClient.rowCount,
      1,
      "expected a tenant client for write proof",
    );
    assert.equal(
      (
        await runtimeClient.query(
          "UPDATE public.clients SET notes=notes WHERE id=$1::uuid",
          [tenantClient.rows[0].id],
        )
      ).rowCount,
      1,
      "same-tenant write must succeed",
    );
    await runtimeClient.query("ROLLBACK");

    // Create a second real tenant and row inside a rollback-only transaction,
    // then prove bidirectional A/B read and write isolation.
    await runtimeClient.query("BEGIN");
    await runtimeClient.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [PROOF_ORGANISATION_ID],
    );
    await runtimeClient.query(
      `INSERT INTO public.organisations
         (id, name, slug, type, status, country_code)
       VALUES ($1::uuid, 'Runtime RLS proof tenant', 'runtime-rls-proof-tenant',
         'client', 'active', 'NG')`,
      [PROOF_ORGANISATION_ID],
    );
    await runtimeClient.query(
      `INSERT INTO public.clients (id, organisation_id, name)
       VALUES ($1::uuid, $2::uuid, 'Runtime RLS proof client')`,
      [PROOF_CLIENT_ID, PROOF_ORGANISATION_ID],
    );
    assert.equal(
      (
        await runtimeClient.query(
          "UPDATE public.clients SET notes=notes WHERE id=$1::uuid",
          [PROOF_CLIENT_ID],
        )
      ).rowCount,
      1,
      "tenant B same-tenant update must succeed",
    );
    assert.equal(
      Number(
        (
          await runtimeClient.query(
            "SELECT count(*) FROM public.clients WHERE id=$1::uuid",
            [tenantClient.rows[0].id],
          )
        ).rows[0].count,
      ),
      0,
      "tenant B must not read tenant A",
    );
    assert.equal(
      (
        await runtimeClient.query(
          "UPDATE public.clients SET notes=notes WHERE id=$1::uuid",
          [tenantClient.rows[0].id],
        )
      ).rowCount,
      0,
      "tenant B must not update tenant A",
    );
    assert.equal(
      (
        await runtimeClient.query(
          "DELETE FROM public.clients WHERE id=$1::uuid",
          [tenantClient.rows[0].id],
        )
      ).rowCount,
      0,
      "tenant B must not delete tenant A",
    );
    await runtimeClient.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [ORGANISATION_ID],
    );
    assert.equal(
      Number(
        (
          await runtimeClient.query(
            "SELECT count(*) FROM public.clients WHERE id=$1::uuid",
            [PROOF_CLIENT_ID],
          )
        ).rows[0].count,
      ),
      0,
      "tenant A must not read tenant B",
    );
    assert.equal(
      (
        await runtimeClient.query(
          "UPDATE public.clients SET notes=notes WHERE id=$1::uuid",
          [PROOF_CLIENT_ID],
        )
      ).rowCount,
      0,
      "tenant A must not update tenant B",
    );
    assert.equal(
      (
        await runtimeClient.query(
          "DELETE FROM public.clients WHERE id=$1::uuid",
          [PROOF_CLIENT_ID],
        )
      ).rowCount,
      0,
      "tenant A must not delete tenant B",
    );
    await runtimeClient.query("SAVEPOINT tenant_change_check");
    let tenantChangeDenied = false;
    try {
      await runtimeClient.query(
        "UPDATE public.clients SET organisation_id=$1::uuid WHERE id=$2::uuid",
        [PROOF_ORGANISATION_ID, tenantClient.rows[0].id],
      );
    } catch (error) {
      tenantChangeDenied = error?.code === "42501";
    }
    await runtimeClient.query("ROLLBACK TO SAVEPOINT tenant_change_check");
    await runtimeClient.query("RELEASE SAVEPOINT tenant_change_check");
    assert.equal(
      tenantChangeDenied,
      true,
      "tenant A must not move a visible row into tenant B",
    );

    await runtimeClient.query("SAVEPOINT a_claims_b_check");
    let mismatchedInsertDenied = false;
    try {
      await runtimeClient.query(
        `INSERT INTO public.clients (id, organisation_id, name)
         VALUES ($1::uuid, $2::uuid, 'RLS denied proof row')`,
        [PROOF_DENIED_INSERT_ID, PROOF_ORGANISATION_ID],
      );
    } catch (error) {
      mismatchedInsertDenied = error?.code === "42501";
    }
    await runtimeClient.query("ROLLBACK TO SAVEPOINT a_claims_b_check");
    await runtimeClient.query("RELEASE SAVEPOINT a_claims_b_check");
    assert.equal(
      mismatchedInsertDenied,
      true,
      "tenant A must not insert a row claiming tenant B",
    );
    await runtimeClient.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [PROOF_ORGANISATION_ID],
    );
    await runtimeClient.query("SAVEPOINT b_claims_a_check");
    let reverseInsertDenied = false;
    try {
      await runtimeClient.query(
        `INSERT INTO public.clients (id, organisation_id, name)
         VALUES ($1::uuid, $2::uuid, 'Reverse RLS denied proof row')`,
        [PROOF_DENIED_INSERT_ID, ORGANISATION_ID],
      );
    } catch (error) {
      reverseInsertDenied = error?.code === "42501";
    }
    await runtimeClient.query("ROLLBACK TO SAVEPOINT b_claims_a_check");
    await runtimeClient.query("RELEASE SAVEPOINT b_claims_a_check");
    assert.equal(
      reverseInsertDenied,
      true,
      "tenant B must not insert a row claiming tenant A",
    );
    await runtimeClient.query("ROLLBACK");
  } finally {
    await runtimeClient.end();
  }

  const { report, reportPath } = await writeReconciliationReport({
    ownerUrl,
    expectedCounts,
    archiveDigest: auditExportSha256,
    committedActiveHead,
    legacyLineageId: manifest.legacyLineage.id,
  });
  console.log(`BRIDGE_RECONCILIATION_REPORT=${reportPath}`);
  assert.equal(
    report.allMatched,
    true,
    `post-commit reconciliation mismatch: ${JSON.stringify(
      report.tables.filter((entry) => !entry.matches),
    )}`,
  );

  console.log(
    "legacy bridge committed: archived evidence preserved; v2 boundary and runtime RLS proof passed",
  );
  console.log(
    `ACTIVE_V2_HEAD=${committedActiveHead.seq}:${committedActiveHead.hash}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      bridgeCommitted
        ? "BRIDGE_COMMITTED_POSTCHECK_FAILED: keep the application stopped; preserve evidence and choose reviewed forward repair or PITR; do not assume rollback or blindly rerun:"
        : bridgeCommitOutcomeUnknown
          ? "BRIDGE_COMMIT_OUTCOME_UNKNOWN: keep the application stopped; do not retry; reconnect with the owner credential and verify whether the target is exact legacy or completed v2.5 before a reviewed forward-repair or PITR decision:"
          : "legacy bridge transaction rolled back before commit:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}

export {
  ASSESSMENT_ID,
  BOUNDARY_ID,
  EXPECTED_POLICY_CATALOG_SHA256,
  EXPECTED_RLS_TABLE_CATALOG_SHA256,
  KNOWN_DISCONTINUITY_SEQUENCES,
  LEGACY_COLUMN_FINGERPRINT_ALGORITHM,
  LEGACY_CATALOG_DIGEST_ALGORITHM,
  LEGACY_LINEAGE_CANONICAL,
  LEGACY_LINEAGE_PRODUCTION_PUSH_MANAGED,
  LEGACY_LINEAGE_IDS,
  LEGACY_TABLES,
  LOCK_LEGACY_TABLES,
  ORGANISATION_ID,
  PAYLOAD_HASH_VERIFIED_SEQUENCES,
  SOURCE_COMMIT,
  SOURCE_DIGEST_ALGORITHM,
  auditHash,
  canonicalAuditPayload,
  checkArtifact,
  classifyLegacyColumnMap,
  classifyTarget,
  detectLegacyLineage,
  legacyColumnFingerprint,
  legacyColumnsForLineage,
  legacyCatalogDigest,
  parseRestoreManifest,
  sha256,
  sourceEvidence,
  tableDigest,
};
