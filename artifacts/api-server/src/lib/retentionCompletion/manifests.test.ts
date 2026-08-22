import assert from "node:assert/strict";
import test from "node:test";
import {
  RETENTION_CERTIFICATE_MANIFEST_SCHEMA,
  RETENTION_SOURCE_MANIFEST_SCHEMA,
  RETENTION_PURGE_RECEIPT_SCHEMA,
  RETENTION_RECONCILIATION_MANIFEST_SCHEMA,
  digestSortedIdentities,
  parsePersistedManifest,
  parseRetentionCertificateManifest,
  parseRetentionReconciliationManifest,
  parseRetentionSourceManifest,
  parseRetentionProjectPurgeReceipt,
  retentionManifestSha256,
  serializeRetentionManifest,
  type RetentionSourceManifest,
  type RetentionProjectPurgeReceipt,
  type RetentionCertificateManifest,
  type RetentionReconciliationManifest,
} from "./manifests";

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

test("retention manifests are canonical, deterministic and identity ordered", () => {
  const manifest: RetentionSourceManifest = {
    schema: RETENTION_SOURCE_MANIFEST_SCHEMA,
    organisationId: id("1"),
    retentionRequestId: id("2"),
    retentionActionId: id("3"),
    subjectProjectId: id("4"),
    requestVersion: 1,
    projectVersion: 7,
    projectStatus: "exported",
    capturedAt: "2026-08-22T12:00:00.000Z",
    idempotencyKeySha256: "a".repeat(64),
    attestationSha256: "b".repeat(64),
    categories: [
      {
        category: "documents",
        count: 2,
        identitiesSha256: digestSortedIdentities([id("6"), id("5")]),
      },
      {
        category: "projects",
        count: 1,
        identitiesSha256: digestSortedIdentities([id("4")]),
      },
    ],
    storageObjects: [
      { objectPathSha256: "c".repeat(64), sourceKind: "document" },
    ],
    retainedCategories: [
      {
        category: "retention_control",
        reason: "immutable completion evidence",
        count: 2,
      },
    ],
  };
  const serialized = serializeRetentionManifest(manifest);
  assert.deepEqual(parsePersistedManifest(serialized), manifest);
  assert.deepEqual(
    parseRetentionSourceManifest(serialized, retentionManifestSha256(manifest)),
    manifest,
  );
  assert.equal(
    retentionManifestSha256(manifest),
    retentionManifestSha256(manifest),
  );
  assert.equal(
    digestSortedIdentities([id("5"), id("6")]),
    digestSortedIdentities([id("6"), id("5")]),
  );
  const categoryOrderDrift = {
    ...manifest,
    categories: [...manifest.categories].reverse(),
  };
  assert.throws(() =>
    parseRetentionSourceManifest(
      serializeRetentionManifest(categoryOrderDrift),
      retentionManifestSha256(categoryOrderDrift),
    ),
  );
});

test("persisted manifests reject noncanonical JSON", () => {
  assert.throws(() => parsePersistedManifest('{"b":1,"a":2}'));
});

test("owner purge receipts bind the exact relational counts and version stamp", () => {
  const receipt: RetentionProjectPurgeReceipt = {
    schema: RETENTION_PURGE_RECEIPT_SCHEMA,
    organisationId: id("1"),
    retentionRequestId: id("2"),
    retentionActionId: id("3"),
    subjectProjectId: id("4"),
    sourceManifestSha256: "a".repeat(64),
    actionVersionBefore: 2,
    actionVersionAfter: 3,
    deletedProjectRows: 1,
    deletedDocumentVersionSnapshotRows: 2,
    detachedLegalHoldRows: 3,
    detachedOrderRows: 4,
    detachedEntitlementUsageRows: 5,
    purgedAt: "2026-08-22T12:00:00.000Z",
    method: "owner_held_manifest_bound_project_purge",
  };
  const serialized = serializeRetentionManifest(receipt);
  assert.deepEqual(
    parseRetentionProjectPurgeReceipt(
      serialized,
      retentionManifestSha256(receipt),
    ),
    receipt,
  );
  assert.throws(() =>
    parseRetentionProjectPurgeReceipt(
      serializeRetentionManifest({ ...receipt, actionVersionAfter: 4 }),
    ),
  );
});

test("reconciliation and certificate manifests commit to the owner purge proof", () => {
  const reconciliation: RetentionReconciliationManifest = {
    schema: RETENTION_RECONCILIATION_MANIFEST_SCHEMA,
    organisationId: id("1"),
    retentionRequestId: id("2"),
    retentionActionId: id("3"),
    subjectProjectId: id("4"),
    sourceManifestSha256: "a".repeat(64),
    purgeReceiptSha256: "b".repeat(64),
    purgedAt: "2026-08-22T12:00:00.000Z",
    reconciledAt: "2026-08-22T12:01:00.000Z",
    idempotencyKeySha256: "c".repeat(64),
    attestationSha256: "d".repeat(64),
    events: [],
  };
  const reconciliationText = serializeRetentionManifest(reconciliation);
  assert.deepEqual(
    parseRetentionReconciliationManifest(
      reconciliationText,
      retentionManifestSha256(reconciliation),
    ),
    reconciliation,
  );

  const certificate: RetentionCertificateManifest = {
    schema: RETENTION_CERTIFICATE_MANIFEST_SCHEMA,
    organisationId: id("1"),
    retentionRequestId: id("2"),
    retentionActionId: id("3"),
    subjectProjectId: id("4"),
    sourceManifestSha256: "a".repeat(64),
    purgeReceiptSha256: "b".repeat(64),
    purgedAt: "2026-08-22T12:00:00.000Z",
    reconciliationManifestSha256: retentionManifestSha256(reconciliation),
    preparedByUserId: id("5"),
    preparedByName: "Retention Maker",
    preparedAt: "2026-08-22T12:01:00.000Z",
    checkedByUserId: id("6"),
    checkedByName: "Retention Checker",
    checkedAt: "2026-08-22T12:02:00.000Z",
    idempotencyKeySha256: "e".repeat(64),
    attestationSha256: "f".repeat(64),
    method: "durable_two_phase_detach_reconcile_certify",
  };
  assert.deepEqual(
    parseRetentionCertificateManifest(
      serializeRetentionManifest(certificate),
      retentionManifestSha256(certificate),
    ),
    certificate,
  );
  const { purgeReceiptSha256: _removed, ...unbound } = certificate;
  assert.throws(() =>
    parseRetentionCertificateManifest(serializeRetentionManifest(unbound)),
  );
});
