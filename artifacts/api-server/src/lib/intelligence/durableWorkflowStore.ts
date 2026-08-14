import { createHash } from "node:crypto";
import { processingJobs, processingRuns, reviews } from "@workspace/db/schema";
import { and, eq, gt, lte } from "drizzle-orm";
import {
  AI_CAPABILITY_IDS,
  AI_SAFE_ERROR_CODES,
  type AiCapabilityId,
  type AiSafeErrorCode,
} from "../aiPolicy";
import { computeRetryDelayMs, type JobStatus } from "../jobPolicy";

/**
 * This store persists control evidence only. It does not start a worker, call a
 * model provider, approve an output, or alter the production AI kill switch.
 */
export const DURABLE_WORKFLOW_STORE_STATUS = Object.freeze({
  persistenceImplemented: true,
  runtimeConnected: false,
  providerInvocationAllowed: false,
  productionApproved: false,
  activation: "blocked" as const,
});

export const DURABLE_WORKFLOW_JOB_TYPES = Object.freeze([
  ...AI_CAPABILITY_IDS,
] as const);

export type DurableWorkflowJobType = AiCapabilityId;
export type DurableWorkflowJob = typeof processingJobs.$inferSelect;
export type DurableWorkflowRun = typeof processingRuns.$inferSelect;
export type DurableWorkflowReview = typeof reviews.$inferSelect;

export type DurableWorkflowStoreErrorCode =
  | "invalid_scope"
  | "invalid_control_input"
  | "not_found_or_not_authorized"
  | "stale_version"
  | "invalid_transition"
  | "lease_mismatch"
  | "lease_not_expired"
  | "attempts_exhausted"
  | "persistence_conflict";

export class DurableWorkflowStoreError extends Error {
  readonly code: DurableWorkflowStoreErrorCode;

  constructor(code: DurableWorkflowStoreErrorCode) {
    super(DURABLE_WORKFLOW_ERROR_MESSAGES[code]);
    this.name = "DurableWorkflowStoreError";
    this.code = code;
  }
}

const DURABLE_WORKFLOW_ERROR_MESSAGES: Record<
  DurableWorkflowStoreErrorCode,
  string
> = {
  invalid_scope: "The workflow scope is invalid.",
  invalid_control_input: "The workflow control input is invalid.",
  not_found_or_not_authorized: "The workflow record is unavailable.",
  stale_version: "The workflow record changed before this operation completed.",
  invalid_transition: "The requested workflow transition is not allowed.",
  lease_mismatch: "The active workflow lease is unavailable.",
  lease_not_expired: "The workflow lease has not expired.",
  attempts_exhausted: "The workflow retry allowance is exhausted.",
  persistence_conflict: "The workflow transition could not be persisted.",
};

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_V1_5_PATTERN as UUID,
} from "../identifierPatterns";
const CONTROL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITIES = new Set<string>(AI_CAPABILITY_IDS);
const SAFE_ERROR_CODES = new Set<string>(AI_SAFE_ERROR_CODES);
const CLAIMABLE_STATUSES = new Set<JobStatus>(["queued", "retry_wait"]);
const TERMINAL_STATUSES = new Set<JobStatus>([
  "succeeded",
  "dead_letter",
  "cancelled",
]);
const RETRY_REASON_CODES = new Set<DurableWorkflowRetryReason>([
  "transient_dependency_restored",
  "configuration_corrected",
  "capacity_restored",
  "manual_recovery_authorized",
]);
const CANCELLATION_REASON_CODES = new Set<DurableWorkflowCancellationReason>([
  "user_requested",
  "superseded",
  "scope_withdrawn",
  "policy_hold",
]);

export interface DurableWorkflowScope {
  organisationId: string;
  projectId: string;
}

export type DurableWorkflowRetryReason =
  | "transient_dependency_restored"
  | "configuration_corrected"
  | "capacity_restored"
  | "manual_recovery_authorized";

export type DurableWorkflowCancellationReason =
  | "user_requested"
  | "superseded"
  | "scope_withdrawn"
  | "policy_hold";

export interface DurableWorkflowEnqueueInput extends DurableWorkflowScope {
  jobType: DurableWorkflowJobType;
  /** A caller-generated digest. Plain request text and PII are rejected. */
  idempotencyDigest: string;
  documentVersionId?: string | null;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
}

