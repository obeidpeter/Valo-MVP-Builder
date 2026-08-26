import { createHash } from "node:crypto";
import type pg from "pg";
import { INTAKE_FUNCTION_MANIFEST } from "./intakeFunctionManifest";

type RuntimeEnvironment = Record<string, string | undefined>;

export const TENANT_PARENT_EDGE_MANIFEST_SHA256 =
  "620cbf5d64521211dd59e8bc19128d9661b67eec8eb497eb200c8695a693c2bd";
const EXPECTED_POLICY_CATALOG_SHA256 =
  "92235aeea371cae756f06c6b9c6ec79f51515ea60825d2a3268129691950308c";
export const EXPECTED_PUBLIC_SECURITY_TRIGGER_COUNT = 168;

const EXPECTED_FORCE_RLS_TABLES = [
  "addendum_impact_assessments",
  "addendum_impact_items",
  "approvals",
  "audit_anchors",
  "audit_events",
  "authenticated_rate_limit_buckets",
  "benchmark_consents",
  "boq_checks",
  "boq_exceptions",
  "boq_runs",
  "capability_evidence_links",
  "capability_items",
  "capability_usage",
  "capability_versions",
  "claim_evidence_links",
  "clients",
  "comments",
  "conflict_records",
  "consent_records",
  "cross_border_transfers",
  "data_subject_requests",
  "defect_decisions",
  "defects",
  "deletion_certificates",
  "document_versions",
  "document_version_snapshots",
  "documents",
  "draft_claims",
  "draft_versions",
  "drafts",
  "engagement_tender_lots",
  "entitlement_usage",
  "entitlements",
  "evaluation_cases",
  "evaluation_results",
  "evaluation_runs",
  "evidence_items",
  "export_deliveries",
  "feature_flags",
  "integration_configurations",
  "integration_receipts",
  "invoice_lines",
  "invoices",
  "legal_holds",
  "legacy_audit_events",
  "legacy_audit_integrity_assessments",
  "llm_runs",
  "model_configurations",
  "nda_records",
  "notification_attempts",
  "notification_events",
  "orders",
  "outcomes",
  "package_manifest_items",
  "package_signoffs",
  "package_versions",
  "packages",
  "partner_branding",
  "partner_revenue_share_entries",
  "payments",
  "price_book_entries",
  "price_books",
  "privacy_records",
  "processing_jobs",
  "processing_runs",
  "projects",
  "prompt_configurations",
  "red_team_findings",
  "red_team_runs",
  "renewal_monitors",
  "reports",
  "requirement_citations",
  "requirements",
  "retention_actions",
  "retention_action_storage_events",
  "retention_requests",
  "reviews",
  "rule_evaluations",
  "rule_overrides",
  "sbd_annotations",
  "sbd_templates",
  "subprocessors",
  "subscriptions",
  "tender_context_artifacts",
  "tender_context_requirements",
  "tender_context_versions",
  "tender_eligibility_passports",
  "tender_lots",
  "tenders",
  "upload_sessions",
  "vault_item_versions",
  "vault_items",
  "vault_usage",
  "work_tasks",
] as const;

const EXPECTED_GLOBAL_TABLES = [
  "ai_retrieval_registry",
  "app_config",
  "benchmark_cohorts",
  "benchmark_releases",
  "break_glass_sessions",
  "jurisdiction_rule_packs",
  "jurisdiction_rules",
  "organisation_memberships",
  "organisations",
  "partner_relationships",
  "role_grants",
  "users",
] as const;

const EXPECTED_PUBLIC_TABLES = [
  ...EXPECTED_FORCE_RLS_TABLES,
  ...EXPECTED_GLOBAL_TABLES,
].sort();
const EXPECTED_FORCE_RLS_TABLE_SET = new Set<string>(EXPECTED_FORCE_RLS_TABLES);
const EXPECTED_PUBLIC_TABLE_SET = new Set<string>(EXPECTED_PUBLIC_TABLES);

type TenantParentEdgeProof = {
  child_table: string;
  child_column: string;
  parent_table: string;
  parent_column: string;
  allow_global_parent: boolean;
  guarded: boolean;
  guard_enabled: boolean;
  trigger_type: number | null;
  update_columns: string | null;
  trigger_args_hex: string | null;
  when_clause: string | null;
};

type SpecialTenantTriggerProof = {
  trigger_contract: string;
  enabled: boolean;
  trigger_type: number;
  update_columns: string;
  trigger_args_hex: string;
  when_clause: string | null;
};

export type DeliveryGuardTriggerProof = {
  relation_schema: string;
  table_name: string;
  trigger_name: string;
  trigger_enabled: string;
  trigger_type: number;
  update_columns: string;
  trigger_args_hex: string;
  when_clause: string | null;
  is_internal: boolean;
  function_schema: string;
  function_name: string;
  function_identity_arguments: string;
  function_oid_matches: boolean;
};

export type TenantGuardFunctionProof = {
  function_name: string;
  language_name: string;
  function_kind: string;
  security_definer: boolean;
  leakproof: boolean;
  strict: boolean;
  volatility: string;
  parallel_safety: string;
  function_config: string;
  returns_trigger: boolean;
  argument_count: number;
  argument_types: string;
  identity_arguments: string;
  return_type: string;
  function_result: string;
  returns_set: boolean;
  owner_name: string;
  owner_is_schema_owner?: boolean;
  runtime_can_execute: boolean;
  public_can_execute?: boolean;
  function_source: string;
};

export type DeliveryGuardFunctionProof = TenantGuardFunctionProof & {
  function_arguments: string;
  argument_default_count: number;
  owner_is_database_owner: boolean;
  owner_is_security_owner: boolean;
  execute_acl: string[];
};

type IntakeFunctionProof = TenantGuardFunctionProof & {
  owner_is_schema_owner: boolean;
  public_can_execute: boolean;
};

const EXPECTED_CONTROL_PLANE_LIMITER_FUNCTION = {
  functionName: "consume_authenticated_actor_rate_limit",
  argumentCount: 3,
  argumentTypes: "text, integer, integer",
  identityArguments:
    "p_bucket_key_sha256 text, p_window_seconds integer, p_max_requests integer",
  returnType: "record",
  functionResult:
    "TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)",
  returnsSet: true,
  securityDefiner: true,
  runtimeCanExecute: true,
  sourceSha256:
    "97f97bc16b5773684a9933bc4575916d4086dae9b352eb60d71b5c8478474030",
} as const;

const EXPECTED_AUTHENTICATED_RATE_PURGE_FUNCTION = {
  functionName: "purge_expired_authenticated_rate_limit_buckets",
  argumentCount: 0,
  argumentTypes: "",
  identityArguments: "",
  returnType: "bigint",
  functionResult: "bigint",
  returnsSet: false,
  securityDefiner: false,
  runtimeCanExecute: false,
  sourceSha256:
    "beeae6ab916be432aa0749085de35145912e9fd0d8277d186485f20c09c625bf",
} as const;

export function assertAuthenticatedRateLimitFunctionAttestation(
  functionProofs: TenantGuardFunctionProof[],
): void {
  const expectedFunctions = [
    EXPECTED_CONTROL_PLANE_LIMITER_FUNCTION,
    EXPECTED_AUTHENTICATED_RATE_PURGE_FUNCTION,
  ];
  const byName = new Map(
    functionProofs.map((proof) => [proof.function_name, proof]),
  );
  const malformed = expectedFunctions.some((expected) => {
    const actual = byName.get(expected.functionName);
    return (
      !actual ||
      actual.language_name !== "plpgsql" ||
      actual.function_kind !== "f" ||
      actual.security_definer !== expected.securityDefiner ||
      actual.leakproof ||
      actual.strict ||
      actual.volatility !== "v" ||
      actual.parallel_safety !== "u" ||
      actual.function_config !== "search_path=pg_catalog" ||
      actual.returns_trigger ||
      actual.argument_count !== expected.argumentCount ||
      actual.argument_types !== expected.argumentTypes ||
      actual.identity_arguments !== expected.identityArguments ||
      actual.return_type !== expected.returnType ||
      actual.function_result !== expected.functionResult ||
      actual.returns_set !== expected.returnsSet ||
      actual.owner_name === "valo_app_runtime" ||
      actual.owner_is_schema_owner !== true ||
      actual.runtime_can_execute !== expected.runtimeCanExecute ||
      normalizedFunctionSourceSha256(actual.function_source) !==
        expected.sourceSha256
    );
  });
  if (
    functionProofs.length !== expectedFunctions.length ||
    byName.size !== expectedFunctions.length ||
    malformed
  ) {
    throw new Error(
      "production authenticated rate-limit function catalog is drifted",
    );
  }
}

type RuntimeTablePrivilegeProof = {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_references: boolean;
  can_trigger: boolean;
};

type RuntimeColumnPrivilegeProof = {
  table_name: string;
  column_name: string;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_references: boolean;
};

type RuntimeSequencePrivilegeProof = {
  sequence_name: string;
  can_use: boolean;
  can_select: boolean;
  can_update: boolean;
};

type RuntimePolicyProof = {
  table_name: string;
  policy_name: string;
  permissive: boolean;
  command: string;
  role_names: string[];
  using_expression: string;
  check_expression: string;
};

const AUDIT_INSERT_COLUMNS = new Set([
  "id",
  "organisation_id",
  "user_id",
  "user_name",
  "project_id",
  "event_type",
  "object_type",
  "object_id",
  "details",
  "seq",
  "prev_hash",
  "hash",
  "hash_version",
  "created_at",
]);

const NO_TABLE_INSERT = new Set([
  "audit_events",
  "jurisdiction_rule_packs",
  "jurisdiction_rules",
  "legacy_audit_events",
  "legacy_audit_integrity_assessments",
]);
const NO_TABLE_UPDATE = new Set([
  "audit_events",
  "deletion_certificates",
  "document_versions",
  "jurisdiction_rule_packs",
  "jurisdiction_rules",
  "legacy_audit_events",
  "legacy_audit_integrity_assessments",
  "organisations",
  "role_grants",
  "tender_context_artifacts",
  "tender_context_requirements",
]);
const NO_TABLE_DELETE = new Set([
  "addendum_impact_assessments",
  "addendum_impact_items",
  "ai_retrieval_registry",
  "audit_events",
  "authenticated_rate_limit_buckets",
  "break_glass_sessions",
  "clients",
  "document_version_snapshots",
  "deletion_certificates",
  "jurisdiction_rule_packs",
  "jurisdiction_rules",
  "legacy_audit_events",
  "legacy_audit_integrity_assessments",
  "organisation_memberships",
  "organisations",
  "partner_relationships",
  "projects",
  "role_grants",
  "retention_actions",
  "retention_action_storage_events",
  "retention_requests",
  "tender_context_artifacts",
  "tender_context_requirements",
  "tender_context_versions",
  "tender_eligibility_passports",
  "users",
]);

