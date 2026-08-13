import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./repository.ts", import.meta.url),
  "utf8",
);

test("deletion intents are closed, cascade-resistant and exact-replay safe", () => {
  assert.match(
    source,
    /createStorageDeletionIntent\(\{[\s\S]*?organisationId: input\.organisationId,[\s\S]*?reason: input\.reason,[\s\S]*?requestedAt:/u,
  );
  assert.doesNotMatch(source, /createStorageDeletionIntent\(\{\s*\.\.\.input/u);
  assert.match(
    source,
    /projectId: null,[\s\S]*?channel: STORAGE_DELETION_CHANNEL,[\s\S]*?template: STORAGE_DELETION_INTENT_SCHEMA/u,
  );
  assert.match(
    source,
    /onConflictDoNothing\(\{ target: notificationEvents\.id \}\)/u,
  );
});

test("reconciliation rechecks all references before the idempotent delete", () => {
  const referenceCheck = source.indexOf("storagePathReferenceKinds(");
  const deleteCall = source.indexOf("deleteObjectEntity(", referenceCheck);
  assert.ok(referenceCheck >= 0 && deleteCall > referenceCheck);
  assert.match(
    source,
    /limit\(STORAGE_LIFECYCLE_BOUNDS\.maximumAttempts \+ 1\)/u,
  );
  assert.match(source, /status: terminal \? "dead_letter" : "retry_wait"/u);
  assert.match(
    source,
    /lockStagedUploadObject\(candidate\.envelope\.objectPath\)/u,
  );
  const pathLock = source.indexOf(
    "lockStagedUploadObject(candidate.envelope.objectPath)",
  );
  const rowLock = source.indexOf('.for("update")', pathLock);
  const pathRecheck = source.indexOf(
    "event.envelope.objectPath !== candidate.envelope.objectPath",
    rowLock,
  );
  assert.ok(pathLock >= 0 && rowLock > pathLock && pathRecheck > rowLock);
  assert.match(
    source,
    /event\.envelope\.requestSha256 !==[\s\S]*candidate\.envelope\.requestSha256/u,
  );
  assert.match(source, /availableAt: nextAttemptAt \?\? input\.now/u);
  assert.match(source, /storage\.deletion_retry_scheduled/u);
  assert.match(source, /storage\.deletion_dead_lettered/u);
});

test("expired upload sweeping covers live URLs and follows path-before-row locking", () => {
  const sweep = source.slice(source.indexOf("sweepExpiredClientUploadLeases"));
  for (const status of [
    "open",
    "completed",
    "rejected",
    "quarantined",
    "cleanup_unconfirmed",
  ]) {
    assert.match(sweep, new RegExp(`"${status}"`, "u"));
  }
  assert.match(sweep, /\.limit\(limit \+ 1\)/u);
  const pathLock = sweep.indexOf("lockStagedUploadObject(objectPath)");
  const rowLock = sweep.indexOf('.for("update")', pathLock);
  assert.ok(pathLock >= 0 && rowLock > pathLock);
  assert.match(sweep, /"completed_cleanup_queued"/u);
  assert.match(sweep, /"rejected_cleanup_queued"/u);
  assert.match(sweep, /"quarantined_cleanup_queued"/u);
  assert.match(sweep, /"cleanup_unconfirmed_post_expiry_queued"/u);
  assert.match(sweep, /enqueueStorageDeletionIntentTx/u);
});
