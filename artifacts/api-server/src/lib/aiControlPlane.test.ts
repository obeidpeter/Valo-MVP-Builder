import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION,
  AI_CONTROL_PLANE_FOUNDATION_STATUS,
  assessAiHumanReviewRisk,
  createPrivacySafeAiTraceEvent,
  createQueuedAiRun,
  routeQualityConstrainedModel,
  transitionAiDurableRun,
  type AiDurableRun,
  type AiModelCandidate,
  type AiRunActor,
  type AiRunCommand,
  type AiRunCreationInput,
  type AiWorkflowDefinition,
} from "./aiControlPlane";

const definition: AiWorkflowDefinition = {
  definitionId: "requirements-draft",
  version: "workflow-v1",
  allowedStages: ["retrieve", "generate", "ground"],
  maxSteps: 5,
  maxAttempts: 3,
  maxElapsedMs: 60 * 60 * 1_000,
  maxLeaseMs: 5 * 60 * 1_000,
  maxCostMinor: 5_000,
  maxOutputTokens: 2_000,
};
const artifactSha256 = "d".repeat(64);

const worker = (id = "worker-1"): AiRunActor => ({
  actorId: id,
  kind: "worker",
  tenantId: "tenant-a",
  projectId: "project-a",
  permissions: [],
});

const reviewer = (id: string): AiRunActor => ({
  actorId: id,
  kind: "human",
  tenantId: "tenant-a",
  projectId: "project-a",
  permissions: ["requirement:review"],
});

function creationInput(requiredApprovals: 1 | 2 = 2): AiRunCreationInput {
  return {
    runId: "run-1",
    idempotencyKeySha256: "a".repeat(64),
    tenantId: "tenant-a",
    projectId: "project-a",
    requesterId: "requester-1",
    capability: "extract_requirements",
    capabilityPolicyVersion: AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION,
    definition,
    createdAt: "2026-08-10T12:00:00Z",
    riskContext: {
      classification: requiredApprovals === 2 ? "confidential" : "public",
      grounding: requiredApprovals === 2 ? "partial" : "grounded",
      calibratedConfidence: 0.99,
      injectionSignalPresent: false,
      crossTenantSignalPresent: false,
      monetaryImpactMinor: 0,
      novelModelOrRetrievalVersion: false,
    },
  };
}

function createdRun(requiredApprovals: 1 | 2 = 2): AiDurableRun {
  const decision = createQueuedAiRun(creationInput(requiredApprovals));
  if (!decision.allowed) assert.fail(decision.code);
  assert.equal(decision.allowed, true);
  return decision.run;
}

function transition(run: AiDurableRun, command: AiRunCommand) {
  return transitionAiDurableRun({ run, definition, command });
}

test("the control-plane foundation is disconnected and cannot activate AI", () => {
  assert.deepEqual(AI_CONTROL_PLANE_FOUNDATION_STATUS, {
    runtimeConnected: false,
    durableStoreConnected: false,
    productionApproved: false,
    activation: "blocked",
  });
});