const EXPECTED_SPECIAL_TENANT_TRIGGERS = new Map<string, [number, string]>([
  [
    "audit_events.audit_events_append_only:reject_active_audit_mutation",
    [27, ""],
  ],
  [
    "break_glass_sessions.tenant_break_glass_target_immutable:reject_tenant_identity_reassignment",
    [19, "target_organisation_id"],
  ],
  [
    "break_glass_sessions.tenant_control_break_glass_context:enforce_control_plane_tenant_context",
    [23, ""],
  ],
  [
    "addendum_impact_assessments.addendum_impact_assessment_content_immutable:reject_versioned_record_content_mutation",
    [
      19,
      "id,organisation_id,project_id,baseline_document_version_id,revision_document_version_id,radar_id,assessment_id,source_manifest_sha256,impact_manifest_sha256,assessment_snapshot,created_at",
    ],
  ],
  [
    "addendum_impact_assessments.addendum_impact_assessment_state_transition:enforce_governed_state_transition",
    [23, ""],
  ],
  [
    "addendum_impact_items.addendum_impact_item_content_immutable:reject_versioned_record_content_mutation",
    [
      19,
      "id,organisation_id,assessment_id,change_id,category,kind,before_text,after_text,citation_data,field_external_id,affected_object_type,affected_object_id,affected_object_version,proposed_action,created_at",
    ],
  ],
  [
    "addendum_impact_items.addendum_impact_item_state_transition:enforce_governed_state_transition",
    [23, ""],
  ],
  [
    "document_versions.document_version_content_immutable:reject_versioned_record_content_mutation",
    [
      19,
      "id,organisation_id,document_id,version_number,supersedes_version_id,object_path,sha256,detected_mime,detected_format,size_bytes,integrity_manifest,uploaded_by,created_at",
    ],
  ],
  [
    "document_version_snapshots.document_version_snapshot_content_immutable:reject_versioned_record_content_mutation",
    [
      19,
      "id,organisation_id,document_version_id,document_version_sha256,captured_redaction_status,canonical_text,canonical_text_sha256,structured_snapshot,structured_snapshot_sha256,extraction_method,parser_version,captured_by_user_id,captured_by_name,created_at",
    ],
  ],
  [
    "document_version_snapshots.document_version_snapshot_state_transition:enforce_governed_state_transition",
    [23, ""],
  ],
  [
    "deletion_certificates.deletion_certificate_completion_guard:enforce_retention_completion_transition",
    [31, ""],
  ],
  [
    "invoice_lines.tenant_derived_invoice_order:enforce_derived_tenant_relationship",
    [23, "invoice_id,order_id"],
  ],
  [
    "legacy_audit_events.legacy_audit_events_immutable:reject_legacy_audit_mutation",
    [27, ""],
  ],
  [
    "legacy_audit_integrity_assessments.legacy_audit_assessments_immutable:reject_legacy_audit_mutation",
    [27, ""],
  ],
  [
    "orders.tenant_derived_price_book_entry:enforce_derived_tenant_relationship",
    [23, "organisation_id,price_book_entry_id"],
  ],
  [
    "organisations.tenant_control_organisation_context:enforce_control_plane_tenant_context",
    [7, ""],
  ],
  [
    "organisation_memberships.tenant_membership_organisation_immutable:reject_tenant_identity_reassignment",
    [19, "organisation_id"],
  ],
  [
    "organisation_memberships.tenant_control_membership_context:enforce_control_plane_tenant_context",
    [23, ""],
  ],
  [
    "partner_relationships.tenant_derived_partner_approver:enforce_derived_tenant_relationship",
    [23, "approved_by_membership_id,status"],
  ],
  [
    "partner_relationships.tenant_partner_parties_immutable:reject_tenant_identity_reassignment",
    [19, "partner_organisation_id,client_organisation_id"],
  ],
  [
    "partner_relationships.tenant_control_partner_context:enforce_control_plane_tenant_context",
    [23, ""],
  ],
  [
    "partner_revenue_share_entries.tenant_derived_partner_revenue:enforce_derived_tenant_relationship",
    [23, "partner_organisation_id,client_organisation_id,order_id"],
  ],
  [
    "role_grants.tenant_derived_role_grant:enforce_derived_tenant_relationship",
    [7, ""],
  ],
  [
    "role_grants.tenant_role_grant_identity_immutable:reject_tenant_identity_reassignment",
    [19, "membership_id,granted_by_membership_id"],
  ],
  [
    "role_grants.tenant_control_role_grant_context:enforce_control_plane_tenant_context",
    [23, ""],
  ],
  [
    "retention_actions.retention_action_completion_guard:enforce_retention_completion_transition",
    [31, ""],
  ],
  [
    "retention_requests.retention_request_completion_guard:enforce_retention_completion_transition",
    [31, ""],
  ],
  [
    "retention_action_storage_events.retention_action_storage_event_completion_guard:enforce_retention_completion_transition",
    [31, ""],
  ],
  [
    "subscriptions.tenant_derived_price_book_entry:enforce_derived_tenant_relationship",
    [23, "organisation_id,price_book_entry_id"],
  ],
  [
    "tender_context_artifacts.tender_context_artifact_immutable:reject_versioned_record_content_mutation",
    [19, ""],
  ],
  [
    "tender_context_requirements.tender_context_requirement_immutable:reject_versioned_record_content_mutation",
    [19, ""],
  ],
  [
    "tender_context_versions.tender_context_version_content_immutable:reject_versioned_record_content_mutation",
    [
      19,
      "id,organisation_id,project_id,version_number,supersedes_context_version_id,primary_document_version_id,jurisdiction_rule_pack_id,legal_entity_name,submission_date,jurisdiction,entity_scopes,category_scopes,source_manifest,source_manifest_sha256,context_snapshot,context_sha256,rule_advisories,created_by_user_id,created_at",
    ],
  ],
  [
    "tender_context_versions.tender_context_version_state_transition:enforce_governed_state_transition",
    [23, ""],
  ],
  [
    "tender_eligibility_passports.tender_eligibility_passport_content_immutable:reject_versioned_record_content_mutation",
    [
      19,
      "id,organisation_id,project_id,tender_context_version_id,passport_id,source_manifest_sha256,result_snapshot,result_snapshot_sha256,result_status,created_by_user_id,created_at",
    ],
  ],
  [
    "tender_eligibility_passports.tender_eligibility_passport_state_transition:enforce_governed_state_transition",
    [23, ""],
  ],
]);

const EXPECTED_TENANT_GUARD_FUNCTIONS = new Map<
  string,
  {
    language: "plpgsql" | "sql";
    volatility: "i" | "s" | "v";
    parallelSafety: "s" | "u";
    returnsTrigger: boolean;
    argumentCount: number;
    argumentTypes: string;
    identityArguments: string;
    returnType: string;
    functionResult: string;
    returnsSet: boolean;
    securityDefiner?: boolean;
    ownerIsSchemaOwner?: boolean;
    publicCanExecute?: boolean;
    runtimeCanExecute: boolean;
    sourceSha256: string;
  }
>([
  [
    "current_organisation_id",
    {
      language: "sql",
      volatility: "s",
      parallelSafety: "s",
      returnsTrigger: false,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "uuid",
      functionResult: "uuid",
      returnsSet: false,
      runtimeCanExecute: true,
      sourceSha256:
        "14ef09278baa44a810e11c0e51bd46219f617a34a46c5b41786960d0fccd6be9",
    },
  ],
  [
    "enforce_control_plane_tenant_context",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "4730f140c8ceae6c51cf420fc08d0543a162d88ca25c3dfe85c8a1379bed7345",
    },
  ],
  [
    "enforce_derived_tenant_relationship",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "fb56a447849fcc09a0e9a7fa240bc47c6826b8ab6112b3b4ec5448ca3fe554b7",
    },
  ],
  [
    "enforce_governed_state_transition",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "fc3ca21f64494b959a808a781d490d04306c9acb6fcb7604692c4f3418848ce2",
    },
  ],
  [
    "enforce_retention_completion_transition",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "61009cea8a4bbbe066a3be5682fb1155503d11deff956bdb3691cac9ccb444c5",
    },
  ],
  [
    "purge_retention_project",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: false,
      argumentCount: 6,
      argumentTypes: "uuid,uuid,uuid,uuid,text,integer",
      identityArguments:
        "p_organisation_id uuid, p_retention_request_id uuid, p_retention_action_id uuid, p_subject_project_id uuid, p_source_manifest_sha256 text, p_expected_action_version integer",
      returnType: "record",
      functionResult:
        "TABLE(deleted_project_rows integer, deleted_document_version_snapshot_rows integer, detached_legal_hold_rows integer, detached_order_rows integer, detached_entitlement_usage_rows integer, purge_receipt_sha256 text, post_purge_action_version integer)",
      returnsSet: true,
      securityDefiner: true,
      ownerIsSchemaOwner: true,
      publicCanExecute: false,
      runtimeCanExecute: false,
      sourceSha256:
        "ccbb687b1cb2dd9472204fe61b7781eda749fa22671d6859963954c3ca85a8fa",
    },
  ],
  [
    "enforce_tenant_parent",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "36feb19977974453f49460dcca3c1f41204ebaae57294439508b861499832b26",
    },
  ],
  [
    "expected_tenant_parent_edges",
    {
      language: "sql",
      volatility: "i",
      parallelSafety: "u",
      returnsTrigger: false,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "record",
      functionResult:
        "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)",
      returnsSet: true,
      runtimeCanExecute: false,
      sourceSha256:
        "60114030c0143b63cdc870d34d2436f591d5f87a67a4d9dc1c810a2aa385b775",
    },
  ],
  [
    "expected_tenant_parent_edges_v10",
    {
      language: "sql",
      volatility: "i",
      parallelSafety: "u",
      returnsTrigger: false,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "record",
      functionResult:
        "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)",
      returnsSet: true,
      runtimeCanExecute: false,
      sourceSha256:
        "9a7fe7e15ae45587b7326d1d648585714ee690da0f860816da1dece2201b5768",
    },
  ],
  [
    "expected_tenant_parent_edges_v25",
    {
      language: "sql",
      volatility: "i",
      parallelSafety: "u",
      returnsTrigger: false,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "record",
      functionResult:
        "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)",
      returnsSet: true,
      runtimeCanExecute: false,
      sourceSha256:
        "bdc81a7d7148b2c016226525c3907ab30c975c59cea4e51839dad4baff842f70",
    },
  ],
  [
    "reject_versioned_record_content_mutation",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "ef751ed465bb43c61792f37d58ba9f4c8eb60f7bdbb33d1c7f5d4bec72bf028e",
    },
  ],
  [
    "reject_tenant_identity_reassignment",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "f574951920d2182028bded7bdca95912f4d775f1abab2adc621f447614217793",
    },
  ],
  [
    "reject_active_audit_mutation",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "496ccf2ad11c615af5c4bfd52b8566e3b10f94cf05919eec61588c834b380241",
    },
  ],
  [
    "reject_legacy_audit_mutation",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      returnType: "trigger",
      functionResult: "trigger",
      returnsSet: false,
      runtimeCanExecute: false,
      sourceSha256:
        "7503978cb1f4568b2eb16020769f4eb2e9444daf843c9c28c24d8c7ffda59321",
    },
  ],
  [
    "set_current_organisation_id",
    {
      language: "plpgsql",
      volatility: "v",
      parallelSafety: "u",
      returnsTrigger: false,
      argumentCount: 1,
      argumentTypes: "uuid",
      identityArguments: "p_organisation_id uuid",
      returnType: "void",
      functionResult: "void",
      returnsSet: false,
      runtimeCanExecute: true,
      sourceSha256:
        "3019b61a9be108a48506120795cb13f88ed30dd6f745f4772b11973d2764b84e",
    },
  ],
]);

