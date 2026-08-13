import assert from "node:assert/strict";
import test from "node:test";
import {
  STORAGE_LIFECYCLE_UNAVAILABLE_RECEIPT,
  storageLifecycleErrorStatus,
} from "./operatorHttp";

test("lifecycle persistence failure is an explicit side-effect-free 503", () => {
  assert.equal(storageLifecycleErrorStatus("persistence_unavailable"), 503);
  assert.deepEqual(STORAGE_LIFECYCLE_UNAVAILABLE_RECEIPT, {
    error: "Storage lifecycle persistence is unavailable",
    code: "STORAGE_LIFECYCLE_PERSISTENCE_UNAVAILABLE",
    sideEffectsApplied: false,
  });
});

test("lifecycle domain errors preserve their exact non-503 statuses", () => {
  assert.equal(storageLifecycleErrorStatus("invalid_scope"), 400);
  assert.equal(storageLifecycleErrorStatus("not_found"), 404);
  assert.equal(storageLifecycleErrorStatus("stale_version"), 409);
  assert.equal(storageLifecycleErrorStatus("invalid_state"), 409);
});
