export type JobStatus =
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";
export type JobEvent =
  | "claim"
  | "heartbeat"
  | "succeed"
  | "fail_retryable"
  | "fail_permanent"
  | "retry"
  | "cancel";

export interface JobTransitionInput {
  status: JobStatus;
  event: JobEvent;
  currentVersion: number;
  expectedVersion: number;
  attempts: number;
  maxAttempts: number;
  leaseOwner?: string | null;
  actorWorker?: string | null;
  leaseExpired?: boolean;
  progressPercent: number;
  nextProgressPercent?: number;
}

export interface JobTransitionDecision {
  allowed: boolean;
  nextStatus: JobStatus;
  nextVersion: number;
  nextAttempts: number;
  code?:
    | "stale_version"
    | "invalid_transition"
    | "lease_mismatch"
    | "progress_regressed"
    | "attempts_exhausted";
}

const denial = (
  input: JobTransitionInput,
  code: NonNullable<JobTransitionDecision["code"]>,
): JobTransitionDecision => ({
  allowed: false,
  nextStatus: input.status,
  nextVersion: input.currentVersion,
  nextAttempts: input.attempts,
  code,
});

export function evaluateJobTransition(
  input: JobTransitionInput,
): JobTransitionDecision {
  if (input.currentVersion !== input.expectedVersion)
    return denial(input, "stale_version");
  const ownsLease = Boolean(
    input.actorWorker &&
    input.leaseOwner === input.actorWorker &&
    !input.leaseExpired,
  );
  if (input.event === "claim") {
    if (!new Set<JobStatus>(["queued", "retry_wait"]).has(input.status))
      return denial(input, "invalid_transition");
    if (input.attempts >= input.maxAttempts)
      return denial(input, "attempts_exhausted");
    return {
      allowed: true,
      nextStatus: "running",
      nextVersion: input.currentVersion + 1,
      nextAttempts: input.attempts + 1,
    };
  }
  if (input.event === "cancel") {
    if (
      new Set<JobStatus>(["succeeded", "dead_letter", "cancelled"]).has(
        input.status,
      )
    )
      return denial(input, "invalid_transition");
    return {
      allowed: true,
      nextStatus: "cancelled",
      nextVersion: input.currentVersion + 1,
      nextAttempts: input.attempts,
    };
  }
  if (input.status !== "running") return denial(input, "invalid_transition");
  if (!ownsLease) return denial(input, "lease_mismatch");
  if (input.event === "heartbeat") {
    if (
      (input.nextProgressPercent ?? input.progressPercent) <
      input.progressPercent
    )
      return denial(input, "progress_regressed");
    return {
      allowed: true,
      nextStatus: "running",
      nextVersion: input.currentVersion + 1,
      nextAttempts: input.attempts,
    };
  }
  if (input.event === "succeed")
    return {
      allowed: true,
      nextStatus: "succeeded",
      nextVersion: input.currentVersion + 1,
      nextAttempts: input.attempts,
    };
  if (input.event === "fail_permanent")
    return {
      allowed: true,
      nextStatus: "failed",
      nextVersion: input.currentVersion + 1,
      nextAttempts: input.attempts,
    };
  if (input.event === "fail_retryable") {
    const exhausted = input.attempts >= input.maxAttempts;
    return {
      allowed: true,
      nextStatus: exhausted ? "dead_letter" : "retry_wait",
      nextVersion: input.currentVersion + 1,
      nextAttempts: input.attempts,
    };
  }
  return denial(input, "invalid_transition");
}

/** Stable jitter prevents a retry stampede while keeping schedules testable. */
export function computeRetryDelayMs(input: {
  idempotencyKey: string;
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): number {
  const attempt = Math.max(1, Math.trunc(input.attempt));
  const exponential = Math.min(
    input.maxDelayMs,
    input.baseDelayMs * 2 ** (attempt - 1),
  );
  let hash = 2166136261;
  for (const character of input.idempotencyKey) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const jitter = 0.8 + (hash % 401) / 1000;
  return Math.min(
    input.maxDelayMs,
    Math.max(0, Math.round(exponential * jitter)),
  );
}
