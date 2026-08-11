import assert from "node:assert/strict";
import test from "node:test";
import {
  AiShadowProgrammeError,
  type AiShadowMutationResult,
  type AiShadowObservation,
  type AiShadowObservationDraft,
  type AiShadowPlan,
  type AiShadowPlanDraft,
  type AiShadowRepository,
  type AiShadowScope,
} from "./contracts";
import {
  AiShadowProgrammeService,
  parseAiShadowCloseDraft,
  parseAiShadowObservationDraft,
  parseAiShadowPlanDraft,
} from "./service";

const org = "11111111-1111-4111-8111-111111111111";
const maker = "22222222-2222-4222-8222-222222222222";
const checker = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);
const now = new Date("2026-08-11T10:00:00.000Z");

const scope = (
  actorUserId = maker,
  actorName = "Maker User",
): AiShadowScope => ({
  organisationId: org,
  actorUserId,
  actorName,
});

const planDraft = (): AiShadowPlanDraft => ({
  capabilityId: "extract_requirements",
  title: "Requirement extraction no-output shadow",
  purpose: "Measure safety and accuracy without exposing generated output.",
  versions: {
    applicationReleaseSha256: hash,
    modelSnapshotSha256: hash,
    modelConfigurationSha256: hash,
    promptSha256: hash,
    schemaSha256: hash,
    retrievalPolicySha256: hash,
    corpusManifestSha256: hash,
    governanceDecisionSha256: hash,
    expectedCaseManifestSha256: hash,
  },
  cohorts: [
    "representative",
    "fatal_requirement",
    "abstention",
    "ocr_table",
    "injection",
    "tenant_isolation",
    "cost_latency",
  ],
  expectedCaseCount: 25,
  expiresAt: "2026-09-11T10:00:00.000Z",
  idempotencyKey: "shadow-plan-idempotency-v1",
});

const observationDraft = (
  caseId: string,
  cohort: AiShadowObservationDraft["cohort"] = "representative",
): AiShadowObservationDraft => ({
  caseId,
  cohort,
  disposition: "completed",
  expectedDisposition: "completed",
  passed: true,
  outputSha256: hash,
  fatalMissCount: 0,
  unsupportedMaterialClaimCount: 0,
  tenantLeakDetected: false,
  injectionContained: true,
  citationCorrectCount: 1,
  citationEvaluatedCount: 1,
  latencyMs: 100,
  costMinor: 1,
  reviewerNoteCode: "fixture_verified",
  observedAt: "2026-08-11T10:00:00.000Z",
  idempotencyKey: `shadow-observation-${caseId}-v1`,
});

class MemoryRepository implements AiShadowRepository {
  plans: AiShadowPlan[] = [];
  observations = new Map<string, AiShadowObservation[]>();

  async listPlans() {
    return [...this.plans];
  }
  async listObservations(_scope: AiShadowScope, planId: string) {
    return [...(this.observations.get(planId) ?? [])];
  }
  async createPlan(
    _scope: AiShadowScope,
    _draft: AiShadowPlanDraft,
    _digest: string,
    plan: AiShadowPlan,
  ): Promise<AiShadowMutationResult<AiShadowPlan>> {
    this.plans.push(plan);
    return { outcome: "created", value: plan };
  }
  async appendObservation(
    _scope: AiShadowScope,
    _plan: AiShadowPlan,
    _draft: AiShadowObservationDraft,
    _digest: string,
    observation: AiShadowObservation,
  ): Promise<AiShadowMutationResult<AiShadowObservation>> {
    const current = this.observations.get(observation.planId) ?? [];
    current.push(observation);
    this.observations.set(observation.planId, current);
    return { outcome: "recorded", value: observation };
  }
  async closePlan(
    _scope: AiShadowScope,
    plan: AiShadowPlan,
    _close: Parameters<AiShadowRepository["closePlan"]>[2],
    closed: AiShadowPlan,
  ): Promise<AiShadowMutationResult<AiShadowPlan>> {
    this.plans = this.plans.map((item) =>
      item.id === plan.id ? closed : item,
    );
    return { outcome: "closed", value: closed };
  }
}

