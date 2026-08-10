import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  EXPECTED_REPLIT_INTAKE_SECURITY,
  EXPECTED_REPLIT_MIGRATIONS,
  runReplitIntakeMigrations,
  validateLocalReplitMigrationManifest,
  validateReplitIntakeCatalog,
  validateReplitIntakeSchemaState,
  validateReplitMigrationEnvironment,
  validateReplitMigrationJournal,
} from "./replit-intake-migrations.mjs";

const { Pool } = pg;
const migrationsDirectory = resolve(import.meta.dirname, "../migrations");

const journalRows = (count) =>
  EXPECTED_REPLIT_MIGRATIONS.slice(0, count).map((migration) => ({
    id: migration.id,
    hash: migration.hash,
    createdAt: migration.createdAt,
  }));

test("accepts only the exact approved pending and complete journal states", () => {
  assert.equal(validateReplitMigrationJournal(journalRows(3)), "pending");
  assert.equal(
    validateReplitMigrationJournal(journalRows(6)),
    "already_applied",
  );
  assert.throws(
    () => validateReplitMigrationJournal(journalRows(4)),
    /not the approved 0000-0002 or 0000-0005 state/,
  );
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
    validateReplitIntakeSchemaState("already_applied", "valo_intake"),
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("pending", "valo_intake"),
    /exists before/,
  );
  assert.throws(
    () => validateReplitIntakeSchemaState("already_applied", null),
    /absent after/,
  );
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

test(
  "rehearses idempotent Replit catalog attestation on disposable PostgreSQL 16",
  { timeout: 120_000 },
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

      const migrationPool = new Pool({
        connectionString: ownerDatabaseUrl.href,
        max: 1,
        connectionTimeoutMillis: 10_000,
      });
      try {
        await migrate(drizzle(migrationPool), {
          migrationsFolder: migrationsDirectory,
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
      await runReplitIntakeMigrations(environment);
      await runReplitIntakeMigrations(environment);

      const driftPool = new Pool({
        connectionString: ownerDatabaseUrl.href,
        max: 1,
        connectionTimeoutMillis: 10_000,
      });
      try {
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
