#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const migrationPaths = [
  resolve(repositoryRoot, "lib/db/migrations/0000_tense_vapor.sql"),
  resolve(repositoryRoot, "lib/db/migrations/0001_tenant_rls.sql"),
  resolve(
    repositoryRoot,
    "lib/db/migrations/0002_audit_integrity_boundary.sql",
  ),
];
const bridgeSqlPath = resolve(
  repositoryRoot,
  "scripts/migrations/replit-legacy-v1-to-v2.5.sql",
);
const bridgeRunnerPath = resolve(here, "run-legacy-bridge.mjs");
const drizzleBinPath = resolve(here, "../node_modules/drizzle-kit/bin.cjs");
const dbPackagePath = resolve(here, "..");

const ORGANISATION_ID = "56414c4f-0000-5000-8000-000000000025";
const ASSESSMENT_ID = "56414c4f-0000-5000-8000-000000000026";
const BOUNDARY_ID = "56414c4f-0000-5000-8000-000000000027";
const SOURCE_COMMIT = "b71adcec4a7060c0ce2192266c81d880c5e56277";
const SOURCE_DIGEST_ALGORITHM =
  "sha256(newline-delimited row_to_json(record)::text rows sorted lexicographically in UTC; trailing newline iff nonempty)";
const PLATFORM_ADMIN_ID = "synthetic-ci-platform-admin";
const FIXED_TIME = "2026-01-15T12:00:00.000Z";
const HISTORICAL_DELETED_PROJECT_ID = "30000000-0000-4000-8000-000000000099";
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

const IDS = Object.freeze({
  admin: "10000000-0000-4000-8000-000000000001",
  tenantAdminA: "10000000-0000-4000-8000-000000000002",
  tenantAdminB: "10000000-0000-4000-8000-000000000003",
  client: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  document: "40000000-0000-4000-8000-000000000001",
  requirement: "50000000-0000-4000-8000-000000000001",
  evidence: "60000000-0000-4000-8000-000000000001",
  defect: "70000000-0000-4000-8000-000000000001",
  boq: "80000000-0000-4000-8000-000000000001",
  vault: "90000000-0000-4000-8000-000000000001",
  capability: "a0000000-0000-4000-8000-000000000001",
  conflict: "b0000000-0000-4000-8000-000000000001",
  notification: "c0000000-0000-4000-8000-000000000001",
  retention: "d0000000-0000-4000-8000-000000000001",
  template: "e0000000-0000-4000-8000-000000000001",
  annotation: "e0000000-0000-4000-8000-000000000002",
  report: "f0000000-0000-4000-8000-000000000001",
  llmRun: "f0000000-0000-4000-8000-000000000002",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseName(databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert(name, "DATABASE_URL must include a database name");
  return name;
}

function withDatabase(databaseUrl, name, credentials) {
  const result = new URL(databaseUrl);
  result.pathname = `/${encodeURIComponent(name)}`;
  if (credentials) {
    result.username = encodeURIComponent(credentials.username);
    result.password = encodeURIComponent(credentials.password);
  }
  return result.toString();
}

function postgresEnvironment(databaseUrl) {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName(databaseUrl),
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  };
}

async function connectUtc(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

async function runCommand(command, args, options = {}) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolveResult({ code, signal, stdout, stderr }),
    );
  });
  if (!options.allowFailure && result.code !== 0) {
    const diagnostic = `${result.stderr}\n${result.stdout}`.trim().slice(-4000);
    throw new Error(
      `${basename(command)} exited ${result.code ?? result.signal}: ${diagnostic}`,
    );
  }
  return result;
}

function canonicalAuditPayload(payload) {
  return JSON.stringify([
    payload.seq,
    payload.userId,
    payload.userName,
    payload.projectId,
    payload.eventType,
    payload.objectType,
    payload.objectId,
    payload.details,
    payload.createdAt,
  ]);
}

function auditHash(previousHash, payload) {
  return sha256(`${previousHash}\n${canonicalAuditPayload(payload)}`);
}

function activeAuditHash(previousHash, payload) {
  return sha256(
    `${previousHash}\n${JSON.stringify([
      payload.seq,
      payload.organisationId,
      payload.userId,
      payload.userName,
      payload.projectId,
      payload.eventType,
      payload.objectType,
      payload.objectId,
      payload.details,
      payload.createdAt,
    ])}`,
  );
}

function extractLegacyShape(bridgeSql) {
  const start = bridgeSql.indexOf(
    "INSERT INTO _valo_expected_legacy_columns VALUES",
  );
  const end = bridgeSql.indexOf("DO $preflight$", start);
  assert(start >= 0 && end > start, "legacy column fingerprint is absent");
  const result = new Map();
  for (const match of bridgeSql
    .slice(start, end)
    .matchAll(/\('([^']+)',\s*ARRAY\[([^\]]+)\]\)/g)) {
    result.set(
      match[1],
      [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
    );
  }
  assert.deepEqual([...result.keys()].sort(), LEGACY_TABLES);
  return result;
}

function legacyDdl(migration0000, legacyShape) {
  const tableDefinitions = new Map();
  for (const match of migration0000.matchAll(
    /^CREATE TABLE "([^"]+)" \(\r?\n([\s\S]*?)\r?\n\);/gm,
  )) {
    tableDefinitions.set(match[1], match[2]);
  }
  const statements = [];
  for (const table of LEGACY_TABLES) {
    const body = tableDefinitions.get(table);
    assert(body, `0000 definition is absent for ${table}`);
    const definitions = new Map();
    for (const line of body.split(/\r?\n/)) {
      const column = line.match(/^\s*"([^"]+)"\s+/)?.[1];
      if (column) definitions.set(column, line.trim().replace(/,$/, ""));
    }
    const columns = legacyShape.get(table);
    const selected = columns.map((column) => {
      const definition = definitions.get(column);
      assert(
        definition,
        `0000 column definition is absent for ${table}.${column}`,
      );
      return `  ${definition}`;
    });
    const tableConstraints = body
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.startsWith("CONSTRAINT "))
      .filter((line) => {
        const referencedColumns = [...line.matchAll(/"([^"]+)"/g)]
          .map((match) => match[1])
          .slice(1);
        return referencedColumns.every((column) => columns.includes(column));
      })
      .map((line) => `  ${line}`);
    statements.push(
      `CREATE TABLE public.${quoteIdentifier(table)} (\n${[
        ...selected,
        ...tableConstraints,
      ].join(",\n")}\n)`,
    );
  }

  const foreignKeys = [];
  for (const match of migration0000.matchAll(
    /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "public"\."([^"]+)"\(([^)]+)\) ([^;]+);--> statement-breakpoint$/gm,
  )) {
    const [, table, , localList, referencedTable, referencedList] = match;
    if (!legacyShape.has(table) || !legacyShape.has(referencedTable)) continue;
    const localColumns = [...localList.matchAll(/"([^"]+)"/g)].map(
      (entry) => entry[1],
    );
    const referencedColumns = [...referencedList.matchAll(/"([^"]+)"/g)].map(
      (entry) => entry[1],
    );
    if (
      localColumns.every((column) => legacyShape.get(table).includes(column)) &&
      referencedColumns.every((column) =>
        legacyShape.get(referencedTable).includes(column),
      )
    ) {
      foreignKeys.push(match[0].replace(";--> statement-breakpoint", ";"));
    }
  }

  const indexes = [];
  for (const match of migration0000.matchAll(
    /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)" [^;]+;--> statement-breakpoint$/gm,
  )) {
    const table = match[1];
    if (!legacyShape.has(table)) continue;
    const afterTable = match[0].slice(
      match[0].indexOf(`ON "${table}"`) + table.length + 5,
    );
    const referencedColumns = [...afterTable.matchAll(/"([^"]+)"/g)]
      .map((entry) => entry[1])
      .filter((identifier) => identifier !== table);
    if (
      referencedColumns.every((column) =>
        legacyShape.get(table).includes(column),
      )
    ) {
      indexes.push(match[0].replace(";--> statement-breakpoint", ";"));
    }
  }
  assert(
    foreignKeys.length >= 30,
    "legacy FK graph extraction is unexpectedly sparse",
  );
  assert(indexes.length >= 2, "legacy index extraction is unexpectedly sparse");
  return `${statements.join(";\n")};\n${foreignKeys.join("\n")}\n${indexes.join("\n")}`;
}

