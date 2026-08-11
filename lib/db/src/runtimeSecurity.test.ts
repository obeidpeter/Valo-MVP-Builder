import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  assertIntakeFunctionAttestation,
  assertTenantGraphAttestation,
  assertRuntimePolicyAttestation,
  isProductionRuntime,
  selectDatabaseConnectionString,
} from "./runtimeSecurity";

const SPECIAL_TENANT_TRIGGERS = [
  [
    "audit_events.audit_events_append_only:reject_active_audit_mutation",
    27,
    "",
  ],
  [
    "break_glass_sessions.tenant_break_glass_target_immutable:reject_tenant_identity_reassignment",
    19,
    "target_organisation_id",
  ],
  [
    "break_glass_sessions.tenant_control_break_glass_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "invoice_lines.tenant_derived_invoice_order:enforce_derived_tenant_relationship",
    23,
    "invoice_id,order_id",
  ],
  [
    "legacy_audit_events.legacy_audit_events_immutable:reject_legacy_audit_mutation",
    27,
    "",
  ],
  [
    "legacy_audit_integrity_assessments.legacy_audit_assessments_immutable:reject_legacy_audit_mutation",
    27,
    "",
  ],
  [
    "orders.tenant_derived_price_book_entry:enforce_derived_tenant_relationship",
    23,
    "organisation_id,price_book_entry_id",
  ],
  [
    "organisations.tenant_control_organisation_context:enforce_control_plane_tenant_context",
    7,
    "",
  ],
  [
    "organisation_memberships.tenant_membership_organisation_immutable:reject_tenant_identity_reassignment",
    19,
    "organisation_id",
  ],
  [
    "organisation_memberships.tenant_control_membership_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "partner_relationships.tenant_derived_partner_approver:enforce_derived_tenant_relationship",
    23,
    "approved_by_membership_id,status",
  ],
  [
    "partner_relationships.tenant_partner_parties_immutable:reject_tenant_identity_reassignment",
    19,
    "partner_organisation_id,client_organisation_id",
  ],
  [
    "partner_relationships.tenant_control_partner_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "partner_revenue_share_entries.tenant_derived_partner_revenue:enforce_derived_tenant_relationship",
    23,
    "partner_organisation_id,client_organisation_id,order_id",
  ],
  [
    "role_grants.tenant_derived_role_grant:enforce_derived_tenant_relationship",
    7,
    "",
  ],
  [
    "role_grants.tenant_role_grant_identity_immutable:reject_tenant_identity_reassignment",
    19,
    "membership_id,granted_by_membership_id",
  ],
  [
    "role_grants.tenant_control_role_grant_context:enforce_control_plane_tenant_context",
    23,
    "",
  ],
  [
    "subscriptions.tenant_derived_price_book_entry:enforce_derived_tenant_relationship",
    23,
    "organisation_id,price_book_entry_id",
  ],
].map(([trigger_contract, trigger_type, update_columns]) => ({
  trigger_contract: String(trigger_contract),
  enabled: true,
  trigger_type: Number(trigger_type),
  update_columns: String(update_columns),
  trigger_args_hex: "",
  when_clause: null,
}));
const migration = readFileSync(
  new URL("../migrations/0002_audit_integrity_boundary.sql", import.meta.url),
  "utf8",
);
const tenantRlsMigration = readFileSync(
  new URL("../migrations/0001_tenant_rls.sql", import.meta.url),
  "utf8",
);
const runtimeSecuritySource = readFileSync(
  new URL("./runtimeSecurity.ts", import.meta.url),
  "utf8",
);
const intakeLimiterMigration = readFileSync(
  new URL("../migrations/0004_dizzy_virginia_dare.sql", import.meta.url),
  "utf8",
);
const intakeRetentionMigration = readFileSync(
  new URL("../migrations/0005_tranquil_jack_power.sql", import.meta.url),
  "utf8",
);
const intakeOperationsMigration = readFileSync(
  new URL("../migrations/0006_lead_operations_queue.sql", import.meta.url),
  "utf8",
);

