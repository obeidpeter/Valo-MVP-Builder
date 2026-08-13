import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

const MIGRATIONS_DIRECTORY = resolve(import.meta.dirname, "../migrations");
const MIGRATION_JOURNAL_PATH = resolve(
  MIGRATIONS_DIRECTORY,
  "meta/_journal.json",
);
const REPLIT_MIGRATION_LOCK_NAMESPACE = 1_987_650_632;
const REPLIT_MIGRATION_LOCK_KEY = 3_005;

export const EXPECTED_REPLIT_MIGRATIONS = Object.freeze([
  Object.freeze({
    id: 1,
    tag: "0000_tense_vapor",
    createdAt: "1786221409612",
    hash: "ae95d198bff43d732b27ed9e3f1ab5254141cad32f293510607fde6b0732c35e",
  }),
  Object.freeze({
    id: 2,
    tag: "0001_tenant_rls",
    createdAt: "1786221441937",
    hash: "e41f7dbd83af38e6924480e88ecea95b67473ad52339abfd1a1a35d7a6729caf",
  }),
  Object.freeze({
    id: 3,
    tag: "0002_audit_integrity_boundary",
    createdAt: "1786251600000",
    hash: "e254b3f568abf509da238b1ae6bb2aca93d60a7a3819a18a59cf18797edde9b5",
  }),
  Object.freeze({
    id: 4,
    tag: "0003_zippy_skrulls",
    createdAt: "1786338364994",
    hash: "59b510c74fe3301b84ddd2537c15576fba00d72e2c90b05644a8dbe22dcbee11",
  }),
  Object.freeze({
    id: 5,
    tag: "0004_dizzy_virginia_dare",
    createdAt: "1786339089360",
    hash: "60ba00bd36f54895f8c52505da0be9acadd8b96035cd55ee9a41b4fa12beab02",
  }),
  Object.freeze({
    id: 6,
    tag: "0005_tranquil_jack_power",
    createdAt: "1786339224638",
    hash: "d00dd4369d665b040334b4b534dde9c609a2baf0145105563ce850498911c741",
  }),
  Object.freeze({
    id: 7,
    tag: "0006_lead_operations_queue",
    createdAt: "1786425600000",
    hash: "389885eed7d81b50ed80f825dc9f59aeb9a04a22de4decf983dcb5ca28319a10",
  }),
  Object.freeze({
    id: 8,
    tag: "0007_storage_lifecycle_indexes",
    createdAt: "1786622400000",
    hash: "64b6ddfbd46d90cd9f57c7b26280b8a3114d504b1706ca3463b4d007e0b80280",
  }),
  Object.freeze({
    id: 9,
    tag: "0008_production_assurance",
    createdAt: "1786708800000",
    hash: "f72fc4ba4aa5e6c6d4e49a9654339c6dd90db5e78003804f0f4dd9fcfb1d29a8",
  }),
]);

const EXPECTED_INTAKE_TABLES = Object.freeze([
  Object.freeze({ name: "bid_autopsy_rate_limits", type: "BASE TABLE" }),
  Object.freeze({ name: "bid_autopsy_requests", type: "BASE TABLE" }),
]);

const EXPECTED_INTAKE_TABLE_DDL = `
  CREATE TEMP TABLE bid_autopsy_requests (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
    idempotency_key_hash text NOT NULL,
    payload_fingerprint text NOT NULL,
    contact_name text NOT NULL,
    company_name text NOT NULL,
    business_email text NOT NULL,
    business_telephone text NOT NULL,
    tender_category text NOT NULL,
    bid_stage text NOT NULL,
    tender_deadline date,
    preferred_contact_method text NOT NULL,
    privacy_notice_version text NOT NULL,
    destination text DEFAULT 'database' NOT NULL,
    delivery_status text DEFAULT 'stored' NOT NULL,
    received_at timestamp with time zone DEFAULT pg_catalog.now() NOT NULL,
    retention_until timestamp with time zone NOT NULL,
    CONSTRAINT bid_autopsy_requests_idempotency_hash_check
      CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT bid_autopsy_requests_payload_fingerprint_check
      CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT bid_autopsy_requests_contact_name_check
      CHECK (pg_catalog.char_length(contact_name) BETWEEN 2 AND 120
        AND contact_name !~ '[[:cntrl:]]'),
    CONSTRAINT bid_autopsy_requests_company_name_check
      CHECK (pg_catalog.char_length(company_name) BETWEEN 2 AND 160
        AND company_name !~ '[[:cntrl:]]'),
    CONSTRAINT bid_autopsy_requests_email_check
      CHECK (pg_catalog.char_length(business_email) BETWEEN 5 AND 254
        AND business_email = pg_catalog.lower(business_email)
        AND business_email !~ '[[:cntrl:]]'),
    CONSTRAINT bid_autopsy_requests_telephone_check
      CHECK (pg_catalog.char_length(business_telephone) BETWEEN 7 AND 32
        AND business_telephone !~ '[[:cntrl:]]'),
    CONSTRAINT bid_autopsy_requests_category_check
      CHECK (tender_category IN
        ('federal_public','oil_and_gas','donor_funded','other')),
    CONSTRAINT bid_autopsy_requests_stage_check
      CHECK (bid_stage IN ('live','draft','previously_submitted')),
    CONSTRAINT bid_autopsy_requests_contact_method_check
      CHECK (preferred_contact_method IN ('email','telephone')),
    CONSTRAINT bid_autopsy_requests_privacy_version_check
      CHECK (pg_catalog.char_length(privacy_notice_version) BETWEEN 1 AND 40),
    CONSTRAINT bid_autopsy_requests_destination_check
      CHECK (destination = 'database'),
    CONSTRAINT bid_autopsy_requests_delivery_status_check
      CHECK (delivery_status IN ('stored','follow_up_started','closed')),
    CONSTRAINT bid_autopsy_requests_retention_until_check
      CHECK (retention_until > received_at
        AND retention_until <= received_at + interval '3650 days')
  ) ON COMMIT DROP;
  CREATE UNIQUE INDEX bid_autopsy_requests_idempotency_unique
    ON bid_autopsy_requests USING btree (idempotency_key_hash);
  CREATE INDEX bid_autopsy_requests_delivery_received_idx
    ON bid_autopsy_requests USING btree (delivery_status, received_at);

  CREATE TEMP TABLE bid_autopsy_rate_limits (
    client_key_hash text PRIMARY KEY NOT NULL,
    request_count integer NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT bid_autopsy_rate_limits_client_hash_check
      CHECK (client_key_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT bid_autopsy_rate_limits_count_check
      CHECK (request_count BETWEEN 1 AND 101),
    CONSTRAINT bid_autopsy_rate_limits_window_check
      CHECK (expires_at > window_started_at
        AND expires_at <= window_started_at + interval '1 hour')
  ) ON COMMIT DROP;
  CREATE INDEX bid_autopsy_rate_limits_expires_idx
    ON bid_autopsy_rate_limits USING btree (expires_at);
`;

