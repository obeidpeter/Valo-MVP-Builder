import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dbDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dbDirectory, "migrations", "0001_tenant_rls.sql"),
  "utf8",
);
const auditBoundaryMigration = readFileSync(
  join(dbDirectory, "migrations", "0002_audit_integrity_boundary.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(dbDirectory, "tenant-rls.rollback.dev.sql"),
  "utf8",
);
const schema = readFileSync(
  join(dbDirectory, "src", "schema", "index.ts"),
  "utf8",
);
const runtimeSecurity = readFileSync(
  join(dbDirectory, "src", "runtimeSecurity.ts"),
  "utf8",
);
const bridge = readFileSync(
  join(
    dbDirectory,
    "..",
    "..",
    "scripts",
    "migrations",
    "replit-legacy-v1-to-v2.5.sql",
  ),
  "utf8",
);

function extractSqlArray(sql, name) {
  const match = sql.match(
    new RegExp(
      `${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]\\s*::text\\[\\]`,
    ),
  );
  assert.ok(match, `SQL array ${name} must exist`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function withoutSqlComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

const strictOrganisationTables = extractSqlArray(
  migration,
  "strict_organisation_tables",
);
const sharedOrganisationTables = extractSqlArray(
  migration,
  "shared_organisation_tables",
);
const specialProtectedTables = [
  "evaluation_results",
  "invoice_lines",
  "partner_branding",
  "partner_revenue_share_entries",
  "price_book_entries",
];
const controlPlaneTables = [
  "break_glass_sessions",
  "organisation_memberships",
  "organisations",
  "partner_relationships",
  "role_grants",
];
const intentionallyGlobalTables = [
  "app_config",
  "benchmark_cohorts",
  "benchmark_releases",
  "jurisdiction_rule_packs",
  "jurisdiction_rules",
  "users",
];
const protectedTables = new Set([
  ...strictOrganisationTables,
  ...sharedOrganisationTables,
  ...specialProtectedTables,
  "legacy_audit_events",
  "legacy_audit_integrity_assessments",
]);

const tableDeclarations = [
  ...schema.matchAll(
    /export const \w+ = pgTable\(\s*"([^"]+)"([\s\S]*?)(?=\nexport const |\s*$)/g,
  ),
];
const schemaTables = tableDeclarations.map((declaration) => declaration[1]);
const directOrganisationTables = tableDeclarations
  .filter((declaration) =>
    declaration[2].includes('organisationId: uuid("organisation_id")'),
  )
  .map((declaration) => declaration[1]);

test("every current schema table has an explicit RLS or global classification", () => {
  assert.equal(schemaTables.length, 96, "unexpected parser/schema table count");
  assert.equal(
    protectedTables.size,
    85,
    "protected table list contains a duplicate or omission",
  );

  const classified = new Set([
    ...protectedTables,
    ...controlPlaneTables,
    ...intentionallyGlobalTables,
  ]);
  assert.deepEqual(sorted(classified), sorted(schemaTables));
  assert.deepEqual(
    sorted([
      ...strictOrganisationTables,
      ...sharedOrganisationTables,
      "organisation_memberships",
      "legacy_audit_events",
      "legacy_audit_integrity_assessments",
    ]),
    sorted(directOrganisationTables),
    "every table with organisation_id must be protected or explicitly control-plane",
  );

  for (const table of controlPlaneTables) {
    assert.equal(
      protectedTables.has(table),
      false,
      `${table} must resolve before tenant RLS`,
    );
  }
});

test("policies use a transaction-local, fail-closed organisation context", () => {
  const executableSql = withoutSqlComments(migration);

  assert.match(
    executableSql,
    /current_setting\(\s*'app\.current_organisation_id'\s*,\s*true\s*\)/i,
  );
  assert.match(
    executableSql,
    /set_config\(\s*'app\.current_organisation_id'\s*,[\s\S]*?p_organisation_id::text\s*,\s*true\s*\)/i,
  );
  assert.doesNotMatch(
    executableSql,
    /set_config\(\s*'app\.current_organisation_id'\s*,[\s\S]*?,\s*false\s*\)/i,
  );
  assert.doesNotMatch(
    executableSql,
    /\bBYPASSRLS\b|\bpg_has_role\b|\bcurrent_user\b|\bsession_user\b/i,
  );
  assert.doesNotMatch(
    executableSql,
    /USING\s*\(\s*true\s*\)|WITH CHECK\s*\(\s*true\s*\)/i,
  );
});

test("all protected tables enable and force RLS without an admin policy", () => {
  const dynamicLoopPattern =
    /FOREACH tenant_table IN ARRAY [a-z_]+[\s\S]*?ENABLE ROW LEVEL SECURITY[\s\S]*?FORCE ROW LEVEL SECURITY[\s\S]*?CREATE POLICY/gi;
  assert.equal(
    [...migration.matchAll(dynamicLoopPattern)].length,
    2,
    "both direct-table policy loops must enable, force, and create policies",
  );

  for (const table of specialProtectedTables) {
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, "i"),
    );
  }
  for (const table of [
    "legacy_audit_events",
    "legacy_audit_integrity_assessments",
  ]) {
    assert.match(
      auditBoundaryMigration,
      new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, "i"),
    );
    assert.match(
      auditBoundaryMigration,
      new RegExp(`CREATE POLICY tenant_select ON public\\.${table}`, "i"),
    );
  }
  assert.match(
    auditBoundaryMigration,
    /DROP POLICY IF EXISTS tenant_isolation ON public\.audit_events/i,
  );
  assert.match(
    auditBoundaryMigration,
    /CREATE TRIGGER audit_events_append_only/i,
  );

  assert.doesNotMatch(
    withoutSqlComments(migration),
    /CREATE POLICY\s+[^\s]+[\s\S]*?\b(admin|administrator|owner)_bypass\b/i,
  );
});

