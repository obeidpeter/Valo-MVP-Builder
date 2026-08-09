import assert from "node:assert/strict";
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
