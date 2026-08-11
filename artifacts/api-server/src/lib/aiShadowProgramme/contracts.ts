import type { AiCapabilityId } from "../aiPolicy";
import type { AiEvalCohort } from "../aiContinuousEval";

export const AI_SHADOW_PROGRAMME_STATUS = Object.freeze({
  runtimeConnected: true,
  modelExecutionConnected: false,
  providerDisclosureAllowed: false,
  rawOutputPersistenceAllowed: false,
  customerVisible: false,
  productionActivationGranted: false,
  authority: "named_human_governance_review_required" as const,
});

export const AI_SHADOW_PROGRAMME_BOUNDS = Object.freeze({
  maxPlansPerOrganisation: 25,
  maxObservationsPerPlan: 500,
  minProductionProfileCases: 25,
  maxSummaryCodeUnits: 1_000,
  maxReferenceCodeUnits: 256,
  maxEventCodeUnits: 12_000,
  maxEventBytes: 24_000,
  maxEventSetBytes: 8_000_000,
});

export const AI_SHADOW_PLAN_SCHEMA = "valo.ai-shadow-plan/v1" as const;
export const AI_SHADOW_OBSERVATION_SCHEMA =
  "valo.ai-shadow-observation/v1" as const;
export const AI_SHADOW_REVIEWER_NOTE_CODES = [
  "fixture_verified",
  "fixture_discrepancy",
  "safe_failure_verified",
  "requires_adjudication",
] as const;
export type AiShadowReviewerNoteCode =
  (typeof AI_SHADOW_REVIEWER_NOTE_CODES)[number];

export interface AiShadowVersionManifest {
  applicationReleaseSha256: string;
  modelSnapshotSha256: string;
  modelConfigurationSha256: string;
  promptSha256: string;
  schemaSha256: string;
  retrievalPolicySha256: string;
  corpusManifestSha256: string;
  governanceDecisionSha256: string;
  expectedCaseManifestSha256: string;
}

export interface AiShadowScope {
  organisationId: string;
  actorUserId: string;
  actorName: string;
}

export interface AiShadowPlanDraft {
  capabilityId: AiCapabilityId;
  title: string;
  purpose: string;
  versions: AiShadowVersionManifest;
  cohorts: AiEvalCohort[];
  expectedCaseCount: number;
  expiresAt: string;
  idempotencyKey: string;
}

export interface AiShadowPlan {
  schema: typeof AI_SHADOW_PLAN_SCHEMA;
  id: string;
  organisationId: string;
  capabilityId: AiCapabilityId;
  title: string;
  purpose: string;
  versions: AiShadowVersionManifest;
  cohorts: AiEvalCohort[];
  expectedCaseCount: number;
  expiresAt: string;
  status: "active" | "closed";
  version: number;
  executionMode: "no_output_shadow";
  customerVisible: false;
  productionActivationGranted: false;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  closedByUserId: string | null;
  closedByName: string | null;
  closedAt: string | null;
  closeReason: string | null;
  evaluationRecommendation:
    | "not_evaluated"
    | "blocked"
    | "eligible_for_governance_review";
}

export interface AiShadowObservationDraft {
  caseId: string;
  cohort: AiEvalCohort;
  disposition: "completed" | "abstained" | "safe_failure";
  expectedDisposition: "completed" | "abstained" | "safe_failure";
  passed: boolean;
  outputSha256: string | null;
  fatalMissCount: number;
  unsupportedMaterialClaimCount: number;
  tenantLeakDetected: boolean;
  injectionContained: boolean;
  citationCorrectCount: number;
  citationEvaluatedCount: number;
  latencyMs: number;
  costMinor: number;
  reviewerNoteCode: AiShadowReviewerNoteCode;
  observedAt: string;
  idempotencyKey: string;
}

export interface AiShadowObservation extends Omit<
  AiShadowObservationDraft,
  "idempotencyKey"
> {
  schema: typeof AI_SHADOW_OBSERVATION_SCHEMA;
  id: string;
  organisationId: string;
  planId: string;
  recordedByUserId: string;
  recordedByName: string;
  recordedAt: string;
}

export interface AiShadowProgrammeSnapshot {
  generatedAt: string;
  plans: Array<{
    plan: AiShadowPlan;
    observationCount: number;
    coveredCohorts: AiEvalCohort[];
    blockers: string[];
  }>;
  authority: typeof AI_SHADOW_PROGRAMME_STATUS;
}

export interface AiShadowCloseDraft {
  expectedVersion: number;
  expectedObservationCount: number;
  reason: string;
}

export type AiShadowMutationResult<T> =
  | { outcome: "created" | "recorded" | "closed" | "replayed"; value: T }
  | { outcome: "idempotency_conflict" };

export interface AiShadowRepository {
  listPlans(scope: AiShadowScope): Promise<AiShadowPlan[]>;
  listObservations(
    scope: AiShadowScope,
    planId: string,
  ): Promise<AiShadowObservation[]>;
  createPlan(
    scope: AiShadowScope,
    draft: AiShadowPlanDraft,
    requestDigest: string,
    plan: AiShadowPlan,
  ): Promise<AiShadowMutationResult<AiShadowPlan>>;
  appendObservation(
    scope: AiShadowScope,
    plan: AiShadowPlan,
    draft: AiShadowObservationDraft,
    requestDigest: string,
    observation: AiShadowObservation,
  ): Promise<AiShadowMutationResult<AiShadowObservation>>;
  closePlan(
    scope: AiShadowScope,
    plan: AiShadowPlan,
    close: AiShadowCloseDraft,
    closedPlan: AiShadowPlan,
  ): Promise<AiShadowMutationResult<AiShadowPlan>>;
}

export type AiShadowErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "policy_denied"
  | "capacity_exceeded"
  | "repository_unavailable";

export class AiShadowProgrammeError extends Error {
  constructor(
    readonly code: AiShadowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiShadowProgrammeError";
  }
}