test("risk policy prohibits consequential/injection work and requires named review for drafts", () => {
  const prohibited = assessAiHumanReviewRisk({
    actionClass: "consequential_action",
    modelGenerated: true,
    classification: "restricted",
    grounding: "contradicted",
    calibratedConfidence: 0.99,
    injectionSignalPresent: true,
    crossTenantSignalPresent: false,
    monetaryImpactMinor: 1,
    novelModelOrRetrievalVersion: false,
  });
  assert.equal(prohibited.executionAllowed, false);
  assert.equal(prohibited.reviewMode, "prohibited");
  assert.equal(prohibited.band, "critical");

  const draft = assessAiHumanReviewRisk({
    actionClass: "reversible_draft",
    modelGenerated: true,
    classification: "confidential",
    grounding: "partial",
    calibratedConfidence: 0.55,
    injectionSignalPresent: false,
    crossTenantSignalPresent: false,
    monetaryImpactMinor: 0,
    novelModelOrRetrievalVersion: true,
  });
  assert.equal(draft.executionAllowed, true);
  assert.equal(draft.reviewRequired, true);
  assert.equal(draft.reviewMode, "two_humans");

  const deterministicRead = assessAiHumanReviewRisk({
    actionClass: "read_only",
    modelGenerated: false,
    classification: "public",
    grounding: "grounded",
    calibratedConfidence: 0.99,
    injectionSignalPresent: false,
    crossTenantSignalPresent: false,
    monetaryImpactMinor: 0,
    novelModelOrRetrievalVersion: false,
  });
  assert.equal(deterministicRead.reviewMode, "none");

  const invalidMoney = assessAiHumanReviewRisk({
    actionClass: "reversible_draft",
    modelGenerated: true,
    classification: "confidential",
    grounding: "grounded",
    calibratedConfidence: 0.99,
    injectionSignalPresent: false,
    crossTenantSignalPresent: false,
    monetaryImpactMinor: -1,
    novelModelOrRetrievalVersion: false,
  });
  assert.equal(invalidMoney.executionAllowed, false);
  assert.equal(invalidMoney.reviewMode, "prohibited");
  assert.equal(invalidMoney.reasons.includes("monetary_impact_invalid"), true);
});

test("run creation derives review controls from capability policy and risk", () => {
  const untrustedCallerInput = {
    ...creationInput(2),
    review: {
      required: false,
      requiredPermission: "caller:bypass",
      requiredApprovals: 1,
    },
  };
  const derived = createQueuedAiRun(untrustedCallerInput);
  if (!derived.allowed) assert.fail(derived.code);
  assert.equal(derived.allowed, true);
  assert.equal(derived.run.review.required, true);
  assert.equal(derived.run.review.requiredPermission, "requirement:review");
  assert.equal(derived.run.review.requiredApprovals, 2);
  assert.equal(
    derived.run.review.policyVersion,
    AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION,
  );

  const wrongPolicy = createQueuedAiRun({
    ...creationInput(1),
    capabilityPolicyVersion: "caller-policy-v0",
  } as unknown as AiRunCreationInput);
  assert.equal(wrongPolicy.allowed, false);
  assert.equal(wrongPolicy.code, "capability_policy_invalid");

  const prohibited = createQueuedAiRun({
    ...creationInput(1),
    riskContext: {
      ...creationInput(1).riskContext,
      injectionSignalPresent: true,
    },
  });
  assert.equal(prohibited.allowed, false);
  assert.equal(prohibited.code, "risk_prohibited");

  const invalidMoney = createQueuedAiRun({
    ...creationInput(1),
    riskContext: {
      ...creationInput(1).riskContext,
      monetaryImpactMinor: -1,
    },
  });
  assert.equal(invalidMoney.allowed, false);
  assert.equal(invalidMoney.code, "risk_prohibited");
});

