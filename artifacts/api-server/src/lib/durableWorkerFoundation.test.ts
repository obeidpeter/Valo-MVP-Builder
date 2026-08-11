import "../test-env";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDurableWorkerService,
  DURABLE_WORKER_FOUNDATION_STATUS,
  DurableWorkerError,
  type DurableWorkerRepository,
  type WorkerCapabilityPolicy,
  type WorkerJob,
  type WorkerRun,
} from "./durableWorkerFoundation";

test("worker controls stay unmounted until workload identity is connected", () => {
  assert.equal(DURABLE_WORKER_FOUNDATION_STATUS.persistenceImplemented, true);
  assert.equal(
    DURABLE_WORKER_FOUNDATION_STATUS.userAuthenticatedControlRouteMounted,
    false,
  );
  assert.equal(
    DURABLE_WORKER_FOUNDATION_STATUS.workloadIdentityConnected,
    false,
  );
  assert.equal(
    DURABLE_WORKER_FOUNDATION_STATUS.externalProviderInvocationAllowed,
    false,
  );
});

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const DIGEST = createHash("sha256").update("idempotency").digest("hex");
const INPUT_HASH = createHash("sha256").update("input").digest("hex");
const OUTPUT_HASH = createHash("sha256").update("output").digest("hex");
const NOW = new Date("2026-08-11T12:00:00.000Z");

const INTERNAL_POLICY: WorkerCapabilityPolicy = {
  id: "documents.thumbnail@v1",
  effectClass: "internal_deterministic",
  requiresProject: true,
  requiresDocumentVersion: false,
  maxQueuedPerTenant: 20,
  maxRunningPerTenant: 2,
  maxAttempts: 3,
  leaseMs: 30_000,
  deadlineMs: 300_000,
  retryBaseMs: 5_000,
  retryMaxMs: 60_000,
  retryableErrorCodes: ["DEPENDENCY_BUSY"],
};

const EXTERNAL_POLICY: WorkerCapabilityPolicy = {
  ...INTERNAL_POLICY,
  id: "notifications.email@v1",
  effectClass: "external_provider",
};

function job(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: JOB,
    organisationId: ORG,
    projectId: PROJECT,
    documentVersionId: null,
    jobType: INTERNAL_POLICY.id,
    idempotencyKey: DIGEST,
    status: "queued",
    priority: 100,
    attempts: 0,
    maxAttempts: INTERNAL_POLICY.maxAttempts,
    availableAt: NOW,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorSummary: null,
    progressPercent: 0,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function run(overrides: Partial<WorkerRun> = {}): WorkerRun {
  return {
    id: RUN,
    organisationId: ORG,
    jobId: JOB,
    runType: INTERNAL_POLICY.id,
    provider: "internal-worker",
    modelConfigurationId: null,
    promptConfigurationId: null,
    inputHash: INPUT_HASH,
    outputHash: null,
    status: "running",
    latencyMs: null,
    costMinor: null,
    costCurrency: null,
    promptTokens: null,
    completionTokens: null,
    confidenceCalibrationVersion: null,
    errorCode: null,
    startedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

class StubRepository implements DurableWorkerRepository {
  current: WorkerJob | null = null;
  enqueueInput: Parameters<DurableWorkerRepository["enqueue"]>[0] | null = null;
  claimCalls = 0;
  successInput: Parameters<DurableWorkerRepository["succeed"]>[0] | null = null;

  async enqueue(input: Parameters<DurableWorkerRepository["enqueue"]>[0]) {
    this.enqueueInput = input;
    return job({
      id: randomUUID(),
      jobType: input.capability,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.policy.maxAttempts,
    });
  }

  async findJob(
    scope: { organisationId: string; projectId?: string | null },
    jobId: string,
  ) {
    return this.current?.id === jobId &&
      this.current.organisationId === scope.organisationId &&
      this.current.projectId === (scope.projectId ?? null)
      ? this.current
      : null;
  }

  async claimNext() {
    this.claimCalls += 1;
    return null;
  }

  async heartbeat(input: Parameters<DurableWorkerRepository["heartbeat"]>[0]) {
    return job({ ...this.current, version: input.fenceToken + 1 });
  }

  async succeed(input: Parameters<DurableWorkerRepository["succeed"]>[0]) {
    this.successInput = input;
    return {
      job: job({ status: "succeeded", version: input.fenceToken + 1 }),
      run: run({ status: "succeeded", outputHash: input.outputHash }),
    };
  }

  async fail(input: Parameters<DurableWorkerRepository["fail"]>[0]) {
    return {
      job: job({ status: input.nextStatus }),
      run: run({ status: "failed" }),
    };
  }

  async cancel() {
    return { job: job({ status: "cancelled" }) };
  }

  async recover(input: Parameters<DurableWorkerRepository["recover"]>[0]) {
    return { job: job({ status: input.nextStatus }) };
  }
}

async function rejectsCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DurableWorkerError);
    assert.equal(error.code, code);
    return true;
  });
}

