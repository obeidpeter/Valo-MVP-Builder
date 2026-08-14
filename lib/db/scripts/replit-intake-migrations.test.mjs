import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  EXPECTED_REPLIT_INTAKE_SECURITY,
  EXPECTED_REPLIT_MIGRATIONS,
  runReplitIntakeMigrations,
  shouldApplyReplitMigrations,
  validateLocalReplitMigrationManifest,
  validateReplitIntakeCatalog,
  validateReplitIntakeSchemaState,
  validateReplitMigrationEnvironment,
  validateReplitMigrationJournal,
  validateReplitMigrationSearchPath,
  withReplitMigrationSearchPath,
} from "./replit-intake-migrations.mjs";

const { Pool } = pg;
const migrationsDirectory = resolve(import.meta.dirname, "../migrations");
const leadOperationsMigration = readFileSync(
  resolve(migrationsDirectory, "0006_lead_operations_queue.sql"),
  "utf8",
);
const storageLifecycleMigration = readFileSync(
  resolve(migrationsDirectory, "0007_storage_lifecycle_indexes.sql"),
  "utf8",
);
const productionAssuranceMigration = readFileSync(
  resolve(migrationsDirectory, "0008_production_assurance.sql"),
  "utf8",
);
const replitMigrationRunner = readFileSync(
  resolve(import.meta.dirname, "replit-intake-migrations.mjs"),
  "utf8",
);

