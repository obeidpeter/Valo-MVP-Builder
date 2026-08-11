import assert from "node:assert/strict";
import test from "node:test";
import { OperationsSuiteError } from "../lib/operationsSuite/errors";
import { createDbOperationsSuiteGuards } from "./operationsSuite";

const scope = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
};

function scopeDenied(error: unknown): boolean {
  return error instanceof OperationsSuiteError && error.code === "scope_denied";
}

test("database guards reject malformed UUID references before querying", async () => {
  const guards = createDbOperationsSuiteGuards();
  await assert.rejects(
    guards.projectGuard.assertProject({ ...scope, projectId: "bad-project" }),
    scopeDenied,
  );
  await assert.rejects(
    guards.references.assertUser(scope, "bad-user"),
    scopeDenied,
  );
  await assert.rejects(
    guards.references.assertDocument(scope, "bad-document"),
    scopeDenied,
  );
  await assert.rejects(
    guards.references.assertPackageVersion(scope, "bad-package-version"),
    scopeDenied,
  );
});
