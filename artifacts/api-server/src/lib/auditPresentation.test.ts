import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires an explicit extension.
import { mergeAuditEventPresentations } from "./auditPresentation.ts";

test("merged audit rows retain explicit active and archive provenance", () => {
  const rows = mergeAuditEventPresentations(
    [{ id: "current", createdAt: "2026-08-09T10:00:00.000Z" }],
    [
      {
        id: "legacy-intact-payload",
        createdAt: "2026-07-01T10:00:00.000Z",
        integrityStatus: "payload_hash_verified" as const,
      },
      {
        id: "legacy-discontinuity",
        createdAt: "2026-07-02T10:00:00.000Z",
        integrityStatus: "known_discontinuity" as const,
      },
    ],
  );

  assert.deepEqual(
    rows.map(({ id, auditSource, integrityStatus }) => ({
      id,
      auditSource,
      integrityStatus,
    })),
    [
      {
        id: "current",
        auditSource: "active_v2",
        integrityStatus: "active_v2_record",
      },
      {
        id: "legacy-discontinuity",
        auditSource: "legacy_v1_archive",
        integrityStatus: "known_discontinuity",
      },
      {
        id: "legacy-intact-payload",
        auditSource: "legacy_v1_archive",
        integrityStatus: "payload_hash_verified",
      },
    ],
  );

  assert.equal(
    rows.some(
      (row) =>
        row.auditSource === "legacy_v1_archive" &&
        String(row.integrityStatus) === "active_v2_record",
    ),
    false,
    "archived rows must never be presented as ordinary active-chain verification",
  );
});

test("legacy integrity assessments keep an explicit tenant predicate", async () => {
  const routeSource = await readFile(
    new URL("../routes/audit.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    routeSource,
    /eq\(legacyAuditIntegrityAssessments\.organisationId, organisationId\)/,
    "the assessment endpoint must not rely on an unscoped table scan",
  );
});

test("active and archived project audit queries keep explicit tenant predicates", async () => {
  const routeSource = await readFile(
    new URL("../routes/audit.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    routeSource,
    /eq\(auditEvents\.organisationId, organisationId\)/,
  );
  assert.match(
    routeSource,
    /eq\(legacyAuditEvents\.organisationId, organisationId\)/,
  );
});

test("the audit writer leaves the monotonic row number to PostgreSQL", async () => {
  const writerSource = await readFile(
    new URL("./audit.ts", import.meta.url),
    "utf8",
  );
  const insert = /INSERT INTO public\.audit_events \(([\s\S]*?)\) VALUES/.exec(
    writerSource,
  );
  assert(insert, "raw active-audit INSERT target list is missing");
  assert.doesNotMatch(insert[1], /\brow_no\b/);
  assert.match(insert[1], /\borganisation_id\b/);
  assert.match(insert[1], /\bhash_version\b/);
});