export interface DurableWorkflowClaimInput extends DurableWorkflowScope {
  jobId: string;
  expectedVersion: number;
  workerId: string;
  leaseDurationMs: number;
  provider: string;
  inputHash: string;
  modelConfigurationId?: string | null;
  promptConfigurationId?: string | null;
}

export interface DurableWorkflowHeartbeatInput extends DurableWorkflowScope {
  jobId: string;
  expectedVersion: number;
  workerId: string;
  leaseDurationMs: number;
  progressPercent: number;
}

export interface DurableWorkflowSucceedInput extends DurableWorkflowScope {
  jobId: string;
  runId: string;
  expectedVersion: number;
  workerId: string;
  outputHash: string;
  reviewerUserId: string;
  latencyMs?: number | null;
  costMinor?: bigint | null;
  costCurrency?: "NGN" | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface DurableWorkflowFailInput extends DurableWorkflowScope {
  jobId: string;
  runId: string;
  expectedVersion: number;
  workerId: string;
  retryable: boolean;
  errorCode: AiSafeErrorCode;
  latencyMs?: number | null;
}

export interface DurableWorkflowRetryInput extends DurableWorkflowScope {
  jobId: string;
  expectedVersion: number;
  operatorUserId: string;
  reasonCode: DurableWorkflowRetryReason;
  newMaxAttempts: number;
}

export interface DurableWorkflowCancelInput extends DurableWorkflowScope {
  jobId: string;
  expectedVersion: number;
  cancelledByUserId: string;
  reasonCode: DurableWorkflowCancellationReason;
}

export interface DurableWorkflowRecoverLeaseInput extends DurableWorkflowScope {
  jobId: string;
  expectedVersion: number;
}

interface ClaimPersistenceInput extends DurableWorkflowClaimInput {
  expectedStatus: "queued" | "retry_wait";
  now: Date;
  leaseExpiresAt: Date;
  nextVersion: number;
  nextAttempts: number;
}

interface HeartbeatPersistenceInput extends DurableWorkflowHeartbeatInput {
  now: Date;
  leaseExpiresAt: Date;
  expectedStatus: "running";
  nextVersion: number;
}

interface SuccessPersistenceInput extends DurableWorkflowSucceedInput {
  now: Date;
  expectedStatus: "running";
  nextVersion: number;
}

interface FailurePersistenceInput extends DurableWorkflowFailInput {
  now: Date;
  expectedStatus: "running";
  nextStatus: "failed" | "retry_wait" | "dead_letter";
  nextVersion: number;
  availableAt: Date;
}

interface RetryPersistenceInput extends DurableWorkflowRetryInput {
  now: Date;
  expectedStatus: "failed" | "dead_letter";
  nextVersion: number;
}

interface CancelPersistenceInput extends DurableWorkflowCancelInput {
  now: Date;
  expectedStatus: JobStatus;
  nextVersion: number;
}

interface RecoverLeasePersistenceInput extends DurableWorkflowRecoverLeaseInput {
  now: Date;
  expectedStatus: "running";
  nextStatus: "retry_wait" | "dead_letter";
  nextVersion: number;
  availableAt: Date;
}

export interface DurableWorkflowClaimResult {
  job: DurableWorkflowJob;
  /** Persisted before this method returns; only then may a caller invoke a provider. */
  run: DurableWorkflowRun;
}

export interface DurableWorkflowSuccessResult {
  job: DurableWorkflowJob;
  run: DurableWorkflowRun;
  review: DurableWorkflowReview;
  authoritativeUseApproved: false;
}

export interface DurableWorkflowTransitionResult {
  job: DurableWorkflowJob;
  run?: DurableWorkflowRun;
  review?: DurableWorkflowReview;
}

/** Atomic persistence boundary, injectable for deterministic unit tests. */
export interface DurableWorkflowRepository {
  enqueue(
    input: Omit<DurableWorkflowEnqueueInput, "idempotencyDigest"> & {
      idempotencyKey: string;
      now: Date;
      priority: number;
      maxAttempts: number;
      availableAt: Date;
    },
  ): Promise<DurableWorkflowJob>;
  findJob(
    scope: DurableWorkflowScope,
    jobId: string,
  ): Promise<DurableWorkflowJob | null>;
  claim(
    input: ClaimPersistenceInput,
  ): Promise<DurableWorkflowClaimResult | null>;
  heartbeat(
    input: HeartbeatPersistenceInput,
  ): Promise<DurableWorkflowJob | null>;
  succeed(
    input: SuccessPersistenceInput,
  ): Promise<DurableWorkflowSuccessResult | null>;
  fail(
    input: FailurePersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null>;
  retry(
    input: RetryPersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null>;
  cancel(
    input: CancelPersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null>;
  recoverExpiredLease(
    input: RecoverLeasePersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null>;
}

function workflowHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validScope(scope: DurableWorkflowScope): boolean {
  return UUID.test(scope.organisationId) && UUID.test(scope.projectId);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function validControlIdentifier(value: unknown): value is string {
  return typeof value === "string" && CONTROL_IDENTIFIER.test(value);
}

function validInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function assertScope(scope: DurableWorkflowScope): void {
  if (!validScope(scope)) throw new DurableWorkflowStoreError("invalid_scope");
}

function assertVersion(expectedVersion: number): void {
  if (!validInteger(expectedVersion, 1, Number.MAX_SAFE_INTEGER)) {
    throw new DurableWorkflowStoreError("invalid_control_input");
  }
}

function requireJob(
  job: DurableWorkflowJob | null,
  expectedVersion: number,
): DurableWorkflowJob {
  if (!job) {
    throw new DurableWorkflowStoreError("not_found_or_not_authorized");
  }
  if (job.version !== expectedVersion) {
    throw new DurableWorkflowStoreError("stale_version");
  }
  return job;
}

function requirePersisted<T>(value: T | null): T {
  if (!value) throw new DurableWorkflowStoreError("persistence_conflict");
  return value;
}

function ownsLiveLease(
  job: DurableWorkflowJob,
  workerId: string,
  now: Date,
): boolean {
  return (
    job.status === "running" &&
    job.leaseOwner === workerId &&
    job.leaseExpiresAt != null &&
    job.leaseExpiresAt.getTime() > now.getTime()
  );
}

function assertOptionalRunTelemetry(input: {
  latencyMs?: number | null;
  costMinor?: bigint | null;
  costCurrency?: "NGN" | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): void {
  const integerOrNull = (value: number | null | undefined, max: number) =>
    value == null || validInteger(value, 0, max);
  if (
    !integerOrNull(input.latencyMs, 86_400_000) ||
    !integerOrNull(input.promptTokens, 10_000_000) ||
    !integerOrNull(input.completionTokens, 10_000_000) ||
    (input.costMinor != null &&
      (typeof input.costMinor !== "bigint" ||
        input.costMinor < 0n ||
        input.costMinor > 1_000_000_000_000n)) ||
    (input.costCurrency != null && input.costCurrency !== "NGN") ||
    (input.costMinor != null && input.costCurrency !== "NGN") ||
    (input.costCurrency != null && input.costMinor == null)
  ) {
    throw new DurableWorkflowStoreError("invalid_control_input");
  }
}

export class DurableWorkflowStore {
  constructor(
    private readonly repository: DurableWorkflowRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(
    input: DurableWorkflowEnqueueInput,
  ): Promise<DurableWorkflowJob> {
    assertScope(input);
    const priority = input.priority ?? 100;
    const maxAttempts = input.maxAttempts ?? 5;
    const now = this.now();
    const availableAt = input.availableAt ?? now;
    if (
      !CAPABILITIES.has(input.jobType) ||
      !validSha256(input.idempotencyDigest) ||
      (input.documentVersionId != null &&
        !validUuid(input.documentVersionId)) ||
      !validInteger(priority, 0, 1_000) ||
      !validInteger(maxAttempts, 1, 10) ||
      !(availableAt instanceof Date) ||
      !Number.isFinite(availableAt.getTime()) ||
      availableAt.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1_000
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const idempotencyKey = workflowHash(
      [
        "valo-durable-workflow-v1",
        input.organisationId,
        input.projectId,
        input.jobType,
        input.idempotencyDigest,
      ].join("\0"),
    );
    return this.repository.enqueue({
      ...input,
      idempotencyKey,
      priority,
      maxAttempts,
      now,
      availableAt,
    });
  }

  async claim(
    input: DurableWorkflowClaimInput,
  ): Promise<DurableWorkflowClaimResult> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    if (
      !validUuid(input.jobId) ||
      !validControlIdentifier(input.workerId) ||
      !validControlIdentifier(input.provider) ||
      !validSha256(input.inputHash) ||
      !validInteger(input.leaseDurationMs, 5_000, 300_000) ||
      (input.modelConfigurationId != null &&
        !validUuid(input.modelConfigurationId)) ||
      (input.promptConfigurationId != null &&
        !validUuid(input.promptConfigurationId))
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (!CLAIMABLE_STATUSES.has(job.status as JobStatus)) {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    if (job.attempts >= job.maxAttempts) {
      throw new DurableWorkflowStoreError("attempts_exhausted");
    }
    if (job.availableAt.getTime() > now.getTime()) {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    return requirePersisted(
      await this.repository.claim({
        ...input,
        expectedStatus: job.status as "queued" | "retry_wait",
        now,
        leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
        nextVersion: job.version + 1,
        nextAttempts: job.attempts + 1,
      }),
    );
  }

  async heartbeat(
    input: DurableWorkflowHeartbeatInput,
  ): Promise<DurableWorkflowJob> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    if (
      !validUuid(input.jobId) ||
      !validControlIdentifier(input.workerId) ||
      !validInteger(input.leaseDurationMs, 5_000, 300_000) ||
      !validInteger(input.progressPercent, 0, 99)
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (job.status !== "running") {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    if (!ownsLiveLease(job, input.workerId, now)) {
      throw new DurableWorkflowStoreError("lease_mismatch");
    }
    if (input.progressPercent < job.progressPercent) {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    return requirePersisted(
      await this.repository.heartbeat({
        ...input,
        now,
        leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
        expectedStatus: "running",
        nextVersion: job.version + 1,
      }),
    );
  }

  async succeed(
    input: DurableWorkflowSucceedInput,
  ): Promise<DurableWorkflowSuccessResult> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    assertOptionalRunTelemetry(input);
    if (
      !validUuid(input.jobId) ||
      !validUuid(input.runId) ||
      !validControlIdentifier(input.workerId) ||
      !validSha256(input.outputHash) ||
      !validUuid(input.reviewerUserId)
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (job.status !== "running") {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    if (!ownsLiveLease(job, input.workerId, now)) {
      throw new DurableWorkflowStoreError("lease_mismatch");
    }
    return requirePersisted(
      await this.repository.succeed({
        ...input,
        now,
        expectedStatus: "running",
        nextVersion: job.version + 1,
      }),
    );
  }

  async fail(
    input: DurableWorkflowFailInput,
  ): Promise<DurableWorkflowTransitionResult> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    assertOptionalRunTelemetry(input);
    if (
      !validUuid(input.jobId) ||
      !validUuid(input.runId) ||
      !validControlIdentifier(input.workerId) ||
      !SAFE_ERROR_CODES.has(input.errorCode) ||
      typeof input.retryable !== "boolean"
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (job.status !== "running") {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    if (!ownsLiveLease(job, input.workerId, now)) {
      throw new DurableWorkflowStoreError("lease_mismatch");
    }
    const exhausted = job.attempts >= job.maxAttempts;
    const nextStatus = input.retryable
      ? exhausted
        ? "dead_letter"
        : "retry_wait"
      : "failed";
    const retryDelayMs =
      nextStatus === "retry_wait"
        ? computeRetryDelayMs({
            idempotencyKey: job.idempotencyKey,
            attempt: job.attempts,
            baseDelayMs: 5_000,
            maxDelayMs: 15 * 60_000,
          })
        : 0;
    return requirePersisted(
      await this.repository.fail({
        ...input,
        now,
        expectedStatus: "running",
        nextStatus,
        nextVersion: job.version + 1,
        availableAt: new Date(now.getTime() + retryDelayMs),
      }),
    );
  }

  async retry(
    input: DurableWorkflowRetryInput,
  ): Promise<DurableWorkflowTransitionResult> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    if (
      !validUuid(input.jobId) ||
      !validUuid(input.operatorUserId) ||
      !RETRY_REASON_CODES.has(input.reasonCode) ||
      !validInteger(input.newMaxAttempts, 1, 10)
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (job.status !== "failed" && job.status !== "dead_letter") {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    if (input.newMaxAttempts <= job.attempts) {
      throw new DurableWorkflowStoreError("attempts_exhausted");
    }
    return requirePersisted(
      await this.repository.retry({
        ...input,
        now,
        expectedStatus: job.status,
        nextVersion: job.version + 1,
      }),
    );
  }

  async cancel(
    input: DurableWorkflowCancelInput,
  ): Promise<DurableWorkflowTransitionResult> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    if (
      !validUuid(input.jobId) ||
      !validUuid(input.cancelledByUserId) ||
      !CANCELLATION_REASON_CODES.has(input.reasonCode)
    ) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (TERMINAL_STATUSES.has(job.status as JobStatus)) {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    return requirePersisted(
      await this.repository.cancel({
        ...input,
        now,
        expectedStatus: job.status as JobStatus,
        nextVersion: job.version + 1,
      }),
    );
  }

  async recoverExpiredLease(
    input: DurableWorkflowRecoverLeaseInput,
  ): Promise<DurableWorkflowTransitionResult> {
    assertScope(input);
    assertVersion(input.expectedVersion);
    if (!validUuid(input.jobId)) {
      throw new DurableWorkflowStoreError("invalid_control_input");
    }
    const now = this.now();
    const job = requireJob(
      await this.repository.findJob(input, input.jobId),
      input.expectedVersion,
    );
    if (job.status !== "running") {
      throw new DurableWorkflowStoreError("invalid_transition");
    }
    if (
      job.leaseExpiresAt == null ||
      job.leaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new DurableWorkflowStoreError("lease_not_expired");
    }
    const nextStatus =
      job.attempts >= job.maxAttempts ? "dead_letter" : "retry_wait";
    const retryDelayMs =
      nextStatus === "retry_wait"
        ? computeRetryDelayMs({
            idempotencyKey: job.idempotencyKey,
            attempt: job.attempts,
            baseDelayMs: 5_000,
            maxDelayMs: 15 * 60_000,
          })
        : 0;
    return requirePersisted(
      await this.repository.recoverExpiredLease({
        ...input,
        now,
        expectedStatus: "running",
        nextStatus,
        nextVersion: job.version + 1,
        availableAt: new Date(now.getTime() + retryDelayMs),
      }),
    );
  }
}

export class DrizzleDurableWorkflowRepository implements DurableWorkflowRepository {
  private async database(): Promise<(typeof import("@workspace/db"))["db"]> {
    return (await import("@workspace/db")).db;
  }

  async enqueue(
    input: Omit<DurableWorkflowEnqueueInput, "idempotencyDigest"> & {
      idempotencyKey: string;
      now: Date;
      priority: number;
      maxAttempts: number;
      availableAt: Date;
    },
  ): Promise<DurableWorkflowJob> {
    const database = await this.database();
    const [inserted] = await database
      .insert(processingJobs)
      .values({
        organisationId: input.organisationId,
        projectId: input.projectId,
        documentVersionId: input.documentVersionId ?? null,
        jobType: input.jobType,
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        priority: input.priority,
        maxAttempts: input.maxAttempts,
        availableAt: input.availableAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const [existing] = await database
      .select()
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.organisationId, input.organisationId),
          eq(processingJobs.projectId, input.projectId),
          eq(processingJobs.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (!existing) {
      throw new DurableWorkflowStoreError("persistence_conflict");
    }
    return existing;
  }

  async findJob(
    scope: DurableWorkflowScope,
    jobId: string,
  ): Promise<DurableWorkflowJob | null> {
    const database = await this.database();
    const [job] = await database
      .select()
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.id, jobId),
          eq(processingJobs.organisationId, scope.organisationId),
          eq(processingJobs.projectId, scope.projectId),
        ),
      );
    return job ?? null;
  }

  async claim(
    input: ClaimPersistenceInput,
  ): Promise<DurableWorkflowClaimResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(processingJobs)
        .set({
          status: "running",
          attempts: input.nextAttempts,
          leaseOwner: input.workerId,
          leaseExpiresAt: input.leaseExpiresAt,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(processingJobs.id, input.jobId),
            eq(processingJobs.organisationId, input.organisationId),
            eq(processingJobs.projectId, input.projectId),
            eq(processingJobs.status, input.expectedStatus),
            eq(processingJobs.version, input.expectedVersion),
            lte(processingJobs.availableAt, input.now),
          ),
        )
        .returning();
      if (!job) return null;
      const [run] = await transaction
        .insert(processingRuns)
        .values({
          organisationId: input.organisationId,
          jobId: input.jobId,
          runType: job.jobType,
          provider: input.provider,
          modelConfigurationId: input.modelConfigurationId ?? null,
          promptConfigurationId: input.promptConfigurationId ?? null,
          inputHash: input.inputHash,
          status: "running",
          startedAt: input.now,
        })
        .returning();
      if (!run) throw new DurableWorkflowStoreError("persistence_conflict");
      return { job, run };
    });
  }

  async heartbeat(
    input: HeartbeatPersistenceInput,
  ): Promise<DurableWorkflowJob | null> {
    const database = await this.database();
    const [job] = await database
      .update(processingJobs)
      .set({
        progressPercent: input.progressPercent,
        leaseExpiresAt: input.leaseExpiresAt,
        version: input.nextVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(processingJobs.id, input.jobId),
          eq(processingJobs.organisationId, input.organisationId),
          eq(processingJobs.projectId, input.projectId),
          eq(processingJobs.status, input.expectedStatus),
          eq(processingJobs.version, input.expectedVersion),
          eq(processingJobs.leaseOwner, input.workerId),
          gt(processingJobs.leaseExpiresAt, input.now),
        ),
      )
      .returning();
    return job ?? null;
  }

  async succeed(
    input: SuccessPersistenceInput,
  ): Promise<DurableWorkflowSuccessResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(processingJobs)
        .set({
          status: "succeeded",
          progressPercent: 100,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorSummary: null,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(processingJobs.id, input.jobId),
            eq(processingJobs.organisationId, input.organisationId),
            eq(processingJobs.projectId, input.projectId),
            eq(processingJobs.status, input.expectedStatus),
            eq(processingJobs.version, input.expectedVersion),
            eq(processingJobs.leaseOwner, input.workerId),
            gt(processingJobs.leaseExpiresAt, input.now),
          ),
        )
        .returning();
      if (!job) return null;
      const [run] = await transaction
        .update(processingRuns)
        .set({
          status: "succeeded",
          outputHash: input.outputHash,
          latencyMs: input.latencyMs ?? null,
          costMinor: input.costMinor ?? null,
          costCurrency: input.costCurrency ?? null,
          promptTokens: input.promptTokens ?? null,
          completionTokens: input.completionTokens ?? null,
          completedAt: input.now,
        })
        .where(
          and(
            eq(processingRuns.id, input.runId),
            eq(processingRuns.organisationId, input.organisationId),
            eq(processingRuns.jobId, input.jobId),
            eq(processingRuns.status, "running"),
          ),
        )
        .returning();
      if (!run) throw new DurableWorkflowStoreError("persistence_conflict");
      const [review] = await transaction
        .insert(reviews)
        .values({
          organisationId: input.organisationId,
          projectId: input.projectId,
          reviewType: "ai_output_review",
          objectType: "processing_run",
          objectId: run.id,
          reviewerUserId: input.reviewerUserId,
          status: "pending",
          findings: null,
          sourceVersion: job.version,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!review) throw new DurableWorkflowStoreError("persistence_conflict");
      return {
        job,
        run,
        review,
        authoritativeUseApproved: false as const,
      };
    });
  }

  async fail(
    input: FailurePersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(processingJobs)
        .set({
          status: input.nextStatus,
          availableAt: input.availableAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: input.errorCode,
          lastErrorSummary: null,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(processingJobs.id, input.jobId),
            eq(processingJobs.organisationId, input.organisationId),
            eq(processingJobs.projectId, input.projectId),
            eq(processingJobs.status, input.expectedStatus),
            eq(processingJobs.version, input.expectedVersion),
            eq(processingJobs.leaseOwner, input.workerId),
            gt(processingJobs.leaseExpiresAt, input.now),
          ),
        )
        .returning();
      if (!job) return null;
      const [run] = await transaction
        .update(processingRuns)
        .set({
          status: "failed",
          errorCode: input.errorCode,
          latencyMs: input.latencyMs ?? null,
          completedAt: input.now,
        })
        .where(
          and(
            eq(processingRuns.id, input.runId),
            eq(processingRuns.organisationId, input.organisationId),
            eq(processingRuns.jobId, input.jobId),
            eq(processingRuns.status, "running"),
          ),
        )
        .returning();
      if (!run) throw new DurableWorkflowStoreError("persistence_conflict");
      return { job, run };
    });
  }

  async retry(
    input: RetryPersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(processingJobs)
        .set({
          status: "retry_wait",
          maxAttempts: input.newMaxAttempts,
          availableAt: input.now,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(processingJobs.id, input.jobId),
            eq(processingJobs.organisationId, input.organisationId),
            eq(processingJobs.projectId, input.projectId),
            eq(processingJobs.status, input.expectedStatus),
            eq(processingJobs.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!job) return null;
      const [review] = await transaction
        .insert(reviews)
        .values({
          organisationId: input.organisationId,
          projectId: input.projectId,
          reviewType: "ai_retry_authorization",
          objectType: "processing_job",
          objectId: input.jobId,
          reviewerUserId: input.operatorUserId,
          status: "completed",
          findings: JSON.stringify({
            schemaVersion: "valo.ai.retry-authorization.v1",
            reasonCode: input.reasonCode,
          }),
          sourceVersion: input.expectedVersion,
          completedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!review) throw new DurableWorkflowStoreError("persistence_conflict");
      return { job, review };
    });
  }

  async cancel(
    input: CancelPersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(processingJobs)
        .set({
          status: "cancelled",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: "AI_CANCELLED",
          lastErrorSummary: null,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(processingJobs.id, input.jobId),
            eq(processingJobs.organisationId, input.organisationId),
            eq(processingJobs.projectId, input.projectId),
            eq(processingJobs.status, input.expectedStatus),
            eq(processingJobs.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!job) return null;
      const [run] = await transaction
        .update(processingRuns)
        .set({
          status: "cancelled",
          errorCode: "AI_CANCELLED",
          completedAt: input.now,
        })
        .where(
          and(
            eq(processingRuns.organisationId, input.organisationId),
            eq(processingRuns.jobId, input.jobId),
            eq(processingRuns.status, "running"),
          ),
        )
        .returning();
      const [review] = await transaction
        .insert(reviews)
        .values({
          organisationId: input.organisationId,
          projectId: input.projectId,
          reviewType: "ai_cancellation",
          objectType: "processing_job",
          objectId: input.jobId,
          reviewerUserId: input.cancelledByUserId,
          status: "completed",
          findings: JSON.stringify({
            schemaVersion: "valo.ai.cancellation.v1",
            reasonCode: input.reasonCode,
          }),
          sourceVersion: input.expectedVersion,
          completedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!review) throw new DurableWorkflowStoreError("persistence_conflict");
      return { job, ...(run ? { run } : {}), review };
    });
  }

  async recoverExpiredLease(
    input: RecoverLeasePersistenceInput,
  ): Promise<DurableWorkflowTransitionResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [job] = await transaction
        .update(processingJobs)
        .set({
          status: input.nextStatus,
          availableAt: input.availableAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: "AI_PROVIDER_UNAVAILABLE",
          lastErrorSummary: null,
          version: input.nextVersion,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(processingJobs.id, input.jobId),
            eq(processingJobs.organisationId, input.organisationId),
            eq(processingJobs.projectId, input.projectId),
            eq(processingJobs.status, input.expectedStatus),
            eq(processingJobs.version, input.expectedVersion),
            lte(processingJobs.leaseExpiresAt, input.now),
          ),
        )
        .returning();
      if (!job) return null;
      const [run] = await transaction
        .update(processingRuns)
        .set({
          status: "failed",
          errorCode: "AI_PROVIDER_UNAVAILABLE",
          completedAt: input.now,
        })
        .where(
          and(
            eq(processingRuns.organisationId, input.organisationId),
            eq(processingRuns.jobId, input.jobId),
            eq(processingRuns.status, "running"),
          ),
        )
        .returning();
      if (!run) throw new DurableWorkflowStoreError("persistence_conflict");
      return { job, run };
    });
  }
}

export function createDurableWorkflowStore(input?: {
  repository?: DurableWorkflowRepository;
  now?: () => Date;
}): DurableWorkflowStore {
  return new DurableWorkflowStore(
    input?.repository ?? new DrizzleDurableWorkflowRepository(),
    input?.now,
  );
}
