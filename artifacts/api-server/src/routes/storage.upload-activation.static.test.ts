import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LEGACY_SIGNED_UPLOAD_ISSUANCE } from "../lib/storageLifecycle/activation";

const source = readFileSync(new URL("./storage.ts", import.meta.url), "utf8");

test("generic signed upload issuance is fail-closed before parsing or signing", () => {
  assert.deepEqual(LEGACY_SIGNED_UPLOAD_ISSUANCE, {
    durableLeaseImplemented: false,
    createOnlySignedPutVerified: false,
    issuanceEnabled: false,
  });
  const gate = source.indexOf("LEGACY_SIGNED_UPLOAD_ISSUANCE.issuanceEnabled");
  assert.ok(gate >= 0);
  assert.doesNotMatch(source, /RequestUploadUrlBody|getObjectEntityUploadURL/u);
  assert.match(source, /no issuance implementation is mounted/u);
  assert.match(source, /LEGACY_UPLOAD_ISSUANCE_NOT_ACTIVATED/u);
  assert.match(source, /sideEffectsApplied: false/u);
});