function normalizedFunctionSourceSha256(source: string): string {
  return createHash("sha256")
    .update(source.replaceAll("\r\n", "\n").trim())
    .digest("hex");
}

export function assertRuntimePrivilegeAndRlsAttestation(input: {
  tables: RuntimeTablePrivilegeProof[];
  columns: RuntimeColumnPrivilegeProof[];
  sequences: RuntimeSequencePrivilegeProof[];
}): void {
  const actualTableNames = input.tables.map((table) => table.table_name);
  if (
    actualTableNames.length !== EXPECTED_PUBLIC_TABLES.length ||
    actualTableNames.some(
      (tableName, index) => tableName !== EXPECTED_PUBLIC_TABLES[index],
    )
  ) {
    throw new Error("production runtime public table inventory is drifted");
  }

  for (const table of input.tables) {
    const forceRls = EXPECTED_FORCE_RLS_TABLE_SET.has(table.table_name);
    if (
      table.rls_enabled !== forceRls ||
      table.rls_forced !== forceRls ||
      !table.can_select ||
      table.can_insert !== !NO_TABLE_INSERT.has(table.table_name) ||
      table.can_update !== !NO_TABLE_UPDATE.has(table.table_name) ||
      table.can_delete !== !NO_TABLE_DELETE.has(table.table_name) ||
      table.can_truncate ||
      table.can_references ||
      table.can_trigger
    ) {
      throw new Error(
        `production runtime table/RLS contract is drifted for ${table.table_name}`,
      );
    }
  }

  if (input.columns.length === 0) {
    throw new Error("production runtime column privilege inventory is empty");
  }
  const seenColumns = new Set<string>();
  for (const column of input.columns) {
    const columnKey = `${column.table_name}.${column.column_name}`;
    if (
      seenColumns.has(columnKey) ||
      !EXPECTED_PUBLIC_TABLE_SET.has(column.table_name)
    ) {
      throw new Error(
        "production runtime column privilege inventory is drifted",
      );
    }
    seenColumns.add(columnKey);
    const expectedInsert =
      column.table_name === "audit_events"
        ? AUDIT_INSERT_COLUMNS.has(column.column_name)
        : !NO_TABLE_INSERT.has(column.table_name);
    const expectedUpdate = !NO_TABLE_UPDATE.has(column.table_name);
    if (
      !column.can_select ||
      column.can_insert !== expectedInsert ||
      column.can_update !== expectedUpdate ||
      column.can_references
    ) {
      throw new Error(
        `production runtime column privilege contract is drifted for ${columnKey}`,
      );
    }
  }

  if (
    input.sequences.length !== 1 ||
    input.sequences[0]?.sequence_name !== "audit_events_row_no_seq" ||
    !input.sequences[0].can_use ||
    !input.sequences[0].can_select ||
    input.sequences[0].can_update
  ) {
    throw new Error(
      "production runtime sequence privilege contract is drifted",
    );
  }
}

export function assertRuntimePolicyAttestation(
  policies: RuntimePolicyProof[],
  serverVersionNumber: number,
): void {
  const independentlyAttestedTables = new Set([
    "addendum_impact_assessments",
    "addendum_impact_items",
    "authenticated_rate_limit_buckets",
    "document_version_snapshots",
    "tender_context_artifacts",
    "tender_context_requirements",
    "tender_context_versions",
    "tender_eligibility_passports",
  ]);
  const retentionCompletionIndependentlyAttestedTables = new Set([
    "retention_action_storage_events",
  ]);
  const allIndependentlyAttestedTables = new Set([
    ...independentlyAttestedTables,
    ...retentionCompletionIndependentlyAttestedTables,
  ]);
  for (const tableName of allIndependentlyAttestedTables) {
    const tablePolicies = policies.filter(
      (policy) => policy.table_name === tableName,
    );
    if (
      tablePolicies.length !== 1 ||
      tablePolicies[0]?.policy_name !== "tenant_isolation" ||
      !tablePolicies[0]?.permissive ||
      tablePolicies[0]?.command !== "*" ||
      JSON.stringify(tablePolicies[0]?.role_names) !==
        JSON.stringify(["PUBLIC"]) ||
      tablePolicies[0]?.using_expression !==
        "(organisation_id = valo_security.current_organisation_id())" ||
      tablePolicies[0]?.check_expression !==
        "(organisation_id = valo_security.current_organisation_id())"
    ) {
      throw new Error(`${tableName} RLS policy is drifted`);
    }
  }
  // Preserve the pinned v2.5 catalog proof and attest the newly introduced
  // tenant table independently. This avoids weakening the existing 104-policy
  // digest into an unpinned shape-only assertion.
  const policyLines = policies
    .filter((policy) => !allIndependentlyAttestedTables.has(policy.table_name))
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
    .sort();
  const digest = createHash("sha256")
    .update(policyLines.join("\n"))
    .digest("hex");
  if (
    Math.trunc(serverVersionNumber / 10_000) !== 16 ||
    policyLines.length !== 104 ||
    digest !== EXPECTED_POLICY_CATALOG_SHA256
  ) {
    throw new Error("production database RLS policy catalog is drifted");
  }
}

export function assertTenantGraphAttestation(input: {
  directEdges: TenantParentEdgeProof[];
  specialTriggers: SpecialTenantTriggerProof[];
  functionProofs: TenantGuardFunctionProof[];
  compositeTenantEdges: number;
  immutableArchiveExceptions: number;
  tenantParentTriggerCount: number;
}): void {
  const lines = input.directEdges
    .map(
      (edge) =>
        `${edge.child_table}.${edge.child_column}->${edge.parent_table}.${edge.parent_column}|${edge.allow_global_parent ? "global" : "strict"}`,
    )
    .sort();
  const digest = createHash("sha256").update(lines.join("\n")).digest("hex");
  const malformedDirectGuard = input.directEdges.some((edge) => {
    const expectedArgs = Buffer.from(
      `${edge.parent_table}\0${edge.parent_column}\0${edge.child_column}\0${edge.allow_global_parent ? "true" : "false"}\0`,
      "utf8",
    ).toString("hex");
    return (
      !edge.guarded ||
      !edge.guard_enabled ||
      edge.trigger_type !== 23 ||
      edge.update_columns !== `organisation_id,${edge.child_column}` ||
      edge.trigger_args_hex !== expectedArgs ||
      edge.when_clause !== null
    );
  });
  if (
    lines.length !== 118 ||
    digest !== TENANT_PARENT_EDGE_MANIFEST_SHA256 ||
    malformedDirectGuard ||
    input.compositeTenantEdges !== 0 ||
    input.immutableArchiveExceptions !== 1 ||
    input.tenantParentTriggerCount !== 118
  ) {
    throw new Error(
      "production database tenant-parent graph is not the pinned 118-edge boundary",
    );
  }

  const actualSpecial = new Map(
    input.specialTriggers.map((trigger) => [trigger.trigger_contract, trigger]),
  );
  const malformedSpecialGuard = [...EXPECTED_SPECIAL_TENANT_TRIGGERS].some(
    ([contract, [triggerType, updateColumns]]) => {
      const actual = actualSpecial.get(contract);
      return (
        !actual ||
        !actual.enabled ||
        actual.trigger_type !== triggerType ||
        actual.update_columns !== updateColumns ||
        actual.trigger_args_hex !== "" ||
        actual.when_clause !== null
      );
    },
  );
  if (
    actualSpecial.size !== EXPECTED_SPECIAL_TENANT_TRIGGERS.size ||
    malformedSpecialGuard
  ) {
    throw new Error(
      "production database derived tenant guards are incomplete or drifted",
    );
  }

  const actualFunctions = new Map(
    input.functionProofs.map((proof) => [proof.function_name, proof]),
  );
  const malformedFunction = [...EXPECTED_TENANT_GUARD_FUNCTIONS].some(
    ([functionName, expected]) => {
      const actual = actualFunctions.get(functionName);
      return (
        !actual ||
        actual.language_name !== expected.language ||
        actual.function_kind !== "f" ||
        actual.security_definer !== (expected.securityDefiner ?? false) ||
        actual.leakproof ||
        actual.strict ||
        actual.volatility !== expected.volatility ||
        actual.parallel_safety !== expected.parallelSafety ||
        actual.function_config !== "search_path=pg_catalog" ||
        actual.returns_trigger !== expected.returnsTrigger ||
        actual.argument_count !== expected.argumentCount ||
        actual.argument_types !== expected.argumentTypes ||
        actual.identity_arguments !== expected.identityArguments ||
        actual.return_type !== expected.returnType ||
        actual.function_result !== expected.functionResult ||
        actual.returns_set !== expected.returnsSet ||
        actual.owner_name === "valo_app_runtime" ||
        (expected.ownerIsSchemaOwner !== undefined &&
          actual.owner_is_schema_owner !== expected.ownerIsSchemaOwner) ||
        (expected.publicCanExecute !== undefined &&
          actual.public_can_execute !== expected.publicCanExecute) ||
        actual.runtime_can_execute !== expected.runtimeCanExecute ||
        normalizedFunctionSourceSha256(actual.function_source) !==
          expected.sourceSha256
      );
    },
  );
  if (
    input.functionProofs.length !== EXPECTED_TENANT_GUARD_FUNCTIONS.size ||
    actualFunctions.size !== EXPECTED_TENANT_GUARD_FUNCTIONS.size ||
    malformedFunction
  ) {
    throw new Error(
      "production database tenant guard functions are semantically drifted",
    );
  }
}

const DELIVERY_SOURCE_GUARD_TABLES = [
  "boq_checks",
  "claim_evidence_links",
  "defects",
  "document_version_snapshots",
  "document_versions",
  "documents",
  "draft_claims",
  "draft_versions",
  "drafts",
  "evidence_items",
  "red_team_findings",
  "red_team_runs",
  "requirements",
  "reviews",
] as const;

const EXPECTED_DELIVERY_GUARD_TRIGGERS = new Map<
  string,
  { functionName: string; triggerType: number }
>([
  ...DELIVERY_SOURCE_GUARD_TABLES.map(
    (tableName) =>
      [
        `public.${tableName}.delivery_source_project_guard`,
        {
          functionName: "valo_guard_delivery_source_mutation",
          // BEFORE ROW INSERT OR DELETE OR UPDATE.
          triggerType: 31,
        },
      ] as const,
  ),
  [
    "public.projects.delivery_project_delete_guard",
    {
      functionName: "valo_guard_delivery_project_delete",
      // BEFORE ROW DELETE.
      triggerType: 11,
    },
  ],
]);