async function createMigrationPrefix(count) {
  const prefixDirectory = await mkdtemp(
    join(tmpdir(), "valo-replit-migration-prefix-"),
  );
  const metaDirectory = join(prefixDirectory, "meta");
  await mkdir(metaDirectory);
  const journal = JSON.parse(
    await readFile(resolve(migrationsDirectory, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.slice(0, count);
  await writeFile(
    join(metaDirectory, "_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`,
    "utf8",
  );
  await Promise.all(
    EXPECTED_REPLIT_MIGRATIONS.slice(0, count).map(({ tag }) =>
      copyFile(
        resolve(migrationsDirectory, `${tag}.sql`),
        join(prefixDirectory, `${tag}.sql`),
      ),
    ),
  );
  return prefixDirectory;
}

const journalRows = (count) =>
  EXPECTED_REPLIT_MIGRATIONS.slice(0, count).map((migration) => ({
    id: migration.id,
    hash: migration.hash,
    createdAt: migration.createdAt,
  }));

test("accepts only the exact approved baseline, upgrade, and complete journal states", () => {
  assert.equal(validateReplitMigrationJournal(journalRows(3)), "pending");
  assert.equal(
    validateReplitMigrationJournal(journalRows(6)),
    "upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(7)),
    "storage_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(8)),
    "assurance_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(9)),
    "registry_upgrade_pending",
  );
  assert.equal(
    validateReplitMigrationJournal(journalRows(10)),
    "already_applied",
  );
  for (const rejectedRows of [
    journalRows(0),
    journalRows(1),
    journalRows(2),
    journalRows(4),
    journalRows(5),
    [...journalRows(10), { id: 11, hash: "0".repeat(64), createdAt: "0" }],
  ]) {
    assert.throws(
      () => validateReplitMigrationJournal(rejectedRows),
      /not the approved 0000-0002, 0000-0005, 0000-0006, 0000-0007, 0000-0008, or 0000-0009 state/,
    );
  }
  assert.throws(
    () =>
      validateReplitMigrationJournal([
        ...journalRows(2),
        { ...journalRows(3)[2], hash: "0".repeat(64) },
      ]),
    /entry 3 is drifted/,
  );
});

test("binds journal state to the presence of the intake schema", () => {
  assert.doesNotThrow(() => validateReplitIntakeSchemaState("pending", null));
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("storage_upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("assurance_upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("registry_upgrade_pending", "valo_intake"),
  );
  assert.doesNotThrow(() =>
    validateReplitIntakeSchemaState("already_applied", "valo_intake"),
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("pending", "valo_intake"),
    /exists before/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("upgrade_pending", null),
    /absent after/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("storage_upgrade_pending", null),
    /absent after/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("already_applied", null),
    /absent after/,
  );
});

test("applies migrations for every approved incomplete journal state", () => {
  assert.equal(shouldApplyReplitMigrations("pending"), true);
  assert.equal(shouldApplyReplitMigrations("upgrade_pending"), true);
  assert.equal(shouldApplyReplitMigrations("storage_upgrade_pending"), true);
  assert.equal(shouldApplyReplitMigrations("assurance_upgrade_pending"), true);
  assert.equal(shouldApplyReplitMigrations("already_applied"), false);
});

test("pins production-assurance retention, limiter and RLS controls", () => {
  assert.match(
    productionAssuranceMigration,
    /CREATE TABLE "authenticated_rate_limit_buckets"/u,
  );
  assert.match(
    productionAssuranceMigration,
    /ALTER TABLE "authenticated_rate_limit_buckets" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    productionAssuranceMigration,
    /CREATE POLICY "tenant_isolation"[\s\S]*valo_security\.current_organisation_id/u,
  );
  assert.match(
    productionAssuranceMigration,
    /purge_expired_authenticated_rate_limit_buckets[\s\S]*LIMIT 1000[\s\S]*FOR UPDATE SKIP LOCKED/u,
  );
  assert.match(
    productionAssuranceMigration,
    /REVOKE ALL ON FUNCTION[\s\S]*purge_expired_authenticated_rate_limit_buckets/u,
  );
  assert.match(productionAssuranceMigration, /"concluded_at"/u);
  assert.match(productionAssuranceMigration, /"storage_terminal_at"/u);
  assert.match(
    productionAssuranceMigration,
    /"retention_scan_cycle_incomplete" boolean NOT NULL DEFAULT false/u,
  );
  assert.match(
    productionAssuranceMigration,
    /"storage_lifecycle_cycle_incomplete" boolean NOT NULL DEFAULT false/u,
  );
  assert.doesNotMatch(
    productionAssuranceMigration,
    /DROP\s+(?:TABLE|COLUMN)/iu,
  );
});

test("backfills populated legacy storage attempt cycles without losing unresolved locators", () => {
  assert.match(
    productionAssuranceMigration,
    /ALTER TABLE "notification_events" NO FORCE ROW LEVEL SECURITY[\s\S]*ALTER TABLE "notification_attempts" NO FORCE ROW LEVEL SECURITY[\s\S]*LEFT JOIN "notification_attempts" AS "attempt"[\s\S]*ALTER TABLE "notification_attempts" FORCE ROW LEVEL SECURITY[\s\S]*ALTER TABLE "notification_events" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    productionAssuranceMigration,
    /count\("attempt"\."id"\)::integer AS "attempt_count"[\s\S]*LEFT JOIN "notification_attempts" AS "attempt"/u,
  );
  assert.match(
    productionAssuranceMigration,
    /WHEN "event"\."status" = 'dead_letter' THEN 5[\s\S]*ELSE least\(5, "counts"\."attempt_count"\)/u,
  );
  assert.match(
    productionAssuranceMigration,
    /"event"\."status" IN \([\s\S]*'retry_wait', 'completed', 'cancelled', 'dead_letter'[\s\S]*\)/u,
  );
  const terminalIndex = productionAssuranceMigration.match(
    /CREATE INDEX "notification_events_storage_terminal_retention_idx"[\s\S]*?;\s*--> statement-breakpoint/u,
  )?.[0];
  assert.ok(terminalIndex, "missing storage terminal retention index");
  assert.match(terminalIndex, /"status" IN \('completed', 'cancelled'\)/u);
  assert.doesNotMatch(terminalIndex, /dead_letter|resolved/u);
});

test("adds a durable cursor and bounded partial indexes for storage lifecycle scans", () => {
  assert.match(
    storageLifecycleMigration,
    /ALTER TABLE "app_config"[\s\S]*ADD COLUMN "storage_lifecycle_cursor_organisation_id" uuid[\s\S]*ADD COLUMN "storage_lifecycle_lease_owner" text[\s\S]*ADD COLUMN "storage_lifecycle_lease_expires_at" timestamp with time zone/u,
  );
  assert.match(
    storageLifecycleMigration,
    /ALTER TABLE "notification_events"[\s\S]*ADD COLUMN "available_at" timestamp with time zone NOT NULL DEFAULT now\(\)[\s\S]*notification_events_storage_reconcile_idx[\s\S]*organisation_id[\s\S]*available_at[\s\S]*created_at[\s\S]*WHERE "channel" = 'internal_storage'[\s\S]*"status" IN \('queued', 'retry_wait'\)/u,
  );
  assert.match(
    storageLifecycleMigration,
    /upload_sessions_cleanup_project_expiry_idx[\s\S]*organisation_id[\s\S]*project_id[\s\S]*expires_at[\s\S]*WHERE "status" IN \('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed'\)/u,
  );
  assert.match(
    storageLifecycleMigration,
    /upload_sessions_cleanup_expiry_idx[\s\S]*organisation_id[\s\S]*expires_at[\s\S]*WHERE "status" IN \('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed'\)/u,
  );
  for (const indexName of [
    "documents_org_object_path_idx",
    "document_versions_org_object_path_idx",
    "vault_items_org_object_path_idx",
    "reports_org_docx_path_idx",
    "reports_org_pdf_path_idx",
    "package_versions_org_docx_path_idx",
    "package_versions_org_pdf_path_idx",
    "package_versions_org_zip_path_idx",
  ]) {
    assert.match(storageLifecycleMigration, new RegExp(indexName, "u"));
  }
  assert.doesNotMatch(storageLifecycleMigration, /DROP|DELETE|UPDATE/iu);
});

test("keeps the bounded work queue active-only and contact-data free", () => {
  const listFunction = leadOperationsMigration.match(
    /CREATE FUNCTION "valo_intake"\."list_bid_autopsy_work_queue"[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(listFunction, "missing lead operations queue function");
  assert.match(listFunction, /stored\.delivery_status <> 'closed'/);
  assert.doesNotMatch(
    listFunction,
    /stored\.(?:contact_name|business_email|business_telephone)/,
  );
  assert.doesNotMatch(listFunction, /preferred_contact_method/);
});

test("limits contact handoff to one retained active lead and preferred channel", () => {
  const handoffFunction = leadOperationsMigration.match(
    /CREATE FUNCTION "valo_intake"\."get_bid_autopsy_contact_handoff"[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(handoffFunction, "missing single-record contact handoff function");
  assert.match(handoffFunction, /stored\.id = p_request_id/u);
  assert.match(handoffFunction, /stored\.delivery_status <> 'closed'/u);
  assert.match(
    handoffFunction,
    /stored\.retention_until > pg_catalog\.statement_timestamp\(\)/u,
  );
  assert.match(
    handoffFunction,
    /CASE stored\.preferred_contact_method[\s\S]*?WHEN 'email'[\s\S]*?WHEN 'telephone'/u,
  );
  assert.doesNotMatch(handoffFunction, /\bLIMIT\s+[2-9]/iu);
});

test("requires the exact structural and security intake catalog", () => {
  const expectedTables = {
    format: "valo.intake-table-catalog.v1",
    relations: Array.from({ length: 2 }, (_, index) => [
      `relation_${index}`,
      "r",
    ]),
    columns: Array.from({ length: 20 }, (_, index) => [
      "bid_autopsy_requests",
      index + 1,
      `column_${index}`,
      "text",
      true,
      null,
    ]),
    constraints: Array.from({ length: 18 }, (_, index) => [
      "bid_autopsy_requests",
      `constraint_${index}`,
      "c",
    ]),
    indexes: Array.from({ length: 5 }, (_, index) => [
      "bid_autopsy_requests",
      `index_${index}`,
      "btree",
      index === 0,
    ]),
    triggers: [],
    rules: [],
    inheritance: [],
    policies: [],
  };
  const validCatalog = () => ({
    tables: structuredClone(expectedTables),
    referenceTables: structuredClone(expectedTables),
    security: structuredClone(EXPECTED_REPLIT_INTAKE_SECURITY),
  });
  assert.doesNotThrow(() => validateReplitIntakeCatalog(validCatalog()));
  assert.throws(
    () =>
      validateReplitIntakeCatalog({
        security: structuredClone(EXPECTED_REPLIT_INTAKE_SECURITY),
      }),
    /catalog is incomplete or drifted/,
  );

  const columnDefaultDrift = validCatalog();
  columnDefaultDrift.tables.columns[0][5] = "gen_random_uuid()";
  assert.throws(
    () => validateReplitIntakeCatalog(columnDefaultDrift),
    /catalog is incomplete or drifted/,
  );

  const constraintDrift = validCatalog();
  constraintDrift.tables.constraints[0][2] = "p";
  assert.throws(
    () => validateReplitIntakeCatalog(constraintDrift),
    /catalog is incomplete or drifted/,
  );

  const droppedUniqueIndex = validCatalog();
  droppedUniqueIndex.tables.indexes = [];
  assert.throws(
    () => validateReplitIntakeCatalog(droppedUniqueIndex),
    /catalog is incomplete or drifted/,
  );

  const indexUniquenessDrift = validCatalog();
  indexUniquenessDrift.tables.indexes[0][3] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(indexUniquenessDrift),
    /catalog is incomplete or drifted/,
  );

  const rewriteRuleDrift = validCatalog();
  rewriteRuleDrift.tables.rules.push([
    "bid_autopsy_requests",
    "exfiltrate_insert",
    "2",
  ]);
  assert.throws(
    () => validateReplitIntakeCatalog(rewriteRuleDrift),
    /catalog is incomplete or drifted/,
  );

  const inheritanceDrift = validCatalog();
  inheritanceDrift.tables.inheritance.push([
    "valo_intake",
    "bid_autopsy_requests",
    "public",
    "public_readable_parent",
    1,
  ]);
  assert.throws(
    () => validateReplitIntakeCatalog(inheritanceDrift),
    /catalog is incomplete or drifted/,
  );

  const ownerDrift = validCatalog();
  ownerDrift.security.schema[0] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(ownerDrift),
    /catalog is incomplete or drifted/,
  );

  const aclDrift = validCatalog();
  aclDrift.security.columnGrants.push([
    "bid_autopsy_requests",
    "business_email",
    "$OWNER",
    "unexpected_role",
    "SELECT",
    false,
  ]);
  assert.throws(
    () => validateReplitIntakeCatalog(aclDrift),
    /catalog is incomplete or drifted/,
  );

  const functionBodyDrift = validCatalog();
  functionBodyDrift.security.functions[0][19] = "0".repeat(64);
  assert.throws(
    () => validateReplitIntakeCatalog(functionBodyDrift),
    /catalog is incomplete or drifted/,
  );

  const functionSecurityDrift = validCatalog();
  functionSecurityDrift.security.functions[0][9] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(functionSecurityDrift),
    /catalog is incomplete or drifted/,
  );

  const functionDefaultDrift = validCatalog();
  functionDefaultDrift.security.functions[0][17] = 1;
  assert.throws(
    () => validateReplitIntakeCatalog(functionDefaultDrift),
    /catalog is incomplete or drifted/,
  );

  const functionVariadicDrift = validCatalog();
  functionVariadicDrift.security.functions[0][18] = false;
  assert.throws(
    () => validateReplitIntakeCatalog(functionVariadicDrift),
    /catalog is incomplete or drifted/,
  );
});

test("restricts execution to Replit production with separated same-target roles", () => {
  const environment = {
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
    DATABASE_URL:
      "postgresql://owner:owner-secret@db.example.test/valo?sslmode=require",
    VALO_RUNTIME_DATABASE_URL:
      "postgresql://valo_app_runtime:runtime-secret@db.example.test/valo?sslmode=require",
  };
  assert.equal(
    validateReplitMigrationEnvironment(environment),
    environment.DATABASE_URL,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        REPLIT_DEPLOYMENT: "0",
      }),
    /restricted to Replit production/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        NODE_ENV: "development",
      }),
    /restricted to Replit production/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        VALO_RUNTIME_DATABASE_URL: environment.DATABASE_URL,
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://%76alo_app_runtime:another-owner-secret@db.example.test/valo?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://owner:owner%2Dsecret@db.example.test/valo?sslmode=require",
        VALO_RUNTIME_DATABASE_URL:
          "postgresql://owner:owner-secret@db.example.test/valo?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://valo_app_runtime:another-owner-secret@db.example.test/valo?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        VALO_RUNTIME_DATABASE_URL:
          "postgresql://other_runtime:runtime-secret@db.example.test/valo?sslmode=require",
      }),
    /fixed runtime role/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://owner:runtime-secret@db.example.test/valo?sslmode=require",
      }),
    /identity and credential must differ/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        VALO_RUNTIME_DATABASE_URL:
          "postgresql://valo_app_runtime:runtime-secret@other.example.test/valo?sslmode=require",
      }),
    /must target the same database/,
  );
  assert.throws(
    () =>
      validateReplitMigrationEnvironment({
        ...environment,
        DATABASE_URL:
          "postgresql://db.example.test/valo?sslmode=require&password=owner-secret",
      }),
    /credentials only in URL userinfo/,
  );
});

