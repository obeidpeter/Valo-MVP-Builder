import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
  RETENTION_COMPLETION_ACTIVATION_ENV,
  type RetentionCompletionActivationManifest,
} from "./activation";
import {
  RetentionCompletionError,
  type RetentionCompletionMutationCommand,
  type RetentionCompletionPermissions,
  type RetentionCompletionRepository,
  type RetentionCompletionScope,
  type RetentionCompletionSnapshot,
} from "./contracts";
import { RetentionCompletionService } from "./service";

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const scope: RetentionCompletionScope = {
  organisationId: id("1"),
  actorUserId: id("2"),
  actorMembershipId: id("3"),
};

function snapshot(): RetentionCompletionSnapshot {
  return {
    request: {
      id: id("4"),
      projectId: id("5"),
      subjectProjectId: id("5"),
      requestedByUserId: id("2"),
      requestedByName: "Retention Owner",
      reason: "window elapsed",
      dueAt: "2026-08-01T00:00:00.000Z",
      completedAt: null,
      status: "pending",
      completionProtocolVersion: 1,
      version: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    action: null,
    blockers: [],
    objectReconciliation: {
      expected: 0,
      detached: 0,
      reconciled: 0,
      pending: 0,
      deadLetters: 0,
    },
    objectBindings: [],
    retainedCategories: [],
    certificate: null,
    permissions: { canStart: true, canReconcile: true, canCertify: true },
    generatedAt: "2026-08-22T12:00:00.000Z",
  };
}

class StubRepository implements RetentionCompletionRepository {
  calls: Array<{
    operation: string;
    id?: string;
    command?: RetentionCompletionMutationCommand;
  }> = [];

  async databaseNow() {
    return new Date("2026-08-22T12:00:00.000Z");
  }
  async list() {
    return [snapshot().request];
  }
  async read() {
    return snapshot();
  }
  async detach(
    _scope: RetentionCompletionScope,
    idValue: string,
    command: RetentionCompletionMutationCommand,
    _permissions: RetentionCompletionPermissions,
  ) {
    this.calls.push({ operation: "detach", id: idValue, command });
    return snapshot();
  }
  async reconcile(
    _scope: RetentionCompletionScope,
    idValue: string,
    command: RetentionCompletionMutationCommand,
    _permissions: RetentionCompletionPermissions,
  ) {
    this.calls.push({ operation: "reconcile", id: idValue, command });
    return snapshot();
  }
  async certify(
    _scope: RetentionCompletionScope,
    idValue: string,
    command: RetentionCompletionMutationCommand,
    _permissions: RetentionCompletionPermissions,
  ) {
    this.calls.push({ operation: "certify", id: idValue, command });
    return snapshot();
  }
}

function verifiedManifest(): RetentionCompletionActivationManifest {
  return {
    ...DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
    status: "approved",
    productionActivationGranted: true,
    preconditions:
      DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST.preconditions.map(
        (precondition) => ({
          ...precondition,
          status: "verified" as const,
          evidence: `evidence:${precondition.id}`,
        }),
      ),
  };
}

test("default service exposes readiness but fails every mutation closed", async () => {
  const repository = new StubRepository();
  const service = new RetentionCompletionService({
    repository,
    environment: { [RETENTION_COMPLETION_ACTIVATION_ENV]: "true" },
  });
  const readiness = await service.readiness(scope);
  assert.equal(readiness.activated, false);
  assert.equal(readiness.permissions.canReconcile, true);
  await assert.rejects(
    service.detach(scope, id("4"), {
      expectedVersion: 1,
      idempotencyKey: "testtesttesttest",
      attestation: "I confirm this governed detach action.",
    }),
    (error: unknown) =>
      error instanceof RetentionCompletionError &&
      error.code === "not_activated",
  );
  assert.deepEqual(repository.calls, []);
});

test("activated service hashes controls and delegates all three CAS transitions", async () => {
  const repository = new StubRepository();
  const service = new RetentionCompletionService({
    repository,
    activationManifest: verifiedManifest(),
    environment: { [RETENTION_COMPLETION_ACTIVATION_ENV]: "true" },
  });
  const input = {
    expectedVersion: 2,
    idempotencyKey: "testtesttesttest",
    attestation: "I confirm the exact governed evidence manifest.",
  };
  await service.detach(scope, id("4"), input);
  await service.reconcile(scope, id("6"), input);
  await service.certify(scope, id("6"), input);
  assert.deepEqual(
    repository.calls.map((call) => call.operation),
    ["detach", "reconcile", "certify"],
  );
  for (const call of repository.calls) {
    assert.match(call.command!.idempotencyKeySha256, /^[a-f0-9]{64}$/u);
    assert.match(call.command!.attestationSha256, /^[a-f0-9]{64}$/u);
    assert.equal(call.command!.expectedVersion, 2);
  }
  const operationDigests = repository.calls.map(
    (call) => call.command!.idempotencyKeySha256,
  );
  assert.equal(
    new Set(operationDigests).size,
    3,
    "phase and resource are part of the idempotency domain",
  );

  await service.detach({ ...scope, actorUserId: id("7") }, id("4"), input);
  assert.notEqual(
    repository.calls[3]!.command!.idempotencyKeySha256,
    operationDigests[0],
    "the current actor is part of the idempotency domain",
  );
});

test("service rejects malformed identifiers, CAS, keys and attestations before persistence", async () => {
  const repository = new StubRepository();
  const service = new RetentionCompletionService({
    repository,
    activationManifest: verifiedManifest(),
    environment: { [RETENTION_COMPLETION_ACTIVATION_ENV]: "true" },
  });
  await assert.rejects(
    service.detach(scope, "bad", {
      expectedVersion: 0,
      idempotencyKey: "short",
      attestation: "short",
    }),
    RetentionCompletionError,
  );
  assert.deepEqual(repository.calls, []);
});