test("parsers require exact version bindings, cohorts, and hash-only output", () => {
  assert.ok(parseAiShadowPlanDraft(planDraft()));
  assert.ok(parseAiShadowObservationDraft(observationDraft("case-1")));
  assert.ok(
    parseAiShadowCloseDraft({
      expectedVersion: 1,
      expectedObservationCount: 25,
      reason: "Independent review complete.",
    }),
  );
  assert.equal(
    parseAiShadowPlanDraft({ ...planDraft(), cohorts: ["representative"] }),
    null,
  );
  assert.equal(
    parseAiShadowObservationDraft({
      ...observationDraft("case-1"),
      outputSha256: "raw model output",
    }),
    null,
  );
});

test("shadow plans never grant production activation", async () => {
  const repository = new MemoryRepository();
  const service = new AiShadowProgrammeService(repository, () => now);
  const created = await service.createPlan(scope(), planDraft());
  assert.notEqual(created.outcome, "idempotency_conflict");
  if (created.outcome === "idempotency_conflict") return;
  assert.equal(created.value.productionActivationGranted, false);
  assert.equal(created.value.customerVisible, false);
  assert.equal(created.value.executionMode, "no_output_shadow");
});

test("plan creator cannot self-close and incomplete work closes blocked", async () => {
  const repository = new MemoryRepository();
  const service = new AiShadowProgrammeService(repository, () => now);
  const created = await service.createPlan(scope(), planDraft());
  if (created.outcome === "idempotency_conflict") return;
  await assert.rejects(
    () =>
      service.closePlan(scope(), created.value.id, {
        expectedVersion: 1,
        expectedObservationCount: 0,
        reason: "Self closure is not allowed.",
      }),
    (error) =>
      error instanceof AiShadowProgrammeError && error.code === "policy_denied",
  );
  const closed = await service.closePlan(
    scope(checker, "Checker User"),
    created.value.id,
    {
      expectedVersion: 1,
      expectedObservationCount: 0,
      reason: "Independent reviewer recorded the incomplete result.",
    },
  );
  assert.notEqual(closed.outcome, "idempotency_conflict");
  if (closed.outcome !== "idempotency_conflict") {
    assert.equal(closed.value.evaluationRecommendation, "blocked");
    assert.equal(closed.value.productionActivationGranted, false);
  }
});

test("complete safe cohort coverage is only eligible for later governance review", async () => {
  const repository = new MemoryRepository();
  const service = new AiShadowProgrammeService(repository, () => now);
  const created = await service.createPlan(scope(), planDraft());
  if (created.outcome === "idempotency_conflict") return;
  const cohorts = planDraft().cohorts;
  for (let index = 0; index < 25; index += 1) {
    await service.recordObservation(
      scope(),
      created.value.id,
      observationDraft(`case-${index + 1}`, cohorts[index % cohorts.length]!),
    );
  }
  const closed = await service.closePlan(
    scope(checker, "Checker User"),
    created.value.id,
    {
      expectedVersion: 1,
      expectedObservationCount: 25,
      reason:
        "Independent reviewer verified the complete hash-only cohort run.",
    },
  );
  assert.notEqual(closed.outcome, "idempotency_conflict");
  if (closed.outcome !== "idempotency_conflict") {
    assert.equal(
      closed.value.evaluationRecommendation,
      "eligible_for_governance_review",
    );
    assert.equal(closed.value.productionActivationGranted, false);
  }
});

test("closure detects a changed observation count", async () => {
  const repository = new MemoryRepository();
  const service = new AiShadowProgrammeService(repository, () => now);
  const created = await service.createPlan(scope(), planDraft());
  if (created.outcome === "idempotency_conflict") return;
  await service.recordObservation(
    scope(),
    created.value.id,
    observationDraft("case-1"),
  );
  await assert.rejects(
    () =>
      service.closePlan(scope(checker, "Checker User"), created.value.id, {
        expectedVersion: 1,
        expectedObservationCount: 0,
        reason: "Stale reviewer view.",
      }),
    (error) =>
      error instanceof AiShadowProgrammeError && error.code === "conflict",
  );
});