test("source migration journal and SQL hashes remain frozen", async () => {
  await assert.doesNotReject(validateLocalReplitMigrationManifest());
});

test("scopes public name resolution to migration execution", async () => {
  const operations = [];
  const client = {
    query: async (statement) => {
      operations.push(statement);
      return statement.includes("current_schema")
        ? {
            rows: [
              {
                configuredPath: "public, pg_temp",
                currentSchema: "public",
                lookupPath: ["pg_catalog", "public"],
              },
            ],
          }
        : { rows: [] };
    },
  };
  const outcome = await withReplitMigrationSearchPath(client, async () => {
    operations.push("migrate");
    return "applied";
  });
  assert.equal(outcome, "applied");
  assert.equal(operations[0], "SET search_path = public, pg_temp");
  assert.match(operations[1], /current_schema/u);
  assert.equal(operations[2], "migrate");
  assert.equal(operations[3], "SET search_path = pg_catalog");
});

test("restores the hardened catalog path when migration fails", async () => {
  const operations = [];
  const expected = new Error("synthetic migration failure");
  const client = {
    query: async (statement) => {
      operations.push(statement);
      return statement.includes("current_schema")
        ? {
            rows: [
              {
                configuredPath: "public, pg_temp",
                currentSchema: "public",
                lookupPath: ["pg_catalog", "public", "pg_temp_3"],
              },
            ],
          }
        : { rows: [] };
    },
  };
  await assert.rejects(
    () =>
      withReplitMigrationSearchPath(client, async () => {
        operations.push("migrate");
        throw expected;
      }),
    (error) => error === expected,
  );
  assert.equal(operations[0], "SET search_path = public, pg_temp");
  assert.match(operations[1], /current_schema/u);
  assert.equal(operations[2], "migrate");
  assert.equal(operations[3], "SET search_path = pg_catalog");
});