const OWNER_TABLE_PRIVILEGES = Object.freeze([
  "DELETE",
  "INSERT",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
]);

const expectedTableGrants = EXPECTED_INTAKE_TABLES.flatMap(({ name }) =>
  OWNER_TABLE_PRIVILEGES.map((privilege) => [
    name,
    "$OWNER",
    "$OWNER",
    privilege,
    false,
  ]),
);

export const EXPECTED_REPLIT_INTAKE_SECURITY = Object.freeze({
  schema: Object.freeze([
    true,
    Object.freeze([
      Object.freeze(["$OWNER", "$OWNER", "CREATE", false]),
      Object.freeze(["$OWNER", "$OWNER", "USAGE", false]),
      Object.freeze(["$OWNER", "$ROLE:valo_app_runtime", "USAGE", false]),
    ]),
  ]),
  tableGrants: Object.freeze(expectedTableGrants.map(Object.freeze)),
  columnGrants: Object.freeze([]),
  functions: Object.freeze([
    Object.freeze([
      "consume_bid_autopsy_rate_limit",
      "text, integer, integer",
      "p_client_key_hash text, p_window_seconds integer, p_max_requests integer",
      "TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)",
      Object.freeze([
        "p_client_key_hash",
        "p_window_seconds",
        "p_max_requests",
        "allowed",
        "remaining",
        "reset_at",
      ]),
      Object.freeze(["i", "i", "i", "t", "t", "t"]),
      Object.freeze([
        "text",
        "integer",
        "integer",
        "boolean",
        "integer",
        "timestamp with time zone",
      ]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      true,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "2b7bc1eedfc4de96716cb1bcaa71b75516d21416103f87b5ba5f8f0a8a04fcff",
    ]),
    Object.freeze([
      "get_bid_autopsy_contact_handoff",
      "uuid",
      "p_request_id uuid",
      "TABLE(request_id uuid, contact_name text, preferred_contact_method text, contact_value text)",
      Object.freeze([
        "p_request_id",
        "request_id",
        "contact_name",
        "preferred_contact_method",
        "contact_value",
      ]),
      Object.freeze(["i", "t", "t", "t", "t"]),
      Object.freeze(["uuid", "uuid", "text", "text", "text"]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      true,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "bb803997163ca8502955f5c1a71f13226a9d21d04935ce0139f9b1e63f6f4dbe",
    ]),
    Object.freeze([
      "list_bid_autopsy_work_queue",
      "integer",
      "p_limit integer",
      "TABLE(request_id uuid, organisation_label text, tender_category text, bid_stage text, tender_deadline date, delivery_status text, received_at timestamp with time zone)",
      Object.freeze([
        "p_limit",
        "request_id",
        "organisation_label",
        "tender_category",
        "bid_stage",
        "tender_deadline",
        "delivery_status",
        "received_at",
      ]),
      Object.freeze(["i", "t", "t", "t", "t", "t", "t", "t"]),
      Object.freeze([
        "integer",
        "uuid",
        "text",
        "text",
        "text",
        "date",
        "text",
        "timestamp with time zone",
      ]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      true,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "6750d49e15f7d6966b1bf3e24370e0d4001bdb7c18801900c379fafbfa4be4ca",
    ]),
    Object.freeze([
      "purge_expired_bid_autopsy_rate_limits",
      "",
      "",
      "integer",
      Object.freeze([]),
      Object.freeze([]),
      Object.freeze([]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      false,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "4ece097c1958c669ef9891640d65b8c61fc40d26c845841d0fc2ca03f2515df2",
    ]),
    Object.freeze([
      "purge_expired_bid_autopsy_requests",
      "",
      "",
      "integer",
      Object.freeze([]),
      Object.freeze([]),
      Object.freeze([]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      false,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "2d88ed14bbb8779f38b105983900eb47100c6771ce9e1fca29b9b4d93f58ff52",
    ]),
    Object.freeze([
      "store_bid_autopsy_request",
      "text, text, text, text, text, text, text, text, date, text, text, integer",
      "p_idempotency_key_hash text, p_payload_fingerprint text, p_contact_name text, p_company_name text, p_business_email text, p_business_telephone text, p_tender_category text, p_bid_stage text, p_tender_deadline date, p_preferred_contact_method text, p_privacy_notice_version text, p_retention_days integer",
      "TABLE(request_id uuid, received_at timestamp with time zone, replayed boolean, payload_matches boolean)",
      Object.freeze([
        "p_idempotency_key_hash",
        "p_payload_fingerprint",
        "p_contact_name",
        "p_company_name",
        "p_business_email",
        "p_business_telephone",
        "p_tender_category",
        "p_bid_stage",
        "p_tender_deadline",
        "p_preferred_contact_method",
        "p_privacy_notice_version",
        "p_retention_days",
        "request_id",
        "received_at",
        "replayed",
        "payload_matches",
      ]),
      Object.freeze([
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "i",
        "t",
        "t",
        "t",
        "t",
      ]),
      Object.freeze([
        "text",
        "text",
        "text",
        "text",
        "text",
        "text",
        "text",
        "text",
        "date",
        "text",
        "text",
        "integer",
        "uuid",
        "timestamp with time zone",
        "boolean",
        "boolean",
      ]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      true,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "d97eff1d25e172cec633476c0e28a04ead4004cf0e23e794a1c55e4afc7c0430",
    ]),
    Object.freeze([
      "transition_bid_autopsy_work_queue",
      "uuid, text, text",
      "p_request_id uuid, p_expected_status text, p_next_status text",
      "TABLE(request_id uuid)",
      Object.freeze([
        "p_request_id",
        "p_expected_status",
        "p_next_status",
        "request_id",
      ]),
      Object.freeze(["i", "i", "i", "t"]),
      Object.freeze(["uuid", "text", "text", "uuid"]),
      "plpgsql",
      "f",
      true,
      false,
      false,
      "v",
      "u",
      true,
      Object.freeze(["search_path=pg_catalog"]),
      true,
      0,
      true,
      "7a52e4670feb5f3c0a55dbfef8ebe1e6781a06f9cf3154e51fefb273f68af22b",
    ]),
  ]),
  functionGrants: Object.freeze([
    Object.freeze([
      "consume_bid_autopsy_rate_limit",
      "text, integer, integer",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "get_bid_autopsy_contact_handoff",
      "uuid",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "get_bid_autopsy_contact_handoff",
      "uuid",
      "$OWNER",
      "$ROLE:valo_app_runtime",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "list_bid_autopsy_work_queue",
      "integer",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "list_bid_autopsy_work_queue",
      "integer",
      "$OWNER",
      "$ROLE:valo_app_runtime",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "consume_bid_autopsy_rate_limit",
      "text, integer, integer",
      "$OWNER",
      "$ROLE:valo_app_runtime",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "purge_expired_bid_autopsy_rate_limits",
      "",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "purge_expired_bid_autopsy_requests",
      "",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "store_bid_autopsy_request",
      "text, text, text, text, text, text, text, text, date, text, text, integer",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "transition_bid_autopsy_work_queue",
      "uuid, text, text",
      "$OWNER",
      "$OWNER",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "transition_bid_autopsy_work_queue",
      "uuid, text, text",
      "$OWNER",
      "$ROLE:valo_app_runtime",
      "EXECUTE",
      false,
    ]),
    Object.freeze([
      "store_bid_autopsy_request",
      "text, text, text, text, text, text, text, text, date, text, text, integer",
      "$OWNER",
      "$ROLE:valo_app_runtime",
      "EXECUTE",
      false,
    ]),
  ]),
});

function fail(message) {
  throw new Error(`Replit intake migration gate failed: ${message}`);
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function collapseSqlWhitespace(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
}

function compareCanonical(left, right) {
  const leftKey = JSON.stringify(left);
  const rightKey = JSON.stringify(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function canonicalRows(rows) {
  return [...rows].sort(compareCanonical);
}

export function validateReplitMigrationJournal(rows) {
  if (!Array.isArray(rows)) fail("migration journal result is malformed");
  if (![3, 6, 7, 8, EXPECTED_REPLIT_MIGRATIONS.length].includes(rows.length)) {
    fail(
      "production journal is not the approved 0000-0002, 0000-0005, 0000-0006, 0000-0007, or 0000-0008 state",
    );
  }

  for (const [index, row] of rows.entries()) {
    const expected = EXPECTED_REPLIT_MIGRATIONS[index];
    if (
      Number(row?.id) !== expected.id ||
      row?.hash !== expected.hash ||
      String(row?.createdAt) !== expected.createdAt
    ) {
      fail(`production journal entry ${index + 1} is drifted`);
    }
  }

  if (rows.length === EXPECTED_REPLIT_MIGRATIONS.length) {
    return "already_applied";
  }
  return rows.length === 8
    ? "assurance_upgrade_pending"
    : rows.length === 7
      ? "storage_upgrade_pending"
      : rows.length === 6
        ? "upgrade_pending"
        : "pending";
}

export function validateReplitIntakeSchemaState(mode, schemaName) {
  const present = schemaName === "valo_intake";
  if (mode === "pending" && present) {
    fail("valo_intake exists before its approved journal entries");
  }
  if (
    [
      "upgrade_pending",
      "storage_upgrade_pending",
      "assurance_upgrade_pending",
      "already_applied",
    ].includes(mode) &&
    !present
  ) {
    fail("valo_intake is absent after its approved journal entries");
  }
}

export function shouldApplyReplitMigrations(mode) {
  return [
    "pending",
    "upgrade_pending",
    "storage_upgrade_pending",
    "assurance_upgrade_pending",
  ].includes(mode);
}

function hasExactIntakeTableCatalogShape(catalog) {
  return (
    catalog !== null &&
    typeof catalog === "object" &&
    catalog.format === "valo.intake-table-catalog.v1" &&
    Array.isArray(catalog.relations) &&
    catalog.relations.length === 2 &&
    Array.isArray(catalog.columns) &&
    catalog.columns.length === 20 &&
    Array.isArray(catalog.constraints) &&
    catalog.constraints.length === 18 &&
    Array.isArray(catalog.indexes) &&
    catalog.indexes.length === 5 &&
    Array.isArray(catalog.triggers) &&
    catalog.triggers.length === 0 &&
    Array.isArray(catalog.rules) &&
    catalog.rules.length === 0 &&
    Array.isArray(catalog.inheritance) &&
    catalog.inheritance.length === 0 &&
    Array.isArray(catalog.policies) &&
    catalog.policies.length === 0
  );
}

function canonicalIntakeSecurity(catalog) {
  if (
    catalog === null ||
    typeof catalog !== "object" ||
    !Array.isArray(catalog.schema) ||
    catalog.schema.length !== 2 ||
    typeof catalog.schema[0] !== "boolean" ||
    !Array.isArray(catalog.schema[1]) ||
    catalog.schema[1].length !== 3 ||
    !Array.isArray(catalog.tableGrants) ||
    catalog.tableGrants.length !== 14 ||
    !Array.isArray(catalog.columnGrants) ||
    catalog.columnGrants.length !== 0 ||
    !Array.isArray(catalog.functions) ||
    catalog.functions.length !== 7 ||
    !Array.isArray(catalog.functionGrants) ||
    catalog.functionGrants.length !== 12
  ) {
    return null;
  }
  return {
    schema: [catalog.schema[0], canonicalRows(catalog.schema[1])],
    tableGrants: canonicalRows(catalog.tableGrants),
    columnGrants: [],
    functions: canonicalRows(catalog.functions),
    functionGrants: canonicalRows(catalog.functionGrants),
  };
}

export function validateReplitIntakeCatalog(catalog) {
  const actualSecurity = canonicalIntakeSecurity(catalog?.security);
  const expectedSecurity = canonicalIntakeSecurity(
    EXPECTED_REPLIT_INTAKE_SECURITY,
  );
  if (
    !catalog ||
    !hasExactIntakeTableCatalogShape(catalog.tables) ||
    !hasExactIntakeTableCatalogShape(catalog.referenceTables) ||
    JSON.stringify(catalog.tables) !==
      JSON.stringify(catalog.referenceTables) ||
    !actualSecurity ||
    JSON.stringify(actualSecurity) !== JSON.stringify(expectedSecurity)
  ) {
    fail("valo_intake object catalog is incomplete or drifted");
  }
}

function databaseIdentity(connectionString, label) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail(`${label} is malformed`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail(`${label} must use the PostgreSQL protocol`);
  }
  if (parsed.hash) fail(`${label} must not contain a fragment`);
  for (const key of ["user", "username", "password"]) {
    if (parsed.searchParams.has(key)) {
      fail(`${label} must carry credentials only in URL userinfo`);
    }
  }
  let username;
  let password;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    fail(`${label} contains malformed credential encoding`);
  }
  if (!username || !password) {
    fail(`${label} must include userinfo credentials`);
  }
  parsed.username = "";
  parsed.password = "";
  return { target: parsed.href, username, password };
}

export function validateReplitMigrationEnvironment(environment) {
  if (
    environment.NODE_ENV !== "production" ||
    environment.REPLIT_DEPLOYMENT !== "1"
  ) {
    fail("the bounded migration runner is restricted to Replit production");
  }
  const ownerUrl = environment.DATABASE_URL?.trim();
  const runtimeUrl = environment.VALO_RUNTIME_DATABASE_URL?.trim();
  if (!ownerUrl) fail("DATABASE_URL is required for the migration owner");
  if (!runtimeUrl) fail("VALO_RUNTIME_DATABASE_URL is required for startup");
  const ownerIdentity = databaseIdentity(ownerUrl, "DATABASE_URL");
  const runtimeIdentity = databaseIdentity(
    runtimeUrl,
    "VALO_RUNTIME_DATABASE_URL",
  );
  if (
    ownerIdentity.username === runtimeIdentity.username ||
    ownerIdentity.password === runtimeIdentity.password
  ) {
    fail(
      "the runtime database identity and credential must differ from the migration owner",
    );
  }
  if (runtimeIdentity.username !== "valo_app_runtime") {
    fail("VALO_RUNTIME_DATABASE_URL must name the fixed runtime role");
  }
  if (ownerIdentity.target !== runtimeIdentity.target) {
    fail("owner and runtime database URLs must target the same database");
  }
  return ownerUrl;
}

export async function validateLocalReplitMigrationManifest() {
  const journal = JSON.parse(await readFile(MIGRATION_JOURNAL_PATH, "utf8"));
  const entries = journal?.entries;
  if (
    journal?.version !== "7" ||
    journal?.dialect !== "postgresql" ||
    !Array.isArray(entries) ||
    entries.length !== EXPECTED_REPLIT_MIGRATIONS.length
  ) {
    fail("source migration journal is not the frozen nine-entry manifest");
  }

  for (const [index, expected] of EXPECTED_REPLIT_MIGRATIONS.entries()) {
    const entry = entries[index];
    if (
      entry?.idx !== index ||
      entry?.version !== "7" ||
      entry?.tag !== expected.tag ||
      String(entry?.when) !== expected.createdAt ||
      entry?.breakpoints !== true
    ) {
      fail(`source migration manifest entry ${index} is drifted`);
    }
    const sqlBytes = await readFile(
      resolve(MIGRATIONS_DIRECTORY, `${expected.tag}.sql`),
    );
    if (sha256(sqlBytes) !== expected.hash) {
      fail(`source migration ${expected.tag} hash is drifted`);
    }
  }
}

async function readProductionJournal(client) {
  const result = await client.query(`
    SELECT id, hash, created_at::pg_catalog.text AS "createdAt"
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `);
  return result.rows;
}

async function validatePostgresCatalogVersion(client) {
  const result = await client.query("SHOW server_version_num");
  const version = Number(result.rows[0]?.server_version_num);
  if (!Number.isInteger(version) || Math.floor(version / 10_000) !== 16) {
    fail("the intake catalog contract requires PostgreSQL 16");
  }
}

async function readIntakeSchemaName(client) {
  const result = await client.query(
    "SELECT pg_catalog.to_regnamespace('valo_intake')::pg_catalog.text AS name",
  );
  return result.rows[0]?.name ?? null;
}

async function readTableCatalog(
  client,
  schemaName,
  normalizeTemporary = false,
) {
  const relations = await client.query(
    `SELECT relation.relname, relation.relkind, relation.relpersistence,
       relation.relrowsecurity, relation.relforcerowsecurity,
       relation.relreplident, relation.relispartition,
       relation.relhasindex, relation.relhasrules, relation.relhastriggers,
       relation.relchecks,
       relation.relowner=(SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname=current_user) AS owned_by_current_user,
       COALESCE(relation.reloptions,ARRAY[]::text[]) AS relation_options
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname=$1
       AND relation.relkind IN ('r','p','S','v','m','f')
     ORDER BY relation.relkind,relation.relname`,
    [schemaName],
  );
  const columns = await client.query(
    `SELECT relation.relname, attribute.attnum, attribute.attname,
       pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)
         AS data_type,
       attribute.attnotnull, attribute.attidentity, attribute.attgenerated,
       CASE WHEN attribute.attcollation=0 THEN ''
         ELSE collation_namespace.nspname || '.' || selected_collation.collname END
         AS collation,
       pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,false)
         AS default_expression,
       attribute.attstorage, attribute.attcompression
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=attribute.attrelid
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     LEFT JOIN pg_catalog.pg_attrdef AS default_value
       ON default_value.adrelid=attribute.attrelid
      AND default_value.adnum=attribute.attnum
     LEFT JOIN pg_catalog.pg_collation AS selected_collation
       ON selected_collation.oid=attribute.attcollation
     LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
       ON collation_namespace.oid=selected_collation.collnamespace
     WHERE namespace.nspname=$1 AND relation.relkind IN ('r','p')
       AND attribute.attnum>0 AND NOT attribute.attisdropped
     ORDER BY relation.relname,attribute.attnum`,
    [schemaName],
  );
  const constraints = await client.query(
    `SELECT relation.relname, constraint_record.conname,
       constraint_record.contype, constraint_record.convalidated,
       constraint_record.condeferrable, constraint_record.condeferred,
       constraint_record.connoinherit,
       pg_catalog.pg_get_constraintdef(constraint_record.oid,false)
         AS definition
     FROM pg_catalog.pg_constraint AS constraint_record
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=constraint_record.conrelid
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname=$1
     ORDER BY relation.relname,constraint_record.conname`,
    [schemaName],
  );
  const indexes = await client.query(
    `SELECT relation.relname, index_relation.relname AS index_name,
       access_method.amname,
       index_relation.relowner=(SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname=current_user) AS owned_by_current_user,
       index_record.indisunique, index_record.indisprimary,
       index_record.indisexclusion, index_record.indimmediate,
       index_record.indisvalid, index_record.indisready,
       index_record.indislive, index_record.indisreplident,
       index_record.indisclustered, index_record.indnkeyatts,
       index_record.indnatts,
       ARRAY(
         SELECT CASE WHEN indexed_column.attnum=0
           THEN pg_catalog.pg_get_indexdef(
             index_record.indexrelid,indexed_column.ordinality::integer,false
           )
           ELSE attribute.attname END
         FROM pg_catalog.unnest(index_record.indkey::smallint[])
           WITH ORDINALITY AS indexed_column(attnum,ordinality)
         LEFT JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid=index_record.indrelid
          AND attribute.attnum=indexed_column.attnum
         ORDER BY indexed_column.ordinality
       ) AS indexed_values,
       ARRAY(
         SELECT opclass_namespace.nspname || '.' || opclass.opcname
         FROM pg_catalog.unnest(index_record.indclass::oid[])
           WITH ORDINALITY AS selected_opclass(opclass_oid,ordinality)
         JOIN pg_catalog.pg_opclass AS opclass
           ON opclass.oid=selected_opclass.opclass_oid
         JOIN pg_catalog.pg_namespace AS opclass_namespace
           ON opclass_namespace.oid=opclass.opcnamespace
         ORDER BY selected_opclass.ordinality
       ) AS operator_classes,
       ARRAY(
         SELECT CASE WHEN selected_collation.collation_oid=0 THEN ''
           ELSE collation_namespace.nspname || '.' || index_collation.collname END
         FROM pg_catalog.unnest(index_record.indcollation::oid[])
           WITH ORDINALITY AS selected_collation(collation_oid,ordinality)
         LEFT JOIN pg_catalog.pg_collation AS index_collation
           ON index_collation.oid=selected_collation.collation_oid
         LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
           ON collation_namespace.oid=index_collation.collnamespace
         ORDER BY selected_collation.ordinality
       ) AS collations,
       index_record.indoption::smallint[] AS index_options,
       pg_catalog.pg_get_expr(
         index_record.indexprs,index_record.indrelid,false
       ) AS expressions,
       pg_catalog.pg_get_expr(
         index_record.indpred,index_record.indrelid,false
       ) AS predicate,
       COALESCE(index_relation.reloptions,ARRAY[]::text[]) AS relation_options
     FROM pg_catalog.pg_index AS index_record
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=index_record.indrelid
     JOIN pg_catalog.pg_class AS index_relation
       ON index_relation.oid=index_record.indexrelid
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     JOIN pg_catalog.pg_am AS access_method
       ON access_method.oid=index_relation.relam
     WHERE namespace.nspname=$1
     ORDER BY relation.relname,index_relation.relname`,
    [schemaName],
  );
  const triggers = await client.query(
    `SELECT relation.relname, trigger_record.tgname,
       trigger_record.tgenabled,
       pg_catalog.pg_get_triggerdef(trigger_record.oid,false) AS definition
     FROM pg_catalog.pg_trigger AS trigger_record
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=trigger_record.tgrelid
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname=$1 AND NOT trigger_record.tgisinternal
     ORDER BY relation.relname,trigger_record.tgname`,
    [schemaName],
  );
  const rules = await client.query(
    `SELECT relation.relname,rewrite_rule.rulename,rewrite_rule.ev_type,
       rewrite_rule.ev_enabled,rewrite_rule.is_instead,
       pg_catalog.pg_get_ruledef(rewrite_rule.oid,false) AS definition
     FROM pg_catalog.pg_rewrite AS rewrite_rule
     JOIN pg_catalog.pg_class AS relation
       ON relation.oid=rewrite_rule.ev_class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname=$1 AND rewrite_rule.rulename<>'_RETURN'
     ORDER BY relation.relname,rewrite_rule.rulename`,
    [schemaName],
  );
  const inheritance = await client.query(
    `SELECT child_namespace.nspname AS child_schema,
       child.relname AS child_name,
       parent_namespace.nspname AS parent_schema,
       parent.relname AS parent_name,
       inheritance_record.inhseqno
     FROM pg_catalog.pg_inherits AS inheritance_record
     JOIN pg_catalog.pg_class AS child
       ON child.oid=inheritance_record.inhrelid
     JOIN pg_catalog.pg_namespace AS child_namespace
       ON child_namespace.oid=child.relnamespace
     JOIN pg_catalog.pg_class AS parent
       ON parent.oid=inheritance_record.inhparent
     JOIN pg_catalog.pg_namespace AS parent_namespace
       ON parent_namespace.oid=parent.relnamespace
     WHERE child_namespace.nspname=$1 OR parent_namespace.nspname=$1
     ORDER BY child_schema,child_name,inheritance_record.inhseqno,
       parent_schema,parent_name`,
    [schemaName],
  );
  const policies = await client.query(
    `SELECT tablename,policyname,permissive,roles::text,cmd,qual,with_check
     FROM pg_catalog.pg_policies
     WHERE schemaname=$1
     ORDER BY tablename,policyname`,
    [schemaName],
  );

  return {
    format: "valo.intake-table-catalog.v1",
    relations: canonicalRows(
      relations.rows.map((row) => [
        row.relname,
        row.relkind,
        normalizeTemporary ? "p" : row.relpersistence,
        row.relrowsecurity,
        row.relforcerowsecurity,
        row.relreplident,
        row.relispartition,
        row.relhasindex,
        row.relhasrules,
        row.relhastriggers,
        Number(row.relchecks),
        row.owned_by_current_user,
        [...row.relation_options].sort(),
      ]),
    ),
    columns: canonicalRows(
      columns.rows.map((row) => [
        row.relname,
        Number(row.attnum),
        row.attname,
        row.data_type,
        row.attnotnull,
        row.attidentity,
        row.attgenerated,
        row.collation,
        collapseSqlWhitespace(row.default_expression),
        row.attstorage,
        row.attcompression,
      ]),
    ),
    constraints: canonicalRows(
      constraints.rows.map((row) => [
        row.relname,
        row.conname,
        row.contype,
        row.convalidated,
        row.condeferrable,
        row.condeferred,
        row.connoinherit,
        collapseSqlWhitespace(row.definition),
      ]),
    ),
    indexes: canonicalRows(
      indexes.rows.map((row) => [
        row.relname,
        row.index_name,
        row.amname,
        row.owned_by_current_user,
        row.indisunique,
        row.indisprimary,
        row.indisexclusion,
        row.indimmediate,
        row.indisvalid,
        row.indisready,
        row.indislive,
        row.indisreplident,
        row.indisclustered,
        Number(row.indnkeyatts),
        Number(row.indnatts),
        row.indexed_values,
        row.operator_classes,
        row.collations,
        row.index_options,
        collapseSqlWhitespace(row.expressions),
        collapseSqlWhitespace(row.predicate),
        [...row.relation_options].sort(),
      ]),
    ),
    triggers: canonicalRows(
      triggers.rows.map((row) => [
        row.relname,
        row.tgname,
        row.tgenabled,
        collapseSqlWhitespace(row.definition),
      ]),
    ),
    rules: canonicalRows(
      rules.rows.map((row) => [
        row.relname,
        row.rulename,
        row.ev_type,
        row.ev_enabled,
        row.is_instead,
        collapseSqlWhitespace(row.definition),
      ]),
    ),
    inheritance: canonicalRows(
      inheritance.rows.map((row) => [
        row.child_schema,
        row.child_name,
        row.parent_schema,
        row.parent_name,
        Number(row.inhseqno),
      ]),
    ),
    policies: canonicalRows(
      policies.rows.map((row) => [
        row.tablename,
        row.policyname,
        row.permissive,
        row.roles,
        row.cmd,
        collapseSqlWhitespace(row.qual),
        collapseSqlWhitespace(row.with_check),
      ]),
    ),
  };
}

async function readComparedTableCatalogs(client) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
    const actual = await readTableCatalog(client, "valo_intake");
    await client.query(EXPECTED_INTAKE_TABLE_DDL);
    const namespace = await client.query(
      "SELECT pg_catalog.pg_my_temp_schema()::pg_catalog.regnamespace::pg_catalog.text AS name",
    );
    const reference = await readTableCatalog(
      client,
      namespace.rows[0]?.name,
      true,
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return { actual, reference };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  }
}

async function readIntakeSecurityCatalog(client) {
  const schema = await client.query(`
    SELECT namespace.nspowner=(SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname=current_user) AS owned_by_current_user
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname='valo_intake'
  `);
  const schemaGrants = await client.query(`
    SELECT CASE WHEN grant_record.grantor=namespace.nspowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantor) END AS grantor,
      CASE WHEN grant_record.grantee=0 THEN '$PUBLIC'
        WHEN grant_record.grantee=namespace.nspowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantee) END AS grantee,
      grant_record.privilege_type, grant_record.is_grantable
    FROM pg_catalog.pg_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(namespace.nspacl,
        pg_catalog.acldefault('n',namespace.nspowner))
    ) AS grant_record
    WHERE namespace.nspname='valo_intake'
    ORDER BY grantor,grantee,privilege_type
  `);
  const tableGrants = await client.query(`
    SELECT relation.relname,
      CASE WHEN grant_record.grantor=relation.relowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantor) END AS grantor,
      CASE WHEN grant_record.grantee=0 THEN '$PUBLIC'
        WHEN grant_record.grantee=relation.relowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantee) END AS grantee,
      grant_record.privilege_type, grant_record.is_grantable
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl,
        pg_catalog.acldefault('r',relation.relowner))
    ) AS grant_record
    WHERE namespace.nspname='valo_intake' AND relation.relkind IN ('r','p')
    ORDER BY relation.relname,grantor,grantee,privilege_type
  `);
  const columnGrants = await client.query(`
    SELECT relation.relname,attribute.attname,
      CASE WHEN grant_record.grantor=relation.relowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantor) END AS grantor,
      CASE WHEN grant_record.grantee=0 THEN '$PUBLIC'
        WHEN grant_record.grantee=relation.relowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantee) END AS grantee,
      grant_record.privilege_type, grant_record.is_grantable
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid=attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS grant_record
    WHERE namespace.nspname='valo_intake' AND relation.relkind IN ('r','p')
      AND attribute.attnum>0 AND NOT attribute.attisdropped
    ORDER BY relation.relname,attribute.attname,grantor,grantee,privilege_type
  `);
  const functions = await client.query(`
    SELECT function_record.proname,
      pg_catalog.oidvectortypes(function_record.proargtypes) AS arguments,
      pg_catalog.pg_get_function_identity_arguments(function_record.oid)
        AS identity_arguments,
      pg_catalog.pg_get_function_result(function_record.oid) AS function_result,
      COALESCE(function_record.proargnames,ARRAY[]::text[]) AS argument_names,
      ARRAY(
        SELECT argument_mode::pg_catalog.text
        FROM pg_catalog.unnest(COALESCE(
          function_record.proargmodes,ARRAY[]::"char"[]
        )) AS argument_mode
      ) AS argument_modes,
      ARRAY(
        SELECT pg_catalog.format_type(argument_type,NULL)
        FROM pg_catalog.unnest(COALESCE(
          function_record.proallargtypes,function_record.proargtypes::oid[]
        )) WITH ORDINALITY AS selected_type(argument_type,ordinality)
        ORDER BY selected_type.ordinality
      ) AS all_argument_types,
      language.lanname, function_record.prokind::pg_catalog.text AS prokind,
      function_record.prosecdef, function_record.proleakproof,
      function_record.proisstrict,
      function_record.provolatile::pg_catalog.text AS provolatile,
      function_record.proparallel::pg_catalog.text AS proparallel,
      function_record.proretset,
      COALESCE(function_record.proconfig,ARRAY[]::text[]) AS configuration,
      function_record.proowner=namespace.nspowner
        AND function_record.proowner=(SELECT oid FROM pg_catalog.pg_roles
          WHERE rolname=current_user) AS owned_by_schema_owner,
      function_record.pronargdefaults,
      function_record.provariadic=0::pg_catalog.oid AS no_variadic,
      function_record.prosrc
    FROM pg_catalog.pg_proc AS function_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=function_record.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid=function_record.prolang
    WHERE namespace.nspname='valo_intake'
    ORDER BY function_record.proname,arguments
  `);
  const functionGrants = await client.query(`
    SELECT function_record.proname,
      pg_catalog.oidvectortypes(function_record.proargtypes) AS arguments,
      CASE WHEN grant_record.grantor=function_record.proowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantor) END AS grantor,
      CASE WHEN grant_record.grantee=0 THEN '$PUBLIC'
        WHEN grant_record.grantee=function_record.proowner THEN '$OWNER'
        ELSE '$ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantee) END AS grantee,
      grant_record.privilege_type, grant_record.is_grantable
    FROM pg_catalog.pg_proc AS function_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=function_record.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(function_record.proacl,
        pg_catalog.acldefault('f',function_record.proowner))
    ) AS grant_record
    WHERE namespace.nspname='valo_intake'
    ORDER BY function_record.proname,arguments,grantor,grantee,privilege_type
  `);

  return {
    schema: [
      schema.rows.length === 1 && schema.rows[0].owned_by_current_user === true,
      canonicalRows(
        schemaGrants.rows.map((row) => [
          row.grantor,
          row.grantee,
          row.privilege_type,
          row.is_grantable,
        ]),
      ),
    ],
    tableGrants: canonicalRows(
      tableGrants.rows.map((row) => [
        row.relname,
        row.grantor,
        row.grantee,
        row.privilege_type,
        row.is_grantable,
      ]),
    ),
    columnGrants: canonicalRows(
      columnGrants.rows.map((row) => [
        row.relname,
        row.attname,
        row.grantor,
        row.grantee,
        row.privilege_type,
        row.is_grantable,
      ]),
    ),
    functions: canonicalRows(
      functions.rows.map((row) => [
        row.proname,
        row.arguments,
        row.identity_arguments,
        row.function_result,
        row.argument_names,
        row.argument_modes,
        row.all_argument_types,
        row.lanname,
        row.prokind,
        row.prosecdef,
        row.proleakproof,
        row.proisstrict,
        row.provolatile,
        row.proparallel,
        row.proretset,
        [...row.configuration].sort(),
        row.owned_by_schema_owner,
        Number(row.pronargdefaults),
        row.no_variadic,
        sha256(row.prosrc.replaceAll("\r\n", "\n").trim()),
      ]),
    ),
    functionGrants: canonicalRows(
      functionGrants.rows.map((row) => [
        row.proname,
        row.arguments,
        row.grantor,
        row.grantee,
        row.privilege_type,
        row.is_grantable,
      ]),
    ),
  };
}

async function readIntakeCatalog(client) {
  const { actual, reference } = await readComparedTableCatalogs(client);
  return {
    tables: actual,
    referenceTables: reference,
    security: await readIntakeSecurityCatalog(client),
  };
}

export async function runReplitIntakeMigrations(environment = process.env) {
  await validateLocalReplitMigrationManifest();
  const ownerUrl = validateReplitMigrationEnvironment(environment);
  const pool = new Pool({
    connectionString: ownerUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let lockClient;
  let lockAcquired = false;

  try {
    lockClient = await pool.connect();
    await lockClient.query("SET lock_timeout = '30s'");
    await lockClient.query("SET statement_timeout = '60s'");
    await lockClient.query("SET idle_in_transaction_session_timeout = '60s'");
    await lockClient.query("SET search_path = pg_catalog");
    await validatePostgresCatalogVersion(lockClient);
    await lockClient.query("SELECT pg_catalog.pg_advisory_lock($1, $2)", [
      REPLIT_MIGRATION_LOCK_NAMESPACE,
      REPLIT_MIGRATION_LOCK_KEY,
    ]);
    lockAcquired = true;

    const beforeRows = await readProductionJournal(lockClient);
    const mode = validateReplitMigrationJournal(beforeRows);
    validateReplitIntakeSchemaState(
      mode,
      await readIntakeSchemaName(lockClient),
    );

    if (shouldApplyReplitMigrations(mode)) {
      await migrate(drizzle(lockClient), {
        migrationsFolder: MIGRATIONS_DIRECTORY,
      });
    }

    const afterRows = await readProductionJournal(lockClient);
    if (validateReplitMigrationJournal(afterRows) !== "already_applied") {
      fail("approved migrations did not reach the complete journal state");
    }
    validateReplitIntakeSchemaState(
      "already_applied",
      await readIntakeSchemaName(lockClient),
    );
    const catalog = await readIntakeCatalog(lockClient);
    validateReplitIntakeCatalog(catalog);

    const outcome =
      mode === "pending"
        ? "0003-0008 applied"
        : mode === "upgrade_pending"
          ? "0006-0008 applied"
          : mode === "storage_upgrade_pending"
            ? "0007-0008 applied"
            : mode === "assurance_upgrade_pending"
              ? "0008 applied"
              : "already current";
    process.stdout.write(`Replit intake migration gate passed: ${outcome}\n`);
  } finally {
    if (lockClient && lockAcquired) {
      await lockClient
        .query("SELECT pg_catalog.pg_advisory_unlock($1, $2)", [
          REPLIT_MIGRATION_LOCK_NAMESPACE,
          REPLIT_MIGRATION_LOCK_KEY,
        ])
        .catch(() => undefined);
    }
    lockClient?.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReplitIntakeMigrations().catch((error) => {
    const message =
      error instanceof Error &&
      error.message.startsWith("Replit intake migration gate failed:")
        ? error.message
        : "Replit intake migration gate failed: database operation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
