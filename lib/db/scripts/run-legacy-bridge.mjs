#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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

async function assertPrecommitSecurityCatalog(client) {
  await client.query("SET LOCAL search_path=pg_catalog");
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
  assert.equal(rlsCatalog.rows.length, 96);
  assert.equal(
    sha256(
      rlsCatalog.rows
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
  assert.equal(policies.rows.length, 104);
  assert.equal(
    sha256(
      policies.rows
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
    public_triggers: 116,
    security_functions: 9,
  });
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
  const [bridge, migration0000, migration0001, migration0002] =
    await Promise.all(
      [bridgePath, ...migrationPaths].map((path) => readFile(path, "utf8")),
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
  assert.equal(
    canonicalOperationalSql(embedded0002Schema),
    canonicalOperationalSql(migration0002.slice(0, migration0002SecurityStart)),
    "embedded 0002 schema is not the checked-in migration segment",
  );
  assert.equal(
    canonicalOperationalSql(embedded0002Security),
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
        artifact.legacyColumns.get(table),
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
  KNOWN_DISCONTINUITY_SEQUENCES,
  LEGACY_CATALOG_DIGEST_ALGORITHM,
  LEGACY_TABLES,
  LOCK_LEGACY_TABLES,
  ORGANISATION_ID,
  PAYLOAD_HASH_VERIFIED_SEQUENCES,
  SOURCE_COMMIT,
  SOURCE_DIGEST_ALGORITHM,
  checkArtifact,
  classifyTarget,
  legacyCatalogDigest,
  parseRestoreManifest,
  sha256,
  sourceEvidence,
  tableDigest,
};
