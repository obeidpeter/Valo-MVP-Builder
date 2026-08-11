import assert from "node:assert/strict";
import test from "node:test";
import type { OperationsScope } from "./contracts";
import { DrizzleOperationsSuiteStore } from "./drizzleStore";
import { OperationsSuiteError } from "./errors";

const scope: OperationsScope = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
};

test("durable lookups reject malformed UUIDs before a PostgreSQL bind", async () => {
  const store = new DrizzleOperationsSuiteStore();
  await assert.rejects(
    store.get(scope, "not-a-uuid"),
    (error: unknown) =>
      error instanceof OperationsSuiteError && error.code === "not_found",
  );
  await assert.rejects(
    store.list({ ...scope, projectId: "not-a-project-uuid" }),
    (error: unknown) =>
      error instanceof OperationsSuiteError && error.code === "scope_denied",
  );
});
