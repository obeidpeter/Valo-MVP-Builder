import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./operations.ts", import.meta.url),
  "utf8",
);
const completionStart = source.indexOf('"/retention-requests/:id/complete"');
const completionEnd = source.indexOf(
  "\n);\n\nexport default router",
  completionStart,
);

assert.ok(completionStart >= 0, "retention completion route exists");
assert.ok(completionEnd > completionStart, "completion route can be isolated");

const completionRoute = source.slice(completionStart, completionEnd);

test("retention request creation and listing remain mounted", () => {
  assert.match(source, /"\/projects\/:id\/retention-requests"/u);
  assert.match(source, /router\.get\(\s*"\/retention-requests"/u);
});

test("retention completion fails closed without a mutation path", () => {
  assert.match(completionRoute, /res\.status\(503\)\.json/u);
  assert.match(completionRoute, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
  assert.match(completionRoute, /sideEffectsApplied: false/u);
  assert.match(completionRoute, /durable_two_phase_detach_reconcile_certify/u);
  assert.match(completionRoute, /"upload_sessions"/u);
  assert.match(completionRoute, /"storage_lifecycle_control_rows"/u);
  assert.doesNotMatch(
    completionRoute,
    /\bawait\b|\bdb\.|writeAudit|ObjectStorageService|planProjectBlobPurge|purgeBlobs|\.delete\(|\.update\(|\.insert\(/u,
  );
});

test("operations route no longer imports the synchronous blob purge", () => {
  assert.doesNotMatch(
    source,
    /ObjectStorageService|planProjectBlobPurge|purgeBlobs/u,
  );
  assert.doesNotMatch(source, /eventType: "retention\.completed"/u);
});