test("tenant-derived children resolve and validate their owning parent", () => {
  const parentReferences = new Map([
    ["price_book_entries", ["price_books"]],
    ["invoice_lines", ["invoices"]],
    ["evaluation_results", ["evaluation_runs", "evaluation_cases"]],
  ]);

  for (const [child, parents] of parentReferences) {
    const childPolicyStart = migration.indexOf(
      `CREATE POLICY tenant_`,
      migration.indexOf(`public.${child}`),
    );
    assert.notEqual(childPolicyStart, -1, `${child} policy must exist`);
    const nextTable = migration.indexOf(
      "ALTER TABLE public.",
      childPolicyStart + 1,
    );
    const policyBlock = migration.slice(
      childPolicyStart,
      nextTable === -1 ? migration.length : nextTable,
    );
    assert.match(
      policyBlock,
      /EXISTS\s*\(/i,
      `${child} must use a parent EXISTS check`,
    );
    for (const parent of parents) {
      assert.match(
        policyBlock,
        new RegExp(`FROM public\\.${parent}\\b`, "i"),
        `${child} must derive scope from ${parent}`,
      );
    }
  }
});

test("0002 pins and guards the complete tenant relationship graph", () => {
  const manifestStart = auditBoundaryMigration.indexOf(
    "CREATE OR REPLACE FUNCTION valo_security.expected_tenant_parent_edges()",
  );
  const manifestEnd = auditBoundaryMigration.indexOf(
    "$function$;",
    manifestStart,
  );
  assert(manifestStart >= 0 && manifestEnd > manifestStart);
  const manifestRows = [
    ...auditBoundaryMigration
      .slice(manifestStart, manifestEnd)
      .matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)',(true|false)\)/g),
  ];
  const manifestLines = manifestRows
    .map(
      (row) =>
        `${row[1]}.${row[2]}->${row[3]}.${row[4]}|${row[5] === "true" ? "global" : "strict"}`,
    )
    .sort();
  assert.equal(manifestLines.length, 98);
  assert.equal(
    manifestLines.filter((line) => line.endsWith("|global")).length,
    2,
  );
  assert.equal(
    createHash("sha256").update(manifestLines.join("\n")).digest("hex"),
    "0240790c357b1461feb2f48d1a1930750e4a09dbaf2502b1260b35c4fe706172",
  );
  assert.match(
    auditBoundaryMigration,
    /CREATE OR REPLACE FUNCTION valo_security\.enforce_tenant_parent\(\)/,
  );
  assert.match(
    auditBoundaryMigration,
    /tenant parent edge catalog differs from the pinned 98-edge manifest plus immutable archive exception/,
  );
  assert.doesNotMatch(
    auditBoundaryMigration,
    /'audit_events',\s*'projects',\s*'project_id'/,
    "audit project references intentionally survive parent deletion",
  );
  for (const trigger of [
    "tenant_derived_price_book_entry",
    "tenant_derived_invoice_order",
    "tenant_derived_partner_revenue",
    "tenant_derived_role_grant",
    "tenant_derived_partner_approver",
    "tenant_membership_organisation_immutable",
    "tenant_partner_parties_immutable",
    "tenant_role_grant_identity_immutable",
    "tenant_control_membership_context",
    "tenant_control_role_grant_context",
    "tenant_control_partner_context",
    "tenant_control_organisation_context",
    "tenant_control_break_glass_context",
    "tenant_break_glass_target_immutable",
  ]) {
    assert.match(
      auditBoundaryMigration,
      new RegExp(`CREATE TRIGGER ${trigger}`),
    );
  }
  assert.match(auditBoundaryMigration, /relationship\.status = 'active'/);
  assert.match(
    auditBoundaryMigration,
    /client_organisation_id = valo_security\.current_organisation_id\(\)/,
  );
  assert.match(
    auditBoundaryMigration,
    /CREATE OR REPLACE FUNCTION valo_security\.enforce_control_plane_tenant_context\(\)/,
  );
  assert.match(
    auditBoundaryMigration,
    /NEW\.organisation_id = current_organisation_id/,
  );
  assert.match(
    auditBoundaryMigration,
    /TG_OP = 'INSERT'[\s\S]*?NEW\.id = current_organisation_id/,
  );
  assert.match(
    auditBoundaryMigration,
    /NEW\.target_organisation_id = current_organisation_id/,
  );
  assert.match(
    auditBoundaryMigration,
    /subject_organisation_id = current_organisation_id/,
  );
  assert.match(
    auditBoundaryMigration,
    /TG_OP = 'INSERT'[\s\S]*?NEW\.partner_organisation_id = current_organisation_id[\s\S]*?NEW\.status = 'pending'[\s\S]*?NEW\.approved_by_membership_id IS NULL[\s\S]*?NEW\.access_starts_at IS NULL/,
  );
  assert.match(
    auditBoundaryMigration,
    /TG_OP = 'UPDATE'[\s\S]*?NEW\.client_organisation_id = current_organisation_id/,
  );
  assert.match(
    bridge,
    /REVOKE UPDATE, DELETE ON TABLE public\.organisations FROM %I/,
  );
  assert.match(
    bridge,
    /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I/,
  );
  assert.match(
    bridge,
    /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I/,
  );
  assert.match(bridge, /REVOKE DELETE ON TABLE public\.users FROM %I/);
  assert.match(
    bridge,
    /REVOKE DELETE ON TABLE public\.organisation_memberships, public\.partner_relationships, public\.break_glass_sessions FROM %I/,
  );
  assert.match(
    bridge,
    /REVOKE UPDATE, DELETE ON TABLE public\.role_grants FROM %I/,
  );
});