export function assertDeliveryGuardTriggerAttestation(
  triggerProofs: DeliveryGuardTriggerProof[],
): void {
  const actualTriggers = new Map(
    triggerProofs.map((proof) => [
      `${proof.relation_schema}.${proof.table_name}.${proof.trigger_name}`,
      proof,
    ]),
  );
  const malformedTrigger = [...EXPECTED_DELIVERY_GUARD_TRIGGERS].some(
    ([triggerContract, expected]) => {
      const actual = actualTriggers.get(triggerContract);
      return (
        !actual ||
        actual.trigger_enabled !== "O" ||
        actual.trigger_type !== expected.triggerType ||
        actual.update_columns !== "" ||
        actual.trigger_args_hex !== "" ||
        actual.when_clause !== null ||
        actual.is_internal ||
        actual.function_schema !== "public" ||
        actual.function_name !== expected.functionName ||
        actual.function_identity_arguments !== "" ||
        actual.function_oid_matches !== true
      );
    },
  );
  if (
    triggerProofs.length !== EXPECTED_DELIVERY_GUARD_TRIGGERS.size ||
    actualTriggers.size !== EXPECTED_DELIVERY_GUARD_TRIGGERS.size ||
    malformedTrigger
  ) {
    throw new Error(
      "production database delivery guard triggers are incomplete or drifted",
    );
  }
}

/**
 * The 0012 delivery-source release-boundary functions live in the public
 * schema (their trigger bodies call each other schema-qualified), so they sit
 * outside the valo_security function inventory. This map pins them
 * independently: exact catalog shape, normalized source, ownership shared by
 * the database owner and pinned security-function owner, and a canonical ACL
 * with runtime execute only on the two helpers the SECURITY INVOKER trigger
 * bodies call as the mutating role (0013 grants). The two trigger entry points
 * stay owner-only — trigger EXECUTE is checked at CREATE TRIGGER time, never
 * at fire time.
 */
const EXPECTED_DELIVERY_GUARD_FUNCTIONS = new Map<
  string,
  {
    volatility: "i" | "s" | "v";
    returnsTrigger: boolean;
    argumentCount: number;
    argumentTypes: string;
    identityArguments: string;
    functionArguments: string;
    argumentDefaultCount: number;
    returnType: string;
    functionResult: string;
    runtimeCanExecute: boolean;
    sourceSha256: string;
  }
>([
  [
    "valo_assert_delivery_project_mutable",
    {
      volatility: "v",
      returnsTrigger: false,
      argumentCount: 2,
      argumentTypes: "uuid,boolean",
      identityArguments:
        "source_project_id uuid, allow_terminal_delete boolean",
      functionArguments:
        "source_project_id uuid, allow_terminal_delete boolean DEFAULT false",
      argumentDefaultCount: 1,
      returnType: "void",
      functionResult: "void",
      runtimeCanExecute: true,
      sourceSha256:
        "801194e9255d427a046c45b2fb19f8c2e614c2741f17bb916260aab21d845a03",
    },
  ],
  [
    "valo_delivery_source_project_id",
    {
      volatility: "s",
      returnsTrigger: false,
      argumentCount: 2,
      argumentTypes: "name,jsonb",
      identityArguments: "source_table name, source_row jsonb",
      functionArguments: "source_table name, source_row jsonb",
      argumentDefaultCount: 0,
      returnType: "uuid",
      functionResult: "uuid",
      runtimeCanExecute: true,
      sourceSha256:
        "55426212117c41dadee7bdcd167e42540b14232fe1082b31078d8ea12899e718",
    },
  ],
  [
    "valo_guard_delivery_project_delete",
    {
      volatility: "v",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      functionArguments: "",
      argumentDefaultCount: 0,
      returnType: "trigger",
      functionResult: "trigger",
      runtimeCanExecute: false,
      sourceSha256:
        "a8767b19436393b9ce44077499a16f6899b4400d3b69757dd997b12c49a24b79",
    },
  ],
  [
    "valo_guard_delivery_source_mutation",
    {
      volatility: "v",
      returnsTrigger: true,
      argumentCount: 0,
      argumentTypes: "",
      identityArguments: "",
      functionArguments: "",
      argumentDefaultCount: 0,
      returnType: "trigger",
      functionResult: "trigger",
      runtimeCanExecute: false,
      sourceSha256:
        "ac6770b6382e6f74a793d8901dde97f6a0a7212e75b600ade35ab3a61415d6eb",
    },
  ],
]);

export function assertDeliveryGuardFunctionAttestation(
  functionProofs: DeliveryGuardFunctionProof[],
): void {
  const actualFunctions = new Map(
    functionProofs.map((proof) => [proof.function_name, proof]),
  );
  const malformedFunction = [...EXPECTED_DELIVERY_GUARD_FUNCTIONS].some(
    ([functionName, expected]) => {
      const actual = actualFunctions.get(functionName);
      const expectedExecuteAcl = [
        "$OWNER>$OWNER:EXECUTE:f",
        ...(expected.runtimeCanExecute
          ? ["$OWNER>$ROLE:valo_app_runtime:EXECUTE:f"]
          : []),
      ].sort();
      return (
        !actual ||
        actual.language_name !== "plpgsql" ||
        actual.function_kind !== "f" ||
        actual.security_definer ||
        actual.leakproof ||
        actual.strict ||
        actual.volatility !== expected.volatility ||
        actual.parallel_safety !== "u" ||
        actual.function_config !== "search_path=pg_catalog, public" ||
        actual.returns_trigger !== expected.returnsTrigger ||
        actual.argument_count !== expected.argumentCount ||
        actual.argument_types !== expected.argumentTypes ||
        actual.identity_arguments !== expected.identityArguments ||
        actual.function_arguments !== expected.functionArguments ||
        actual.argument_default_count !== expected.argumentDefaultCount ||
        actual.return_type !== expected.returnType ||
        actual.function_result !== expected.functionResult ||
        actual.returns_set ||
        actual.owner_name === "valo_app_runtime" ||
        actual.owner_is_database_owner !== true ||
        actual.owner_is_security_owner !== true ||
        actual.public_can_execute !== false ||
        actual.runtime_can_execute !== expected.runtimeCanExecute ||
        actual.execute_acl.length !== expectedExecuteAcl.length ||
        [...actual.execute_acl]
          .sort()
          .some((grant, index) => grant !== expectedExecuteAcl[index]) ||
        normalizedFunctionSourceSha256(actual.function_source) !==
          expected.sourceSha256
      );
    },
  );
  if (
    functionProofs.length !== EXPECTED_DELIVERY_GUARD_FUNCTIONS.size ||
    actualFunctions.size !== EXPECTED_DELIVERY_GUARD_FUNCTIONS.size ||
    malformedFunction
  ) {
    throw new Error(
      "production database delivery guard functions are semantically drifted",
    );
  }
}

export function assertIntakeFunctionAttestation(
  functionProofs: IntakeFunctionProof[],
): void {
  const actualFunctions = new Map(
    functionProofs.map((proof) => [proof.function_name, proof]),
  );
  const malformedFunction = [...INTAKE_FUNCTION_MANIFEST].some(
    ([functionName, expected]) => {
      const actual = actualFunctions.get(functionName);
      return (
        !actual ||
        actual.language_name !== "plpgsql" ||
        actual.function_kind !== "f" ||
        !actual.security_definer ||
        actual.leakproof ||
        actual.strict ||
        actual.volatility !== "v" ||
        actual.parallel_safety !== "u" ||
        actual.function_config !== "search_path=pg_catalog" ||
        actual.returns_trigger ||
        actual.argument_count !== expected.argumentCount ||
        actual.argument_types !== expected.argumentTypes ||
        actual.return_type !== expected.returnType ||
        actual.function_result !== expected.functionResult ||
        actual.returns_set !== expected.returnsSet ||
        actual.owner_name === "valo_app_runtime" ||
        !actual.owner_is_schema_owner ||
        actual.public_can_execute ||
        actual.runtime_can_execute !== expected.runtimeCanExecute ||
        normalizedFunctionSourceSha256(actual.function_source) !==
          expected.sourceSha256
      );
    },
  );
  if (
    functionProofs.length !== INTAKE_FUNCTION_MANIFEST.size ||
    actualFunctions.size !== INTAKE_FUNCTION_MANIFEST.size ||
    malformedFunction
  ) {
    throw new Error("production database intake function catalog is drifted");
  }
}

export function isProductionRuntime(environment: RuntimeEnvironment): boolean {
  if (
    environment.REPLIT_DEPLOYMENT === "1" &&
    environment.NODE_ENV !== "production"
  ) {
    throw new Error(
      "Replit deployments require NODE_ENV=production before database startup",
    );
  }
  return (
    environment.NODE_ENV === "production" ||
    environment.REPLIT_DEPLOYMENT === "1"
  );
}

export function selectDatabaseConnectionString(
  environment: RuntimeEnvironment,
): string {
  const ownerUrl = environment.DATABASE_URL?.trim();
  if (!isProductionRuntime(environment)) {
    if (!ownerUrl) throw new Error("DATABASE_URL must be set");
    return ownerUrl;
  }

  const runtimeUrl = environment.VALO_RUNTIME_DATABASE_URL?.trim();
  if (!runtimeUrl) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL is required in production; DATABASE_URL is migration-owner only",
    );
  }
  if (ownerUrl && runtimeUrl === ownerUrl) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL must not reuse the migration-owner DATABASE_URL",
    );
  }
  if (!ownerUrl) {
    throw new Error(
      "DATABASE_URL is required in production for runtime-target attestation",
    );
  }
  let ownerTarget: URL;
  let runtimeTarget: URL;
  try {
    ownerTarget = new URL(ownerUrl);
    runtimeTarget = new URL(runtimeUrl);
  } catch {
    throw new Error("production database URL is malformed");
  }
  if (
    !["postgres:", "postgresql:"].includes(ownerTarget.protocol) ||
    !["postgres:", "postgresql:"].includes(runtimeTarget.protocol)
  ) {
    throw new Error("production database URL must use the PostgreSQL protocol");
  }
  if (ownerTarget.hash || runtimeTarget.hash) {
    throw new Error("production database URL must not contain a fragment");
  }
  for (const candidate of [ownerTarget, runtimeTarget]) {
    for (const key of ["user", "username", "password"]) {
      if (candidate.searchParams.has(key)) {
        throw new Error(
          "production database credentials must be carried only in URL userinfo",
        );
      }
    }
  }
  ownerTarget.username = "";
  ownerTarget.password = "";
  runtimeTarget.username = "";
  runtimeTarget.password = "";
  if (ownerTarget.href !== runtimeTarget.href) {
    throw new Error(
      "VALO_RUNTIME_DATABASE_URL must preserve the managed target and TLS parameters",
    );
  }
  return runtimeUrl;
}