test("enqueue derives a tenant/scope idempotency key and fixes policy limits", async () => {
  const repository = new StubRepository();
  const service = createDurableWorkerService({
    repository,
    policies: [INTERNAL_POLICY],
    now: () => NOW,
  });

  const result = await service.enqueue({
    organisationId: ORG,
    projectId: PROJECT,
    capability: INTERNAL_POLICY.id,
    idempotencyDigest: DIGEST,
  });

  assert.equal(result.maxAttempts, INTERNAL_POLICY.maxAttempts);
  assert.match(repository.enqueueInput?.idempotencyKey ?? "", /^[a-f0-9]{64}$/);
  assert.notEqual(repository.enqueueInput?.idempotencyKey, DIGEST);
  assert.equal(repository.enqueueInput?.policy.maxRunningPerTenant, 2);
});

test("external capability claims fail closed before repository access", async () => {
  const repository = new StubRepository();
  const service = createDurableWorkerService({
    repository,
    policies: [EXTERNAL_POLICY],
    now: () => NOW,
  });

  await rejectsCode(
    service.claimNext({
      organisationId: ORG,
      projectId: PROJECT,
      capability: EXTERNAL_POLICY.id,
      workerId: "worker-1",
      inputHash: INPUT_HASH,
    }),
    "provider_disconnected",
  );
  assert.equal(repository.claimCalls, 0);
});

test("heartbeat rejects an expired immutable capability deadline", async () => {
  const repository = new StubRepository();
  repository.current = job({
    status: "running",
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    createdAt: new Date(NOW.getTime() - INTERNAL_POLICY.deadlineMs),
    version: 2,
  });
  const service = createDurableWorkerService({
    repository,
    policies: [INTERNAL_POLICY],
    now: () => NOW,
  });

  await rejectsCode(
    service.heartbeat({
      organisationId: ORG,
      projectId: PROJECT,
      jobId: JOB,
      runId: RUN,
      workerId: "worker-1",
      fenceToken: 2,
      progressPercent: 20,
    }),
    "deadline_exceeded",
  );
});

test("success binds an outbox intent to the authenticated job scope", async () => {
  const repository = new StubRepository();
  repository.current = job({
    status: "running",
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    version: 2,
  });
  const service = createDurableWorkerService({
    repository,
    policies: [INTERNAL_POLICY],
    now: () => NOW,
  });

  await service.succeed({
    organisationId: ORG,
    projectId: PROJECT,
    jobId: JOB,
    runId: RUN,
    workerId: "worker-1",
    fenceToken: 2,
    outputHash: OUTPUT_HASH,
    outbox: {
      eventName: "thumbnail.ready",
      aggregateType: "processing_job",
      idempotencyDigest: DIGEST,
      payloadHash: OUTPUT_HASH,
      deadlineAt: new Date(NOW.getTime() + 60_000),
    },
  });

  assert.equal(repository.successInput?.outboxIntent?.organisationId, ORG);
  assert.equal(repository.successInput?.outboxIntent?.projectId, PROJECT);
  assert.equal(repository.successInput?.outboxIntent?.aggregateId, JOB);
});
