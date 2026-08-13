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
const productionAssuranceMigration = readFileSync(
  join(dbDirectory, "migrations", "0008_production_assurance.sql"),
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
const legacyBridgeRehearsal = readFileSync(
  join(dbDirectory, "scripts", "legacy-bridge-ci-rehearsal.mjs"),
  "utf8",
);
const legacyBridgeRunner = readFileSync(
  join(dbDirectory, "scripts", "run-legacy-bridge.mjs"),
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
const laterProtectedTables = ["authenticated_rate_limit_buckets"];
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
  ...laterProtectedTables,
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
  assert.equal(schemaTables.length, 97, "unexpected parser/schema table count");
  assert.equal(
    protectedTables.size,
    86,
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
      ...laterProtectedTables,
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
  for (const table of laterProtectedTables) {
    assert.match(
      productionAssuranceMigration,
      new RegExp(
        `ALTER TABLE ["']?${table}["']? ENABLE ROW LEVEL SECURITY`,
        "i",
      ),
    );
    assert.match(
      productionAssuranceMigration,
      new RegExp(
        `ALTER TABLE ["']?${table}["']? FORCE ROW LEVEL SECURITY`,
        "i",
      ),
    );
    assert.match(
      productionAssuranceMigration,
      new RegExp(
        `CREATE POLICY ["']?tenant_isolation["']?[\\s\\S]*?ON ["']?${table}["']?`,
        "i",
      ),
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

test("legacy bridge reuses the runtime role within PG16 CREATEROLE authority", () => {
  const roleBlockStart = bridge.indexOf("DO $runtime_role$");
  const roleBlockEnd = bridge.indexOf("$runtime_role$;", roleBlockStart);
  assert.ok(roleBlockStart >= 0 && roleBlockEnd > roleBlockStart);
  const roleBlock = bridge.slice(roleBlockStart, roleBlockEnd);
  assert.match(bridge, /SET LOCAL password_encryption = 'scram-sha-256'/);
  assert.match(
    roleBlock,
    /CREATE ROLE %I LOGIN PASSWORD %L VALID UNTIL ''infinity'' CONNECTION LIMIT -1 NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS/,
  );
  const existingRoleBranch = roleBlock.match(
    /  ELSE\r?\n    EXECUTE format\([\s\S]*?\r?\n  END IF;/,
  )?.[0];
  assert.ok(existingRoleBranch);
  assert.match(
    existingRoleBranch,
    /ALTER ROLE %I LOGIN PASSWORD %L VALID UNTIL ''infinity'' CONNECTION LIMIT -1 NOCREATEROLE INHERIT/,
  );
  assert.doesNotMatch(
    existingRoleBranch,
    /NOSUPERUSER|NOCREATEDB|NOREPLICATION|NOBYPASSRLS/,
    "a PG16 CREATEROLE migrator cannot repeat privileged false attributes",
  );
  assert.match(roleBlock, /ALTER ROLE %I RESET ALL/);
  assert.match(roleBlock, /ALTER ROLE %I IN DATABASE %I RESET ALL/);
  for (const exactAttribute of [
    "rolsuper",
    "rolbypassrls",
    "rolcanlogin",
    "rolcreatedb",
    "rolcreaterole",
    "rolreplication",
    "rolinherit",
    "rolconnlimit",
    "rolvaliduntil",
    "rolconfig",
  ]) {
    assert.match(roleBlock, new RegExp(`\\b${exactAttribute}\\b`));
  }
  assert.match(roleBlock, /COALESCE\(cardinality\(role_config\), 0\) <> 0/);
  assert.match(roleBlock, /role_connection_limit <> -1/);
  assert.match(
    roleBlock,
    /role_valid_until IS DISTINCT FROM 'infinity'::timestamptz/,
  );
  assert.match(
    roleBlock,
    /SELECT 1 FROM pg_db_role_setting WHERE setrole=role_oid/,
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

test("runtime path attestation casts PostgreSQL name arrays for node-postgres", () => {
  for (const source of [runtimeSecurity, legacyBridgeRehearsal]) {
    assert.equal(
      [
        ...source.matchAll(
          /pg_catalog\.current_schemas\((?:false|true)\)::pg_catalog\.text\[\]/g,
        ),
      ].length,
      2,
      "both current_schemas results must use the node-postgres text[] parser",
    );
  }
});

test("legacy rehearsal pins both pre-0008 and production-assurance catalogs", () => {
  assert.match(legacyBridgeRehearsal, /productionAssuranceExpected \? 97 : 96/);
  assert.match(
    legacyBridgeRehearsal,
    /productionAssuranceExpected \? 105 : 104/,
  );
  assert.equal(
    [...legacyBridgeRehearsal.matchAll(/productionAssuranceExpected:\s*false/g)]
      .length,
    3,
    "only incremental 0002 plus the newly bridged pre-0008 catalog and runtime contract may omit production assurance",
  );
});

test("legacy rehearsal pins the runtime table contract for both catalog variants", () => {
  const runtimeContract = legacyBridgeRehearsal.slice(
    legacyBridgeRehearsal.indexOf("async function assertRuntimeContract"),
    legacyBridgeRehearsal.indexOf("async function expectInsufficientPrivilege"),
  );
  assert.match(
    runtimeContract,
    /typeof productionAssuranceExpected[\s\S]*"boolean"/u,
  );
  assert.match(
    runtimeContract,
    /tableGrants\.rows\.length,[\s\S]*productionAssuranceExpected \? 97 : 96/u,
  );
  assert.match(
    runtimeContract,
    /grant\.relname === "authenticated_rate_limit_buckets"[\s\S]*can_select: true,[\s\S]*can_insert: true,[\s\S]*can_update: true,[\s\S]*can_delete: false,[\s\S]*can_truncate: false,[\s\S]*can_references: false,[\s\S]*can_trigger: false/u,
  );
  assert.match(
    runtimeContract,
    /const noDelete = new Set\(\[[\s\S]*"authenticated_rate_limit_buckets"/u,
  );
  for (const [connection, expected] of [
    ["bridged", false],
    ["afterNoOp", true],
    ["afterRerun", true],
    ["fresh", true],
  ]) {
    assert.match(
      legacyBridgeRehearsal,
      new RegExp(
        `assertRuntimeContract\\(${connection}, \\{\\s*productionAssuranceExpected: ${expected},`,
        "u",
      ),
    );
  }
});

test("legacy runner precommit proof pins both security catalog variants", () => {
  const precommit = legacyBridgeRunner.slice(
    legacyBridgeRunner.indexOf("async function assertPrecommitSecurityCatalog"),
    legacyBridgeRunner.indexOf("function canonicalAuditPayload"),
  );
  assert.match(precommit, /FROM pg_temp\._valo_bridge_state/u);
  assert.match(precommit, /productionAssuranceExpected \? 97 : 96/u);
  assert.match(precommit, /productionAssuranceExpected \? 86 : 85/u);
  assert.match(precommit, /productionAssuranceExpected \? 105 : 104/u);
  assert.match(precommit, /productionAssuranceExpected \? 11 : 9/u);
  assert.match(
    precommit,
    /table_name: "authenticated_rate_limit_buckets"[\s\S]*enabled: true[\s\S]*forced: true/u,
  );
  assert.match(
    precommit,
    /policy_name: "tenant_isolation"[\s\S]*role_names: \["PUBLIC"\][\s\S]*using_expression:[\s\S]*current_organisation_id[\s\S]*check_expression:[\s\S]*current_organisation_id/u,
  );
  for (const [name, sourceSha256, runtimeCanExecute, securityDefiner] of [
    [
      "consume_authenticated_actor_rate_limit",
      "97f97bc16b5773684a9933bc4575916d4086dae9b352eb60d71b5c8478474030",
      true,
      true,
    ],
    [
      "purge_expired_authenticated_rate_limit_buckets",
      "beeae6ab916be432aa0749085de35145912e9fd0d8277d186485f20c09c625bf",
      false,
      false,
    ],
  ]) {
    const expectedFunction = legacyBridgeRunner.slice(
      legacyBridgeRunner.indexOf(`function_name: "${name}"`),
      legacyBridgeRunner.indexOf("}),", legacyBridgeRunner.indexOf(name)),
    );
    assert.match(
      expectedFunction,
      new RegExp(`source_sha256:[\\s\\S]*${sourceSha256}`, "u"),
    );
    assert.match(
      expectedFunction,
      new RegExp(`security_definer: ${securityDefiner}`, "u"),
    );
    assert.match(
      expectedFunction,
      new RegExp(`runtime_can_execute: ${runtimeCanExecute}`, "u"),
    );
    assert.match(expectedFunction, /public_can_execute: false/u);
    assert.match(expectedFunction, /execute_acl:/u);
  }
});

test("legacy bridge recognizes only exact pre-0008 or production-assurance targets", () => {
  const preflight = bridge.slice(
    bridge.indexOf("DO $preflight$"),
    bridge.indexOf("$preflight$;"),
  );
  assert.match(
    preflight,
    /cardinality\(actual_tables\) = cardinality\(target_tables\) \+ 1[\s\S]*actual_tables @> target_tables[\s\S]*'authenticated_rate_limit_buckets' = ANY\(actual_tables\)/u,
  );
  assert.match(
    preflight,
    /cardinality\(actual_rls_tables\) = cardinality\(rls_tables\) \+ 1[\s\S]*actual_rls_tables @> rls_tables[\s\S]*'authenticated_rate_limit_buckets' = ANY\(actual_rls_tables\)[\s\S]*policy_count = 105[\s\S]*authenticated_rate_limit_policy_matches/u,
  );
  assert.match(
    preflight,
    /count\(\*\) = 1[\s\S]*policy\.polname = 'tenant_isolation'[\s\S]*policy\.polpermissive[\s\S]*policy\.polcmd = '\*'[\s\S]*policy\.polroles = ARRAY\[0::oid\][\s\S]*policy\.polqual[\s\S]*policy\.polwithcheck[\s\S]*relation\.relname='authenticated_rate_limit_buckets'/u,
  );
  assert.equal(
    [
      ...bridge.matchAll(
        /relation\.relname='authenticated_rate_limit_buckets'/gu,
      ),
    ].length,
    2,
    "the new policy catalog is attested at admission and after reconciliation",
  );
  assert.match(
    preflight,
    /cardinality\(actual_tables\)=cardinality\(legacy_tables\)[\s\S]*any_rls_table_count = 0[\s\S]*policy_count = 0[\s\S]*to_regclass\('drizzle\.__drizzle_migrations'\) IS NULL/u,
  );
  assert.match(
    bridge,
    /expected_table_count := 97;[\s\S]*expected_policy_count := 105;[\s\S]*ARRAY\['authenticated_rate_limit_buckets'\]::text\[\]/u,
  );
  assert.match(
    bridge,
    /assurance_expected IS DISTINCT FROM\s*authenticated_rate_limit_policy_matches/u,
  );
  assert.match(
    bridge,
    /production_assurance_expected FROM _valo_bridge_state[\s\S]*REVOKE DELETE ON TABLE public\.authenticated_rate_limit_buckets/u,
  );
  assert.match(
    bridge,
    /production_assurance_expected FROM _valo_bridge_state[\s\S]*GRANT EXECUTE ON FUNCTION valo_security\.consume_authenticated_actor_rate_limit\(text, integer, integer\)/u,
  );
  assert.match(
    bridge,
    /'audit_events','authenticated_rate_limit_buckets',[\s\S]*'partner_relationships','role_grants','users'/u,
  );
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
