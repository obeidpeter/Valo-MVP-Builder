import { test } from "node:test";
import assert from "node:assert/strict";
import { canMutateReleasedOperationsLedger } from "./tenancy";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";

const releasedLedgerMutations = [
  ["POST", `/projects/${PROJECT_ID}/operations-suite/submission-war-rooms`],
  [
    "POST",
    `/projects/${PROJECT_ID}/operations-suite/submission-war-rooms/${RECORD_ID}/advance`,
  ],
  ["POST", `/projects/${PROJECT_ID}/operations-suite/visual-qa-reports`],
  ["POST", `/projects/${PROJECT_ID}/operations-suite/post-award-items`],
  [
    "PATCH",
    `/projects/${PROJECT_ID}/operations-suite/post-award-items/${RECORD_ID}`,
  ],
  ["POST", `/projects/${PROJECT_ID}/claims-desk/records`],
  [
    "POST",
    `/projects/${PROJECT_ID}/claims-desk/records/${RECORD_ID}/transitions`,
  ],
] as const;

test("only exact released Operations ledger mutations bypass content immutability", () => {
  for (const status of ["signed_off", "exported"]) {
    for (const [method, path] of releasedLedgerMutations) {
      assert.equal(
        canMutateReleasedOperationsLedger(status, method, path),
        true,
        `${status} ${method} ${path}`,
      );
    }
  }

  assert.equal(
    canMutateReleasedOperationsLedger(
      "exported",
      "post",
      releasedLedgerMutations[0][1],
    ),
    true,
    "method matching is case insensitive",
  );
});

test("archived projects and non-ledger source/content routes remain immutable", () => {
  for (const [method, path] of releasedLedgerMutations) {
    assert.equal(
      canMutateReleasedOperationsLedger("archived", method, path),
      false,
    );
  }

  const denied: ReadonlyArray<readonly [string, string]> = [
    ["POST", `/projects/${PROJECT_ID}/operations-suite`],
    ["POST", `/projects/${PROJECT_ID}/operations-suite/work-items`],
    [
      "POST",
      `/projects/${PROJECT_ID}/operations-suite/visual-qa-reports/extra`,
    ],
    ["PATCH", `/projects/${PROJECT_ID}/operations-suite/post-award-items`],
    [
      "POST",
      `/projects/${PROJECT_ID}/operations-suite/post-award-items/${RECORD_ID}`,
    ],
    ["POST", `/projects/${PROJECT_ID}/reports`],
    ["PATCH", `/projects/${PROJECT_ID}`],
    ["POST", `/projects/${PROJECT_ID}/documents`],
    ["PATCH", `/projects/${PROJECT_ID}/claims-desk/records/${RECORD_ID}`],
    ["POST", `/projects/${PROJECT_ID}/claims-desk/records/extra/path`],
  ];
  for (const [method, path] of denied) {
    assert.equal(
      canMutateReleasedOperationsLedger("exported", method, path),
      false,
      `${method} ${path}`,
    );
  }
});
