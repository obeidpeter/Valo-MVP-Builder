import assert from "node:assert/strict";
import test from "node:test";
import {
  decideRetentionReconciliationProgress,
  decideStorageTerminalEvidence,
  permissionsForSnapshot,
} from "./policy";

test("dead letters wait for governed replay while immutable untrusted receipts block", () => {
  assert.equal(
    decideRetentionReconciliationProgress({
      pending: 0,
      deadLetters: 1,
      untrusted: 0,
    }),
    "wait_for_terminal_evidence",
  );
  assert.equal(
    decideRetentionReconciliationProgress({
      pending: 0,
      deadLetters: 0,
      untrusted: 1,
    }),
    "block_untrusted_terminal_evidence",
  );
  assert.equal(
    decideRetentionReconciliationProgress({
      pending: 0,
      deadLetters: 0,
      untrusted: 0,
    }),
    "reconcile",
  );
});

test("only exact completed provider receipts are trustworthy", () => {
  const terminalAt = new Date("2026-08-22T12:00:00.000Z");
  assert.deepEqual(
    decideStorageTerminalEvidence({
      eventStatus: "completed",
      eventVersion: 2,
      terminalAt,
      latestAttemptStatus: "completed",
      latestAttemptResponseCode: "already_absent",
    }),
    {
      outcome: "trusted",
      disposition: "already_absent",
      terminalEventVersion: 2,
      terminalAt,
    },
  );
  for (const eventStatus of ["cancelled", "resolved"] as const) {
    assert.deepEqual(
      decideStorageTerminalEvidence({
        eventStatus,
        eventVersion: 2,
        terminalAt,
        latestAttemptStatus: "completed",
        latestAttemptResponseCode: "deleted",
      }),
      { outcome: "untrusted" },
    );
  }
  assert.deepEqual(
    decideStorageTerminalEvidence({
      eventStatus: "dead_letter",
      eventVersion: 5,
      terminalAt,
      latestAttemptStatus: "failed",
      latestAttemptResponseCode: null,
    }),
    { outcome: "dead_letter" },
  );
});

test("snapshot capabilities follow state and maker-checker authority", () => {
  const common = {
    authorised: true,
    actorUserId: "checker",
    preparedByUserId: "maker",
  };
  assert.deepEqual(
    permissionsForSnapshot({
      ...common,
      requestStatus: "pending",
      actionStatus: null,
    }),
    { canStart: true, canReconcile: false, canCertify: false },
  );
  assert.equal(
    permissionsForSnapshot({
      ...common,
      requestStatus: "reconciling",
      actionStatus: "reconciled",
    }).canCertify,
    true,
  );
  assert.equal(
    permissionsForSnapshot({
      ...common,
      actorUserId: "maker",
      requestStatus: "reconciling",
      actionStatus: "reconciled",
    }).canCertify,
    false,
  );
});