test("a workflow definition cannot drift behind an unchanged id and version", () => {
  const run = createdRun();
  const result = transitionAiDurableRun({
    run,
    definition: { ...definition, maxSteps: definition.maxSteps + 1 },
    command: {
      kind: "claim",
      expectedVersion: run.version,
      now: "2026-08-10T12:01:00Z",
      actor: worker(),
      leaseExpiresAt: "2026-08-10T12:02:00Z",
    },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "definition_invalid");
});

function model(overrides: Partial<AiModelCandidate> = {}): AiModelCandidate {
  return {
    candidateId: "economy",
    provider: "provider-a",
    model: "model-a",
    modelConfigurationVersion: "config-economy-v1",
    approved: true,
    healthy: true,
    healthCheckedAt: "2026-08-10T12:00:00Z",
    capabilities: ["extract_requirements"],
    supportedClassifications: ["confidential"],
    maxInputBytes: 100_000,
    evaluatedQuality: 0.92,
    p95LatencyMs: 1_000,
    predictedCostMinor: 100,
    governance: {
      noTrainingVerified: true,
      dpaApproved: true,
      processingRegions: ["ng-approved"],
      retentionDays: 0,
      evidenceVersion: "governance-v1",
    },
    ...overrides,
  };
}

const routingRequest = {
  capability: "extract_requirements" as const,
  classification: "confidential" as const,
  inputBytes: 2_000,
  requiredRegion: "ng-approved",
  maxRetentionDays: 0,
  minEvaluatedQuality: 0.9,
  maxP95LatencyMs: 5_000,
  maxCostMinor: 1_000,
  riskBand: "low" as const,
  approvedModelConfigurationVersions: [
    "config-economy-v1",
    "config-premium-v1",
  ],
  evaluatedAt: "2026-08-10T12:01:00Z",
  maxHealthAgeMs: 5 * 60 * 1_000,
};

test("model routing preserves the quality/privacy floor while optimising cost by risk", () => {
  const economy = model();
  const premium = model({
    candidateId: "premium",
    model: "model-b",
    modelConfigurationVersion: "config-premium-v1",
    evaluatedQuality: 0.98,
    p95LatencyMs: 1_500,
    predictedCostMinor: 400,
  });
  const wrongRegion = model({
    candidateId: "wrong-region",
    modelConfigurationVersion: "config-premium-v1",
    governance: {
      ...model().governance,
      processingRegions: ["unapproved-region"],
    },
  });

  const lowRisk = routeQualityConstrainedModel({
    request: routingRequest,
    candidates: [premium, wrongRegion, economy],
  });
  assert.equal(lowRisk.allowed, true);
  assert.equal(lowRisk.primary?.candidateId, "economy");
  assert.equal(lowRisk.rejected[0]?.codes.includes("region_unavailable"), true);

  const highRisk = routeQualityConstrainedModel({
    request: { ...routingRequest, riskBand: "high" },
    candidates: [economy, premium],
  });
  assert.equal(highRisk.primary?.candidateId, "premium");
  assert.deepEqual(
    highRisk.fallbacks.map((item) => item.candidateId),
    ["economy"],
  );

  const duplicateIds = routeQualityConstrainedModel({
    request: routingRequest,
    candidates: [economy, { ...premium, candidateId: economy.candidateId }],
  });
  assert.equal(duplicateIds.allowed, false);
  assert.equal(duplicateIds.code, "request_invalid");
});

test("bounded durable state requires leases, independent review, and CAS versions", () => {
  let run = createdRun(2);
  const claimed = transition(run, {
    kind: "claim",
    expectedVersion: 0,
    now: "2026-08-10T12:01:00Z",
    actor: worker(),
    leaseExpiresAt: "2026-08-10T12:05:00Z",
  });
  assert.equal(claimed.allowed, true);
  run = claimed.next;

  assert.equal(
    transition(run, {
      kind: "record_step",
      expectedVersion: 0,
      now: "2026-08-10T12:02:00Z",
      actor: worker(),
      stage: "retrieve",
      progressPercent: 30,
      additionalOutputTokens: 100,
      additionalCostMinor: 50,
      artifactSha256,
    }).code,
    "stale_version",
  );

  const stepped = transition(run, {
    kind: "record_step",
    expectedVersion: run.version,
    now: "2026-08-10T12:02:00Z",
    actor: worker(),
    stage: "retrieve",
    progressPercent: 30,
    additionalOutputTokens: 100,
    additionalCostMinor: 50,
    artifactSha256,
  });
  assert.equal(stepped.allowed, true);
  run = stepped.next;

  assert.equal(
    transition(run, {
      kind: "complete",
      expectedVersion: run.version,
      now: "2026-08-10T12:02:30Z",
      actor: worker(),
      artifactSha256,
    }).code,
    "review_required",
  );

  run = transition(run, {
    kind: "request_review",
    expectedVersion: run.version,
    now: "2026-08-10T12:03:00Z",
    actor: worker(),
    artifactSha256,
  }).next;
  assert.equal(run.status, "waiting_for_review");

  const selfApproval = transition(run, {
    kind: "review",
    expectedVersion: run.version,
    now: "2026-08-10T12:03:30Z",
    actor: reviewer("requester-1"),
    decision: "approve",
    approvalReference: "review-1",
    artifactSha256,
  });
  assert.equal(selfApproval.code, "reviewer_not_independent");

  run = transition(run, {
    kind: "review",
    expectedVersion: run.version,
    now: "2026-08-10T12:04:00Z",
    actor: reviewer("reviewer-1"),
    decision: "approve",
    approvalReference: "review-1",
    artifactSha256,
  }).next;
  assert.equal(run.status, "waiting_for_review");
  run = transition(run, {
    kind: "review",
    expectedVersion: run.version,
    now: "2026-08-10T12:05:00Z",
    actor: reviewer("reviewer-2"),
    decision: "approve",
    approvalReference: "review-2",
    artifactSha256,
  }).next;
  assert.equal(run.review.state, "approved");
  assert.equal(run.status, "queued");

  run = transition(run, {
    kind: "claim",
    expectedVersion: run.version,
    now: "2026-08-10T12:06:00Z",
    actor: worker("worker-2"),
    leaseExpiresAt: "2026-08-10T12:10:00Z",
  }).next;
  const completed = transition(run, {
    kind: "complete",
    expectedVersion: run.version,
    now: "2026-08-10T12:07:00Z",
    actor: worker("worker-2"),
    artifactSha256,
  });
  assert.equal(completed.allowed, true);
  assert.equal(completed.next.status, "succeeded");
  assert.equal(completed.next.progressPercent, 100);
});

test("execution limits and expired leases fail closed", () => {
  let run = createdRun(1);
  run = transition(run, {
    kind: "claim",
    expectedVersion: 0,
    now: "2026-08-10T12:01:00Z",
    actor: worker(),
    leaseExpiresAt: "2026-08-10T12:02:00Z",
  }).next;

  assert.equal(
    transition(run, {
      kind: "record_step",
      expectedVersion: run.version,
      now: "2026-08-10T12:01:30Z",
      actor: worker(),
      stage: "generate",
      progressPercent: 50,
      additionalOutputTokens: definition.maxOutputTokens + 1,
      additionalCostMinor: 1,
      artifactSha256,
    }).code,
    "token_limit_exceeded",
  );

  const expired = transition(run, {
    kind: "expire_lease",
    expectedVersion: run.version,
    now: "2026-08-10T12:03:00Z",
    actor: {
      actorId: "scheduler-1",
      kind: "system",
      tenantId: "tenant-a",
      projectId: "project-a",
      permissions: [],
    },
    retryAt: "2026-08-10T12:04:00Z",
  });
  assert.equal(expired.allowed, true);
  assert.equal(expired.next.status, "retry_wait");
  assert.equal(expired.event, "retry_scheduled");
});

test("trace events are metadata-only and reject malformed hashes or metrics", () => {
  const traceWithRawContent = {
    eventId: "event-1",
    traceId: "trace-1",
    runId: "run-1",
    tenantId: "tenant-a",
    projectId: "project-a",
    occurredAt: "2026-08-10T12:00:00Z",
    stage: "grounding",
    outcome: "succeeded",
    attempt: 1,
    step: 2,
    latencyMs: 240,
    promptTokens: 100,
    completionTokens: 20,
    costMinor: 3,
    modelConfigurationVersion: "model-config-v1",
    promptVersion: "prompt-v1",
    retrievalManifestSha256: "b".repeat(64),
    providerRequestIdSha256: "c".repeat(64),
    safeErrorCode: null,
    rawPrompt: "must never be copied",
    rawOutput: "must never be copied",
  } as const;
  const accepted = createPrivacySafeAiTraceEvent(traceWithRawContent);
  assert.equal(accepted.accepted, true);
  if (accepted.accepted) {
    assert.equal(accepted.event.payloadPolicy, "metadata_only_no_raw_content");
    assert.equal("prompt" in accepted.event, false);
    assert.equal("output" in accepted.event, false);
    assert.equal("rawPrompt" in accepted.event, false);
    assert.equal("rawOutput" in accepted.event, false);
  }

  assert.deepEqual(
    createPrivacySafeAiTraceEvent({
      eventId: "event-1",
      traceId: "trace-1",
      runId: "run-1",
      tenantId: "tenant-a",
      projectId: "project-a",
      occurredAt: "2026-08-10T12:00:00Z",
      stage: "provider",
      outcome: "failed",
      attempt: 1,
      step: 1,
      latencyMs: -1,
      promptTokens: 0,
      completionTokens: 0,
      costMinor: 0,
      modelConfigurationVersion: null,
      promptVersion: null,
      retrievalManifestSha256: "not-a-hash",
      providerRequestIdSha256: null,
      safeErrorCode: "AI_PROVIDER_FAILED",
    }),
    { accepted: false, code: "metric_invalid" },
  );
});

test("review approval is artifact-bound and cannot authorise later mutation", () => {
  let run = createdRun(1);
  run = transition(run, {
    kind: "claim",
    expectedVersion: run.version,
    now: "2026-08-10T12:01:00Z",
    actor: worker(),
    leaseExpiresAt: "2026-08-10T12:05:00Z",
  }).next;
  run = transition(run, {
    kind: "record_step",
    expectedVersion: run.version,
    now: "2026-08-10T12:02:00Z",
    actor: worker(),
    stage: "generate",
    progressPercent: 80,
    additionalOutputTokens: 50,
    additionalCostMinor: 10,
    artifactSha256,
  }).next;
  run = transition(run, {
    kind: "request_review",
    expectedVersion: run.version,
    now: "2026-08-10T12:03:00Z",
    actor: worker(),
    artifactSha256,
  }).next;
  run = transition(run, {
    kind: "review",
    expectedVersion: run.version,
    now: "2026-08-10T12:04:00Z",
    actor: reviewer("reviewer-1"),
    decision: "approve",
    approvalReference: "review-final",
    artifactSha256,
  }).next;
  run = transition(run, {
    kind: "claim",
    expectedVersion: run.version,
    now: "2026-08-10T12:05:00Z",
    actor: worker("worker-2"),
    leaseExpiresAt: "2026-08-10T12:09:00Z",
  }).next;

  assert.equal(
    transition(run, {
      kind: "record_step",
      expectedVersion: run.version,
      now: "2026-08-10T12:06:00Z",
      actor: worker("worker-2"),
      stage: "ground",
      progressPercent: 90,
      additionalOutputTokens: 1,
      additionalCostMinor: 1,
      artifactSha256: "e".repeat(64),
    }).code,
    "invalid_transition",
  );
  assert.equal(
    transition(run, {
      kind: "complete",
      expectedVersion: run.version,
      now: "2026-08-10T12:06:00Z",
      actor: worker("worker-2"),
      artifactSha256: "e".repeat(64),
    }).code,
    "artifact_mismatch",
  );
});

test("tampered durable state and backdated commands fail closed", () => {
  const seeded = createdRun(1);
  assert.equal(
    transition(
      { ...seeded, costMinor: Number.NaN },
      {
        kind: "claim",
        expectedVersion: seeded.version,
        now: "2026-08-10T12:01:00Z",
        actor: worker(),
        leaseExpiresAt: "2026-08-10T12:05:00Z",
      },
    ).code,
    "run_invalid",
  );
  const claimed = transition(seeded, {
    kind: "claim",
    expectedVersion: seeded.version,
    now: "2026-08-10T12:02:00Z",
    actor: worker(),
    leaseExpiresAt: "2026-08-10T12:05:00Z",
  }).next;
  assert.equal(
    transition(claimed, {
      kind: "heartbeat",
      expectedVersion: claimed.version,
      now: "2026-08-10T12:01:00Z",
      actor: worker(),
      progressPercent: 0,
      leaseExpiresAt: "2026-08-10T12:04:00Z",
    }).code,
    "run_invalid",
  );
});