test("0002 preflights existing relationships across every FORCE-RLS tenant", () => {
  const organisationLoops = [
    ...auditBoundaryMigration.matchAll(
      /FOR tenant_organisation IN\s+SELECT organisation\.id\s+FROM public\.organisations AS organisation\s+ORDER BY organisation\.id\s+LOOP/g,
    ),
  ];
  assert.equal(
    organisationLoops.length,
    2,
    "direct and derived preflights must each enumerate all organisations",
  );
  assert.equal(
    [
      ...auditBoundaryMigration.matchAll(
        /previous_organisation_context :=\s+pg_catalog\.current_setting\('app\.current_organisation_id', true\)/g,
      ),
    ].length,
    2,
  );
  assert.ok(
    [
      ...auditBoundaryMigration.matchAll(
        /pg_catalog\.set_config\(\s*'app\.current_organisation_id',\s*tenant_organisation\.id::text,\s*true\s*\)/g,
      ),
    ].length >= 2,
  );
  assert.ok(
    [
      ...auditBoundaryMigration.matchAll(
        /pg_catalog\.set_config\(\s*'app\.current_organisation_id',\s*COALESCE\(previous_organisation_context, ''\),\s*true\s*\)/g,
      ),
    ].length >= 3,
  );

  assert.match(
    auditBoundaryMigration,
    /reserved migration policy name valo_tenant_preflight_null already exists/,
  );
  assert.match(
    auditBoundaryMigration,
    /CREATE POLICY valo_tenant_preflight_null[\s\S]*?USING \(organisation_id IS NULL\)/,
  );
  assert.match(
    auditBoundaryMigration,
    /DROP POLICY valo_tenant_preflight_null ON public\.%I/,
  );
  assert.doesNotMatch(
    auditBoundaryMigration,
    /DROP POLICY IF EXISTS valo_tenant_preflight_null/,
    "a colliding operator policy must fail closed rather than be discarded",
  );

  const derivedStart = auditBoundaryMigration.indexOf(
    "DO $derived_tenant_preflight$",
  );
  const derivedEnd = auditBoundaryMigration.indexOf(
    "$derived_tenant_preflight$;",
    derivedStart,
  );
  assert.ok(derivedStart >= 0 && derivedEnd > derivedStart);
  const derivedPreflight = auditBoundaryMigration.slice(
    derivedStart,
    derivedEnd,
  );
  for (const leftJoin of [
    "LEFT JOIN public.price_book_entries",
    "LEFT JOIN public.price_books",
    "LEFT JOIN public.invoices",
    "LEFT JOIN public.orders",
  ]) {
    assert.match(derivedPreflight, new RegExp(leftJoin));
  }
  assert.match(derivedPreflight, /\.tableoid IS NULL/);
  assert.match(
    derivedPreflight,
    /revenue\.client_organisation_id = tenant_organisation\.id/,
  );
});

