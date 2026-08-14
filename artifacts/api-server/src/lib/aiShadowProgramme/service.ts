import { createHash, randomUUID } from "node:crypto";
import { AI_CAPABILITY_IDS, type AiCapabilityId } from "../aiPolicy";
import {
  REQUIRED_CONTINUOUS_EVAL_COHORTS,
  type AiEvalCohort,
} from "../aiContinuousEval";
import {
  AI_SHADOW_OBSERVATION_SCHEMA,
  AI_SHADOW_PLAN_SCHEMA,
  AI_SHADOW_PROGRAMME_BOUNDS,
  AI_SHADOW_PROGRAMME_STATUS,
  AI_SHADOW_REVIEWER_NOTE_CODES,
  AiShadowProgrammeError,
  type AiShadowCloseDraft,
  type AiShadowObservation,
  type AiShadowObservationDraft,
  type AiShadowPlan,
  type AiShadowPlanDraft,
  type AiShadowProgrammeSnapshot,
  type AiShadowRepository,
  type AiShadowScope,
  type AiShadowVersionManifest,
} from "./contracts";

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "../identifierPatterns";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const CAPABILITIES = new Set<string>(AI_CAPABILITY_IDS);
const COHORTS = new Set<string>(REQUIRED_CONTINUOUS_EVAL_COHORTS);
const DISPOSITIONS = new Set(["completed", "abstained", "safe_failure"]);
const REVIEWER_NOTE_CODES = new Set<string>(AI_SHADOW_REVIEWER_NOTE_CODES);
const PLAN_VALIDATION_DEDUPLICATION_MARKER = "persisted-plan-validation-v1";
const OBSERVATION_VALIDATION_DEDUPLICATION_MARKER = "persisted-observation-v1";
const VERSION_KEYS: Array<keyof AiShadowVersionManifest> = [
  "applicationReleaseSha256",
  "modelSnapshotSha256",
  "modelConfigurationSha256",
  "promptSha256",
  "schemaSha256",
  "retrievalPolicySha256",
  "corpusManifestSha256",
  "governanceDecisionSha256",
  "expectedCaseManifestSha256",
];

import { isPlainRecord as plain } from "../typeGuards";

const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(value);

const validDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));

