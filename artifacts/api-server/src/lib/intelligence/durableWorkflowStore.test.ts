import "../../test-env";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { AiSafeErrorCode } from "../aiPolicy";
import {
  createDurableWorkflowStore,
  DurableWorkflowStoreError,
  type DurableWorkflowJob,
  type DurableWorkflowRepository,
  type DurableWorkflowReview,
  type DurableWorkflowRun,
} from "./durableWorkflowStore";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const REVIEWER = "77777777-7777-4777-8777-777777777777";
const DIGEST = createHash("sha256").update("request-1").digest("hex");
const INPUT_HASH = createHash("sha256").update("approved-input").digest("hex");
const OUTPUT_HASH = createHash("sha256").update("draft-output").digest("hex");

type RepoInput<K extends keyof DurableWorkflowRepository> = Parameters<
  DurableWorkflowRepository[K]
>[0];

class MemoryWorkflowRepository implements DurableWorkflowRepository {
  readonly jobs = new Map<string, DurableWorkflowJob>();
  readonly runs = new Map<string, DurableWorkflowRun>();
  readonly reviews = new Map<string, DurableWorkflowReview>();
  forceCasConflict = false;

  async enqueue(input: RepoInput<"enqueue">): Promise<DurableWorkflowJob> {
    const existing = [...this.jobs.values()].find(
      (job) =>
        job.organisationId === input.organisationId &&
        job.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;
    const job: DurableWorkflowJob = {
      id: randomUUID(),
      organisationId: input.organisationId,
      projectId: input.projectId,
      documentVersionId: input.documentVersionId ?? null,
      jobType: input.jobType,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      priority: input.priority,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      availableAt: input.availableAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorSummary: null,
      progressPercent: 0,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async findJob(
    scope: RepoInput<"findJob">,
    jobId: string,
  ): Promise<DurableWorkflowJob | null> {
    const job = this.jobs.get(jobId);
    return job?.organisationId === scope.organisationId &&
      job.projectId === scope.projectId
      ? job
      : null;
  }

  private jobForCas(input: {
    jobId: string;
    organisationId: string;
    projectId: string;
    expectedVersion: number;
    expectedStatus: string;
  }): DurableWorkflowJob | null {
    if (this.forceCasConflict) {
      this.forceCasConflict = false;
      return null;
    }
    const job = this.jobs.get(input.jobId);
    return job?.organisationId === input.organisationId &&
      job.projectId === input.projectId &&
      job.version === input.expectedVersion &&
      job.status === input.expectedStatus
      ? job
      : null;
  }

  async claim(
    input: RepoInput<"claim">,
  ): Promise<Awaited<ReturnType<DurableWorkflowRepository["claim"]>>> {
    const current = this.jobForCas(input);
    if (!current || current.availableAt > input.now) return null;
    const job: DurableWorkflowJob = {
      ...current,
      status: "running",
      attempts: input.nextAttempts,
      leaseOwner: input.workerId,
      leaseExpiresAt: input.leaseExpiresAt,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    const run: DurableWorkflowRun = {
      id: randomUUID(),
      organisationId: input.organisationId,
      jobId: input.jobId,
      runType: current.jobType,
      provider: input.provider,
      modelConfigurationId: input.modelConfigurationId ?? null,
      promptConfigurationId: input.promptConfigurationId ?? null,
      inputHash: input.inputHash,
      outputHash: null,
      status: "running",
      latencyMs: null,
      costMinor: null,
      costCurrency: null,
      promptTokens: null,
      completionTokens: null,
      confidenceCalibrationVersion: null,
      errorCode: null,
      startedAt: input.now,
      completedAt: null,
    };
    this.jobs.set(job.id, job);
    this.runs.set(run.id, run);
    return { job, run };
  }

  async heartbeat(
    input: RepoInput<"heartbeat">,
  ): Promise<DurableWorkflowJob | null> {
    const current = this.jobForCas(input);
    if (
      !current ||
      current.leaseOwner !== input.workerId ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt <= input.now
    ) {
      return null;
    }
    const job = {
      ...current,
      progressPercent: input.progressPercent,
      leaseExpiresAt: input.leaseExpiresAt,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async succeed(
    input: RepoInput<"succeed">,
  ): Promise<Awaited<ReturnType<DurableWorkflowRepository["succeed"]>>> {
    const current = this.jobForCas(input);
    const currentRun = this.runs.get(input.runId);
    if (
      !current ||
      current.leaseOwner !== input.workerId ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt <= input.now ||
      currentRun?.jobId !== input.jobId ||
      currentRun.status !== "running"
    ) {
      return null;
    }
    const job: DurableWorkflowJob = {
      ...current,
      status: "succeeded",
      progressPercent: 100,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorSummary: null,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    const run: DurableWorkflowRun = {
      ...currentRun,
      status: "succeeded",
      outputHash: input.outputHash,
      latencyMs: input.latencyMs ?? null,
      costMinor: input.costMinor ?? null,
      costCurrency: input.costCurrency ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      completedAt: input.now,
    };
    const review = this.makeReview({
      organisationId: input.organisationId,
      projectId: input.projectId,
      reviewerUserId: input.reviewerUserId,
      objectId: run.id,
      reviewType: "ai_output_review",
      objectType: "processing_run",
      status: "pending",
      findings: null,
      sourceVersion: job.version,
      now: input.now,
    });
    this.jobs.set(job.id, job);
    this.runs.set(run.id, run);
    return { job, run, review, authoritativeUseApproved: false };
  }

  async fail(
    input: RepoInput<"fail">,
  ): Promise<Awaited<ReturnType<DurableWorkflowRepository["fail"]>>> {
    const current = this.jobForCas(input);
    const currentRun = this.runs.get(input.runId);
    if (
      !current ||
      current.leaseOwner !== input.workerId ||
      currentRun?.status !== "running"
    ) {
      return null;
    }
    const job: DurableWorkflowJob = {
      ...current,
      status: input.nextStatus,
      availableAt: input.availableAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: input.errorCode,
      lastErrorSummary: null,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    const run: DurableWorkflowRun = {
      ...currentRun,
      status: "failed",
      errorCode: input.errorCode,
      latencyMs: input.latencyMs ?? null,
      completedAt: input.now,
    };
    this.jobs.set(job.id, job);
    this.runs.set(run.id, run);
    return { job, run };
  }

  async retry(
    input: RepoInput<"retry">,
  ): Promise<Awaited<ReturnType<DurableWorkflowRepository["retry"]>>> {
    const current = this.jobForCas(input);
    if (!current) return null;
    const job: DurableWorkflowJob = {
      ...current,
      status: "retry_wait",
      maxAttempts: input.newMaxAttempts,
      availableAt: input.now,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    const review = this.makeReview({
      organisationId: input.organisationId,
      projectId: input.projectId,
      reviewerUserId: input.operatorUserId,
      objectId: input.jobId,
      reviewType: "ai_retry_authorization",
      objectType: "processing_job",
      status: "completed",
      findings: JSON.stringify({ reasonCode: input.reasonCode }),
      sourceVersion: input.expectedVersion,
      now: input.now,
    });
    this.jobs.set(job.id, job);
    return { job, review };
  }

  async cancel(
    input: RepoInput<"cancel">,
  ): Promise<Awaited<ReturnType<DurableWorkflowRepository["cancel"]>>> {
    const current = this.jobForCas(input);
    if (!current) return null;
    const job: DurableWorkflowJob = {
      ...current,
      status: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: "AI_CANCELLED",
      lastErrorSummary: null,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    const running = [...this.runs.values()].find(
      (run) => run.jobId === job.id && run.status === "running",
    );
    let run: DurableWorkflowRun | undefined;
    if (running) {
      run = {
        ...running,
        status: "cancelled",
        errorCode: "AI_CANCELLED",
        completedAt: input.now,
      };
      this.runs.set(run.id, run);
    }
    const review = this.makeReview({
      organisationId: input.organisationId,
      projectId: input.projectId,
      reviewerUserId: input.cancelledByUserId,
      objectId: input.jobId,
      reviewType: "ai_cancellation",
      objectType: "processing_job",
      status: "completed",
      findings: JSON.stringify({ reasonCode: input.reasonCode }),
      sourceVersion: input.expectedVersion,
      now: input.now,
    });
    this.jobs.set(job.id, job);
    return { job, ...(run ? { run } : {}), review };
  }

  async recoverExpiredLease(
    input: RepoInput<"recoverExpiredLease">,
  ): Promise<
    Awaited<ReturnType<DurableWorkflowRepository["recoverExpiredLease"]>>
  > {
    const current = this.jobForCas(input);
    const currentRun = [...this.runs.values()].find(
      (run) => run.jobId === input.jobId && run.status === "running",
    );
    if (
      !current ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt > input.now ||
      !currentRun
    ) {
      return null;
    }
    const job: DurableWorkflowJob = {
      ...current,
      status: input.nextStatus,
      availableAt: input.availableAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: "AI_PROVIDER_UNAVAILABLE",
      lastErrorSummary: null,
      version: input.nextVersion,
      updatedAt: input.now,
    };
    const run: DurableWorkflowRun = {
      ...currentRun,
      status: "failed",
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      completedAt: input.now,
    };
    this.jobs.set(job.id, job);
    this.runs.set(run.id, run);
    return { job, run };
  }

  private makeReview(input: {
    organisationId: string;
    projectId: string;
    reviewerUserId: string;
    objectId: string;
    reviewType: string;
    objectType: string;
    status: string;
    findings: string | null;
    sourceVersion: number;
    now: Date;
  }): DurableWorkflowReview {
    const review: DurableWorkflowReview = {
      id: randomUUID(),
      organisationId: input.organisationId,
      projectId: input.projectId,
      reviewType: input.reviewType,
      objectType: input.objectType,
      objectId: input.objectId,
      reviewerUserId: input.reviewerUserId,
      status: input.status,
      findings: input.findings,
      sourceVersion: input.sourceVersion,
      completedAt: input.status === "completed" ? input.now : null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.reviews.set(review.id, review);
    return review;
  }
}

function setup(options?: { maxAttempts?: number }) {
  const repository = new MemoryWorkflowRepository();
  let clock = new Date("2026-08-10T10:00:00.000Z");
  const store = createDurableWorkflowStore({
    repository,
    now: () => clock,
  });
  const enqueue = () =>
    store.enqueue({
      organisationId: ORG,
      projectId: PROJECT,
      jobType: "map_evidence",
      idempotencyDigest: DIGEST,
      maxAttempts: options?.maxAttempts,
    });
  return {
    repository,
    store,
    enqueue,
    setClock(value: string) {
      clock = new Date(value);
    },
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof DurableWorkflowStoreError ? error.code : undefined;
}

test("enqueue is idempotent, project scoped, and capability bounded", async () => {
  const { store, enqueue } = setup();
  const first = await enqueue();
  const duplicate = await enqueue();
  assert.equal(duplicate.id, first.id);
  const otherProject = await store.enqueue({
    organisationId: ORG,
    projectId: OTHER_PROJECT,
    jobType: "map_evidence",
    idempotencyDigest: DIGEST,
  });
  assert.notEqual(otherProject.id, first.id);
  await assert.rejects(
    store.enqueue({
      organisationId: ORG,
      projectId: PROJECT,
      jobType: "submit_bid" as "map_evidence",
      idempotencyDigest: DIGEST,
    }),
    (error) => errorCode(error) === "invalid_control_input",
  );
  await assert.rejects(
    store.enqueue({
      organisationId: ORG,
      projectId: PROJECT,
      jobType: "map_evidence",
      idempotencyDigest: "customer@example.com",
    }),
    (error) => errorCode(error) === "invalid_control_input",
  );
});

test("claim atomically persists the pre-disclosure attempt and enforces CAS", async () => {
  const { store, repository, enqueue } = setup();
  const queued = await enqueue();
  const claimed = await store.claim({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: queued.version,
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    provider: "approved-provider",
    inputHash: INPUT_HASH,
  });
  assert.equal(claimed.job.status, "running");
  assert.equal(claimed.job.attempts, 1);
  assert.equal(repository.runs.get(claimed.run.id)?.status, "running");
  assert.equal(claimed.run.outputHash, null);
  await assert.rejects(
    store.claim({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      expectedVersion: queued.version,
      workerId: "worker-2",
      leaseDurationMs: 30_000,
      provider: "approved-provider",
      inputHash: INPUT_HASH,
    }),
    (error) => errorCode(error) === "stale_version",
  );
});

test("heartbeat rejects a lease thief and cannot regress progress", async () => {
  const { store, enqueue } = setup();
  const queued = await enqueue();
  const claimed = await store.claim({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: 1,
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    provider: "approved-provider",
    inputHash: INPUT_HASH,
  });
  await assert.rejects(
    store.heartbeat({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      expectedVersion: claimed.job.version,
      workerId: "worker-2",
      leaseDurationMs: 30_000,
      progressPercent: 10,
    }),
    (error) => errorCode(error) === "lease_mismatch",
  );
  const heartbeat = await store.heartbeat({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: claimed.job.version,
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    progressPercent: 40,
  });
  await assert.rejects(
    store.heartbeat({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      expectedVersion: heartbeat.version,
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      progressPercent: 39,
    }),
    (error) => errorCode(error) === "invalid_transition",
  );
});

test("success settles the attempt and creates a pending non-authoritative review", async () => {
  const { store, enqueue } = setup();
  const queued = await enqueue();
  const claimed = await store.claim({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: 1,
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    provider: "approved-provider",
    inputHash: INPUT_HASH,
  });
  await assert.rejects(
    store.succeed({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      runId: claimed.run.id,
      expectedVersion: claimed.job.version,
      workerId: "worker-1",
      outputHash: OUTPUT_HASH,
      reviewerUserId: REVIEWER,
      costMinor: 500 as unknown as bigint,
      costCurrency: "NGN",
    }),
    (error) => errorCode(error) === "invalid_control_input",
  );
  const completed = await store.succeed({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    runId: claimed.run.id,
    expectedVersion: claimed.job.version,
    workerId: "worker-1",
    outputHash: OUTPUT_HASH,
    reviewerUserId: REVIEWER,
    latencyMs: 250,
    costMinor: 500n,
    costCurrency: "NGN",
  });
  assert.equal(completed.job.status, "succeeded");
  assert.equal(completed.run.outputHash, OUTPUT_HASH);
  assert.equal(completed.review.status, "pending");
  assert.equal(completed.review.objectType, "processing_run");
  assert.equal(completed.authoritativeUseApproved, false);
});

test("safe failures retry, dead-letter at the cap, and retain no content summary", async () => {
  const { store, enqueue } = setup({ maxAttempts: 1 });
  const queued = await enqueue();
  const claimed = await store.claim({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: 1,
    workerId: "worker-1",
    leaseDurationMs: 30_000,
    provider: "approved-provider",
    inputHash: INPUT_HASH,
  });
  await assert.rejects(
    store.fail({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      runId: claimed.run.id,
      expectedVersion: claimed.job.version,
      workerId: "worker-1",
      retryable: true,
      errorCode: "raw stack containing client data" as AiSafeErrorCode,
    }),
    (error) => errorCode(error) === "invalid_control_input",
  );
  const failed = await store.fail({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    runId: claimed.run.id,
    expectedVersion: claimed.job.version,
    workerId: "worker-1",
    retryable: true,
    errorCode: "AI_PROVIDER_FAILED",
  });
  assert.equal(failed.job.status, "dead_letter");
  assert.equal(failed.job.lastErrorCode, "AI_PROVIDER_FAILED");
  assert.equal(failed.job.lastErrorSummary, null);
  const retried = await store.retry({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: failed.job.version,
    operatorUserId: REVIEWER,
    reasonCode: "configuration_corrected",
    newMaxAttempts: 2,
  });
  assert.equal(retried.job.status, "retry_wait");
  assert.equal(retried.review?.status, "completed");
});

test("expired leases are recovered to retry wait and the attempt is closed", async () => {
  const { store, enqueue, setClock } = setup({ maxAttempts: 2 });
  const queued = await enqueue();
  const claimed = await store.claim({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: 1,
    workerId: "worker-1",
    leaseDurationMs: 5_000,
    provider: "approved-provider",
    inputHash: INPUT_HASH,
  });
  await assert.rejects(
    store.recoverExpiredLease({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      expectedVersion: claimed.job.version,
    }),
    (error) => errorCode(error) === "lease_not_expired",
  );
  setClock("2026-08-10T10:00:06.000Z");
  const recovered = await store.recoverExpiredLease({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: claimed.job.version,
  });
  assert.equal(recovered.job.status, "retry_wait");
  assert.equal(recovered.run?.status, "failed");
  assert.equal(recovered.run?.errorCode, "AI_PROVIDER_UNAVAILABLE");
});

test("cancellation is terminal, content-free, and attributed to a named user", async () => {
  const { store, enqueue } = setup();
  const queued = await enqueue();
  const cancelled = await store.cancel({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: queued.id,
    expectedVersion: queued.version,
    cancelledByUserId: REVIEWER,
    reasonCode: "scope_withdrawn",
  });
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.lastErrorCode, "AI_CANCELLED");
  assert.equal(cancelled.job.lastErrorSummary, null);
  assert.equal(cancelled.review?.reviewerUserId, REVIEWER);
  assert.equal(cancelled.review?.status, "completed");
  await assert.rejects(
    store.claim({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      expectedVersion: cancelled.job.version,
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      provider: "approved-provider",
      inputHash: INPUT_HASH,
    }),
    (error) => errorCode(error) === "invalid_transition",
  );
});

test("a repository CAS race fails closed", async () => {
  const { store, repository, enqueue } = setup();
  const queued = await enqueue();
  repository.forceCasConflict = true;
  await assert.rejects(
    store.claim({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: queued.id,
      expectedVersion: queued.version,
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      provider: "approved-provider",
      inputHash: INPUT_HASH,
    }),
    (error) => errorCode(error) === "persistence_conflict",
  );
  assert.equal(repository.runs.size, 0);
});
