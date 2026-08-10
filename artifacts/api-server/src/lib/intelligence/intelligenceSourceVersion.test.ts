import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeIntelligenceSourceVersion,
  hashIntelligenceSourceFields,
} from "./intelligenceSourceVersion";

test("source version is deterministic and order independent", () => {
  const first = computeIntelligenceSourceVersion({
    projectId: "00000000-0000-4000-8000-000000000001",
    records: [
      { kind: "project", id: "p", version: 3 },
      { kind: "document", id: "d", version: 4 },
    ],
  });
  const second = computeIntelligenceSourceVersion({
    projectId: "00000000-0000-4000-8000-000000000001",
    records: [
      { kind: "document", id: "d", version: 4 },
      { kind: "project", id: "p", version: 3 },
    ],
  });
  assert.deepEqual(first, second);
  assert.match(first.manifestHash, /^[a-f0-9]{64}$/u);
  assert.ok(first.version > 0);
});

test("any source version change invalidates the review binding", () => {
  const before = computeIntelligenceSourceVersion({
    projectId: "project",
    records: [{ kind: "requirement", id: "r", version: 1 }],
  });
  const after = computeIntelligenceSourceVersion({
    projectId: "project",
    records: [{ kind: "requirement", id: "r", version: 2 }],
  });
  assert.notEqual(before.manifestHash, after.manifestHash);
  assert.notEqual(before.version, after.version);
});

test("immutable-row fingerprints participate in the exact manifest", () => {
  const before = computeIntelligenceSourceVersion({
    projectId: "project",
    records: [
      {
        kind: "document_version",
        id: "v1",
        version: 1,
        fingerprint: "a".repeat(64),
      },
    ],
  });
  const after = computeIntelligenceSourceVersion({
    projectId: "project",
    records: [
      {
        kind: "document_version",
        id: "v1",
        version: 1,
        fingerprint: "b".repeat(64),
      },
    ],
  });
  assert.notEqual(before.manifestHash, after.manifestHash);
});

test("canonical field fingerprints are key-order independent and content-sensitive", () => {
  const first = hashIntelligenceSourceFields({
    status: "clean",
    content: "source text",
    nested: { b: 2, a: 1 },
  });
  const reordered = hashIntelligenceSourceFields({
    nested: { a: 1, b: 2 },
    content: "source text",
    status: "clean",
  });
  const changed = hashIntelligenceSourceFields({
    nested: { a: 1, b: 2 },
    content: "changed source text",
    status: "clean",
  });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/u);
});

test("ambiguous duplicate record identities fail closed", () => {
  assert.throws(
    () =>
      computeIntelligenceSourceVersion({
        projectId: "project",
        records: [
          { kind: "requirement", id: "r", version: 1 },
          { kind: "requirement", id: "r", version: 2 },
        ],
      }),
    /AI_SOURCE_VERSION_DUPLICATE_RECORD/u,
  );
});

test("invalid and unbounded records fail closed before hashing", () => {
  assert.throws(
    () =>
      computeIntelligenceSourceVersion({
        projectId: "project",
        records: [{ kind: "document", id: "x", version: 0 }],
      }),
    /AI_SOURCE_VERSION_INVALID_RECORD/u,
  );
  assert.throws(
    () =>
      computeIntelligenceSourceVersion({ projectId: "project", records: [] }),
    /AI_SOURCE_VERSION_INVALID_RECORD_COUNT/u,
  );
});

test("the source-binding repository bounds, normalizes, and binds the exact source projection", () => {
  const source = readFileSync(
    new URL("./intelligenceSourceBindingStore.ts", import.meta.url),
    "utf8",
  );
  for (const required of [
    "draftClaims",
    "packageSignoffs",
    "contentText",
    "malwareStatus",
    "quarantineStatus",
    "addendumStatus",
    "sourceSnapshotHash",
    "manifestHash",
    "docxSha256",
    "pdfSha256",
    "zipSha256",
    "snapshot_temporal_state",
    "snapshot_output",
    "INTELLIGENCE_SOURCE_BINDING_POLICY_VERSION",
    "INTELLIGENCE_SNAPSHOT_ENGINE_VERSION",
    "loadIntelligenceSourceProjection",
    "loadIntelligenceSourceBinding",
    "loadPersistedRowTextBounds",
    "currentEvidenceApproverIds",
    "citation_verifier_authority",
    "verifierAuthority",
  ]) {
    assert.match(source, new RegExp(`\\b${required}\\b`, "u"), required);
  }
  assert.match(source, /organisationId: string;[\s\S]*now\?: Date/u);
  assert.match(
    source,
    /environment\?: IntelligenceCentreSnapshot\["environment"\]/u,
  );
  assert.match(
    source,
    /eq\(projects\.organisationId, options\.organisationId\)/u,
  );
  assert.match(
    source,
    /eq\(\s*organisationMemberships\.organisationId,\s*options\.organisationId,?\s*\)/u,
  );
  assert.match(source, /delegatedByMembershipId/u);
  assert.match(source, /active_direct_tenant_evidence_approver/u);
  assert.match(source, /productionAiEnabled: false/u);
  assert.match(source, /generatedAt: now\.toISOString\(\)/u);
  assert.match(source, /char_length\(to_jsonb\(/u);
  assert.match(source, /octet_length\(to_jsonb\(/u);
  assert.match(source, /coordinateJson: row\.coordinateJson/u);
  for (const table of [
    "documents",
    "document_versions",
    "requirements",
    "requirement_citations",
    "evidence_items",
    "defects",
    "boq_checks",
    "drafts",
    "draft_versions",
    "draft_claims",
    "work_tasks",
    "packages",
    "package_versions",
    "package_signoffs",
    "reports",
    "outcomes",
    "vault_items",
    "capability_items",
    "tenders",
  ]) {
    assert.match(
      source,
      new RegExp(`loadPersistedRowTextBounds\\(\\s*"${table}"`, "u"),
      table,
    );
  }
  assert.match(source, /source_set_bound_exceeded/u);
  assert.match(source, /source_text_bound_exceeded/u);
});
