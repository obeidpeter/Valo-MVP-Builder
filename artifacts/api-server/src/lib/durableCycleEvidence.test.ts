import assert from "node:assert/strict";
import test from "node:test";
import { advanceDurableCycleEvidence } from "./durableCycleEvidence";

test("an incomplete page remains dirty until its cursor cycle wraps", () => {
  const failedPage = advanceDurableCycleEvidence({
    carriedIncomplete: false,
    invocationIncomplete: true,
    cycleComplete: false,
  });
  assert.deepEqual(failedPage, {
    fullCycleComplete: false,
    nextCycleIncomplete: true,
  });

  const laterCleanPage = advanceDurableCycleEvidence({
    carriedIncomplete: failedPage.nextCycleIncomplete,
    invocationIncomplete: false,
    cycleComplete: false,
  });
  assert.deepEqual(laterCleanPage, {
    fullCycleComplete: false,
    nextCycleIncomplete: true,
  });

  const dirtyWrap = advanceDurableCycleEvidence({
    carriedIncomplete: laterCleanPage.nextCycleIncomplete,
    invocationIncomplete: false,
    cycleComplete: true,
  });
  assert.deepEqual(dirtyWrap, {
    fullCycleComplete: false,
    nextCycleIncomplete: false,
  });
});

test("only a wholly clean wrap emits durable full-cycle evidence", () => {
  assert.deepEqual(
    advanceDurableCycleEvidence({
      carriedIncomplete: false,
      invocationIncomplete: false,
      cycleComplete: true,
    }),
    { fullCycleComplete: true, nextCycleIncomplete: false },
  );
  assert.deepEqual(
    advanceDurableCycleEvidence({
      carriedIncomplete: false,
      invocationIncomplete: true,
      cycleComplete: true,
    }),
    { fullCycleComplete: false, nextCycleIncomplete: false },
  );
});
