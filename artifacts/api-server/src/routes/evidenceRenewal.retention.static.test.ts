import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const retentionRoute = readFileSync(
  new URL("./retentionCompletion.ts", import.meta.url),
  "utf8",
);
const retentionService = readFileSync(
  new URL("../lib/retentionCompletion/service.ts", import.meta.url),
  "utf8",
);
test("retention completion cannot purge renewal payloads or issue a certificate", () => {
  assert.match(retentionRoute, /RETENTION_COMPLETION_NOT_ACTIVATED/u);
  assert.match(retentionRoute, /sideEffectsApplied: false/u);
  assert.match(
    retentionService,
    /async detach\([\s\S]*?this\.#assertActivated\(\);[\s\S]*?this\.#repository\.detach\(/u,
  );
  assert.doesNotMatch(retentionRoute, /EVIDENCE_RENEWAL_NAMESPACE/u);
  assert.doesNotMatch(retentionRoute, /evidence_renewal_records=/u);
  assert.doesNotMatch(retentionRoute, /eventType: "retention\.completed"/u);
});