test("rejects a migration path that could create outside public", () => {
  assert.throws(
    () =>
      validateReplitMigrationSearchPath({
        configuredPath: "public, pg_temp",
        currentSchema: "pg_catalog",
        lookupPath: ["pg_catalog", "public"],
      }),
    /migration search path is not the approved catalog\/public boundary/u,
  );
  assert.throws(
    () =>
      validateReplitMigrationSearchPath({
        configuredPath: "public, pg_temp",
        currentSchema: "public",
        lookupPath: ["pg_catalog", "pg_temp_3", "public"],
      }),
    /migration search path is not the approved catalog\/public boundary/u,
  );
  assert.throws(
    () =>
      validateReplitMigrationSearchPath({
        configuredPath: '"$user", public',
        currentSchema: "public",
        lookupPath: ["pg_catalog", "public"],
      }),
    /migration search path is not the approved catalog\/public boundary/u,
  );
});

test("keeps catalog-only postchecks after the scoped migration path", () => {
  assert.match(
    replitMigrationRunner,
    /export async function withReplitMigrationSearchPath[\s\S]*SET search_path = public, pg_temp[\s\S]*current_setting\('search_path'\)[\s\S]*current_schema[\s\S]*current_schemas\(true\)[\s\S]*finally[\s\S]*SET search_path = pg_catalog/u,
  );
  assert.match(
    replitMigrationRunner,
    /await withReplitMigrationSearchPath\(lockClient,[\s\S]*migrate\(drizzle\(lockClient\)[\s\S]*\);\s*\}\s*const afterRows/u,
  );
});

