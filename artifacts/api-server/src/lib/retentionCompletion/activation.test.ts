import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
  RETENTION_COMPLETION_ACTIVATION_ENV,
  evaluateRetentionCompletionActivation,
  loadCheckedRetentionCompletionActivationManifest,
  type RetentionCompletionActivationManifest,
} from "./activation";

test("checked source manifest matches the operator activation file and ships closed", () => {
  const persisted = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../config/operations/retention-completion-activation.v1.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(persisted, DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST);
  const repositoryRoot = resolve(import.meta.dirname, "../../../../../");
  const packageRoot = resolve(import.meta.dirname, "../../..");
  assert.deepEqual(
    loadCheckedRetentionCompletionActivationManifest(repositoryRoot),
    persisted,
  );
  assert.deepEqual(
    loadCheckedRetentionCompletionActivationManifest(packageRoot),
    persisted,
  );
  assert.equal(
    loadCheckedRetentionCompletionActivationManifest(
      resolve(repositoryRoot, "missing-runtime-root"),
    ),
    null,
  );
  const result = evaluateRetentionCompletionActivation(persisted, {
    [RETENTION_COMPLETION_ACTIVATION_ENV]: "true",
  });
  assert.equal(result.activated, false);
  assert.equal(result.manifestValid, true);
  assert.equal(result.evidenceBlockers.length, 6);
  assert.equal(
    result.activationBlockers.some(
      (blocker) => blocker.code === "production_activation_not_granted",
    ),
    true,
  );
});

test("activation requires an exact approved manifest and exact env opt-in", () => {
  const verified: RetentionCompletionActivationManifest = {
    ...DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
    status: "approved",
    productionActivationGranted: true,
    preconditions:
      DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST.preconditions.map(
        (precondition) => ({
          ...precondition,
          status: "verified" as const,
          evidence: `evidence:${precondition.id}`,
        }),
      ),
  };
  assert.equal(
    evaluateRetentionCompletionActivation(verified, {}).activated,
    false,
  );
  assert.equal(
    evaluateRetentionCompletionActivation(verified, {
      [RETENTION_COMPLETION_ACTIVATION_ENV]: "TRUE",
    }).activated,
    false,
  );
  assert.equal(
    evaluateRetentionCompletionActivation(verified, {
      [RETENTION_COMPLETION_ACTIVATION_ENV]: "true",
    }).activated,
    true,
  );
});

test("malformed, duplicate or unevidenced preconditions invalidate or block", () => {
  const duplicate = {
    ...DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
    preconditions: [
      ...DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST.preconditions.slice(
        0,
        -1,
      ),
      DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST.preconditions[0],
    ],
  };
  assert.equal(
    evaluateRetentionCompletionActivation(duplicate, {
      [RETENTION_COMPLETION_ACTIVATION_ENV]: "true",
    }).manifestValid,
    false,
  );
});
