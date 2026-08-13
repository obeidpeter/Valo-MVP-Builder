import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const retention = readFileSync(
  new URL("./operations.ts", import.meta.url),
  "utf8",
);
test("retention completion cannot purge renewal payloads or issue a certificate", () => {
  assert.match(retention, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
  assert.match(retention, /sideEffectsApplied: false/u);
  assert.doesNotMatch(retention, /EVIDENCE_RENEWAL_NAMESPACE/u);
  assert.doesNotMatch(retention, /evidence_renewal_records=/u);
  assert.doesNotMatch(retention, /eventType: "retention\.completed"/u);
});