test(
  "applies 0007-0009 from the exact seven-entry Replit production prefix",
  { timeout: 180_000 },
  async (context) => {
    const baseDatabaseUrl = process.env.DATABASE_URL?.trim();
    if (!baseDatabaseUrl) {
      context.skip("DATABASE_URL is absent");
      return;
    }

    const parsedBaseUrl = new URL(baseDatabaseUrl);
    assert.ok(
      ["postgres:", "postgresql:"].includes(parsedBaseUrl.protocol),
      "integration DATABASE_URL must use PostgreSQL",
    );
    assert.ok(
      parsedBaseUrl.username && parsedBaseUrl.password,
      "integration DATABASE_URL must include userinfo credentials",
    );
    assert.notEqual(
      decodeURIComponent(parsedBaseUrl.username),
      "valo_app_runtime",
      "integration DATABASE_URL must use an owner identity",
    );

    const databaseName = `valo_replit_intake_${randomBytes(10).toString("hex")}`;
    const runtimePassword = randomBytes(24).toString("hex");
    const quotedDatabaseName = `"${databaseName}"`;
    const ownerDatabaseUrl = new URL(parsedBaseUrl);
    ownerDatabaseUrl.pathname = `/${databaseName}`;
    const runtimeDatabaseUrl = new URL(ownerDatabaseUrl);
    runtimeDatabaseUrl.username = "valo_app_runtime";
    runtimeDatabaseUrl.password = runtimePassword;

    const adminPool = new Pool({
      connectionString: parsedBaseUrl.href,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    let databaseCreated = false;
    let runtimeRoleCreated = false;
    let migrationPrefix;

    try {
      const role = await adminPool.query(
        "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='valo_app_runtime'",
      );
      if (role.rowCount === 0) {
        await adminPool.query("CREATE ROLE valo_app_runtime NOLOGIN");
        runtimeRoleCreated = true;
      }

      await adminPool.query(`CREATE DATABASE ${quotedDatabaseName}`);
      databaseCreated = true;
      migrationPrefix = await createMigrationPrefix(7);

      const migrationPool = new Pool({
        connectionString: ownerDatabaseUrl.href,
        max: 1,
        connectionTimeoutMillis: 10_000,
      });
      try {
        await migrate(drizzle(migrationPool), {
          migrationsFolder: migrationPrefix,
        });
      } finally {
        await migrationPool.end();
      }

      const environment = {
        NODE_ENV: "production",
        REPLIT_DEPLOYMENT: "1",
        DATABASE_URL: ownerDatabaseUrl.href,
        VALO_RUNTIME_DATABASE_URL: runtimeDatabaseUrl.href,
      };
      assert.equal(
        await runReplitIntakeMigrations(environment),
        "0007-0009 applied",
      );
      assert.equal(
        await runReplitIntakeMigrations(environment),
        "already current",
      );

      const driftPool = new Pool({
        connectionString: ownerDatabaseUrl.href,
        max: 1,
        connectionTimeoutMillis: 10_000,
      });
      try {
        const actorLimitColumnAclDefaults = await driftPool.query(`
          SELECT count(*)::integer AS "columnCount",
            count(*) FILTER (WHERE actor_limit_column.attacl IS NULL)::integer
              AS "nullAclCount"
          FROM pg_catalog.pg_attribute AS actor_limit_column
          WHERE actor_limit_column.attrelid =
              'valo_security.authenticated_actor_rate_limit_buckets'::pg_catalog.regclass
            AND actor_limit_column.attnum > 0
            AND NOT actor_limit_column.attisdropped
        `);
        assert.deepEqual(actorLimitColumnAclDefaults.rows, [
          { columnCount: 4, nullAclCount: 4 },
        ]);

        const actorLimitColumnAcls = await driftPool.query(`
          SELECT count(*)::integer AS "publicPrivilegeCount"
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
        `);
        assert.deepEqual(actorLimitColumnAcls.rows, [
          { publicPrivilegeCount: 0 },
        ]);

        const actorLimitFunctionShapes = await driftPool.query(`
          SELECT routine.proname AS "functionName",
            routine.proretset AS "returnsSet"
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = routine.pronamespace
          WHERE namespace.nspname = 'valo_security'
            AND routine.proname IN (
              'consume_authenticated_actor_rate_limit',
              'purge_expired_authenticated_rate_limit_buckets'
            )
          ORDER BY routine.proname
        `);
        assert.deepEqual(actorLimitFunctionShapes.rows, [
          {
            functionName: "consume_authenticated_actor_rate_limit",
            returnsSet: true,
          },
          {
            functionName: "purge_expired_authenticated_rate_limit_buckets",
            returnsSet: false,
          },
        ]);

        const transitionCatalog = await driftPool.query(`
          SELECT pg_catalog.format_type(routine.prorettype, NULL) AS return_type,
            pg_catalog.pg_get_function_result(routine.oid) AS function_result,
            routine.proretset AS returns_set
          FROM pg_catalog.pg_proc AS routine
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = routine.pronamespace
          WHERE namespace.nspname = 'valo_intake'
            AND routine.proname = 'transition_bid_autopsy_work_queue'
            AND pg_catalog.oidvectortypes(routine.proargtypes) = 'uuid, text, text'
        `);
        // A one-OUT-column RETURNS TABLE routine exposes the scalar OUT type
        // through prorettype while pg_get_function_result retains TABLE(...).
        assert.deepEqual(transitionCatalog.rows, [
          {
            return_type: "uuid",
            function_result: "TABLE(request_id uuid)",
            returns_set: true,
          },
        ]);

        await driftPool.query(
          "DROP INDEX valo_intake.bid_autopsy_requests_idempotency_unique",
        );
      } finally {
        await driftPool.end();
      }
      await assert.rejects(
        () => runReplitIntakeMigrations(environment),
        /object catalog is incomplete or drifted/,
      );
    } finally {
      try {
        if (migrationPrefix) {
          await rm(migrationPrefix, { recursive: true, force: true });
        }
        if (databaseCreated) {
          await adminPool.query(
            `DROP DATABASE IF EXISTS ${quotedDatabaseName} WITH (FORCE)`,
          );
        }
      } finally {
        try {
          if (runtimeRoleCreated) {
            await adminPool.query("DROP ROLE IF EXISTS valo_app_runtime");
          }
        } finally {
          await adminPool.end();
        }
      }
    }
  },
);