test("runtime attestation pins both transaction-local tenant context helpers", () => {
  for (const functionName of [
    "current_organisation_id",
    "set_current_organisation_id",
  ]) {
    const signature = `CREATE OR REPLACE FUNCTION valo_security.${functionName}`;
    const start = migration.indexOf(signature);
    const sourceStart = migration.indexOf("AS $function$", start);
    const sourceEnd = migration.indexOf("$function$;", sourceStart);
    assert(start >= 0 && sourceStart > start && sourceEnd > sourceStart);
    const digest = createHash("sha256")
      .update(
        migration
          .slice(sourceStart + "AS $function$".length, sourceEnd)
          .replaceAll("\r\n", "\n")
          .trim(),
      )
      .digest("hex");
    assert.match(runtimeSecurity, new RegExp(functionName));
    assert.match(runtimeSecurity, new RegExp(digest));
  }
});

test("manual rollback is doubly guarded and covers exactly the protected set", () => {
  const rollbackTables = extractSqlArray(rollback, "protected_tables");
  assert.deepEqual(sorted(rollbackTables), sorted(protectedTables));
  assert.match(rollback, /app\.environment/i);
  assert.match(rollback, /current_database\(\)\s*~\*/i);
  assert.match(rollback, /I_UNDERSTAND_DATA_ISOLATION_WILL_BE_DISABLED/);
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/i);
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/i);
  assert.match(rollback, /DROP POLICY IF EXISTS/i);
});
