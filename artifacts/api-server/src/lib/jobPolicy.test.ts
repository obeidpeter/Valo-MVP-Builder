import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRetryDelayMs,
  evaluateJobTransition,
  type JobTransitionInput,
} from "./jobPolicy";

const running = (
  overrides: Partial<JobTransitionInput> = {},
): JobTransitionInput => ({
  status: "running",
  event: "heartbeat",
  currentVersion: 2,
  expectedVersion: 2,
  attempts: 1,
  maxAttempts: 3,
  leaseOwner: "worker-a",
  actorWorker: "worker-a",
  leaseExpired: false,
  progressPercent: 25,
  nextProgressPercent: 50,
  ...overrides,
});

test("claims use optimistic locking and bounded attempts", () => {
  assert.equal(
    evaluateJobTransition(
      running({ status: "queued", event: "claim", attempts: 0 }),
    ).nextStatus,
    "running",
  );
  assert.equal(
    evaluateJobTransition(
      running({ status: "queued", event: "claim", expectedVersion: 1 }),
    ).code,
    "stale_version",
  );
  assert.equal(
    evaluateJobTransition(
      running({ status: "queued", event: "claim", attempts: 3 }),
    ).code,
    "attempts_exhausted",
  );
});

test("only the active lease owner may mutate a running job", () => {
  assert.equal(
    evaluateJobTransition(running({ actorWorker: "worker-b" })).code,
    "lease_mismatch",
  );
  assert.equal(
    evaluateJobTransition(running({ leaseExpired: true })).code,
    "lease_mismatch",
  );
  assert.equal(
    evaluateJobTransition(running({ nextProgressPercent: 10 })).code,
    "progress_regressed",
  );
});

test("retryable errors wait or dead-letter at the configured bound", () => {
  assert.equal(
    evaluateJobTransition(running({ event: "fail_retryable", attempts: 2 }))
      .nextStatus,
    "retry_wait",
  );
  assert.equal(
    evaluateJobTransition(running({ event: "fail_retryable", attempts: 3 }))
      .nextStatus,
    "dead_letter",
  );
  assert.equal(
    evaluateJobTransition(running({ event: "fail_permanent" })).nextStatus,
    "failed",
  );
  assert.equal(
    evaluateJobTransition(running({ event: "succeed" })).nextStatus,
    "succeeded",
  );
});

test("terminal jobs cannot be cancelled or retried", () => {
  assert.equal(
    evaluateJobTransition(running({ status: "succeeded", event: "cancel" }))
      .code,
    "invalid_transition",
  );
  assert.equal(
    evaluateJobTransition(running({ status: "retry_wait", event: "retry" }))
      .code,
    "invalid_transition",
  );
});

test("retry delay is bounded, exponential, and stable for an idempotency key", () => {
  const first = computeRetryDelayMs({
    idempotencyKey: "job-a",
    attempt: 1,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
  });
  const second = computeRetryDelayMs({
    idempotencyKey: "job-a",
    attempt: 2,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
  });
  assert.equal(
    first,
    computeRetryDelayMs({
      idempotencyKey: "job-a",
      attempt: 1,
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
    }),
  );
  assert.equal(second > first, true);
  assert.equal(
    computeRetryDelayMs({
      idempotencyKey: "job-a",
      attempt: 99,
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
    }) <= 10_000,
    true,
  );
});