/** Fail before listen if the production pool can bypass tenant enforcement. */
export async function assertProductionRuntimeDatabaseSafety(
  pool: pg.Pool,
  environment: RuntimeEnvironment,
): Promise<void> {
  if (!isProductionRuntime(environment)) return;

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const ambientPath = await client.query<{
      explicit_schemas: string[];
      implicit_schemas: string[];
    }>(`
      SELECT pg_catalog.current_schemas(false)::pg_catalog.text[]
          AS explicit_schemas,
        pg_catalog.current_schemas(true)::pg_catalog.text[]
          AS implicit_schemas
    `);
    if (
      JSON.stringify(ambientPath.rows[0]?.explicit_schemas) !==
        JSON.stringify(["public"]) ||
      JSON.stringify(ambientPath.rows[0]?.implicit_schemas) !==
        JSON.stringify(["pg_catalog", "public"])
    ) {
      throw new Error("production runtime search_path is not exactly public");
    }
    await client.query("SET LOCAL search_path=pg_catalog");
    const result = await client.query<{
      role_name: string;
      session_role_name: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      rolinherit: boolean;
      rolconnlimit: number;
      rolvaliduntil: string | null;
      role_settings: number;
      database_role_settings: number;
      inherited_memberships: string;
      owned_public_relations: string;
      forced_rls_tables: string;
      policies: string;
      can_mutate_active_audit: boolean;
      can_insert_active_audit: boolean;
      can_insert_audit_ordinal: boolean;
      can_select_active_audit: boolean;
      can_select_legacy_events: boolean;
      can_select_legacy_assessment: boolean;
      can_mutate_legacy_events: boolean;
      can_mutate_legacy_assessment: boolean;
      can_create_public_objects: boolean;
      can_set_audit_ordinal: boolean;
      session_replication_role: string;
      row_security: string;
      server_version_number: number;
      can_create_database_objects: boolean;
      can_create_valo_security_objects: boolean;
      can_create_valo_intake_objects: boolean;
      can_create_drizzle_objects: boolean;
      can_use_public_schema: boolean;
      can_use_valo_security_schema: boolean;
      can_use_valo_intake_schema: boolean;
      can_use_drizzle_schema: boolean;
      can_execute_current_organisation: boolean;
      can_execute_set_current_organisation: boolean;
      can_execute_store_bid_autopsy_request: boolean;
      can_execute_consume_bid_autopsy_rate_limit: boolean;
      can_execute_list_bid_autopsy_work_queue: boolean;
      can_execute_transition_bid_autopsy_work_queue: boolean;
      can_execute_get_bid_autopsy_contact_handoff: boolean;
      can_execute_purge_bid_autopsy_requests: boolean;
      can_execute_purge_bid_autopsy_rate_limits: boolean;
      can_execute_purge_authenticated_rate_limit_buckets: boolean;
      can_access_bid_autopsy_request_table: boolean;
      can_access_bid_autopsy_rate_limit_table: boolean;
      can_access_bid_autopsy_request_columns: boolean;
      can_access_bid_autopsy_rate_limit_columns: boolean;
      can_access_authenticated_actor_rate_limit_table: boolean;
      can_access_authenticated_actor_rate_limit_columns: boolean;
      public_can_access_authenticated_actor_rate_limit_table: boolean;
      public_can_access_authenticated_actor_rate_limit_columns: boolean;
      authenticated_actor_rate_limit_owner_is_schema_owner: boolean;
      owned_database: string;
      owned_security_schemas: string;
      owned_security_relations: string;
      owned_security_functions: string;
      owned_security_types: string;
      creatable_non_system_schemas: string;
      has_required_control_plane_privileges: boolean;
      can_update_organisations: boolean;
      can_update_role_grants: boolean;
      can_delete_control_plane: boolean;
    }>(`
      SELECT
        current_user AS role_name,
        session_user AS session_role_name,
        role.rolsuper,
        role.rolbypassrls,
        role.rolcanlogin,
        role.rolcreaterole,
        role.rolcreatedb,
        role.rolreplication,
        role.rolinherit,
        role.rolconnlimit,
        role.rolvaliduntil::text AS rolvaliduntil,
        COALESCE(pg_catalog.cardinality(role.rolconfig),0)::integer
          AS role_settings,
        (SELECT count(*)::integer FROM pg_catalog.pg_db_role_setting
         WHERE setrole=role.oid) AS database_role_settings,
        (SELECT count(*)::text FROM pg_catalog.pg_auth_members membership
         WHERE membership.member=role.oid) AS inherited_memberships,
        (SELECT count(*)::text FROM pg_catalog.pg_class owned
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=owned.relnamespace
         WHERE namespace.nspname='public' AND owned.relowner=role.oid)
          AS owned_public_relations,
        (SELECT count(*)::text
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname='public' AND relation.relrowsecurity
           AND relation.relforcerowsecurity) AS forced_rls_tables,
        (SELECT count(*)::text FROM pg_catalog.pg_policies WHERE schemaname='public') AS policies,
        (pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
          OR pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'DELETE'))
          AS can_mutate_active_audit,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(ARRAY[
            'id','organisation_id','user_id','user_name','project_id','event_type',
            'object_type','object_id','details','seq','prev_hash','hash',
            'hash_version','created_at'
          ]) AS required_columns(column_name)
          WHERE NOT pg_catalog.has_column_privilege(
            current_user, 'public.audit_events', column_name, 'INSERT'
          )
        ) AS can_insert_active_audit,
        pg_catalog.has_column_privilege(
          current_user, 'public.audit_events', 'row_no', 'INSERT'
        ) AS can_insert_audit_ordinal,
        pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'SELECT')
          AS can_select_active_audit,
        pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'SELECT')
          AS can_select_legacy_events,
        pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'SELECT')
          AS can_select_legacy_assessment,
        (pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'INSERT')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'UPDATE')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_events', 'DELETE'))
          AS can_mutate_legacy_events,
        (pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'INSERT')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'UPDATE')
          OR pg_catalog.has_table_privilege(current_user, 'public.legacy_audit_integrity_assessments', 'DELETE'))
          AS can_mutate_legacy_assessment,
        pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
          AS can_create_public_objects,
        pg_catalog.has_sequence_privilege(
          current_user, 'public.audit_events_row_no_seq', 'UPDATE'
        ) AS can_set_audit_ordinal,
        pg_catalog.current_setting('session_replication_role')
          AS session_replication_role,
        pg_catalog.current_setting('row_security') AS row_security,
        pg_catalog.current_setting('server_version_num')::integer
          AS server_version_number,
        pg_catalog.has_database_privilege(
          current_user, pg_catalog.current_database(), 'CREATE'
        ) AS can_create_database_objects,
        pg_catalog.has_schema_privilege(
          current_user, 'valo_security', 'CREATE'
        ) AS can_create_valo_security_objects,
        pg_catalog.has_schema_privilege(
          current_user, 'valo_intake', 'CREATE'
        ) AS can_create_valo_intake_objects,
        pg_catalog.has_schema_privilege(
          current_user, 'drizzle', 'CREATE'
        ) AS can_create_drizzle_objects,
        pg_catalog.has_schema_privilege(current_user,'public','USAGE')
          AS can_use_public_schema,
        pg_catalog.has_schema_privilege(current_user,'valo_security','USAGE')
          AS can_use_valo_security_schema,
        pg_catalog.has_schema_privilege(current_user,'valo_intake','USAGE')
          AS can_use_valo_intake_schema,
        pg_catalog.has_schema_privilege(current_user,'drizzle','USAGE')
          AS can_use_drizzle_schema,
        pg_catalog.has_function_privilege(
          current_user,'valo_security.current_organisation_id()','EXECUTE'
        ) AS can_execute_current_organisation,
        pg_catalog.has_function_privilege(
          current_user,'valo_security.set_current_organisation_id(uuid)','EXECUTE'
        ) AS can_execute_set_current_organisation,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.store_bid_autopsy_request(text,text,text,text,text,text,text,text,date,text,text,integer)',
          'EXECUTE'
        ) AS can_execute_store_bid_autopsy_request,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.consume_bid_autopsy_rate_limit(text,integer,integer)',
          'EXECUTE'
        ) AS can_execute_consume_bid_autopsy_rate_limit,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.list_bid_autopsy_work_queue(integer)',
          'EXECUTE'
        ) AS can_execute_list_bid_autopsy_work_queue,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.transition_bid_autopsy_work_queue(uuid,text,text)',
          'EXECUTE'
        ) AS can_execute_transition_bid_autopsy_work_queue,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.get_bid_autopsy_contact_handoff(uuid)',
          'EXECUTE'
        ) AS can_execute_get_bid_autopsy_contact_handoff,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.purge_expired_bid_autopsy_requests()',
          'EXECUTE'
        ) AS can_execute_purge_bid_autopsy_requests,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_intake.purge_expired_bid_autopsy_rate_limits()',
          'EXECUTE'
        ) AS can_execute_purge_bid_autopsy_rate_limits,
        pg_catalog.has_function_privilege(
          current_user,
          'valo_security.purge_expired_authenticated_rate_limit_buckets()',
          'EXECUTE'
        ) AS can_execute_purge_authenticated_rate_limit_buckets,
        (
          pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','SELECT'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','INSERT'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','UPDATE'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','DELETE'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','TRUNCATE'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','REFERENCES'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_requests','TRIGGER'
          )
        ) AS can_access_bid_autopsy_request_table,
        (
          pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','SELECT'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','INSERT'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','UPDATE'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','DELETE'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','TRUNCATE'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','REFERENCES'
          ) OR pg_catalog.has_table_privilege(
            current_user,'valo_intake.bid_autopsy_rate_limits','TRIGGER'
          )
        ) AS can_access_bid_autopsy_rate_limit_table,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS intake_column
          WHERE intake_column.attrelid =
            'valo_intake.bid_autopsy_requests'::pg_catalog.regclass
            AND intake_column.attnum > 0
            AND NOT intake_column.attisdropped
            AND (
              pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'SELECT'
              ) OR pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'INSERT'
              ) OR pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'UPDATE'
              ) OR pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'REFERENCES'
              )
            )
        ) AS can_access_bid_autopsy_request_columns,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS intake_column
          WHERE intake_column.attrelid =
            'valo_intake.bid_autopsy_rate_limits'::pg_catalog.regclass
            AND intake_column.attnum > 0
            AND NOT intake_column.attisdropped
            AND (
              pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'SELECT'
              ) OR pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'INSERT'
              ) OR pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'UPDATE'
              ) OR pg_catalog.has_column_privilege(
                current_user,intake_column.attrelid,intake_column.attnum,'REFERENCES'
              )
            )
        ) AS can_access_bid_autopsy_rate_limit_columns,
        (
          pg_catalog.has_table_privilege(
            current_user,
            'valo_security.authenticated_actor_rate_limit_buckets',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
        ) AS can_access_authenticated_actor_rate_limit_table,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS actor_limit_column
          WHERE actor_limit_column.attrelid =
              'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
            AND actor_limit_column.attnum > 0
            AND NOT actor_limit_column.attisdropped
            AND (
              pg_catalog.has_column_privilege(
                current_user,actor_limit_column.attrelid,
                actor_limit_column.attnum,'SELECT'
              ) OR pg_catalog.has_column_privilege(
                current_user,actor_limit_column.attrelid,
                actor_limit_column.attnum,'INSERT'
              ) OR pg_catalog.has_column_privilege(
                current_user,actor_limit_column.attrelid,
                actor_limit_column.attnum,'UPDATE'
              ) OR pg_catalog.has_column_privilege(
                current_user,actor_limit_column.attrelid,
                actor_limit_column.attnum,'REFERENCES'
              )
            )
        ) AS can_access_authenticated_actor_rate_limit_columns,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS actor_limit_relation
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              actor_limit_relation.relacl,
              pg_catalog.acldefault('r',actor_limit_relation.relowner)
            )
          ) AS actor_limit_acl
          WHERE actor_limit_relation.oid =
              'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
            AND actor_limit_acl.grantee = 0
            AND actor_limit_acl.privilege_type IN (
              'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
            )
        ) AS public_can_access_authenticated_actor_rate_limit_table,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS actor_limit_column
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            actor_limit_column.attacl
          ) AS actor_limit_acl
          WHERE actor_limit_column.attrelid =
              'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
            AND actor_limit_column.attnum > 0
            AND NOT actor_limit_column.attisdropped
            AND actor_limit_acl.grantee = 0
            AND actor_limit_acl.privilege_type IN (
              'SELECT','INSERT','UPDATE','REFERENCES'
            )
        ) AS public_can_access_authenticated_actor_rate_limit_columns,
        (
          SELECT relation.relowner=namespace.nspowner
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid=relation.relnamespace
          WHERE relation.oid =
            'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
        ) AS authenticated_actor_rate_limit_owner_is_schema_owner,
        (SELECT count(*)::text
         FROM pg_catalog.pg_database AS database_record
         WHERE database_record.datname=pg_catalog.current_database()
           AND database_record.datdba=role.oid) AS owned_database,
        (SELECT count(*)::text
         FROM pg_catalog.pg_namespace AS namespace
         WHERE namespace.nspname !~ '^pg_'
           AND namespace.nspname<>'information_schema'
           AND namespace.nspowner=role.oid) AS owned_security_schemas,
        (SELECT count(*)::text
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid=relation.relnamespace
         WHERE namespace.nspname !~ '^pg_'
           AND namespace.nspname<>'information_schema'
           AND relation.relowner=role.oid) AS owned_security_relations,
        (SELECT count(*)::text
         FROM pg_catalog.pg_proc AS routine
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid=routine.pronamespace
         WHERE namespace.nspname !~ '^pg_'
           AND namespace.nspname<>'information_schema'
           AND routine.proowner=role.oid) AS owned_security_functions,
        (SELECT count(*)::text
         FROM pg_catalog.pg_type AS type_record
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid=type_record.typnamespace
         WHERE namespace.nspname !~ '^pg_'
           AND namespace.nspname<>'information_schema'
           AND type_record.typowner=role.oid) AS owned_security_types,
        (SELECT count(*)::text
         FROM pg_catalog.pg_namespace AS namespace
         WHERE namespace.nspname !~ '^pg_'
           AND namespace.nspname<>'information_schema'
           AND pg_catalog.has_schema_privilege(
             current_user,namespace.oid,'CREATE'
           )) AS creatable_non_system_schemas,
        (
          pg_catalog.has_table_privilege(
            current_user, 'public.organisations', 'SELECT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.organisations', 'INSERT'
          )
          AND
          pg_catalog.has_table_privilege(
            current_user, 'public.organisation_memberships', 'SELECT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.organisation_memberships', 'INSERT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.organisation_memberships', 'UPDATE'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.role_grants', 'SELECT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.role_grants', 'INSERT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.partner_relationships', 'SELECT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.partner_relationships', 'INSERT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.partner_relationships', 'UPDATE'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.break_glass_sessions', 'SELECT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.break_glass_sessions', 'INSERT'
          )
          AND pg_catalog.has_table_privilege(
            current_user, 'public.break_glass_sessions', 'UPDATE'
          )
        ) AS has_required_control_plane_privileges,
        pg_catalog.has_table_privilege(
          current_user, 'public.organisations', 'UPDATE'
        ) AS can_update_organisations,
        pg_catalog.has_table_privilege(
          current_user, 'public.role_grants', 'UPDATE'
        ) AS can_update_role_grants,
        (
          pg_catalog.has_table_privilege(
            current_user, 'public.organisations', 'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            current_user, 'public.organisation_memberships', 'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            current_user, 'public.role_grants', 'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            current_user, 'public.partner_relationships', 'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            current_user, 'public.break_glass_sessions', 'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            current_user, 'public.users', 'DELETE'
          )
        ) AS can_delete_control_plane
      FROM pg_catalog.pg_roles role
      WHERE role.rolname=current_user
    `);
    const proof = result.rows[0];
    if (
      !proof ||
      proof.role_name !== "valo_app_runtime" ||
      proof.session_role_name !== "valo_app_runtime"
    ) {
      throw new Error(
        "production database must authenticate as valo_app_runtime",
      );
    }
    if (
      proof.rolsuper ||
      proof.rolbypassrls ||
      !proof.rolcanlogin ||
      proof.rolcreaterole ||
      proof.rolcreatedb ||
      proof.rolreplication ||
      !proof.rolinherit ||
      proof.rolconnlimit !== -1 ||
      proof.rolvaliduntil !== "infinity" ||
      proof.role_settings !== 0 ||
      proof.database_role_settings !== 0 ||
      Number(proof.inherited_memberships) !== 0 ||
      Number(proof.owned_public_relations) !== 0
    ) {
      throw new Error(
        "production database role must be NOSUPERUSER NOBYPASSRLS",
      );
    }
    if (
      Number(proof.forced_rls_tables) !== 94 ||
      Number(proof.policies) !== 113
    ) {
      throw new Error(
        "production database RLS catalog is not the retention-completion boundary (94/113)",
      );
    }
    if (
      !proof.can_insert_active_audit ||
      proof.can_insert_audit_ordinal ||
      !proof.can_select_active_audit ||
      !proof.can_select_legacy_events ||
      !proof.can_select_legacy_assessment ||
      proof.can_mutate_active_audit ||
      proof.can_mutate_legacy_events ||
      proof.can_mutate_legacy_assessment ||
      proof.can_create_public_objects ||
      proof.can_set_audit_ordinal ||
      proof.session_replication_role !== "origin" ||
      proof.row_security !== "on" ||
      proof.can_create_database_objects ||
      proof.can_create_valo_security_objects ||
      proof.can_create_valo_intake_objects ||
      proof.can_create_drizzle_objects ||
      !proof.can_use_public_schema ||
      !proof.can_use_valo_security_schema ||
      !proof.can_use_valo_intake_schema ||
      proof.can_use_drizzle_schema ||
      !proof.can_execute_current_organisation ||
      !proof.can_execute_set_current_organisation ||
      !proof.can_execute_store_bid_autopsy_request ||
      !proof.can_execute_consume_bid_autopsy_rate_limit ||
      !proof.can_execute_list_bid_autopsy_work_queue ||
      !proof.can_execute_transition_bid_autopsy_work_queue ||
      !proof.can_execute_get_bid_autopsy_contact_handoff ||
      proof.can_execute_purge_bid_autopsy_requests ||
      proof.can_execute_purge_bid_autopsy_rate_limits ||
      proof.can_execute_purge_authenticated_rate_limit_buckets ||
      proof.can_access_bid_autopsy_request_table ||
      proof.can_access_bid_autopsy_rate_limit_table ||
      proof.can_access_bid_autopsy_request_columns ||
      proof.can_access_bid_autopsy_rate_limit_columns ||
      proof.can_access_authenticated_actor_rate_limit_table ||
      proof.can_access_authenticated_actor_rate_limit_columns ||
      proof.public_can_access_authenticated_actor_rate_limit_table ||
      proof.public_can_access_authenticated_actor_rate_limit_columns ||
      !proof.authenticated_actor_rate_limit_owner_is_schema_owner ||
      Number(proof.owned_database) !== 0 ||
      Number(proof.owned_security_schemas) !== 0 ||
      Number(proof.owned_security_relations) !== 0 ||
      Number(proof.owned_security_functions) !== 0 ||
      Number(proof.owned_security_types) !== 0 ||
      Number(proof.creatable_non_system_schemas) !== 0
    ) {
      throw new Error(
        "production runtime has forbidden audit mutation privileges",
      );
    }
    if (
      !proof.has_required_control_plane_privileges ||
      proof.can_update_organisations ||
      proof.can_update_role_grants ||
      proof.can_delete_control_plane
    ) {
      throw new Error(
        "production runtime control-plane privileges are incomplete or excessive",
      );
    }

    const tablePrivileges = await client.query<RuntimeTablePrivilegeProof>(`
      SELECT relation.relname::text AS table_name,
        relation.relrowsecurity AS rls_enabled,
        relation.relforcerowsecurity AS rls_forced,
        pg_catalog.has_table_privilege(current_user,relation.oid,'SELECT')
          AS can_select,
        pg_catalog.has_table_privilege(current_user,relation.oid,'INSERT')
          AS can_insert,
        pg_catalog.has_table_privilege(current_user,relation.oid,'UPDATE')
          AS can_update,
        pg_catalog.has_table_privilege(current_user,relation.oid,'DELETE')
          AS can_delete,
        pg_catalog.has_table_privilege(current_user,relation.oid,'TRUNCATE')
          AS can_truncate,
        pg_catalog.has_table_privilege(current_user,relation.oid,'REFERENCES')
          AS can_references,
        pg_catalog.has_table_privilege(current_user,relation.oid,'TRIGGER')
          AS can_trigger
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
      ORDER BY table_name
    `);
    const columnPrivileges = await client.query<RuntimeColumnPrivilegeProof>(`
      SELECT relation.relname::text AS table_name,
        attribute.attname::text AS column_name,
        pg_catalog.has_column_privilege(
          current_user,relation.oid,attribute.attnum,'SELECT'
        ) AS can_select,
        pg_catalog.has_column_privilege(
          current_user,relation.oid,attribute.attnum,'INSERT'
        ) AS can_insert,
        pg_catalog.has_column_privilege(
          current_user,relation.oid,attribute.attnum,'UPDATE'
        ) AS can_update,
        pg_catalog.has_column_privilege(
          current_user,relation.oid,attribute.attnum,'REFERENCES'
        ) AS can_references
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid=relation.oid
       AND attribute.attnum>0
       AND NOT attribute.attisdropped
      WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
      ORDER BY table_name,attribute.attnum
    `);
    const sequencePrivileges =
      await client.query<RuntimeSequencePrivilegeProof>(`
      SELECT relation.relname::text AS sequence_name,
        pg_catalog.has_sequence_privilege(current_user,relation.oid,'USAGE')
          AS can_use,
        pg_catalog.has_sequence_privilege(current_user,relation.oid,'SELECT')
          AS can_select,
        pg_catalog.has_sequence_privilege(current_user,relation.oid,'UPDATE')
          AS can_update
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='public' AND relation.relkind='S'
      ORDER BY sequence_name
    `);
    assertRuntimePrivilegeAndRlsAttestation({
      tables: tablePrivileges.rows,
      columns: columnPrivileges.rows,
      sequences: sequencePrivileges.rows,
    });
    const policies = await client.query<RuntimePolicyProof>(`
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
    assertRuntimePolicyAttestation(policies.rows, proof.server_version_number);

    const directEdges = await client.query<TenantParentEdgeProof>(`
      WITH tenant_edges AS (
        SELECT
          child_relation.oid AS child_oid,
          child_relation.relname::text AS child_table,
          child_key.attname::text AS child_column,
          parent_relation.relname::text AS parent_table,
          parent_key.attname::text AS parent_column,
          child_relation.relname IN ('evaluation_runs','processing_runs')
            AND child_key.attname='prompt_configuration_id'
            AND parent_relation.relname='prompt_configurations'
              AS allow_global_parent
        FROM pg_catalog.pg_constraint AS constraint_record
        JOIN pg_catalog.pg_class AS child_relation
          ON child_relation.oid=constraint_record.conrelid
        JOIN pg_catalog.pg_namespace AS child_namespace
          ON child_namespace.oid=child_relation.relnamespace
        JOIN pg_catalog.pg_class AS parent_relation
          ON parent_relation.oid=constraint_record.confrelid
        JOIN pg_catalog.pg_namespace AS parent_namespace
          ON parent_namespace.oid=parent_relation.relnamespace
        JOIN pg_catalog.pg_attribute AS child_key
          ON child_key.attrelid=child_relation.oid
         AND child_key.attnum=constraint_record.conkey[1]
        JOIN pg_catalog.pg_attribute AS parent_key
          ON parent_key.attrelid=parent_relation.oid
         AND parent_key.attnum=constraint_record.confkey[1]
        WHERE constraint_record.contype='f'
          AND pg_catalog.cardinality(constraint_record.conkey)=1
          AND pg_catalog.cardinality(constraint_record.confkey)=1
          AND child_namespace.nspname='public'
          AND parent_namespace.nspname='public'
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute AS child_organisation
            WHERE child_organisation.attrelid=child_relation.oid
              AND child_organisation.attname='organisation_id'
              AND NOT child_organisation.attisdropped
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute AS parent_organisation
            WHERE parent_organisation.attrelid=parent_relation.oid
              AND parent_organisation.attname='organisation_id'
              AND NOT parent_organisation.attisdropped
          )
      )
      SELECT edge.child_table, edge.child_column, edge.parent_table,
        edge.parent_column, edge.allow_global_parent,
        guard.oid IS NOT NULL AS guarded,
        guard.tgenabled='O' AS guard_enabled,
        guard.tgtype::integer AS trigger_type,
        (
          SELECT pg_catalog.string_agg(attribute.attname, ',' ORDER BY selected.ordinality)
          FROM pg_catalog.unnest(guard.tgattr::smallint[]) WITH ORDINALITY
            AS selected(attnum, ordinality)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid=guard.tgrelid
           AND attribute.attnum=selected.attnum
        ) AS update_columns,
        pg_catalog.encode(guard.tgargs,'hex') AS trigger_args_hex,
        pg_catalog.pg_get_expr(guard.tgqual,guard.tgrelid) AS when_clause
      FROM tenant_edges AS edge
      LEFT JOIN pg_catalog.pg_trigger AS guard
        ON guard.tgrelid=edge.child_oid
       AND guard.tgname=pg_catalog.left('tenant_parent_' || edge.child_column,63)
       AND guard.tgfoid='valo_security.enforce_tenant_parent()'::pg_catalog.regprocedure
       AND NOT guard.tgisinternal
      WHERE NOT (
        edge.child_table='legacy_audit_events'
        AND edge.child_column='assessment_id'
        AND edge.parent_table='legacy_audit_integrity_assessments'
        AND edge.parent_column='id'
      )
      ORDER BY edge.child_table, edge.child_column, edge.parent_table
    `);
    const graphSummary = await client.query<{
      composite_tenant_edges: number;
      immutable_archive_exceptions: number;
      tenant_parent_trigger_count: number;
      public_security_trigger_count: number;
      valo_security_function_count: number;
    }>(`
      SELECT
        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_constraint AS constraint_record
          JOIN pg_catalog.pg_class AS child_relation
            ON child_relation.oid=constraint_record.conrelid
          JOIN pg_catalog.pg_namespace AS child_namespace
            ON child_namespace.oid=child_relation.relnamespace
          JOIN pg_catalog.pg_class AS parent_relation
            ON parent_relation.oid=constraint_record.confrelid
          JOIN pg_catalog.pg_namespace AS parent_namespace
            ON parent_namespace.oid=parent_relation.relnamespace
          WHERE constraint_record.contype='f'
            AND child_namespace.nspname='public'
            AND parent_namespace.nspname='public'
            AND (
              pg_catalog.cardinality(constraint_record.conkey)<>1
              OR pg_catalog.cardinality(constraint_record.confkey)<>1
            )
            AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_attribute AS child_organisation
              WHERE child_organisation.attrelid=child_relation.oid
                AND child_organisation.attname='organisation_id'
                AND NOT child_organisation.attisdropped
            )
            AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_attribute AS parent_organisation
              WHERE parent_organisation.attrelid=parent_relation.oid
                AND parent_organisation.attname='organisation_id'
                AND NOT parent_organisation.attisdropped
            )
        ) AS composite_tenant_edges,
        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_constraint AS constraint_record
          WHERE constraint_record.contype='f'
            AND constraint_record.conrelid='public.legacy_audit_events'::pg_catalog.regclass
            AND constraint_record.confrelid=
              'public.legacy_audit_integrity_assessments'::pg_catalog.regclass
            AND constraint_record.conkey=ARRAY[
              (
                SELECT attnum FROM pg_catalog.pg_attribute
                WHERE attrelid='public.legacy_audit_events'::pg_catalog.regclass
                  AND attname='assessment_id'
              )::smallint
            ]
            AND constraint_record.confkey=ARRAY[
              (
                SELECT attnum FROM pg_catalog.pg_attribute
                WHERE attrelid=
                  'public.legacy_audit_integrity_assessments'::pg_catalog.regclass
                  AND attname='id'
              )::smallint
            ]
        ) AS immutable_archive_exceptions,
        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_trigger AS guard
          WHERE guard.tgfoid=
            'valo_security.enforce_tenant_parent()'::pg_catalog.regprocedure
            AND NOT guard.tgisinternal
        ) AS tenant_parent_trigger_count,
        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_trigger AS guard
          JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname='public' AND NOT guard.tgisinternal
        ) AS public_security_trigger_count,
        (
          SELECT count(*)::integer
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid=routine.pronamespace
          WHERE namespace.nspname='valo_security'
        ) AS valo_security_function_count
    `);
    const specialTriggers = await client.query<SpecialTenantTriggerProof>(`
      SELECT relation.relname || '.' || guard.tgname || ':' || guard_function.proname
          AS trigger_contract,
        guard.tgenabled='O' AS enabled,
        guard.tgtype::integer AS trigger_type,
        COALESCE((
          SELECT pg_catalog.string_agg(attribute.attname, ',' ORDER BY selected.ordinality)
          FROM pg_catalog.unnest(guard.tgattr::smallint[]) WITH ORDINALITY
            AS selected(attnum, ordinality)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid=guard.tgrelid
           AND attribute.attnum=selected.attnum
        ), '') AS update_columns,
        pg_catalog.encode(guard.tgargs,'hex') AS trigger_args_hex,
        pg_catalog.pg_get_expr(guard.tgqual,guard.tgrelid) AS when_clause
      FROM pg_catalog.pg_trigger AS guard
      JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
      JOIN pg_catalog.pg_namespace AS relation_namespace
        ON relation_namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_proc AS guard_function ON guard_function.oid=guard.tgfoid
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid=guard_function.pronamespace
      WHERE relation_namespace.nspname='public'
        AND function_namespace.nspname='valo_security'
        AND guard_function.proname IN (
          'enforce_control_plane_tenant_context',
          'enforce_derived_tenant_relationship',
          'enforce_governed_state_transition',
          'enforce_retention_completion_transition',
          'reject_active_audit_mutation',
          'reject_legacy_audit_mutation',
          'reject_versioned_record_content_mutation',
          'reject_tenant_identity_reassignment'
        )
        AND NOT guard.tgisinternal
      ORDER BY trigger_contract
    `);
    const deliveryGuardTriggerProofs =
      await client.query<DeliveryGuardTriggerProof>(`
      SELECT relation_namespace.nspname::text AS relation_schema,
        relation.relname::text AS table_name,
        guard.tgname::text AS trigger_name,
        guard.tgenabled::text AS trigger_enabled,
        guard.tgtype::integer AS trigger_type,
        COALESCE((
          SELECT pg_catalog.string_agg(
            attribute.attname,',' ORDER BY selected.ordinality
          )
          FROM pg_catalog.unnest(guard.tgattr::smallint[]) WITH ORDINALITY
            AS selected(attnum,ordinality)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid=guard.tgrelid
           AND attribute.attnum=selected.attnum
        ),'') AS update_columns,
        pg_catalog.encode(guard.tgargs,'hex') AS trigger_args_hex,
        pg_catalog.pg_get_expr(guard.tgqual,guard.tgrelid,false)
          AS when_clause,
        guard.tgisinternal AS is_internal,
        function_namespace.nspname::text AS function_schema,
        guard_function.proname::text AS function_name,
        pg_catalog.pg_get_function_identity_arguments(guard_function.oid)
          AS function_identity_arguments,
        guard.tgfoid=(CASE
          WHEN guard.tgname='delivery_project_delete_guard'
            THEN pg_catalog.to_regprocedure(
              'public.valo_guard_delivery_project_delete()'
            )
          WHEN guard.tgname='delivery_source_project_guard'
            THEN pg_catalog.to_regprocedure(
              'public.valo_guard_delivery_source_mutation()'
            )
          ELSE NULL
        END) AS function_oid_matches
      FROM pg_catalog.pg_trigger AS guard
      JOIN pg_catalog.pg_class AS relation ON relation.oid=guard.tgrelid
      JOIN pg_catalog.pg_namespace AS relation_namespace
        ON relation_namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_proc AS guard_function ON guard_function.oid=guard.tgfoid
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid=guard_function.pronamespace
      WHERE relation_namespace.nspname='public'
        AND guard.tgname IN (
          'delivery_project_delete_guard',
          'delivery_source_project_guard'
        )
      ORDER BY relation_schema,table_name,trigger_name
    `);
    const functionProofs = await client.query<TenantGuardFunctionProof>(`
      SELECT guard_function.proname::text AS function_name,
        language.lanname::text AS language_name,
        guard_function.prokind::text AS function_kind,
        guard_function.prosecdef AS security_definer,
        guard_function.proleakproof AS leakproof,
        guard_function.proisstrict AS strict,
        guard_function.provolatile::text AS volatility,
        guard_function.proparallel::text AS parallel_safety,
        COALESCE(pg_catalog.array_to_string(guard_function.proconfig,','),'')
          AS function_config,
        guard_function.prorettype='pg_catalog.trigger'::pg_catalog.regtype
          AS returns_trigger,
        guard_function.pronargs::integer AS argument_count,
        COALESCE((
          SELECT pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid,NULL),
            ',' ORDER BY argument_type.ordinality
          )
          FROM pg_catalog.unnest(guard_function.proargtypes::oid[])
            WITH ORDINALITY AS argument_type(type_oid,ordinality)
        ), '') AS argument_types,
        pg_catalog.pg_get_function_identity_arguments(guard_function.oid)
          AS identity_arguments,
        pg_catalog.format_type(guard_function.prorettype,NULL) AS return_type,
        pg_catalog.pg_get_function_result(guard_function.oid) AS function_result,
        guard_function.proretset AS returns_set,
        pg_catalog.pg_get_userbyid(guard_function.proowner) AS owner_name,
        guard_function.proowner=function_namespace.nspowner
          AS owner_is_schema_owner,
        pg_catalog.has_function_privilege(
          current_user,guard_function.oid,'EXECUTE'
        ) AS runtime_can_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              guard_function.proacl,
              pg_catalog.acldefault('f',guard_function.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee=0
            AND function_acl.privilege_type='EXECUTE'
        ) AS public_can_execute,
        guard_function.prosrc AS function_source
      FROM pg_catalog.pg_proc AS guard_function
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid=guard_function.pronamespace
      JOIN pg_catalog.pg_language AS language
        ON language.oid=guard_function.prolang
      WHERE function_namespace.nspname='valo_security'
        AND guard_function.proname IN (
          'current_organisation_id',
          'enforce_control_plane_tenant_context',
          'enforce_derived_tenant_relationship',
          'enforce_governed_state_transition',
          'enforce_retention_completion_transition',
          'enforce_tenant_parent',
          'expected_tenant_parent_edges',
          'expected_tenant_parent_edges_v10',
          'expected_tenant_parent_edges_v25',
          'purge_retention_project',
          'reject_versioned_record_content_mutation',
          'reject_active_audit_mutation',
          'reject_legacy_audit_mutation',
          'reject_tenant_identity_reassignment',
          'set_current_organisation_id'
        )
      ORDER BY function_name
    `);
    const deliveryGuardFunctionProofs =
      await client.query<DeliveryGuardFunctionProof>(`
      SELECT guard_function.proname::text AS function_name,
        language.lanname::text AS language_name,
        guard_function.prokind::text AS function_kind,
        guard_function.prosecdef AS security_definer,
        guard_function.proleakproof AS leakproof,
        guard_function.proisstrict AS strict,
        guard_function.provolatile::text AS volatility,
        guard_function.proparallel::text AS parallel_safety,
        COALESCE(pg_catalog.array_to_string(guard_function.proconfig,','),'')
          AS function_config,
        guard_function.prorettype='pg_catalog.trigger'::pg_catalog.regtype
          AS returns_trigger,
        guard_function.pronargs::integer AS argument_count,
        COALESCE((
          SELECT pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid,NULL),
            ',' ORDER BY argument_type.ordinality
          )
          FROM pg_catalog.unnest(guard_function.proargtypes::oid[])
            WITH ORDINALITY AS argument_type(type_oid,ordinality)
        ), '') AS argument_types,
        pg_catalog.pg_get_function_identity_arguments(guard_function.oid)
          AS identity_arguments,
        pg_catalog.pg_get_function_arguments(guard_function.oid)
          AS function_arguments,
        guard_function.pronargdefaults::integer AS argument_default_count,
        pg_catalog.format_type(guard_function.prorettype,NULL) AS return_type,
        pg_catalog.pg_get_function_result(guard_function.oid) AS function_result,
        guard_function.proretset AS returns_set,
        pg_catalog.pg_get_userbyid(guard_function.proowner) AS owner_name,
        guard_function.proowner=(
          SELECT database_record.datdba
          FROM pg_catalog.pg_database AS database_record
          WHERE database_record.datname=pg_catalog.current_database()
        ) AS owner_is_database_owner,
        guard_function.proowner=(
          SELECT retention_purge.proowner
          FROM pg_catalog.pg_proc AS retention_purge
          WHERE retention_purge.oid=pg_catalog.to_regprocedure(
            'valo_security.purge_retention_project(uuid,uuid,uuid,uuid,text,integer)'
          )
            AND retention_purge.prosecdef
        ) AS owner_is_security_owner,
        pg_catalog.has_function_privilege(
          current_user,guard_function.oid,'EXECUTE'
        ) AS runtime_can_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              guard_function.proacl,
              pg_catalog.acldefault('f',guard_function.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee=0
            AND function_acl.privilege_type='EXECUTE'
        ) AS public_can_execute,
        ARRAY(
          SELECT pg_catalog.format(
            '%s>%s:%s:%s',
            CASE
              WHEN function_acl.grantor=guard_function.proowner THEN '$OWNER'
              ELSE '$ROLE:' ||
                pg_catalog.pg_get_userbyid(function_acl.grantor)
            END,
            CASE
              WHEN function_acl.grantee=0 THEN '$PUBLIC'
              WHEN function_acl.grantee=guard_function.proowner THEN '$OWNER'
              ELSE '$ROLE:' ||
                pg_catalog.pg_get_userbyid(function_acl.grantee)
            END,
            function_acl.privilege_type,
            function_acl.is_grantable
          )
          FROM pg_catalog.aclexplode(
            COALESCE(
              guard_function.proacl,
              pg_catalog.acldefault('f',guard_function.proowner)
            )
          ) AS function_acl
          ORDER BY function_acl.grantor,function_acl.grantee,
            function_acl.privilege_type,function_acl.is_grantable
        ) AS execute_acl,
        guard_function.prosrc AS function_source
      FROM pg_catalog.pg_proc AS guard_function
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid=guard_function.pronamespace
      JOIN pg_catalog.pg_language AS language
        ON language.oid=guard_function.prolang
      WHERE function_namespace.nspname='public'
        AND guard_function.proname IN (
          'valo_assert_delivery_project_mutable',
          'valo_delivery_source_project_id',
          'valo_guard_delivery_project_delete',
          'valo_guard_delivery_source_mutation'
        )
      ORDER BY function_name
    `);
    const intakeFunctionProofs = await client.query<IntakeFunctionProof>(`
      SELECT intake_function.proname::text AS function_name,
        language.lanname::text AS language_name,
        intake_function.prokind::text AS function_kind,
        intake_function.prosecdef AS security_definer,
        intake_function.proleakproof AS leakproof,
        intake_function.proisstrict AS strict,
        intake_function.provolatile::text AS volatility,
        intake_function.proparallel::text AS parallel_safety,
        COALESCE(pg_catalog.array_to_string(intake_function.proconfig,','),'')
          AS function_config,
        intake_function.prorettype='pg_catalog.trigger'::pg_catalog.regtype
          AS returns_trigger,
        intake_function.pronargs::integer AS argument_count,
        COALESCE((
          SELECT pg_catalog.string_agg(
            pg_catalog.format_type(argument_type.type_oid,NULL),
            ',' ORDER BY argument_type.ordinality
          )
          FROM pg_catalog.unnest(intake_function.proargtypes::oid[])
            WITH ORDINALITY AS argument_type(type_oid,ordinality)
        ), '') AS argument_types,
        pg_catalog.pg_get_function_identity_arguments(intake_function.oid)
          AS identity_arguments,
        pg_catalog.format_type(intake_function.prorettype,NULL) AS return_type,
        pg_catalog.pg_get_function_result(intake_function.oid) AS function_result,
        intake_function.proretset AS returns_set,
        pg_catalog.pg_get_userbyid(intake_function.proowner) AS owner_name,
        intake_function.proowner=intake_namespace.nspowner
          AS owner_is_schema_owner,
        pg_catalog.has_function_privilege(
          current_user,intake_function.oid,'EXECUTE'
        ) AS runtime_can_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              intake_function.proacl,
              pg_catalog.acldefault('f',intake_function.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee=0
            AND function_acl.privilege_type='EXECUTE'
        ) AS public_can_execute,
        intake_function.prosrc AS function_source
      FROM pg_catalog.pg_proc AS intake_function
      JOIN pg_catalog.pg_namespace AS intake_namespace
        ON intake_namespace.oid=intake_function.pronamespace
      JOIN pg_catalog.pg_language AS language
        ON language.oid=intake_function.prolang
      WHERE intake_namespace.nspname='valo_intake'
      ORDER BY function_name
    `);
    const authenticatedRateLimitFunctionProofs =
      await client.query<TenantGuardFunctionProof>(`
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
          pg_catalog.pg_get_userbyid(routine.proowner) AS owner_name,
          routine.proowner=namespace.nspowner AS owner_is_schema_owner,
          pg_catalog.has_function_privilege(current_user,routine.oid,'EXECUTE')
            AS runtime_can_execute,
          routine.prosrc AS function_source
        FROM pg_catalog.pg_proc AS routine
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid=routine.pronamespace
        JOIN pg_catalog.pg_language AS language ON language.oid=routine.prolang
        WHERE namespace.nspname='valo_security'
          AND routine.proname IN (
            'consume_authenticated_actor_rate_limit',
            'purge_expired_authenticated_rate_limit_buckets'
          )
        ORDER BY function_name
      `);
    const graph = graphSummary.rows[0];
    assertTenantGraphAttestation({
      directEdges: directEdges.rows,
      specialTriggers: specialTriggers.rows,
      functionProofs: functionProofs.rows,
      compositeTenantEdges: graph?.composite_tenant_edges ?? -1,
      immutableArchiveExceptions: graph?.immutable_archive_exceptions ?? -1,
      tenantParentTriggerCount: graph?.tenant_parent_trigger_count ?? -1,
    });
    assertDeliveryGuardTriggerAttestation(deliveryGuardTriggerProofs.rows);
    assertDeliveryGuardFunctionAttestation(deliveryGuardFunctionProofs.rows);
    assertIntakeFunctionAttestation(intakeFunctionProofs.rows);
    assertAuthenticatedRateLimitFunctionAttestation(
      authenticatedRateLimitFunctionProofs.rows,
    );
    if (
      graph?.public_security_trigger_count !==
        EXPECTED_PUBLIC_SECURITY_TRIGGER_COUNT ||
      graph.valo_security_function_count !== 17
    ) {
      throw new Error(
        "production database security routine/trigger inventory is drifted",
      );
    }
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
