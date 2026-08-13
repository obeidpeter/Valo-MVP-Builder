import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lockSource = readFileSync(
  new URL("./stagedUploadLock.ts", import.meta.url),
  "utf8",
);
const documentsSource = readFileSync(
  new URL("../routes/documents.ts", import.meta.url),
  "utf8",
);
const storageSource = readFileSync(
  new URL("../routes/storage.ts", import.meta.url),
  "utf8",
);
const reportsSource = readFileSync(
  new URL("../routes/reports.ts", import.meta.url),
  "utf8",
);
const vaultSource = readFileSync(
  new URL("../routes/vault.ts", import.meta.url),
  "utf8",
);

test("registration and discard share one transaction-scoped object lock", () => {
  assert.match(lockSource, /pg_advisory_xact_lock\(hashtextextended\(/);
  assert.match(
    documentsSource,
    /await lockStagedUploadObject\(\s*parsed\.data\.objectPath/,
  );
  assert.match(
    storageSource,
    /await lockStagedUploadObject\(parsed\.data\.objectPath\)/,
  );
});

test("registration checks every reference then promotes under the object lock", () => {
  const lockAt = documentsSource.indexOf("await lockStagedUploadObject(");
  const referenceCheckAt = documentsSource.indexOf(
    "storagePathReferenceKinds(",
    lockAt,
  );
  const firstStorageReadAt = documentsSource.indexOf(
    "downloadDocumentBuffer(parsed.data.objectPath)",
    lockAt,
  );
  const promotionAt = documentsSource.indexOf(
    "await objectStorage.promoteStagedUploadToDocument(",
    lockAt,
  );
  const insertAt = documentsSource.indexOf(".insert(documents)", promotionAt);
  assert.ok(lockAt >= 0, "registration lock missing");
  assert.ok(
    referenceCheckAt > lockAt,
    "reference check must follow the object lock",
  );
  assert.ok(
    firstStorageReadAt > referenceCheckAt,
    "referenced paths must be rejected before any storage read or disposition",
  );
  assert.ok(
    promotionAt > firstStorageReadAt,
    "promotion must follow inspection",
  );
  assert.ok(insertAt > promotionAt, "insert must follow stable promotion");
});

test("discard holds the same lock across reference check and deletion", () => {
  const lockAt = storageSource.indexOf("await lockStagedUploadObject(");
  const referenceAt = storageSource.indexOf(
    "storagePathReferenceKinds(objectPath)",
    lockAt,
  );
  const discardAt = storageSource.indexOf("await discardStagedUpload(", lockAt);
  assert.ok(lockAt >= 0, "discard lock missing");
  assert.ok(discardAt > lockAt, "reference check/delete must follow the lock");
  assert.ok(referenceAt > discardAt, "discard must use the complete inventory");
});

test("document deletion holds the object lock through row deletion and durable cleanup enqueue", () => {
  const deleteRouteAt = documentsSource.indexOf(
    'router.delete(\n  "/documents/:id"',
  );
  const lockAt = documentsSource.indexOf(
    "await lockStagedUploadObject(existing.objectPath)",
    deleteRouteAt,
  );
  const quarantineGuardAt = documentsSource.indexOf(
    'existing.extractionStatus === "quarantined"',
    lockAt,
  );
  const otherReferenceAt = documentsSource.indexOf(
    "excludeDocumentId: existing.id",
    quarantineGuardAt,
  );
  const rowDeleteAt = documentsSource.indexOf(".delete(documents)", lockAt);
  const referenceAt = documentsSource.indexOf(
    "storagePathReferenceKinds(",
    rowDeleteAt,
  );
  const enqueueAt = documentsSource.indexOf(
    "enqueueStorageDeletionIntent({",
    referenceAt,
  );
  assert.ok(deleteRouteAt >= 0, "document delete route missing");
  assert.ok(lockAt > deleteRouteAt, "delete lock missing");
  assert.ok(quarantineGuardAt > lockAt && otherReferenceAt > quarantineGuardAt);
  assert.ok(rowDeleteAt > otherReferenceAt, "quarantine marker guard missing");
  assert.ok(rowDeleteAt > lockAt, "row deletion must follow the object lock");
  assert.ok(
    referenceAt > rowDeleteAt,
    "remaining references must be rechecked",
  );
  assert.ok(
    enqueueAt > referenceAt,
    "durable deletion enqueue must follow the recheck",
  );
  const routeSource = documentsSource.slice(deleteRouteAt);
  assert.doesNotMatch(
    routeSource,
    /objectStorage\.deleteObjectEntity\(/,
    "document deletion must not remove storage inline",
  );
});

test("report and vault reference mutations use the shared object lock", () => {
  const reportLockAt = reportsSource.indexOf(
    "await lockStagedUploadObject(path)",
  );
  const reportInsertAt = reportsSource.indexOf(
    ".insert(reports)",
    reportLockAt,
  );
  assert.ok(reportLockAt >= 0 && reportInsertAt > reportLockAt);

  assert.match(
    vaultSource,
    /await lockObjectPaths\(\[candidate\.objectPath\]\)/,
  );
  assert.match(
    vaultSource,
    /sourceDoc\.extractionStatus === "quarantined"[\s\S]*vault\.source_link_denied[\s\S]*status\(409\)/,
  );
  const quarantineLinkGuards =
    vaultSource.match(/sourceDoc\.extractionStatus === "quarantined"/g) ?? [];
  assert.equal(quarantineLinkGuards.length, 2);
  assert.match(
    vaultSource,
    /await lockObjectPaths\(\[[\s\S]*existing\.objectPath,[\s\S]*sourceDocCandidate\?\.objectPath,[\s\S]*\]\)/,
  );
  const vaultDeleteAt = vaultSource.indexOf(
    'router.delete(\n  "/vault-items/:id"',
  );
  const vaultDeleteLockAt = vaultSource.indexOf(
    "await lockObjectPaths([existing.objectPath])",
    vaultDeleteAt,
  );
  const vaultRowDeleteAt = vaultSource.indexOf(
    ".delete(vaultItems)",
    vaultDeleteLockAt,
  );
  assert.ok(vaultDeleteAt >= 0 && vaultDeleteLockAt > vaultDeleteAt);
  assert.ok(vaultRowDeleteAt > vaultDeleteLockAt);
  assert.doesNotMatch(vaultSource, /deleteObjectEntity\(/);
  assert.match(vaultSource, /queued for durable storage reconciliation/);
});