async function insertRow(client, table, row) {
  const columns = Object.keys(row);
  const parameters = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `INSERT INTO public.${quoteIdentifier(table)} (${columns
      .map(quoteIdentifier)
      .join(", ")}) VALUES (${parameters})`,
    Object.values(row),
  );
}

async function seedLegacyFixture(client) {
  await insertRow(client, "users", {
    id: IDS.admin,
    clerk_user_id: PLATFORM_ADMIN_ID,
    email: "platform-admin@synthetic.invalid",
    name: "Synthetic platform administrator",
    role: "admin",
    status: "active",
    last_login_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "users", {
    id: IDS.tenantAdminA,
    clerk_user_id: "synthetic-ci-tenant-admin-a",
    email: "tenant-admin-a@synthetic.invalid",
    name: "Synthetic tenant administrator A",
    role: "admin",
    status: "active",
    last_login_at: null,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "users", {
    id: IDS.tenantAdminB,
    clerk_user_id: "synthetic-ci-tenant-admin-b",
    email: "tenant-admin-b@synthetic.invalid",
    name: "Synthetic tenant administrator B",
    role: "admin",
    status: "active",
    last_login_at: null,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "clients", {
    id: IDS.client,
    name: "Synthetic Client Alpha",
    sector: "fixture-sector",
    segment: "enterprise",
    contact_name: null,
    contact_email: null,
    nda_status: "signed",
    notes: "Non-PII CI bridge fixture",
    decision_maker_conversations: 2,
    junior_conversations: 1,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "projects", {
    id: IDS.project,
    client_id: IDS.client,
    tender_title: "Synthetic infrastructure tender",
    issuing_entity: "Synthetic Issuer",
    tender_ref: "CI-REF-001",
    lot: "LOT-CI",
    deadline: "2026-06-30",
    value_band: "fixture",
    segment: "enterprise",
    submission_status: "draft",
    status: "review",
    reviewer_id: IDS.tenantAdminA,
    sla_class: "standard",
    payment_status: "not_required",
    payment_confirmed_by_founder: false,
    payment_confirmed_by_advisor: false,
    conflict_status: "clear",
    restricted_mode: false,
    risk_score: 12.5,
    risk_band: "medium",
    outcome: "none",
    mandate_quality: "none",
    scope: "Synthetic fixture scope",
    limitations: "Synthetic fixture only",
    responsiveness_suggested: false,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "documents", {
    id: IDS.document,
    project_id: IDS.project,
    type: "tender",
    filename: "synthetic-tender.txt",
    object_path: "fixtures/synthetic-tender.txt",
    content_type: "text/plain",
    size: 29,
    sha256: sha256("synthetic tender fixture"),
    source: "ci-fixture",
    date_received: "2026-01-15",
    redaction_status: "excluded",
    uploaded_by: IDS.admin,
    content_text: "Synthetic content without personal data.",
    extracted_chars: 40,
    extraction_status: "complete",
    extraction_method: "fixture",
    extraction_confidence: 1,
    extraction_notes: "Deterministic CI fixture",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "requirements", {
    id: IDS.requirement,
    project_id: IDS.project,
    source_doc_id: IDS.document,
    page_ref: "1",
    clause_ref: "CI.1",
    text: "Provide synthetic evidence.",
    category: "technical",
    expected_evidence: "Synthetic document",
    is_mandatory: true,
    confidence: "high",
    review_status: "confirmed",
    reviewer_notes: "CI fixture",
    origin: "fixture",
    engine_text: "Provide synthetic evidence.",
    merged_citations: "[]",
    reviewed_by: IDS.tenantAdminA,
    reviewed_by_name: "Synthetic tenant administrator A",
    reviewed_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "evidence_items", {
    id: IDS.evidence,
    project_id: IDS.project,
    requirement_id: IDS.requirement,
    document_id: IDS.document,
    evidence_status: "confirmed",
    excerpt: "Synthetic evidence excerpt",
    notes: "CI fixture",
    suggested: false,
    confirmed_by: IDS.tenantAdminA,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "defects", {
    id: IDS.defect,
    project_id: IDS.project,
    requirement_id: IDS.requirement,
    type: "completeness",
    severity: "cosmetic",
    description: "Synthetic defect",
    evidence_snapshot: "Synthetic snapshot",
    remediation: "Synthetic remediation",
    owner: "fixture-team",
    status: "open",
    suggested: false,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "boq_checks", {
    id: IDS.boq,
    project_id: IDS.project,
    source_doc_id: IDS.document,
    line_ref: "CI-1",
    description: "Synthetic line item",
    quantity: 2,
    unit_rate: 3.5,
    extension: 7,
    computed_extension: 7,
    quantity_raw: "2",
    unit_rate_kobo: 350,
    extension_kobo: 700,
    computed_extension_kobo: 700,
    check_type: "arithmetic",
    finding: "Synthetic fixture matches",
    severity: "cosmetic",
    status: "resolved",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "vault_items", {
    id: IDS.vault,
    client_id: IDS.client,
    artefact_type: "synthetic-certificate",
    issuer: "Synthetic Issuer",
    issue_date: "2026-01-01",
    expiry_date: "2027-01-01",
    renewal_lead_days: 30,
    status: "active",
    object_path: "fixtures/synthetic-certificate.txt",
    sha256: sha256("synthetic certificate fixture"),
    source_document_id: IDS.document,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "capability_items", {
    id: IDS.capability,
    client_id: IDS.client,
    claim_type: "synthetic-capability",
    description: "Synthetic capability statement",
    evidence_doc_id: IDS.document,
    approved_status: "approved",
    verifier_id: IDS.tenantAdminA,
    verifier_name: "Synthetic tenant administrator A",
    verified_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "conflict_records", {
    id: IDS.conflict,
    client_id: IDS.client,
    project_id: IDS.project,
    tender_ref: "CI-REF-001",
    lot: "LOT-CI",
    matched_project_id: null,
    status: "cleared",
    decision: "clear",
    rationale: "Synthetic fixture",
    decided_by: IDS.admin,
    decided_at: FIXED_TIME,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "notification_events", {
    id: IDS.notification,
    project_id: IDS.project,
    client_id: IDS.client,
    vault_item_id: IDS.vault,
    channel: "manual",
    template: "synthetic-template",
    recipient: "synthetic-destination",
    payload: "{}",
    status: "sent",
    created_by: IDS.admin,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "retention_requests", {
    id: IDS.retention,
    project_id: IDS.project,
    requested_by: IDS.admin,
    reason: "Synthetic retention proof",
    due_at: "2026-02-15T12:00:00.000Z",
    completed_at: null,
    certificate_text: null,
    status: "pending",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "sbd_templates", {
    id: IDS.template,
    code: "SYN-CI-001",
    title: "Synthetic bidding template",
    category: "goods",
    version: 1,
    status: "active",
    issuing_circular: "Synthetic circular",
    summary: "Non-production CI fixture",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "sbd_annotations", {
    id: IDS.annotation,
    template_id: IDS.template,
    agency: "Synthetic Agency",
    section: "CI",
    kind: "format",
    quirk: "Synthetic annotation",
    created_at: FIXED_TIME,
  });
  await insertRow(client, "reports", {
    id: IDS.report,
    project_id: IDS.project,
    version: 1,
    status: "draft",
    docx_path: "fixtures/synthetic.docx",
    pdf_path: "fixtures/synthetic.pdf",
    reviewer_id: IDS.tenantAdminA,
    reviewer_name: "Synthetic tenant administrator A",
    attestation: "Synthetic attestation",
    engine_version: "ci",
    prompt_pack_version: "ci",
    model_id: "synthetic-model",
    taxonomy_version: "ci",
    signed_off_at: null,
    generated_by: IDS.admin,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "llm_runs", {
    id: IDS.llmRun,
    project_id: IDS.project,
    task: "synthetic-evaluation",
    model: "synthetic-model",
    prompt_version: "ci",
    input_hash: sha256("synthetic input"),
    output_summary: "Synthetic output",
    prompt_tokens: 10,
    completion_tokens: 5,
    error: null,
    created_at: FIXED_TIME,
  });
  await insertRow(client, "app_config", {
    id: "singleton",
    severity_weight_fatal: 40,
    severity_weight_likely_fatal: 25,
    severity_weight_scoring_risk: 10,
    severity_weight_cosmetic: 3,
    missing_evidence_weight: 5,
    band_medium_cutoff: 15,
    band_high_cutoff: 40,
    band_critical_cutoff: 70,
    firm_name: "Synthetic Valo Fixture",
    confidentiality_legend: "Synthetic fixture; not production data.",
    retention_default_days: 14,
    updated_at: FIXED_TIME,
    updated_by: IDS.admin,
  });

  let previousHash = "0".repeat(64);
  const events = [];
  for (let seq = 1; seq <= 28; seq += 1) {
    const knownDiscontinuity = seq >= 8 && seq <= 26;
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
    const payload = {
      seq,
      userId: knownDiscontinuity ? null : IDS.admin,
      userName: "Synthetic CI actor",
      projectId: knownDiscontinuity
        ? HISTORICAL_DELETED_PROJECT_ID
        : IDS.project,
      eventType: knownDiscontinuity ? "project.export_denied" : "fixture.event",
      objectType: "synthetic_fixture",
      objectId: `fixture-${seq}`,
      details: JSON.stringify({ fixture: true, sequence: seq }),
      createdAt,
    };
    const hash = knownDiscontinuity
      ? sha256(`intentional-known-discontinuity\n${previousHash}\n${seq}`)
      : auditHash(previousHash, payload);
    const rowNo = seq === 1 ? 49 : seq === 28 ? 560 : seq + 48;
    const row = {
      id: `a1000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      user_id: payload.userId,
      user_name: payload.userName,
      project_id: payload.projectId,
      event_type: payload.eventType,
      object_type: payload.objectType,
      object_id: payload.objectId,
      details: payload.details,
      seq,
      prev_hash: previousHash,
      hash,
      row_no: rowNo,
      created_at: createdAt,
    };
    await insertRow(client, "audit_events", row);
    events.push(row);
    previousHash = hash;
  }
  await client.query(
    "SELECT setval('public.audit_events_row_no_seq', 560, true)",
  );
  return events;
}

async function tableDigest(client, relation, columns) {
  const result = await client.query(`
    SELECT count(*)::integer AS row_count,
      COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json) || E'\\n', '')
        AS content
    FROM (
      SELECT row_to_json(source_row)::text AS row_json
      FROM (SELECT ${columns} FROM ${relation}) AS source_row
    ) AS rows
  `);
  return {
    rowCount: result.rows[0].row_count,
    sha256: sha256(result.rows[0].content),
  };
}

async function legacyDigests(client, legacyShape, complete = false) {
  const result = {};
  for (const table of LEGACY_TABLES) {
    let relation = `public.${quoteIdentifier(table)}`;
    let projection = legacyShape.get(table).map(quoteIdentifier).join(", ");
    if (complete && table === "audit_events") {
      relation = "public.legacy_audit_events";
    } else if (complete && table === "users") {
      relation = "public.users AS identity";
      projection = legacyShape
        .get(table)
        .map((column) => {
          if (column !== "role") {
            return `identity.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`;
          }
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
    result[table] = await tableDigest(client, relation, projection);
  }
  return result;
}

async function auditExport(client, relation = "public.audit_events") {
  const result = await client.query(`
    SELECT string_agg(row_to_json(source_row)::text, E'\\n' ORDER BY source_row.seq)
             || E'\\n' AS content
    FROM (
      SELECT id, user_id, user_name, project_id, event_type, object_type,
        object_id, details, seq, prev_hash, hash, row_no, created_at
      FROM ${relation}
      ORDER BY seq
    ) AS source_row
  `);
  return result.rows[0]?.content ?? "";
}

async function legacyRollbackSnapshot(client, legacyShape) {
  const [
    relations,
    columns,
    constraints,
    indexes,
    triggers,
    policies,
    sequence,
  ] = await Promise.all([
    client.query(`SELECT c.relname, c.relkind,c.relowner::regrole::text AS owner,
          c.relrowsecurity,c.relforcerowsecurity
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')
        ORDER BY c.relkind,c.relname`),
    client.query(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,
          is_nullable,column_default
        FROM information_schema.columns WHERE table_schema='public'
        ORDER BY table_name,ordinal_position`),
    client.query(`SELECT c.conrelid::regclass::text AS relation,c.conname,c.contype,
          pg_get_constraintdef(c.oid,true) AS definition
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' ORDER BY relation,c.conname`),
    client.query(`SELECT schemaname,tablename,indexname,indexdef
        FROM pg_catalog.pg_indexes WHERE schemaname='public'
        ORDER BY tablename,indexname`),
    client.query(`SELECT t.tgrelid::regclass::text AS relation,t.tgname,
          pg_get_triggerdef(t.oid,true) AS definition
        FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal
        ORDER BY relation,t.tgname`),
    client.query(`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
        FROM pg_catalog.pg_policies WHERE schemaname='public'
        ORDER BY tablename,policyname`),
    client.query(`SELECT last_value::text,is_called
        FROM public.audit_events_row_no_seq`),
  ]);
  return {
    relations: relations.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    policies: policies.rows,
    sequence: sequence.rows[0],
    digests: await legacyDigests(client, legacyShape),
  };
}

async function allPublicDataDigests(client) {
  const tables = await client.query(`
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY c.relname
  `);
  const result = {};
  for (const { relname } of tables.rows) {
    const digest = await client.query(`
      SELECT count(*)::integer AS row_count,
        COALESCE(string_agg(row_json, E'\\n' ORDER BY row_json)
          || E'\\n', '') AS content
      FROM (
        SELECT row_to_json(source_row)::text AS row_json
        FROM (SELECT * FROM public.${quoteIdentifier(relname)}) AS source_row
      ) AS rows
    `);
    result[relname] = {
      rowCount: digest.rows[0].row_count,
      sha256: sha256(digest.rows[0].content),
    };
  }
  return result;
}

async function normalizedCatalog(client) {
  const sections = {
    relations: `SELECT n.nspname AS schema_name,c.relname,c.relkind,
        c.relrowsecurity,c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','valo_security','drizzle')
        AND c.relkind IN ('r','p','S','v','m','f')
      ORDER BY schema_name,c.relkind,c.relname`,
    columns: `SELECT n.nspname AS schema_name,c.relname,a.attname,a.attnum,
        pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
        a.attnotnull,a.attidentity,a.attgenerated,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid,true) AS default_expression
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname IN ('public','valo_security','drizzle')
        AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY schema_name,c.relname,a.attnum`,
    rls: `SELECT n.nspname AS schema_name,c.relname,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
      ORDER BY c.relname`,
    policies: `SELECT schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check
      FROM pg_catalog.pg_policies WHERE schemaname='public'
      ORDER BY tablename,policyname`,
    constraints: `SELECT n.nspname AS schema_name,rel.relname,c.conname,c.contype,
        pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class rel ON rel.oid=c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname IN ('public','drizzle')
      ORDER BY schema_name,rel.relname,c.conname`,
    indexes: `SELECT schemaname,tablename,indexname,indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname IN ('public','drizzle')
      ORDER BY schemaname,tablename,indexname`,
    functions: `SELECT n.nspname AS schema_name,p.proname,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_catalog.pg_get_function_result(p.oid) AS result,
        p.provolatile,p.prosecdef,p.prokind,p.proconfig::text,
        pg_catalog.pg_get_functiondef(p.oid) AS definition
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','valo_security')
      ORDER BY schema_name,p.proname,arguments`,
    triggers: `SELECT n.nspname AS schema_name,c.relname,t.tgname,t.tgenabled,
        pg_catalog.pg_get_triggerdef(t.oid,true) AS definition
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND NOT t.tgisinternal
      ORDER BY schema_name,c.relname,t.tgname`,
    grants: `WITH grants AS (
        SELECT 'schema'::text AS object_type,n.nspname AS schema_name,
          n.nspname AS object_name,n.nspowner AS owner_oid,
          x.grantor,x.grantee,x.privilege_type,x.is_grantable
        FROM pg_catalog.pg_namespace n
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x
        WHERE n.nspname IN ('public','valo_security','drizzle')
        UNION ALL
        SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'relation' END,
          n.nspname,c.relname,c.relowner,x.grantor,x.grantee,
          x.privilege_type,x.is_grantable
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,
          pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S','v','m','f')
        UNION ALL
        SELECT 'function',n.nspname,p.proname || '(' ||
          pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',p.proowner,
          x.grantor,x.grantee,x.privilege_type,x.is_grantable
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
        WHERE n.nspname IN ('public','valo_security')
      )
      SELECT object_type,schema_name,object_name,
        CASE WHEN grantor_role.rolname IS NULL THEN 'PUBLIC' ELSE grantor_role.rolname END AS grantor,
        CASE WHEN grantee_role.rolname IS NULL THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
        privilege_type,is_grantable
      FROM grants
      LEFT JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=grants.grantor
      LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid=grants.grantee
      WHERE COALESCE(grantee_role.rolname,'PUBLIC') <> 'valo_app_runtime'
      ORDER BY object_type,schema_name,object_name,grantee,privilege_type`,
  };
  const result = {};
  for (const [name, query] of Object.entries(sections)) {
    result[name] = (await client.query(query)).rows;
  }
  return result;
}

async function assertRuntimeContract(client) {
  const role =
    await client.query(`SELECT rolsuper,rolinherit,rolcreaterole,rolcreatedb,
      rolcanlogin,rolreplication,rolbypassrls,
      (SELECT count(*)::integer FROM pg_catalog.pg_auth_members
        WHERE member=roles.oid) AS memberships
    FROM pg_catalog.pg_roles roles WHERE rolname='valo_app_runtime'`);
  assert.deepEqual(role.rows[0], {
    rolsuper: false,
    rolinherit: true,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolreplication: false,
    rolbypassrls: false,
    memberships: 0,
  });
  const tableGrants = await client.query(`
    SELECT c.relname,
      has_table_privilege('valo_app_runtime',c.oid,'SELECT') AS can_select,
      has_table_privilege('valo_app_runtime',c.oid,'INSERT') AS can_insert,
      has_table_privilege('valo_app_runtime',c.oid,'UPDATE') AS can_update,
      has_table_privilege('valo_app_runtime',c.oid,'DELETE') AS can_delete
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  `);
  assert.equal(tableGrants.rows.length, 96);
  for (const grant of tableGrants.rows) {
    assert.equal(grant.can_select, true, `${grant.relname} SELECT grant`);
    if (
      ["legacy_audit_events", "legacy_audit_integrity_assessments"].includes(
        grant.relname,
      )
    ) {
      assert.deepEqual(
        [grant.can_insert, grant.can_update, grant.can_delete],
        [false, false, false],
        `${grant.relname} must be read-only`,
      );
    } else if (grant.relname === "audit_events") {
      assert.deepEqual(
        [grant.can_update, grant.can_delete],
        [false, false],
        "active audit must be append-only",
      );
    } else {
      assert.deepEqual(
        [grant.can_insert, grant.can_update, grant.can_delete],
        [true, true, true],
        `${grant.relname} runtime grant`,
      );
    }
  }
  const auditColumns = await client.query(`SELECT
      NOT EXISTS (
        SELECT 1 FROM unnest(ARRAY[
          'id','organisation_id','user_id','user_name','project_id','event_type',
          'object_type','object_id','details','seq','prev_hash','hash',
          'hash_version','created_at'
        ]) required(column_name)
        WHERE NOT has_column_privilege(
          'valo_app_runtime','public.audit_events',column_name,'INSERT'
        )
      ) AS can_insert_required,
      has_column_privilege(
        'valo_app_runtime','public.audit_events','row_no','INSERT'
      ) AS can_insert_row_no`);
  assert.deepEqual(auditColumns.rows[0], {
    can_insert_required: true,
    can_insert_row_no: false,
  });
  const sequences = await client.query(`
    SELECT c.relname,
      has_sequence_privilege('valo_app_runtime',c.oid,'USAGE') AS can_use,
      has_sequence_privilege('valo_app_runtime',c.oid,'SELECT') AS can_select,
      has_sequence_privilege('valo_app_runtime',c.oid,'UPDATE') AS can_update
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname
  `);
  assert(sequences.rows.length > 0);
  for (const sequence of sequences.rows) {
    assert.deepEqual(
      [sequence.can_use, sequence.can_select, sequence.can_update],
      [true, true, false],
      `${sequence.relname} runtime sequence grant`,
    );
  }
}

async function expectInsufficientPrivilege(
  client,
  savepoint,
  query,
  parameters,
  label,
) {
  await client.query(`SAVEPOINT ${quoteIdentifier(savepoint)}`);
  let denied = false;
  try {
    await client.query(query, parameters);
  } catch (error) {
    denied = error?.code === "42501";
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${quoteIdentifier(savepoint)}`);
  await client.query(`RELEASE SAVEPOINT ${quoteIdentifier(savepoint)}`);
  assert.equal(denied, true, label);
}

async function assertRuntimeParentIsolation(runtimeUrl, ownerUrl) {
  const tenantB = "56414c4f-0000-5000-8000-000000000095";
  const clientB = "56414c4f-0000-5000-8000-000000000094";
  const projectB = "56414c4f-0000-5000-8000-000000000093";
  const requirementB = "56414c4f-0000-5000-8000-000000000092";
  const deniedRow = "56414c4f-0000-5000-8000-000000000091";
  const runtime = await connectUtc(runtimeUrl);
  try {
    await runtime.query("BEGIN");
    await runtime.query(
      `INSERT INTO public.organisations
        (id,name,slug,type,status,country_code)
       VALUES ($1::uuid,'Synthetic tenant B','synthetic-tenant-b','client','active','NG')`,
      [tenantB],
    );
    await runtime.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [tenantB],
    );
    await runtime.query(
      "INSERT INTO public.clients (id,organisation_id,name) VALUES ($1::uuid,$2::uuid,'Synthetic tenant B client')",
      [clientB, tenantB],
    );
    await runtime.query(
      `INSERT INTO public.projects
        (id,organisation_id,client_id,tender_title)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Synthetic tenant B project')`,
      [projectB, tenantB, clientB],
    );
    await runtime.query(
      `INSERT INTO public.requirements
        (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Synthetic tenant B requirement')`,
      [requirementB, tenantB, projectB],
    );
    assert.equal(
      (
        await runtime.query(
          "UPDATE public.requirements SET reviewer_notes='tenant-b-positive' WHERE id=$1::uuid",
          [requirementB],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      Number(
        (
          await runtime.query(
            "SELECT count(*) FROM public.requirements WHERE id=$1::uuid",
            [IDS.requirement],
          )
        ).rows[0].count,
      ),
      0,
      "tenant B must not read tenant A project child",
    );
    assert.equal(
      (
        await runtime.query(
          "UPDATE public.requirements SET reviewer_notes=reviewer_notes WHERE id=$1::uuid",
          [IDS.requirement],
        )
      ).rowCount,
      0,
      "tenant B must not update tenant A project child",
    );
    assert.equal(
      (
        await runtime.query(
          "DELETE FROM public.requirements WHERE id=$1::uuid",
          [IDS.requirement],
        )
      ).rowCount,
      0,
      "tenant B must not delete tenant A project child",
    );
    await expectInsufficientPrivilege(
      runtime,
      "b_claims_a_child",
      `INSERT INTO public.requirements (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied cross-tenant child')`,
      [deniedRow, ORGANISATION_ID, IDS.project],
      "tenant B must not insert a project child claiming tenant A",
    );

    await runtime.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [ORGANISATION_ID],
    );
    assert.equal(
      Number(
        (
          await runtime.query(
            "SELECT count(*) FROM public.requirements WHERE id=$1::uuid",
            [IDS.requirement],
          )
        ).rows[0].count,
      ),
      1,
      "tenant A must read its project child",
    );
    assert.equal(
      (
        await runtime.query(
          "UPDATE public.requirements SET reviewer_notes=reviewer_notes WHERE id=$1::uuid",
          [IDS.requirement],
        )
      ).rowCount,
      1,
      "tenant A must update its project child",
    );
    assert.equal(
      Number(
        (
          await runtime.query(
            "SELECT count(*) FROM public.requirements WHERE id=$1::uuid",
            [requirementB],
          )
        ).rows[0].count,
      ),
      0,
      "tenant A must not read tenant B project child",
    );
    assert.equal(
      (
        await runtime.query(
          "UPDATE public.requirements SET reviewer_notes=reviewer_notes WHERE id=$1::uuid",
          [requirementB],
        )
      ).rowCount,
      0,
      "tenant A must not update tenant B project child",
    );
    assert.equal(
      (
        await runtime.query(
          "DELETE FROM public.requirements WHERE id=$1::uuid",
          [requirementB],
        )
      ).rowCount,
      0,
      "tenant A must not delete tenant B project child",
    );
    await expectInsufficientPrivilege(
      runtime,
      "a_claims_b_child",
      `INSERT INTO public.requirements (id,organisation_id,project_id,text)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'Denied reverse child')`,
      [deniedRow, tenantB, projectB],
      "tenant A must not insert a project child claiming tenant B",
    );
    await expectInsufficientPrivilege(
      runtime,
      "a_moves_child_to_b",
      "UPDATE public.requirements SET organisation_id=$1::uuid WHERE id=$2::uuid",
      [tenantB, IDS.requirement],
      "tenant A must not move a visible project child into tenant B",
    );
    await expectInsufficientPrivilege(
      runtime,
      "explicit_audit_ordinal",
      `INSERT INTO public.audit_events
        (id,organisation_id,event_type,seq,prev_hash,hash,hash_version,row_no,created_at)
       VALUES ($1::uuid,$2::uuid,'fixture.denied',2,$3,$3,2,999,now())`,
      [deniedRow, ORGANISATION_ID, "0".repeat(64)],
      "runtime must not explicitly assign an audit row_no",
    );
    const activeHead = await runtime.query(
      "SELECT seq,hash FROM public.audit_events ORDER BY seq DESC LIMIT 1",
    );
    assert.equal(activeHead.rowCount, 1);
    const auditCreatedAt = new Date().toISOString();
    const auditDetails = JSON.stringify({ fixture: "runtime-writer-positive" });
    const auditSequence = activeHead.rows[0].seq + 1;
    const runtimeAuditHash = activeAuditHash(activeHead.rows[0].hash, {
      seq: auditSequence,
      organisationId: ORGANISATION_ID,
      userId: null,
      userName: "Synthetic runtime audit writer",
      projectId: IDS.project,
      eventType: "fixture.runtime_audit_write",
      objectType: "synthetic_fixture",
      objectId: IDS.project,
      details: auditDetails,
      createdAt: auditCreatedAt,
    });
    const insertedAudit = await runtime.query(
      `INSERT INTO public.audit_events
        (organisation_id,user_id,user_name,project_id,event_type,object_type,
         object_id,details,seq,prev_hash,hash,hash_version,created_at)
       VALUES ($1::uuid,NULL,'Synthetic runtime audit writer',$2::uuid,
         'fixture.runtime_audit_write','synthetic_fixture',$2::text,$3,$4,$5,$6,2,$7::timestamptz)
       RETURNING row_no::integer`,
      [
        ORGANISATION_ID,
        IDS.project,
        auditDetails,
        auditSequence,
        activeHead.rows[0].hash,
        runtimeAuditHash,
        auditCreatedAt,
      ],
    );
    assert.equal(insertedAudit.rowCount, 1);
    assert(
      insertedAudit.rows[0].row_no > 561,
      "runtime audit writer must receive a server-generated row_no",
    );

    await runtime.query(
      "SELECT valo_security.set_current_organisation_id($1::uuid)",
      [tenantB],
    );
    assert.equal(
      (
        await runtime.query(
          "DELETE FROM public.requirements WHERE id=$1::uuid",
          [requirementB],
        )
      ).rowCount,
      1,
      "tenant B must delete its own rollback-only project child",
    );
    await runtime.query("ROLLBACK");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await runtime.end();
  }
  const owner = await connectUtc(ownerUrl);
  try {
    await owner.query(
      "SELECT setval('public.audit_events_row_no_seq',(SELECT max(row_no) FROM public.audit_events),true)",
    );
  } finally {
    await owner.end();
  }
}

async function createDatabase(admin, name, owner) {
  assert(
    /^valo_bridge_ci_[a-z0-9_]+$/.test(name),
    `unsafe CI database name ${name}`,
  );
  const ownerClause = owner ? ` OWNER ${quoteIdentifier(owner)}` : "";
  await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}${ownerClause}`);
}

async function dropDatabase(admin, name) {
  if (!/^valo_bridge_ci_[a-z0-9_]+$/.test(name)) return;
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
}

async function runBridge(environment, allowFailure = false) {
  return runCommand(process.execPath, [bridgeRunnerPath, "--execute"], {
    env: {
      ...process.env,
      ...environment,
      CI: "true",
    },
    allowFailure,
  });
}

async function catalogEvidence(databaseUrl) {
  const result = await runCommand(
    process.execPath,
    [bridgeRunnerPath, "--catalog-evidence"],
    { env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  const stdout = result.stdout.trim();
  assert(stdout.startsWith("{") && stdout.endsWith("}"));
  return JSON.parse(stdout);
}

async function applyMigrations(databaseUrl) {
  await runCommand(
    process.execPath,
    [drizzleBinPath, "migrate", "--config", "./drizzle.config.ts"],
    {
      cwd: dbPackagePath,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
}

async function main() {
  assert.equal(
    process.env.CI,
    "true",
    "legacy bridge rehearsal is intentionally restricted to disposable CI PostgreSQL",
  );
  const baseUrl = process.env.DATABASE_URL;
  assert(baseUrl, "DATABASE_URL is required");
  const parsedBase = new URL(baseUrl);
  assert(
    ["localhost", "127.0.0.1", "::1"].includes(parsedBase.hostname),
    "legacy bridge rehearsal requires local disposable PostgreSQL",
  );

  const suffix = `${process.pid}_${randomBytes(3).toString("hex")}`;
  const sourceDatabase = `valo_bridge_ci_source_${suffix}`;
  const bridgeDatabase = `valo_bridge_ci_target_${suffix}`;
  const freshDatabase = `valo_bridge_ci_fresh_${suffix}`;
  const migratorRole = `valo_bridge_ci_migrator_${suffix}`;
  const migratorPassword = randomBytes(32).toString("hex");
  const databases = [sourceDatabase, bridgeDatabase, freshDatabase];
  const sourceUrl = withDatabase(baseUrl, sourceDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const bridgeUrl = withDatabase(baseUrl, bridgeDatabase);
  const bridgeMigratorUrl = withDatabase(baseUrl, bridgeDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const freshUrl = withDatabase(baseUrl, freshDatabase);
  const freshMigratorUrl = withDatabase(baseUrl, freshDatabase, {
    username: migratorRole,
    password: migratorPassword,
  });
  const runtimePassword = randomBytes(32).toString("hex");
  const runtimeUrl = withDatabase(baseUrl, bridgeDatabase, {
    username: "valo_app_runtime",
    password: runtimePassword,
  });
  const evidenceDirectory = await mkdtemp(
    resolve(tmpdir(), "valo-bridge-ci-evidence-"),
  );
  await chmod(evidenceDirectory, 0o700);
  const backupPath = resolve(evidenceDirectory, "synthetic-legacy.dump");
  const auditExportPath = resolve(evidenceDirectory, "synthetic-audit.ndjson");
  const manifestPath = resolve(
    evidenceDirectory,
    "synthetic-restore-manifest.json",
  );

  const [migrationFiles, bridgeSql] = await Promise.all([
    Promise.all(migrationPaths.map((path) => readFile(path, "utf8"))),
    readFile(bridgeSqlPath, "utf8"),
  ]);
  const [migration0000] = migrationFiles;
  const expectedJournal = [1786221409612, 1786221441937, 1786251600000].map(
    (createdAt, index) => ({
      created_at: String(createdAt),
      hash: sha256(migrationFiles[index]),
    }),
  );
  const legacyShape = extractLegacyShape(bridgeSql);
  const admin = await connectUtc(baseUrl);
  try {
    const capabilities =
      await admin.query(`SELECT r.rolcreatedb,r.rolcreaterole,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname='valo_app_runtime') AS runtime_exists
      FROM pg_roles r WHERE r.rolname=current_user`);
    assert.equal(
      capabilities.rows[0]?.rolcreatedb,
      true,
      "CI owner needs CREATEDB",
    );
    assert.equal(
      capabilities.rows[0]?.rolcreaterole,
      true,
      "CI owner needs CREATEROLE",
    );
    assert.equal(
      capabilities.rows[0]?.runtime_exists,
      false,
      "disposable CI cluster must not begin with valo_app_runtime",
    );
    assert(
      /^valo_bridge_ci_migrator_[a-z0-9_]+$/.test(migratorRole),
      "unsafe CI migrator role",
    );
    await admin.query(
      `CREATE ROLE ${quoteIdentifier(migratorRole)} LOGIN PASSWORD '${migratorPassword}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`,
    );
    await createDatabase(admin, sourceDatabase, migratorRole);
    await createDatabase(admin, bridgeDatabase, migratorRole);
    await createDatabase(admin, freshDatabase, migratorRole);

    const source = await connectUtc(sourceUrl);
    let sourceDigests;
    let sourceAuditExport;
    let events;
    let postgresMajor;
    try {
      await source.query(legacyDdl(migration0000, legacyShape));
      events = await seedLegacyFixture(source);
      sourceDigests = await legacyDigests(source, legacyShape);
      sourceAuditExport = await auditExport(source);
      postgresMajor = Number(
        (await source.query("SHOW server_version_num")).rows[0]
          .server_version_num,
      );
      postgresMajor = Math.floor(postgresMajor / 10000);
    } finally {
      await source.end();
    }
    const sourceCatalogEvidence = await catalogEvidence(sourceUrl);

    assert.deepEqual(Object.keys(sourceDigests).sort(), LEGACY_TABLES);
    assert.equal(sourceDigests.audit_events.rowCount, 28);
    for (const table of LEGACY_TABLES) {
      assert(
        sourceDigests[table].rowCount > 0,
        `${table} must contain a synthetic fixture row`,
      );
    }
    assert.equal(sourceDigests.users.rowCount, 3);

    await runCommand(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        backupPath,
      ],
      { env: postgresEnvironment(sourceUrl) },
    );
    await chmod(backupPath, 0o600);
    const restoreList = await runCommand("pg_restore", ["--list", backupPath]);
    assert.match(restoreList.stdout, /TABLE DATA public audit_events/);
    await runCommand(
      "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        bridgeDatabase,
        backupPath,
      ],
      { env: postgresEnvironment(bridgeMigratorUrl) },
    );

    const restored = await connectUtc(bridgeUrl);
    let restoredDigests;
    try {
      restoredDigests = await legacyDigests(restored, legacyShape);
      assert.deepEqual(restoredDigests, sourceDigests);
      assert.equal(await auditExport(restored), sourceAuditExport);
    } finally {
      await restored.end();
    }
    const restoredCatalogEvidence = await catalogEvidence(bridgeMigratorUrl);
    assert.deepEqual(
      restoredCatalogEvidence,
      sourceCatalogEvidence,
      "custom-format restore must preserve the authenticated legacy catalog",
    );

    await writeFile(auditExportPath, sourceAuditExport, { mode: 0o600 });
    const backupBytes = await readFile(backupPath);
    const auditBytes = await readFile(auditExportPath);
    const head = events.at(-1);
    const manifest = {
      format: "valo.restore-rehearsal.v3",
      capturedAt: new Date().toISOString(),
      sourceCommit: SOURCE_COMMIT,
      target: {
        database: bridgeDatabase,
        organisationId: ORGANISATION_ID,
        organisationName: "Valo Nigeria",
        organisationSlug: "valo-nigeria",
      },
      backup: {
        fileName: basename(backupPath),
        sha256: sha256(backupBytes),
        pgRestoreListVerified: true,
        scratchRestoreExitStatus: 0,
        postgresMajor,
      },
      auditExport: {
        fileName: basename(auditExportPath),
        sha256: sha256(auditBytes),
      },
      rowCounts: Object.fromEntries(
        LEGACY_TABLES.map((table) => [table, sourceDigests[table].rowCount]),
      ),
      audit: {
        eventCount: 28,
        minSeq: 1,
        maxSeq: 28,
        distinctSeq: 28,
        rowNoSequenceLastValue: 560,
        rowNoSequenceIsCalled: true,
        linksContiguous: true,
        payloadHashVerifiedSequences: [1, 2, 3, 4, 5, 6, 7, 27, 28],
        knownDiscontinuitySequences: Array.from(
          { length: 19 },
          (_, index) => index + 8,
        ),
        externalHead: {
          seq: 28,
          hash: head.hash,
          prevHash: head.prev_hash,
        },
      },
      componentManifestSha256: sha256(
        JSON.stringify({
          fixture: "synthetic-v1",
          tableDigests: sourceDigests,
        }),
      ),
      tableDigestAlgorithm: SOURCE_DIGEST_ALGORITHM,
      tableDigests: sourceDigests,
      allTableDigestsMatchProduction: true,
      legacyCatalog: restoredCatalogEvidence,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
    await Promise.all(
      [backupPath, auditExportPath, manifestPath].map((path) =>
        chmod(path, 0o600),
      ),
    );
    const manifestSha256 = sha256(manifestBytes);
    const bridgeEnvironment = {
      DATABASE_URL: bridgeMigratorUrl,
      VALO_RUNTIME_DATABASE_URL: runtimeUrl,
      VALO_BRIDGE_APPLICATION_QUIESCED_ACK:
        "RESTORE_VERIFIED_AND_APPLICATION_QUIESCED",
      VALO_BRIDGE_PLATFORM_ADMIN_CLERK_USER_ID: PLATFORM_ADMIN_ID,
      VALO_BRIDGE_SOURCE_BACKUP_PATH: backupPath,
      VALO_BRIDGE_SOURCE_AUDIT_EXPORT_PATH: auditExportPath,
      VALO_BRIDGE_REHEARSAL_MANIFEST_PATH: manifestPath,
      VALO_BRIDGE_EXPECTED_REHEARSAL_MANIFEST_SHA256: manifestSha256,
    };
    const rollbackRuntimeUrl = withDatabase(bridgeMigratorUrl, bridgeDatabase, {
      username: "valo_app_runtime",
      password: runtimePassword,
    });
    const rollbackEnvironment = {
      ...bridgeEnvironment,
      DATABASE_URL: bridgeMigratorUrl,
      VALO_RUNTIME_DATABASE_URL: rollbackRuntimeUrl,
    };

    const beforeFailure = await connectUtc(bridgeUrl);
    const rollbackBaseline = await legacyRollbackSnapshot(
      beforeFailure,
      legacyShape,
    );
    assert.equal(
      rollbackBaseline.relations.filter((relation) => relation.relkind === "r")
        .length,
      19,
    );
    assert.equal(
      rollbackBaseline.relations.filter((relation) => relation.relkind === "S")
        .length,
      1,
    );
    assert(
      rollbackBaseline.relations.every(
        (relation) => relation.owner === migratorRole,
      ),
      "restored tables, indexes and sequence must be owned by the restricted migrator",
    );
    assert.equal(
      rollbackBaseline.constraints.filter(
        (constraint) => constraint.contype === "f",
      ).length,
      39,
      "legacy fixture must restore the complete applicable FK graph",
    );
    assert.equal(rollbackBaseline.constraints.length, 59);
    assert.equal(rollbackBaseline.indexes.length, 22);
    assert.deepEqual(rollbackBaseline.triggers, []);
    assert.deepEqual(rollbackBaseline.policies, []);
    await beforeFailure.end();
    const failed = await runBridge(rollbackEnvironment, true);
    assert.notEqual(failed.code, 0, "restricted migrator must fail the runner");
    assert.match(
      `${failed.stderr}\n${failed.stdout}`,
      /permission denied to create role|must have CREATEROLE/i,
    );
    const afterFailure = await connectUtc(bridgeUrl);
    try {
      assert.deepEqual(
        await legacyRollbackSnapshot(afterFailure, legacyShape),
        rollbackBaseline,
        "late injected failure must leave the complete legacy database unchanged",
      );
      assert.equal(
        (
          await afterFailure.query(
            "SELECT count(*)::integer AS count FROM pg_roles WHERE rolname='valo_app_runtime'",
          )
        ).rows[0].count,
        0,
        "late injected failure must roll back runtime role creation",
      );
      const leakedArtifacts = await afterFailure.query(`SELECT
          to_regnamespace('valo_security') IS NOT NULL AS security_schema,
          to_regnamespace('valo_legacy_bridge_archive') IS NOT NULL AS archive_schema,
          to_regnamespace('drizzle') IS NOT NULL AS journal_schema,
          to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal_table`);
      assert.deepEqual(leakedArtifacts.rows[0], {
        security_schema: false,
        archive_schema: false,
        journal_schema: false,
        journal_table: false,
      });
    } finally {
      await afterFailure.end();
    }
    console.log(
      "legacy bridge CI: natural late CREATE ROLE failure rolled back with zero drift",
    );

    await admin.query(`ALTER ROLE ${quoteIdentifier(migratorRole)} CREATEROLE`);
    const succeeded = await runBridge(bridgeEnvironment);
    assert.match(succeeded.stdout, /runtime RLS proof passed/);
    const bridged = await connectUtc(bridgeUrl);
    let catalogBeforeNoOp;
    let dataBeforeNoOp;
    try {
      assert.deepEqual(
        await legacyDigests(bridged, legacyShape, true),
        sourceDigests,
        "bridge must preserve every legacy ID and projected value",
      );
      const auditBoundary = await bridged.query(
        `SELECT
          assessment.source_event_count,
          assessment.verified_ranges,
          assessment.discontinuity_ranges,
          assessment.external_head_seq,
          assessment.external_head_hash,
          assessment.source_backup_sha256,
          assessment.source_audit_export_sha256,
          assessment.rehearsal_evidence_sha256,
          assessment.archive_digest,
          boundary.organisation_id::text AS organisation_id,
          boundary.user_id::text AS user_id,
          boundary.user_name,
          boundary.project_id::text AS project_id,
          boundary.event_type,
          boundary.object_type,
          boundary.object_id,
          boundary.details,
          boundary.seq,
          boundary.prev_hash,
          boundary.hash,
          boundary.hash_version,
          boundary.row_no::integer AS boundary_row_no,
          to_char(boundary.created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS boundary_created_at,
          (SELECT count(*)::integer FROM public.legacy_audit_events) AS archived,
          (SELECT count(*)::integer FROM public.legacy_audit_events
            WHERE integrity_status='known_discontinuity') AS known,
          (SELECT count(*)::integer FROM public.legacy_audit_events
            WHERE integrity_status='payload_hash_verified') AS verified,
          (SELECT count(*)::integer FROM public.legacy_audit_events
            WHERE project_id=$3::uuid) AS preserved_deleted_project_refs,
          (SELECT min(seq)::integer FROM public.legacy_audit_events) AS min_seq,
          (SELECT max(seq)::integer FROM public.legacy_audit_events) AS max_seq,
          (SELECT count(*)::integer FROM (
            SELECT prev_hash,
              lag(hash,1,repeat('0',64)) OVER (ORDER BY seq) AS expected_prev
            FROM public.legacy_audit_events
          ) chain WHERE prev_hash<>expected_prev) AS broken_links,
          (SELECT hash FROM public.legacy_audit_events ORDER BY seq DESC LIMIT 1)
            AS archived_head_hash,
          (SELECT prev_hash FROM public.legacy_audit_events ORDER BY seq DESC LIMIT 1)
            AS archived_head_prev_hash,
          (SELECT count(*)::integer FROM public.audit_events) AS active,
          (SELECT count(*)::integer FROM public.legacy_audit_integrity_assessments)
            AS assessments,
          (SELECT count(*)::integer FROM drizzle.__drizzle_migrations)
            AS journal_entries
        FROM public.legacy_audit_integrity_assessments assessment
        JOIN public.audit_events boundary
          ON boundary.id=$1::uuid AND assessment.id=$2::uuid`,
        [BOUNDARY_ID, ASSESSMENT_ID, HISTORICAL_DELETED_PROJECT_ID],
      );
      assert.equal(auditBoundary.rowCount, 1);
      const boundary = auditBoundary.rows[0];
      assert.deepEqual(
        {
          source_event_count: boundary.source_event_count,
          verified_ranges: boundary.verified_ranges,
          discontinuity_ranges: boundary.discontinuity_ranges,
          external_head_seq: boundary.external_head_seq,
          external_head_hash: boundary.external_head_hash,
          source_backup_sha256: boundary.source_backup_sha256,
          source_audit_export_sha256: boundary.source_audit_export_sha256,
          rehearsal_evidence_sha256: boundary.rehearsal_evidence_sha256,
          archive_digest: boundary.archive_digest,
          organisation_id: boundary.organisation_id,
          user_id: boundary.user_id,
          user_name: boundary.user_name,
          project_id: boundary.project_id,
          event_type: boundary.event_type,
          object_type: boundary.object_type,
          object_id: boundary.object_id,
          seq: boundary.seq,
          prev_hash: boundary.prev_hash,
          hash_version: boundary.hash_version,
          boundary_row_no: boundary.boundary_row_no,
          archived: boundary.archived,
          known: boundary.known,
          verified: boundary.verified,
          preserved_deleted_project_refs:
            boundary.preserved_deleted_project_refs,
          min_seq: boundary.min_seq,
          max_seq: boundary.max_seq,
          broken_links: boundary.broken_links,
          archived_head_hash: boundary.archived_head_hash,
          archived_head_prev_hash: boundary.archived_head_prev_hash,
          active: boundary.active,
          assessments: boundary.assessments,
          journal_entries: boundary.journal_entries,
        },
        {
          source_event_count: 28,
          verified_ranges: "1-7,27-28",
          discontinuity_ranges: "8-26",
          external_head_seq: 28,
          external_head_hash: head.hash,
          source_backup_sha256: sha256(backupBytes),
          source_audit_export_sha256: sha256(auditBytes),
          rehearsal_evidence_sha256: manifestSha256,
          archive_digest: sha256(auditBytes),
          organisation_id: ORGANISATION_ID,
          user_id: null,
          user_name: "Valo migration bridge",
          project_id: null,
          event_type: "audit.legacy_boundary_registered",
          object_type: "legacy_audit_integrity_assessment",
          object_id: ASSESSMENT_ID,
          seq: 1,
          prev_hash: "0".repeat(64),
          hash_version: 2,
          boundary_row_no: 561,
          archived: 28,
          known: 19,
          verified: 9,
          preserved_deleted_project_refs: 19,
          min_seq: 1,
          max_seq: 28,
          broken_links: 0,
          archived_head_hash: head.hash,
          archived_head_prev_hash: head.prev_hash,
          active: 1,
          assessments: 1,
          journal_entries: 3,
        },
      );
      assert.equal(
        boundary.hash,
        activeAuditHash(boundary.prev_hash, {
          seq: boundary.seq,
          organisationId: boundary.organisation_id,
          userId: boundary.user_id,
          userName: boundary.user_name,
          projectId: boundary.project_id,
          eventType: boundary.event_type,
          objectType: boundary.object_type,
          objectId: boundary.object_id,
          details: boundary.details,
          createdAt: boundary.boundary_created_at,
        }),
        "active v2 genesis boundary hash must recompute",
      );
      const tenantState = await bridged.query(
        `SELECT
          (SELECT count(*)::integer FROM public.users
            WHERE role='restricted_platform_administrator') AS platform_admins,
          (SELECT count(*)::integer FROM public.users WHERE role='none') AS tenant_only_admins,
          (SELECT count(*)::integer FROM public.organisation_memberships
            WHERE organisation_id=$1::uuid AND status='active') AS memberships,
          (SELECT count(*)::integer FROM public.role_grants grant_record
            JOIN public.organisation_memberships membership
              ON membership.id=grant_record.membership_id
            WHERE membership.organisation_id=$1::uuid
              AND grant_record.role='valo_operations_administrator') AS operations_grants,
          (SELECT count(*)::integer FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS tables,
          (SELECT count(*)::integer FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')
              AND c.relrowsecurity AND c.relforcerowsecurity) AS force_rls,
          (SELECT count(*)::integer FROM pg_catalog.pg_policies
            WHERE schemaname='public') AS policies`,
        [ORGANISATION_ID],
      );
      assert.deepEqual(tenantState.rows[0], {
        platform_admins: 1,
        tenant_only_admins: 2,
        memberships: 3,
        operations_grants: 3,
        tables: 96,
        force_rls: 85,
        policies: 104,
      });
      assert.equal(
        await auditExport(bridged, "public.legacy_audit_events"),
        sourceAuditExport,
      );
      await assertRuntimeContract(bridged);
      catalogBeforeNoOp = await normalizedCatalog(bridged);
      dataBeforeNoOp = await allPublicDataDigests(bridged);
    } finally {
      await bridged.end();
    }
    await assertRuntimeParentIsolation(runtimeUrl, bridgeUrl);
    console.log(
      "legacy bridge CI: 19-table values, 28-row archive, boundary 561, runtime and direct/child bidirectional RLS passed",
    );

    await applyMigrations(bridgeMigratorUrl);
    const afterNoOp = await connectUtc(bridgeUrl);
    try {
      assert.deepEqual(await normalizedCatalog(afterNoOp), catalogBeforeNoOp);
      assert.deepEqual(await allPublicDataDigests(afterNoOp), dataBeforeNoOp);
      const journal = await afterNoOp.query(
        "SELECT created_at::text,hash FROM drizzle.__drizzle_migrations ORDER BY created_at",
      );
      assert.deepEqual(journal.rows, expectedJournal);
    } finally {
      await afterNoOp.end();
    }
    console.log(
      "legacy bridge CI: adopted journal makes migration:apply a verified no-op",
    );

    const idempotent = await runBridge(bridgeEnvironment);
    assert.match(idempotent.stdout, /runtime RLS proof passed/);
    const afterRerun = await connectUtc(bridgeUrl);
    let bridgeCatalog;
    try {
      assert.deepEqual(await normalizedCatalog(afterRerun), catalogBeforeNoOp);
      assert.deepEqual(await allPublicDataDigests(afterRerun), dataBeforeNoOp);
      assert.deepEqual(
        await legacyDigests(afterRerun, legacyShape, true),
        sourceDigests,
      );
      bridgeCatalog = await normalizedCatalog(afterRerun);
    } finally {
      await afterRerun.end();
    }
    console.log("legacy bridge CI: completed-target rerun is idempotent");

    await applyMigrations(freshMigratorUrl);
    const fresh = await connectUtc(freshUrl);
    try {
      const freshCatalog = await normalizedCatalog(fresh);
      for (const section of Object.keys(bridgeCatalog)) {
        assert.deepEqual(
          bridgeCatalog[section],
          freshCatalog[section],
          `bridge/fresh normalized ${section} catalog mismatch`,
        );
      }
      console.log(
        `legacy bridge CI: fresh catalog parity passed (${bridgeCatalog.relations.length} relations, ${bridgeCatalog.policies.length} policies, ${bridgeCatalog.constraints.length} constraints, ${bridgeCatalog.indexes.length} indexes, ${bridgeCatalog.functions.length} functions, ${bridgeCatalog.triggers.length} triggers, ${bridgeCatalog.grants.length} non-runtime grants)`,
      );
    } finally {
      await fresh.end();
    }
  } finally {
    for (const name of databases.reverse()) {
      await dropDatabase(admin, name).catch(() => undefined);
    }
    await admin
      .query("DROP ROLE IF EXISTS valo_app_runtime")
      .catch(() => undefined);
    await admin
      .query(`DROP ROLE IF EXISTS ${quoteIdentifier(migratorRole)}`)
      .catch(() => undefined);
    await admin.end();
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    "legacy bridge CI rehearsal failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
