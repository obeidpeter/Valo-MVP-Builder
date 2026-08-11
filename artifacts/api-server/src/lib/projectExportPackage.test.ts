import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalProjectExportManifest,
  computeProjectExportManifestHash,
  includeAuditEventInProjectExport,
  PROJECT_EXPORT_AUDIT_POLICY,
  soleCanonicalProjectExportPackageId,
  type ProjectExportArchiveEntry,
} from "./projectExportPackage";

const identity = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectVersion: 7,
  reportId: "33333333-3333-4333-8333-333333333333",
  reportVersion: 4,
};

function entries(): ProjectExportArchiveEntry[] {
  return [
    {
      itemType: "project_snapshot",
      sourceObjectId: identity.projectId,
      sourceVersion: identity.projectVersion,
      filename: "project.json",
      bytes: Buffer.from('{"secret":"not persisted"}', "utf8"),
    },
    {
      itemType: "signed_report",
      sourceObjectId: identity.reportId,
      sourceVersion: identity.reportVersion,
      filename: "bid-autopsy-report-v4.docx",
      bytes: Buffer.from("PK\u0003\u0004 governed report bytes", "utf8"),
    },
  ];
}

test("canonical project export hashes are deterministic and re-verifiable", () => {
  const first = buildCanonicalProjectExportManifest(identity, entries());
  const repeated = buildCanonicalProjectExportManifest(identity, entries());
  assert.deepEqual(repeated, first);
  assert.match(first.sourceSnapshotHash, /^[a-f0-9]{64}$/u);
  assert.match(first.manifestHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    computeProjectExportManifestHash(first.items),
    first.manifestHash,
  );
  assert.deepEqual(
    first.items.map(({ ordinal, filename, sizeBytes }) => ({
      ordinal,
      filename,
      sizeBytes,
    })),
    [
      { ordinal: 1, filename: "project.json", sizeBytes: 26 },
      {
        ordinal: 2,
        filename: "bid-autopsy-report-v4.docx",
        sizeBytes: 26,
      },
    ],
  );
  assert.doesNotMatch(JSON.stringify(first), /not persisted/u);
  assert.doesNotMatch(JSON.stringify(first), /governed report bytes/u);
});

test("entry bytes and order bind the manifest while source identity binds the snapshot", () => {
  const baseline = buildCanonicalProjectExportManifest(identity, entries());
  const changedEntries = entries();
  changedEntries[0] = {
    ...changedEntries[0]!,
    bytes: Buffer.from('{"secret":"changed"}', "utf8"),
  };
  const changed = buildCanonicalProjectExportManifest(identity, changedEntries);
  assert.notEqual(changed.manifestHash, baseline.manifestHash);
  assert.notEqual(changed.sourceSnapshotHash, baseline.sourceSnapshotHash);

  const reordered = buildCanonicalProjectExportManifest(
    identity,
    entries().reverse(),
  );
  assert.notEqual(reordered.manifestHash, baseline.manifestHash);

  const nextProjectVersion = buildCanonicalProjectExportManifest(
    { ...identity, projectVersion: identity.projectVersion + 1 },
    entries(),
  );
  assert.equal(nextProjectVersion.manifestHash, baseline.manifestHash);
  assert.notEqual(
    nextProjectVersion.sourceSnapshotHash,
    baseline.sourceSnapshotHash,
  );
});

test("unsafe or duplicate archive names fail before persistence", () => {
  const duplicate = entries();
  duplicate[1] = { ...duplicate[1]!, filename: duplicate[0]!.filename };
  assert.throws(
    () => buildCanonicalProjectExportManifest(identity, duplicate),
    /manifest entry is invalid/u,
  );
  const traversal = entries();
  traversal[0] = { ...traversal[0]!, filename: "../project.json" };
  assert.throws(
    () => buildCanonicalProjectExportManifest(identity, traversal),
    /manifest entry is invalid/u,
  );
});

test("operational package observations stay authoritative without self-hashing", () => {
  assert.equal(
    includeAuditEventInProjectExport({
      eventType: "project.exported",
      objectType: "project",
    }),
    false,
  );
  assert.equal(
    includeAuditEventInProjectExport({
      eventType: "operations_suite.record_updated",
      objectType: "operations_suite.submission_war_room",
    }),
    false,
  );
  assert.equal(
    includeAuditEventInProjectExport({
      eventType: "operations_suite.record_updated",
      objectType: "operations_suite.post_award_item",
    }),
    false,
  );
  assert.equal(
    includeAuditEventInProjectExport({
      eventType: "evidence.accepted",
      objectType: "evidence_item",
    }),
    true,
  );
  assert.equal(
    PROJECT_EXPORT_AUDIT_POLICY.authoritativeTenantAuditRetained,
    true,
  );
  assert.match(
    JSON.stringify(PROJECT_EXPORT_AUDIT_POLICY),
    /package\.versions_viewed/u,
  );
});

test("canonical package identity fails closed on duplicate project packages", () => {
  assert.equal(soleCanonicalProjectExportPackageId([]), null);
  assert.equal(
    soleCanonicalProjectExportPackageId([{ id: "package-1" }]),
    "package-1",
  );
  assert.throws(
    () =>
      soleCanonicalProjectExportPackageId([
        { id: "package-1" },
        { id: "package-2" },
      ]),
    /Multiple canonical project export packages/u,
  );
});