function intakeFunctionSource(migration: string, functionName: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION "valo_intake"\\."${functionName}"\\([\\s\\S]*?AS \\$function\\$\\r?\\n([\\s\\S]*?)\\r?\\n\\$function\\$;`,
    ),
  );
  assert.ok(match?.[1], `missing ${functionName} migration body`);
  return match[1];
}

function migrationIntakeFunctions() {
  const common = {
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: true,
    leakproof: false,
    strict: false,
    volatility: "v",
    parallel_safety: "u",
    function_config: "search_path=pg_catalog",
    returns_trigger: false,
    owner_name: "database_owner",
    owner_is_schema_owner: true,
    public_can_execute: false,
  };
  return [
    {
      ...common,
      function_name: "consume_bid_autopsy_rate_limit",
      argument_count: 3,
      argument_types: "text,integer,integer",
      identity_arguments:
        "p_client_key_hash text, p_window_seconds integer, p_max_requests integer",
      return_type: "record",
      function_result:
        "TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)",
      returns_set: true,
      runtime_can_execute: true,
      function_source: intakeFunctionSource(
        intakeLimiterMigration,
        "consume_bid_autopsy_rate_limit",
      ),
    },
    {
      ...common,
      function_name: "get_bid_autopsy_contact_handoff",
      argument_count: 1,
      argument_types: "uuid",
      identity_arguments: "p_request_id uuid",
      return_type: "record",
      function_result:
        "TABLE(request_id uuid, contact_name text, preferred_contact_method text, contact_value text)",
      returns_set: true,
      runtime_can_execute: true,
      function_source: intakeFunctionSource(
        intakeOperationsMigration,
        "get_bid_autopsy_contact_handoff",
      ),
    },
    {
      ...common,
      function_name: "list_bid_autopsy_work_queue",
      argument_count: 1,
      argument_types: "integer",
      identity_arguments: "p_limit integer",
      return_type: "record",
      function_result:
        "TABLE(request_id uuid, organisation_label text, tender_category text, bid_stage text, tender_deadline date, delivery_status text, received_at timestamp with time zone)",
      returns_set: true,
      runtime_can_execute: true,
      function_source: intakeFunctionSource(
        intakeOperationsMigration,
        "list_bid_autopsy_work_queue",
      ),
    },
    {
      ...common,
      function_name: "purge_expired_bid_autopsy_rate_limits",
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "integer",
      function_result: "integer",
      returns_set: false,
      runtime_can_execute: false,
      function_source: intakeFunctionSource(
        intakeRetentionMigration,
        "purge_expired_bid_autopsy_rate_limits",
      ),
    },
    {
      ...common,
      function_name: "purge_expired_bid_autopsy_requests",
      argument_count: 0,
      argument_types: "",
      identity_arguments: "",
      return_type: "integer",
      function_result: "integer",
      returns_set: false,
      runtime_can_execute: false,
      function_source: intakeFunctionSource(
        intakeRetentionMigration,
        "purge_expired_bid_autopsy_requests",
      ),
    },
    {
      ...common,
      function_name: "store_bid_autopsy_request",
      argument_count: 12,
      argument_types:
        "text,text,text,text,text,text,text,text,date,text,text,integer",
      identity_arguments:
        "p_idempotency_key_hash text, p_payload_fingerprint text, p_contact_name text, p_company_name text, p_business_email text, p_business_telephone text, p_tender_category text, p_bid_stage text, p_tender_deadline date, p_preferred_contact_method text, p_privacy_notice_version text, p_retention_days integer",
      return_type: "record",
      function_result:
        "TABLE(request_id uuid, received_at timestamp with time zone, replayed boolean, payload_matches boolean)",
      returns_set: true,
      runtime_can_execute: true,
      function_source: intakeFunctionSource(
        intakeRetentionMigration,
        "store_bid_autopsy_request",
      ),
    },
    {
      ...common,
      function_name: "transition_bid_autopsy_work_queue",
      argument_count: 3,
      argument_types: "uuid,text,text",
      identity_arguments:
        "p_request_id uuid, p_expected_status text, p_next_status text",
      return_type: "uuid",
      function_result: "TABLE(request_id uuid)",
      returns_set: true,
      runtime_can_execute: true,
      function_source: intakeFunctionSource(
        intakeOperationsMigration,
        "transition_bid_autopsy_work_queue",
      ),
    },
  ];
}

function migrationTenantEdges() {
  const start = migration.indexOf(
    "CREATE OR REPLACE FUNCTION valo_security.expected_tenant_parent_edges()",
  );
  const end = migration.indexOf("$function$;", start);
  assert(start >= 0 && end > start);
  return [
    ...migration
      .slice(start, end)
      .matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)',(true|false)\)/g),
  ].map((match) => ({
    child_table: match[1]!,
    child_column: match[2]!,
    parent_table: match[3]!,
    parent_column: match[4]!,
    allow_global_parent: match[5] === "true",
    guarded: true,
    guard_enabled: true,
    trigger_type: 23,
    update_columns: `organisation_id,${match[2]!}`,
    trigger_args_hex: Buffer.from(
      `${match[3]!}\0${match[4]!}\0${match[2]!}\0${match[5] === "true" ? "true" : "false"}\0`,
      "utf8",
    ).toString("hex"),
    when_clause: null,
  }));
}

function migrationTenantGuardFunctions() {
  const contracts = [
    ["current_organisation_id", "sql", "s", "s", false, 0, "", "uuid"],
    [
      "enforce_control_plane_tenant_context",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "enforce_derived_tenant_relationship",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    ["enforce_tenant_parent", "plpgsql", "v", "u", true, 0, "", "trigger"],
    ["expected_tenant_parent_edges", "sql", "i", "u", false, 0, "", "record"],
    [
      "reject_tenant_identity_reassignment",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "reject_active_audit_mutation",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "reject_legacy_audit_mutation",
      "plpgsql",
      "v",
      "u",
      true,
      0,
      "",
      "trigger",
    ],
    [
      "set_current_organisation_id",
      "plpgsql",
      "v",
      "u",
      false,
      1,
      "uuid",
      "void",
    ],
  ] as const;
  return contracts.map(
    ([
      function_name,
      language_name,
      volatility,
      parallel_safety,
      returns_trigger,
      argument_count,
      argument_types,
      return_type,
    ]) => {
      const sourceMigration = function_name.endsWith("organisation_id")
        ? tenantRlsMigration
        : migration;
      const start = sourceMigration.indexOf(
        `CREATE OR REPLACE FUNCTION valo_security.${function_name}()`,
      );
      const signatureStart =
        start >= 0
          ? start
          : sourceMigration.indexOf(
              `CREATE OR REPLACE FUNCTION valo_security.${function_name}(`,
            );
      const sourceStart = sourceMigration.indexOf(
        "AS $function$",
        signatureStart,
      );
      const sourceEnd = sourceMigration.indexOf("$function$;", sourceStart);
      assert(
        signatureStart >= 0 &&
          sourceStart > signatureStart &&
          sourceEnd > sourceStart,
      );
      return {
        function_name,
        language_name,
        function_kind: "f",
        security_definer: false,
        leakproof: false,
        strict: false,
        volatility,
        parallel_safety,
        function_config: "search_path=pg_catalog",
        returns_trigger,
        argument_count,
        argument_types,
        identity_arguments:
          function_name === "set_current_organisation_id"
            ? "p_organisation_id uuid"
            : "",
        return_type,
        function_result:
          function_name === "expected_tenant_parent_edges"
            ? "TABLE(child_table text, child_column text, parent_table text, parent_column text, allow_global_parent boolean)"
            : return_type,
        returns_set: function_name === "expected_tenant_parent_edges",
        owner_name: "synthetic_migration_owner",
        runtime_can_execute: [
          "current_organisation_id",
          "set_current_organisation_id",
        ].includes(function_name),
        function_source: sourceMigration.slice(
          sourceStart + "AS $function$".length,
          sourceEnd,
        ),
      };
    },
  );
}

describe("production database selection", () => {
  test("uses DATABASE_URL only outside production", () => {
    assert.equal(
      selectDatabaseConnectionString({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://owner:secret@example.test/valo",
      }),
      "postgresql://owner:secret@example.test/valo",
    );
  });

  test("requires the dedicated runtime URL in production", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://owner:secret@example.test/valo",
        }),
      /VALO_RUNTIME_DATABASE_URL is required/,
    );
  });

  test("rejects a Replit deployment without NODE_ENV=production", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          REPLIT_DEPLOYMENT: "1",
          DATABASE_URL: "postgresql://owner:secret@example.test/valo",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo",
        }),
      /require NODE_ENV=production/,
    );
  });

  test("recognises a correctly configured Replit deployment", () => {
    const environment = {
      NODE_ENV: "production",
      REPLIT_DEPLOYMENT: "1",
      DATABASE_URL: "postgresql://owner:secret@example.test/valo",
      VALO_RUNTIME_DATABASE_URL:
        "postgresql://valo_app_runtime:runtime@example.test/valo",
    };
    assert.equal(isProductionRuntime(environment), true);
    assert.equal(
      selectDatabaseConnectionString(environment),
      environment.VALO_RUNTIME_DATABASE_URL,
    );
  });

  test("rejects a malformed production URL without echoing it", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "not a postgres URL with secret-owner-value",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo",
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "production database URL is malformed" &&
        !error.message.includes("secret-owner-value"),
    );
  });

  test("rejects a runtime URL for a different database target", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://owner:secret@example.test/valo",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/other",
        }),
      /must preserve the managed target and TLS parameters/,
    );
  });

  test("requires runtime TLS parameters to match the managed URL", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://owner:secret@example.test/valo?sslmode=require&channel_binding=require",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo?sslmode=disable&channel_binding=require",
        }),
      /must preserve the managed target and TLS parameters/,
    );
  });

  test("rejects credentials in query parameters", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://owner:secret@example.test/valo?sslmode=require&user=owner",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo?sslmode=require&user=owner",
        }),
      /credentials must be carried only in URL userinfo/,
    );
  });
});

describe("production tenant graph attestation", () => {
  test("accepts only the pinned 98-edge and special-trigger contract", () => {
    assert.doesNotThrow(() =>
      assertTenantGraphAttestation({
        directEdges: migrationTenantEdges(),
        specialTriggers: SPECIAL_TENANT_TRIGGERS,
        functionProofs: migrationTenantGuardFunctions(),
        compositeTenantEdges: 0,
        immutableArchiveExceptions: 1,
        tenantParentTriggerCount: 98,
      }),
    );
  });

  test("fails closed when a direct or special guard is absent", () => {
    const directEdges = migrationTenantEdges();
    directEdges[0]!.guarded = false;
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges,
          specialTriggers: SPECIAL_TENANT_TRIGGERS.slice(1),
          functionProofs: migrationTenantGuardFunctions(),
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 98,
        }),
      /tenant-parent graph|derived tenant guards/,
    );
  });

  test("fails closed when a trigger is made inert with a WHEN clause", () => {
    const directEdges = migrationTenantEdges().map((edge, index) => ({
      ...edge,
      when_clause: index === 0 ? "false" : null,
    }));
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges,
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs: migrationTenantGuardFunctions(),
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 98,
        }),
      /tenant-parent graph/,
    );

    const specialTriggers = SPECIAL_TENANT_TRIGGERS.map((trigger, index) => ({
      ...trigger,
      when_clause: index === 0 ? "false" : null,
    }));
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers,
          functionProofs: migrationTenantGuardFunctions(),
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 98,
        }),
      /derived tenant guards/,
    );
  });

  test("fails closed when a guard function becomes a RETURN NEW stub", () => {
    const functionProofs = migrationTenantGuardFunctions();
    functionProofs.find(
      (proof) => proof.function_name === "enforce_tenant_parent",
    )!.function_source = "BEGIN\n  RETURN NEW;\nEND;";
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs,
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 98,
        }),
      /guard functions are semantically drifted/,
    );
  });

  test("fails closed when a tenant-context helper drifts", () => {
    const functionProofs = migrationTenantGuardFunctions();
    functionProofs.find(
      (proof) => proof.function_name === "current_organisation_id",
    )!.function_source = "SELECT NULL::uuid";
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs,
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 98,
        }),
      /guard functions are semantically drifted/,
    );

    const strictSetterProofs = migrationTenantGuardFunctions();
    strictSetterProofs.find(
      (proof) => proof.function_name === "set_current_organisation_id",
    )!.strict = true;
    assert.throws(
      () =>
        assertTenantGraphAttestation({
          directEdges: migrationTenantEdges(),
          specialTriggers: SPECIAL_TENANT_TRIGGERS,
          functionProofs: strictSetterProofs,
          compositeTenantEdges: 0,
          immutableArchiveExceptions: 1,
          tenantParentTriggerCount: 98,
        }),
      /guard functions are semantically drifted/,
    );
  });
});

describe("production RLS policy attestation", () => {
  test("fails closed outside the pinned PG16 104-policy catalog", () => {
    assert.throws(
      () => assertRuntimePolicyAttestation([], 160_004),
      /RLS policy catalog is drifted/,
    );
    assert.throws(
      () => assertRuntimePolicyAttestation([], 170_001),
      /RLS policy catalog is drifted/,
    );
  });
});

describe("production public-intake least privilege attestation", () => {
  test("uses PostgreSQL bound expressions without invalid catalog qualification", () => {
    assert.doesNotMatch(
      intakeLimiterMigration,
      /pg_catalog\.(?:least|greatest)\s*\(/i,
    );
    assert.match(intakeLimiterMigration, /\bLEAST\s*\(/);
    assert.match(intakeLimiterMigration, /\bGREATEST\s*\(/);
  });

  test("pins the complete privileged intake routine catalog", () => {
    const proofs = migrationIntakeFunctions();
    assert.doesNotThrow(() => assertIntakeFunctionAttestation(proofs));

    for (const mutate of [
      (candidate: (typeof proofs)[number]) => {
        candidate.public_can_execute = true;
      },
      (candidate: (typeof proofs)[number]) => {
        candidate.function_source += "\n-- drift";
      },
      (candidate: (typeof proofs)[number]) => {
        candidate.argument_types += ",text";
      },
    ]) {
      const drifted = structuredClone(proofs);
      mutate(drifted[0]!);
      assert.throws(
        () => assertIntakeFunctionAttestation(drifted),
        /intake function catalog is drifted/,
      );
    }

    assert.throws(
      () => assertIntakeFunctionAttestation(proofs.slice(1)),
      /intake function catalog is drifted/,
    );
  });

  test("pins PostgreSQL's one-column RETURNS TABLE catalog semantics", () => {
    const proofs = migrationIntakeFunctions();
    const transition = proofs.find(
      (proof) => proof.function_name === "transition_bid_autopsy_work_queue",
    );
    assert.ok(transition);

    // PostgreSQL exposes the lone OUT column type through prorettype while
    // retaining the declared TABLE shape through pg_get_function_result().
    assert.equal(transition.return_type, "uuid");
    assert.equal(transition.function_result, "TABLE(request_id uuid)");
    assert.equal(transition.returns_set, true);
    assert.doesNotThrow(() => assertIntakeFunctionAttestation(proofs));

    const drifted = structuredClone(proofs);
    const driftedTransition = drifted.find(
      (proof) => proof.function_name === "transition_bid_autopsy_work_queue",
    );
    assert.ok(driftedTransition);
    driftedTransition.return_type = "record";
    assert.throws(
      () => assertIntakeFunctionAttestation(drifted),
      /intake function catalog is drifted/,
    );
  });

  test("checks every PostgreSQL table privilege class on both intake tables", () => {
    for (const table of ["bid_autopsy_requests", "bid_autopsy_rate_limits"]) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        assert.match(
          runtimeSecuritySource,
          new RegExp(`current_user,'valo_intake\\.${table}','${privilege}'`),
        );
      }
    }
  });

  test("denies runtime execution of both owner-side intake purge functions", () => {
    assert.match(
      runtimeSecuritySource,
      /proof\.can_execute_purge_bid_autopsy_requests\s*\|\|/,
    );
    assert.match(
      runtimeSecuritySource,
      /proof\.can_execute_purge_bid_autopsy_rate_limits\s*\|\|/,
    );
  });

  test("checks column-level grants across both intake tables", () => {
    for (const [table, proof] of [
      ["bid_autopsy_requests", "bid_autopsy_request"],
      ["bid_autopsy_rate_limits", "bid_autopsy_rate_limit"],
    ] as const) {
      assert.match(
        runtimeSecuritySource,
        new RegExp(
          `'valo_intake\\.${table}'::pg_catalog\\.regclass[\\s\\S]*?AS can_access_${proof}_columns`,
        ),
      );
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
      assert.match(
        runtimeSecuritySource,
        new RegExp(
          `has_column_privilege\\([\\s\\S]*?intake_column\\.attnum,'${privilege}'`,
        ),
      );
    }
    assert.match(
      runtimeSecuritySource,
      /proof\.can_access_bid_autopsy_request_columns\s*\|\|/,
    );
    assert.match(
      runtimeSecuritySource,
      /proof\.can_access_bid_autopsy_rate_limit_columns\s*\|\|/,
    );
  });
});