const validInteger = (value: unknown, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max;

function parseVersions(value: unknown): AiShadowVersionManifest | null {
  if (
    !plain(value) ||
    !exactKeys(value, VERSION_KEYS) ||
    !VERSION_KEYS.every((key) => SHA256.test(String(value[key])))
  ) {
    return null;
  }
  return Object.fromEntries(
    VERSION_KEYS.map((key) => [key, String(value[key])]),
  ) as unknown as AiShadowVersionManifest;
}

function parseCohorts(value: unknown): AiEvalCohort[] | null {
  if (
    !Array.isArray(value) ||
    value.length !== REQUIRED_CONTINUOUS_EVAL_COHORTS.length
  )
    return null;
  if (!value.every((item) => typeof item === "string" && COHORTS.has(item)))
    return null;
  const unique = new Set(value);
  if (unique.size !== REQUIRED_CONTINUOUS_EVAL_COHORTS.length) return null;
  return REQUIRED_CONTINUOUS_EVAL_COHORTS.filter((cohort) =>
    unique.has(cohort),
  );
}

export function parseAiShadowPlanDraft(
  value: unknown,
): AiShadowPlanDraft | null {
  if (
    !plain(value) ||
    !exactKeys(value, [
      "capabilityId",
      "cohorts",
      "expectedCaseCount",
      "expiresAt",
      "idempotencyKey",
      "purpose",
      "title",
      "versions",
    ]) ||
    typeof value.capabilityId !== "string" ||
    !CAPABILITIES.has(value.capabilityId) ||
    !boundedText(value.title, 256) ||
    !boundedText(
      value.purpose,
      AI_SHADOW_PROGRAMME_BOUNDS.maxSummaryCodeUnits,
    ) ||
    !validInteger(
      value.expectedCaseCount,
      AI_SHADOW_PROGRAMME_BOUNDS.maxObservationsPerPlan,
    ) ||
    value.expectedCaseCount <
      AI_SHADOW_PROGRAMME_BOUNDS.minProductionProfileCases ||
    !validDate(value.expiresAt) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY.test(value.idempotencyKey)
  ) {
    return null;
  }
  const versions = parseVersions(value.versions);
  const cohorts = parseCohorts(value.cohorts);
  return versions && cohorts
    ? {
        capabilityId: value.capabilityId as AiCapabilityId,
        title: value.title,
        purpose: value.purpose,
        versions,
        cohorts,
        expectedCaseCount: value.expectedCaseCount,
        expiresAt: value.expiresAt,
        idempotencyKey: value.idempotencyKey,
      }
    : null;
}

export function parseAiShadowObservationDraft(
  value: unknown,
): AiShadowObservationDraft | null {
  if (
    !plain(value) ||
    !exactKeys(value, [
      "caseId",
      "citationCorrectCount",
      "citationEvaluatedCount",
      "cohort",
      "costMinor",
      "disposition",
      "expectedDisposition",
      "fatalMissCount",
      "idempotencyKey",
      "injectionContained",
      "latencyMs",
      "observedAt",
      "outputSha256",
      "passed",
      "reviewerNoteCode",
      "tenantLeakDetected",
      "unsupportedMaterialClaimCount",
    ]) ||
    typeof value.caseId !== "string" ||
    !IDENTIFIER.test(value.caseId) ||
    typeof value.cohort !== "string" ||
    !COHORTS.has(value.cohort) ||
    typeof value.disposition !== "string" ||
    !DISPOSITIONS.has(value.disposition) ||
    typeof value.expectedDisposition !== "string" ||
    !DISPOSITIONS.has(value.expectedDisposition) ||
    typeof value.passed !== "boolean" ||
    !(
      value.outputSha256 === null ||
      (typeof value.outputSha256 === "string" &&
        SHA256.test(value.outputSha256))
    ) ||
    !validInteger(value.fatalMissCount, 10_000) ||
    !validInteger(value.unsupportedMaterialClaimCount, 10_000) ||
    typeof value.tenantLeakDetected !== "boolean" ||
    typeof value.injectionContained !== "boolean" ||
    !validInteger(value.citationCorrectCount, 100_000) ||
    !validInteger(value.citationEvaluatedCount, 100_000) ||
    value.citationCorrectCount > value.citationEvaluatedCount ||
    !validInteger(value.latencyMs, 3_600_000) ||
    !validInteger(value.costMinor, 1_000_000_000) ||
    typeof value.reviewerNoteCode !== "string" ||
    !REVIEWER_NOTE_CODES.has(value.reviewerNoteCode) ||
    !validDate(value.observedAt) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY.test(value.idempotencyKey)
  ) {
    return null;
  }
  return value as unknown as AiShadowObservationDraft;
}

export function parseAiShadowCloseDraft(
  value: unknown,
): AiShadowCloseDraft | null {
  return plain(value) &&
    exactKeys(value, [
      "expectedObservationCount",
      "expectedVersion",
      "reason",
    ]) &&
    validInteger(value.expectedVersion, Number.MAX_SAFE_INTEGER) &&
    value.expectedVersion >= 1 &&
    validInteger(
      value.expectedObservationCount,
      AI_SHADOW_PROGRAMME_BOUNDS.maxObservationsPerPlan,
    ) &&
    boundedText(value.reason, AI_SHADOW_PROGRAMME_BOUNDS.maxSummaryCodeUnits)
    ? {
        expectedVersion: value.expectedVersion,
        expectedObservationCount: value.expectedObservationCount,
        reason: value.reason,
      }
    : null;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function blockersFor(
  plan: AiShadowPlan,
  observations: readonly AiShadowObservation[],
  now: Date,
): string[] {
  const blockers: string[] = [];
  if (Date.parse(plan.expiresAt) <= now.getTime())
    blockers.push("plan_expired");
  if (observations.length < plan.expectedCaseCount)
    blockers.push("case_manifest_incomplete");
  const cases = new Set(observations.map(({ caseId }) => caseId));
  if (cases.size !== observations.length)
    blockers.push("duplicate_case_result");
  const covered = new Set(observations.map(({ cohort }) => cohort));
  for (const cohort of plan.cohorts) {
    if (!covered.has(cohort)) blockers.push(`cohort_missing:${cohort}`);
  }
  if (observations.some(({ passed }) => !passed)) blockers.push("case_failure");
  if (observations.some(({ fatalMissCount }) => fatalMissCount > 0))
    blockers.push("fatal_miss_detected");
  if (
    observations.some(
      ({ unsupportedMaterialClaimCount }) => unsupportedMaterialClaimCount > 0,
    )
  )
    blockers.push("unsupported_claim_detected");
  if (observations.some(({ tenantLeakDetected }) => tenantLeakDetected))
    blockers.push("tenant_leak_detected");
  if (
    observations.some(
      ({ cohort, injectionContained }) =>
        cohort === "injection" && !injectionContained,
    )
  )
    blockers.push("injection_not_contained");
  if (
    observations.some(
      ({ disposition, expectedDisposition }) =>
        disposition !== expectedDisposition,
    )
  )
    blockers.push("expected_disposition_mismatch");
  if (
    observations.some(
      ({ citationCorrectCount, citationEvaluatedCount }) =>
        citationEvaluatedCount > 0 &&
        citationCorrectCount !== citationEvaluatedCount,
    )
  )
    blockers.push("citation_error_detected");
  return [...new Set(blockers)].sort();
}

export class AiShadowProgrammeService {
  constructor(
    private readonly repository: AiShadowRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(scope: AiShadowScope): Promise<AiShadowProgrammeSnapshot> {
    const plans = await this.repository.listPlans(scope);
    if (plans.length > AI_SHADOW_PROGRAMME_BOUNDS.maxPlansPerOrganisation)
      throw new AiShadowProgrammeError(
        "repository_unavailable",
        "Shadow plan set is invalid.",
      );
    const generatedAt = this.now();
    const projected = await Promise.all(
      plans.map(async (plan) => {
        const observations = await this.repository.listObservations(
          scope,
          plan.id,
        );
        return {
          plan,
          observationCount: observations.length,
          coveredCohorts: plan.cohorts.filter((cohort) =>
            observations.some((item) => item.cohort === cohort),
          ),
          blockers: blockersFor(plan, observations, generatedAt),
        };
      }),
    );
    return {
      generatedAt: generatedAt.toISOString(),
      plans: projected,
      authority: AI_SHADOW_PROGRAMME_STATUS,
    };
  }

  async createPlan(scope: AiShadowScope, draft: AiShadowPlanDraft) {
    const now = this.now();
    if (
      Date.parse(draft.expiresAt) <= now.getTime() ||
      Date.parse(draft.expiresAt) > now.getTime() + 90 * 24 * 60 * 60_000
    )
      throw new AiShadowProgrammeError(
        "invalid_request",
        "Plan expiry must be within the next 90 days.",
      );
    const plan: AiShadowPlan = {
      schema: AI_SHADOW_PLAN_SCHEMA,
      id: randomUUID(),
      organisationId: scope.organisationId,
      capabilityId: draft.capabilityId,
      title: draft.title,
      purpose: draft.purpose,
      versions: draft.versions,
      cohorts: draft.cohorts,
      expectedCaseCount: draft.expectedCaseCount,
      expiresAt: draft.expiresAt,
      status: "active",
      version: 1,
      executionMode: "no_output_shadow",
      customerVisible: false,
      productionActivationGranted: false,
      createdByUserId: scope.actorUserId,
      createdByName: scope.actorName,
      createdAt: now.toISOString(),
      closedByUserId: null,
      closedByName: null,
      closedAt: null,
      closeReason: null,
      evaluationRecommendation: "not_evaluated",
    };
    return this.repository.createPlan(scope, draft, digest(draft), plan);
  }

  async recordObservation(
    scope: AiShadowScope,
    planId: string,
    draft: AiShadowObservationDraft,
  ) {
    if (!UUID.test(planId))
      throw new AiShadowProgrammeError("not_found", "Plan not found.");
    const plan = (await this.repository.listPlans(scope)).find(
      ({ id }) => id === planId,
    );
    if (!plan) throw new AiShadowProgrammeError("not_found", "Plan not found.");
    if (plan.status !== "active")
      throw new AiShadowProgrammeError("conflict", "The plan is closed.");
    if (!plan.cohorts.includes(draft.cohort))
      throw new AiShadowProgrammeError(
        "policy_denied",
        "The cohort is not in the plan.",
      );
    if (draft.disposition === "completed" && draft.outputSha256 === null)
      throw new AiShadowProgrammeError(
        "policy_denied",
        "Completed shadow observations require an output digest.",
      );
    const observedAt = Date.parse(draft.observedAt);
    const now = this.now();
    if (
      observedAt > now.getTime() + 5 * 60_000 ||
      observedAt < Date.parse(plan.createdAt)
    )
      throw new AiShadowProgrammeError(
        "invalid_request",
        "Observation timestamp is outside the plan window.",
      );
    const observation: AiShadowObservation = {
      ...draft,
      id: randomUUID(),
      schema: AI_SHADOW_OBSERVATION_SCHEMA,
      organisationId: scope.organisationId,
      planId,
      recordedByUserId: scope.actorUserId,
      recordedByName: scope.actorName,
      recordedAt: now.toISOString(),
    };
    return this.repository.appendObservation(
      scope,
      plan,
      draft,
      digest(draft),
      observation,
    );
  }

  async closePlan(
    scope: AiShadowScope,
    planId: string,
    close: AiShadowCloseDraft,
  ) {
    if (!UUID.test(planId))
      throw new AiShadowProgrammeError("not_found", "Plan not found.");
    const plan = (await this.repository.listPlans(scope)).find(
      ({ id }) => id === planId,
    );
    if (!plan) throw new AiShadowProgrammeError("not_found", "Plan not found.");
    if (plan.status !== "active" || plan.version !== close.expectedVersion)
      throw new AiShadowProgrammeError(
        "conflict",
        "The plan changed before closure.",
      );
    if (plan.createdByUserId === scope.actorUserId)
      throw new AiShadowProgrammeError(
        "policy_denied",
        "The plan creator cannot close their own plan.",
      );
    const observations = await this.repository.listObservations(scope, plan.id);
    if (observations.length !== close.expectedObservationCount)
      throw new AiShadowProgrammeError(
        "conflict",
        "The observation set changed before closure.",
      );
    const blockers = blockersFor(plan, observations, this.now());
    const closedPlan: AiShadowPlan = {
      ...plan,
      status: "closed",
      version: plan.version + 1,
      closedByUserId: scope.actorUserId,
      closedByName: scope.actorName,
      closedAt: this.now().toISOString(),
      closeReason: close.reason,
      evaluationRecommendation:
        blockers.length === 0 ? "eligible_for_governance_review" : "blocked",
      productionActivationGranted: false,
    };
    return this.repository.closePlan(scope, plan, close, closedPlan);
  }
}

export function isAiShadowPlan(value: unknown): value is AiShadowPlan {
  if (!plain(value)) return false;
  const parsed = parseAiShadowPlanDraft({
    capabilityId: value.capabilityId,
    cohorts: value.cohorts,
    expectedCaseCount: value.expectedCaseCount,
    expiresAt: value.expiresAt,
    idempotencyKey: PLAN_VALIDATION_DEDUPLICATION_MARKER,
    purpose: value.purpose,
    title: value.title,
    versions: value.versions,
  });
  return Boolean(
    parsed &&
    value.schema === AI_SHADOW_PLAN_SCHEMA &&
    typeof value.id === "string" &&
    UUID.test(value.id) &&
    typeof value.organisationId === "string" &&
    UUID.test(value.organisationId) &&
    (value.status === "active" || value.status === "closed") &&
    validInteger(value.version, Number.MAX_SAFE_INTEGER) &&
    value.version >= 1 &&
    value.executionMode === "no_output_shadow" &&
    value.customerVisible === false &&
    value.productionActivationGranted === false &&
    typeof value.createdByUserId === "string" &&
    UUID.test(value.createdByUserId) &&
    boundedText(value.createdByName, 512) &&
    validDate(value.createdAt),
  );
}

export function isAiShadowObservation(
  value: unknown,
): value is AiShadowObservation {
  if (!plain(value)) return false;
  const draft = parseAiShadowObservationDraft({
    caseId: value.caseId,
    citationCorrectCount: value.citationCorrectCount,
    citationEvaluatedCount: value.citationEvaluatedCount,
    cohort: value.cohort,
    costMinor: value.costMinor,
    disposition: value.disposition,
    expectedDisposition: value.expectedDisposition,
    fatalMissCount: value.fatalMissCount,
    idempotencyKey: OBSERVATION_VALIDATION_DEDUPLICATION_MARKER,
    injectionContained: value.injectionContained,
    latencyMs: value.latencyMs,
    observedAt: value.observedAt,
    outputSha256: value.outputSha256,
    passed: value.passed,
    reviewerNoteCode: value.reviewerNoteCode,
    tenantLeakDetected: value.tenantLeakDetected,
    unsupportedMaterialClaimCount: value.unsupportedMaterialClaimCount,
  });
  return Boolean(
    draft &&
    value.schema === AI_SHADOW_OBSERVATION_SCHEMA &&
    typeof value.id === "string" &&
    UUID.test(value.id) &&
    typeof value.organisationId === "string" &&
    UUID.test(value.organisationId) &&
    typeof value.planId === "string" &&
    UUID.test(value.planId) &&
    typeof value.recordedByUserId === "string" &&
    UUID.test(value.recordedByUserId) &&
    boundedText(value.recordedByName, 512) &&
    validDate(value.recordedAt),
  );
}
