import { createHash } from "node:crypto";
import {
  AI_CAPABILITY_IDS,
  AI_CAPABILITY_POLICY,
  AI_SAFE_ERROR_CODES,
  type AiCapabilityPolicy,
  type AiCapabilityId,
  type AiSafeErrorCode,
} from "./aiPolicy";
import {
  SHA256,
  validIdentifier,
  validIsoTimestamp,
  validNonNegativeInteger,
  validUnitScore,
} from "./aiFoundationValidation";

/**
 * Pure control-plane contracts for later integration. They do not start a
 * worker, call a provider, persist a run, or alter the production kill switch.
 */
export const AI_CONTROL_PLANE_FOUNDATION_STATUS = Object.freeze({
  runtimeConnected: false,
  durableStoreConnected: false,
  productionApproved: false,
  activation: "blocked" as const,
});

export const AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION =
  "ai-capability-policy-v1" as const;

export type AiRiskBand = "low" | "medium" | "high" | "critical";
export type AiReviewMode =
  | "none"
  | "single_human"
  | "two_humans"
  | "prohibited";

export interface AiHumanReviewRiskInput {
  actionClass: "read_only" | "reversible_draft" | "consequential_action";
  modelGenerated: boolean;
  classification: "public" | "internal" | "confidential" | "restricted";
  grounding: "grounded" | "partial" | "absent" | "contradicted";
  calibratedConfidence: number | null;
  injectionSignalPresent: boolean;
  crossTenantSignalPresent: boolean;
  monetaryImpactMinor: number;
  novelModelOrRetrievalVersion: boolean;
}

export interface AiHumanReviewRiskDecision {
  score: number;
  band: AiRiskBand;
  executionAllowed: boolean;
  reviewRequired: boolean;
  reviewMode: AiReviewMode;
  reasons: string[];
}

const AI_CAPABILITIES = new Set<string>(AI_CAPABILITY_IDS);
const CAPABILITY_POLICY_SNAPSHOT = Object.freeze(
  Object.fromEntries(
    AI_CAPABILITY_IDS.map((capability) => {
      const policy = AI_CAPABILITY_POLICY[capability];
      return [
        capability,
        Object.freeze({
          ...policy,
          limits: Object.freeze({ ...policy.limits }),
          approval: Object.freeze({ ...policy.approval }),
          failure: Object.freeze({ ...policy.failure }),
        }),
      ];
    }),
  ),
) as Readonly<Record<AiCapabilityId, AiCapabilityPolicy>>;
const ACTION_CLASSES = new Set([
  "read_only",
  "reversible_draft",
  "consequential_action",
]);
const DATA_CLASSIFICATIONS = new Set([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const GROUNDING_STATES = new Set([
  "grounded",
  "partial",
  "absent",
  "contradicted",
]);
const RISK_BANDS = new Set(["low", "medium", "high", "critical"]);

export function assessAiHumanReviewRisk(
  input: AiHumanReviewRiskInput,
): AiHumanReviewRiskDecision {
  if (
    !ACTION_CLASSES.has(input.actionClass) ||
    typeof input.modelGenerated !== "boolean" ||
    !DATA_CLASSIFICATIONS.has(input.classification) ||
    !GROUNDING_STATES.has(input.grounding) ||
    typeof input.injectionSignalPresent !== "boolean" ||
    typeof input.crossTenantSignalPresent !== "boolean" ||
    typeof input.novelModelOrRetrievalVersion !== "boolean"
  ) {
    return {
      score: 100,
      band: "critical",
      executionAllowed: false,
      reviewRequired: true,
      reviewMode: "prohibited",
      reasons: ["risk_input_invalid"],
    };
  }
  const reasons: string[] = [];
  let score = 0;

  if (input.actionClass === "consequential_action") {
    score += 100;
    reasons.push("consequential_action_prohibited");
  } else if (input.actionClass === "reversible_draft") {
    score += 25;
    reasons.push("model_draft_requires_named_human");
  }
  if (input.classification === "restricted") {
    score += 35;
    reasons.push("restricted_data");
  } else if (input.classification === "confidential") {
    score += 15;
    reasons.push("confidential_data");
  }
  if (input.grounding === "contradicted") {
    score += 80;
    reasons.push("evidence_contradiction");
  } else if (input.grounding === "absent") {
    score += 50;
    reasons.push("evidence_absent");
  } else if (input.grounding === "partial") {
    score += 25;
    reasons.push("evidence_partial");
  }
  if (
    input.calibratedConfidence == null ||
    !validUnitScore(input.calibratedConfidence)
  ) {
    score += 25;
    reasons.push("confidence_unavailable");
  } else if (input.calibratedConfidence < 0.6) {
    score += 25;
    reasons.push("confidence_low");
  } else if (input.calibratedConfidence < 0.8) {
    score += 10;
    reasons.push("confidence_medium");
  }
  if (input.injectionSignalPresent) {
    score += 80;
    reasons.push("injection_signal");
  }
  if (input.crossTenantSignalPresent) {
    score += 100;
    reasons.push("cross_tenant_signal");
  }
  if (!validNonNegativeInteger(input.monetaryImpactMinor)) {
    score += 100;
    reasons.push("monetary_impact_invalid");
  } else if (input.monetaryImpactMinor > 0) {
    score += input.monetaryImpactMinor >= 100_000_000 ? 40 : 15;
    reasons.push("monetary_impact");
  }
  if (input.novelModelOrRetrievalVersion) {
    score += 20;
    reasons.push("novel_version");
  }

  const executionAllowed =
    input.actionClass !== "consequential_action" &&
    !input.crossTenantSignalPresent &&
    !input.injectionSignalPresent &&
    input.grounding !== "contradicted" &&
    validNonNegativeInteger(input.monetaryImpactMinor);
  const band: AiRiskBand =
    score >= 100
      ? "critical"
      : score >= 60
        ? "high"
        : score >= 30
          ? "medium"
          : "low";
  const reviewRequired =
    input.modelGenerated ||
    input.actionClass === "reversible_draft" ||
    band !== "low";
  const reviewMode: AiReviewMode = !executionAllowed
    ? "prohibited"
    : reviewRequired && (band === "high" || band === "critical")
      ? "two_humans"
      : reviewRequired
        ? "single_human"
        : "none";

  return {
    score,
    band,
    executionAllowed,
    reviewRequired,
    reviewMode,
    reasons: [...new Set(reasons)].sort(),
  };
}

export interface AiModelCandidate {
  candidateId: string;
  provider: string;
  model: string;
  modelConfigurationVersion: string;
  approved: boolean;
  healthy: boolean;
  healthCheckedAt: string;
  capabilities: AiCapabilityId[];
  supportedClassifications: AiHumanReviewRiskInput["classification"][];
  maxInputBytes: number;
  evaluatedQuality: number;
  p95LatencyMs: number;
  predictedCostMinor: number;
  governance: {
    noTrainingVerified: boolean;
    dpaApproved: boolean;
    processingRegions: string[];
    retentionDays: number;
    evidenceVersion: string;
  };
}

export interface AiModelRoutingRequest {
  capability: AiCapabilityId;
  classification: AiHumanReviewRiskInput["classification"];
  inputBytes: number;
  requiredRegion: string;
  maxRetentionDays: number;
  minEvaluatedQuality: number;
  maxP95LatencyMs: number;
  maxCostMinor: number;
  riskBand: AiRiskBand;
  approvedModelConfigurationVersions: string[];
  evaluatedAt: string;
  maxHealthAgeMs: number;
}

export type AiModelRejectionCode =
  | "candidate_invalid"
  | "not_approved"
  | "unhealthy"
  | "health_stale"
  | "configuration_not_approved"
  | "capability_unsupported"
  | "classification_unsupported"
  | "input_too_large"
  | "quality_below_floor"
  | "latency_above_limit"
  | "cost_above_limit"
  | "privacy_unverified"
  | "region_unavailable"
  | "retention_incompatible";

export interface AiModelRejection {
  candidateId: string;
  codes: AiModelRejectionCode[];
}

export interface AiModelRouteDecision {
  allowed: boolean;
  primary: AiModelCandidate | null;
  fallbacks: AiModelCandidate[];
  rejected: AiModelRejection[];
  code?: "request_invalid" | "no_eligible_model";
}

function candidateRoutingRejections(
  request: AiModelRoutingRequest,
  candidate: AiModelCandidate,
): AiModelRejectionCode[] {
  const codes: AiModelRejectionCode[] = [];
  if (
    !validIdentifier(candidate.candidateId) ||
    !validIdentifier(candidate.provider) ||
    !validIdentifier(candidate.model) ||
    !validIdentifier(candidate.modelConfigurationVersion) ||
    !validIsoTimestamp(candidate.healthCheckedAt) ||
    !validNonNegativeInteger(candidate.maxInputBytes) ||
    !validUnitScore(candidate.evaluatedQuality) ||
    !validNonNegativeInteger(candidate.p95LatencyMs) ||
    !validNonNegativeInteger(candidate.predictedCostMinor)
  ) {
    codes.push("candidate_invalid");
  }
  if (
    typeof candidate.approved !== "boolean" ||
    typeof candidate.healthy !== "boolean" ||
    candidate.capabilities.length === 0 ||
    candidate.capabilities.length > AI_CAPABILITY_IDS.length ||
    new Set(candidate.capabilities).size !== candidate.capabilities.length ||
    !candidate.capabilities.every((capability) =>
      AI_CAPABILITIES.has(capability),
    ) ||
    candidate.supportedClassifications.length === 0 ||
    candidate.supportedClassifications.length > DATA_CLASSIFICATIONS.size ||
    new Set(candidate.supportedClassifications).size !==
      candidate.supportedClassifications.length ||
    !candidate.supportedClassifications.every((classification) =>
      DATA_CLASSIFICATIONS.has(classification),
    )
  ) {
    codes.push("candidate_invalid");
  }
  if (!candidate.approved) codes.push("not_approved");
  if (!candidate.healthy) codes.push("unhealthy");
  if (
    validIsoTimestamp(candidate.healthCheckedAt) &&
    (Date.parse(candidate.healthCheckedAt) > Date.parse(request.evaluatedAt) ||
      Date.parse(request.evaluatedAt) - Date.parse(candidate.healthCheckedAt) >
        request.maxHealthAgeMs)
  ) {
    codes.push("health_stale");
  }
  if (
    !request.approvedModelConfigurationVersions.includes(
      candidate.modelConfigurationVersion,
    )
  ) {
    codes.push("configuration_not_approved");
  }
  if (!candidate.capabilities.includes(request.capability)) {
    codes.push("capability_unsupported");
  }
  if (!candidate.supportedClassifications.includes(request.classification)) {
    codes.push("classification_unsupported");
  }
  if (request.inputBytes > candidate.maxInputBytes)
    codes.push("input_too_large");
  if (candidate.evaluatedQuality < request.minEvaluatedQuality) {
    codes.push("quality_below_floor");
  }
  if (candidate.p95LatencyMs > request.maxP95LatencyMs) {
    codes.push("latency_above_limit");
  }
  if (candidate.predictedCostMinor > request.maxCostMinor) {
    codes.push("cost_above_limit");
  }
  const governance = candidate.governance;
  if (
    governance.noTrainingVerified !== true ||
    governance.dpaApproved !== true ||
    !validIdentifier(governance.evidenceVersion) ||
    !validNonNegativeInteger(governance.retentionDays) ||
    governance.processingRegions.length === 0 ||
    governance.processingRegions.length > 32 ||
    new Set(governance.processingRegions).size !==
      governance.processingRegions.length ||
    !governance.processingRegions.every(validIdentifier)
  ) {
    codes.push("privacy_unverified");
  }
  if (
    !governance.processingRegions
      .map((region) => region.trim().toLowerCase())
      .includes(request.requiredRegion.trim().toLowerCase())
  ) {
    codes.push("region_unavailable");
  }
  if (governance.retentionDays > request.maxRetentionDays) {
    codes.push("retention_incompatible");
  }
  return [...new Set(codes)];
}

/** Selects only evaluated, approved candidates; it never grants approval. */
export function routeQualityConstrainedModel(input: {
  request: AiModelRoutingRequest;
  candidates: AiModelCandidate[];
}): AiModelRouteDecision {
  const request = input.request;
  if (
    !AI_CAPABILITIES.has(request.capability) ||
    !DATA_CLASSIFICATIONS.has(request.classification) ||
    !RISK_BANDS.has(request.riskBand) ||
    !validNonNegativeInteger(request.inputBytes) ||
    !validIdentifier(request.requiredRegion) ||
    !validNonNegativeInteger(request.maxRetentionDays) ||
    !validUnitScore(request.minEvaluatedQuality) ||
    !validNonNegativeInteger(request.maxP95LatencyMs) ||
    !validNonNegativeInteger(request.maxCostMinor) ||
    !validIsoTimestamp(request.evaluatedAt) ||
    !Number.isSafeInteger(request.maxHealthAgeMs) ||
    request.maxHealthAgeMs <= 0 ||
    request.maxHealthAgeMs > 24 * 60 * 60 * 1_000 ||
    request.approvedModelConfigurationVersions.length === 0 ||
    request.approvedModelConfigurationVersions.length > 64 ||
    new Set(request.approvedModelConfigurationVersions).size !==
      request.approvedModelConfigurationVersions.length ||
    !request.approvedModelConfigurationVersions.every(validIdentifier) ||
    input.candidates.length === 0 ||
    input.candidates.length > 64 ||
    new Set(input.candidates.map((candidate) => candidate.candidateId)).size !==
      input.candidates.length
  ) {
    return {
      allowed: false,
      primary: null,
      fallbacks: [],
      rejected: [],
      code: "request_invalid",
    };
  }

  const rejected: AiModelRejection[] = [];
  const eligible: AiModelCandidate[] = [];
  for (const candidate of input.candidates) {
    const codes = candidateRoutingRejections(request, candidate);
    if (codes.length > 0)
      rejected.push({ candidateId: candidate.candidateId, codes });
    else eligible.push(candidate);
  }
  if (eligible.length === 0) {
    return {
      allowed: false,
      primary: null,
      fallbacks: [],
      rejected,
      code: "no_eligible_model",
    };
  }

  const qualityFirst =
    request.riskBand === "high" || request.riskBand === "critical";
  eligible.sort((left, right) =>
    qualityFirst
      ? right.evaluatedQuality - left.evaluatedQuality ||
        left.predictedCostMinor - right.predictedCostMinor ||
        left.p95LatencyMs - right.p95LatencyMs ||
        left.candidateId.localeCompare(right.candidateId)
      : left.predictedCostMinor - right.predictedCostMinor ||
        left.p95LatencyMs - right.p95LatencyMs ||
        right.evaluatedQuality - left.evaluatedQuality ||
        left.candidateId.localeCompare(right.candidateId),
  );
  const [primary, ...rest] = eligible;
  const fallbacks = rest.filter(
    (candidate) =>
      candidate.governance.retentionDays <= primary!.governance.retentionDays &&
      candidate.governance.noTrainingVerified === true &&
      candidate.governance.dpaApproved === true,
  );
  return { allowed: true, primary: primary!, fallbacks, rejected };
}

export interface AiWorkflowDefinition {
  definitionId: string;
  version: string;
  allowedStages: string[];
  maxSteps: number;
  maxAttempts: number;
  maxElapsedMs: number;
  maxLeaseMs: number;
  maxCostMinor: number;
  maxOutputTokens: number;
}

export function aiWorkflowDefinitionSha256(
  definition: AiWorkflowDefinition,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        definitionId: definition.definitionId,
        version: definition.version,
        allowedStages: [...definition.allowedStages].sort(),
        maxSteps: definition.maxSteps,
        maxAttempts: definition.maxAttempts,
        maxElapsedMs: definition.maxElapsedMs,
        maxLeaseMs: definition.maxLeaseMs,
        maxCostMinor: definition.maxCostMinor,
        maxOutputTokens: definition.maxOutputTokens,
      }),
      "utf8",
    )
    .digest("hex");
}

export type AiDurableRunStatus =
  | "queued"
  | "running"
  | "waiting_for_review"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";

export interface AiHumanApproval {
  reviewerId: string;
  approvalReference: string;
  artifactSha256: string;
  reviewedAt: string;
}

export interface AiDurableRun {
  runId: string;
  idempotencyKeySha256: string;
  tenantId: string;
  projectId: string;
  requesterId: string;
  capability: AiCapabilityId;
  definitionId: string;
  definitionVersion: string;
  definitionSha256: string;
  status: AiDurableRunStatus;
  version: number;
  attempts: number;
  stepCount: number;
  progressPercent: number;
  outputTokens: number;
  costMinor: number;
  workingArtifactSha256: string | null;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  nextEligibleAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  review: {
    required: boolean;
    requiredPermission: string;
    requiredApprovals: 1 | 2;
    policyVersion: typeof AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION;
    riskBand: AiRiskBand;
    state:
      | "not_required"
      | "not_requested"
      | "pending"
      | "approved"
      | "rejected";
    artifactSha256: string | null;
    approvals: AiHumanApproval[];
  };
  lastSafeErrorCode: string | null;
}

export interface AiRunActor {
  actorId: string;
  kind: "human" | "worker" | "system";
  tenantId: string;
  projectId: string;
  permissions: string[];
}

interface AiRunCommandBase {
  expectedVersion: number;
  now: string;
  actor: AiRunActor;
}

export type AiRunCommand =
  | (AiRunCommandBase & { kind: "claim"; leaseExpiresAt: string })
  | (AiRunCommandBase & {
      kind: "heartbeat";
      progressPercent: number;
      leaseExpiresAt: string;
    })
  | (AiRunCommandBase & {
      kind: "record_step";
      stage: string;
      progressPercent: number;
      additionalOutputTokens: number;
      additionalCostMinor: number;
      artifactSha256: string;
    })
  | (AiRunCommandBase & { kind: "request_review"; artifactSha256: string })
  | (AiRunCommandBase & {
      kind: "review";
      decision: "approve" | "reject";
      approvalReference: string;
      artifactSha256: string;
    })
  | (AiRunCommandBase & { kind: "complete"; artifactSha256: string })
  | (AiRunCommandBase & {
      kind: "fail";
      retryable: boolean;
      safeErrorCode: string;
      retryAt?: string | null;
    })
  | (AiRunCommandBase & { kind: "expire_lease"; retryAt: string })
  | (AiRunCommandBase & { kind: "cancel" });

export type AiRunTransitionCode =
  | "run_invalid"
  | "definition_invalid"
  | "scope_mismatch"
  | "stale_version"
  | "invalid_transition"
  | "lease_mismatch"
  | "lease_invalid"
  | "deadline_exceeded"
  | "attempts_exhausted"
  | "step_limit_exceeded"
  | "stage_not_allowed"
  | "progress_regressed"
  | "token_limit_exceeded"
  | "cost_limit_exceeded"
  | "review_required"
  | "review_authority_denied"
  | "reviewer_not_independent"
  | "artifact_mismatch"
  | "cancellation_authority_denied";

export interface AiRunTransitionDecision {
  allowed: boolean;
  next: AiDurableRun;
  code?: AiRunTransitionCode;
  event:
    | "none"
    | "enqueued"
    | "claimed"
    | "heartbeat"
    | "step_recorded"
    | "review_requested"
    | "review_approved"
    | "review_rejected"
    | "succeeded"
    | "retry_scheduled"
    | "failed"
    | "dead_lettered"
    | "cancelled"
    | "deadline_exceeded";
}

export type AiRunCreationDecision =
  | {
      allowed: true;
      run: AiDurableRun;
      code?: never;
      event: "enqueued";
    }
  | {
      allowed: false;
      run: null;
      code:
        | "definition_invalid"
        | "run_invalid"
        | "capability_policy_invalid"
        | "risk_prohibited";
      event: "none";
    };

export interface AiRunCreationInput {
  runId: string;
  idempotencyKeySha256: string;
  tenantId: string;
  projectId: string;
  requesterId: string;
  capability: AiCapabilityId;
  capabilityPolicyVersion: typeof AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION;
  definition: AiWorkflowDefinition;
  createdAt: string;
  riskContext: Omit<AiHumanReviewRiskInput, "actionClass" | "modelGenerated">;
}

function validDefinition(definition: AiWorkflowDefinition): boolean {
  if (!definition || !Array.isArray(definition.allowedStages)) return false;
  return (
    validIdentifier(definition.definitionId) &&
    validIdentifier(definition.version) &&
    definition.allowedStages.length > 0 &&
    definition.allowedStages.length <= 100 &&
    new Set(definition.allowedStages).size ===
      definition.allowedStages.length &&
    definition.allowedStages.every(validIdentifier) &&
    Number.isSafeInteger(definition.maxSteps) &&
    definition.maxSteps > 0 &&
    definition.maxSteps <= 100 &&
    Number.isSafeInteger(definition.maxAttempts) &&
    definition.maxAttempts > 0 &&
    definition.maxAttempts <= 10 &&
    Number.isSafeInteger(definition.maxElapsedMs) &&
    definition.maxElapsedMs > 0 &&
    definition.maxElapsedMs <= 30 * 24 * 60 * 60 * 1_000 &&
    Number.isSafeInteger(definition.maxLeaseMs) &&
    definition.maxLeaseMs > 0 &&
    definition.maxLeaseMs <= 60 * 60 * 1_000 &&
    definition.maxLeaseMs <= definition.maxElapsedMs &&
    validNonNegativeInteger(definition.maxCostMinor) &&
    definition.maxCostMinor <= 1_000_000_000 &&
    validNonNegativeInteger(definition.maxOutputTokens) &&
    definition.maxOutputTokens <= 10_000_000
  );
}

export function createQueuedAiRun(
  input: AiRunCreationInput,
): AiRunCreationDecision {
  if (!validDefinition(input.definition)) {
    return {
      allowed: false,
      run: null,
      code: "definition_invalid",
      event: "none",
    };
  }
  if (
    !validIdentifier(input.runId) ||
    !SHA256.test(input.idempotencyKeySha256) ||
    !validIdentifier(input.tenantId) ||
    !validIdentifier(input.projectId) ||
    !validIdentifier(input.requesterId) ||
    !AI_CAPABILITIES.has(input.capability) ||
    !validIsoTimestamp(input.createdAt)
  ) {
    return {
      allowed: false,
      run: null,
      code: "run_invalid",
      event: "none",
    };
  }
  if (
    input.capabilityPolicyVersion !== AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION
  ) {
    return {
      allowed: false,
      run: null,
      code: "capability_policy_invalid",
      event: "none",
    };
  }
  const capabilityPolicy = CAPABILITY_POLICY_SNAPSHOT[input.capability];
  if (
    capabilityPolicy.id !== input.capability ||
    capabilityPolicy.actionClass !== "reversible_draft" ||
    capabilityPolicy.authoritativeMutationAllowed !== false ||
    capabilityPolicy.approval.authoritativeUseRequiresHumanApproval !== true ||
    capabilityPolicy.approval.namedHumanRequired !== true ||
    capabilityPolicy.approval.aiSelfApprovalForbidden !== true ||
    !validIdentifier(capabilityPolicy.approval.approvalAuthority) ||
    capabilityPolicy.failure.behavior !== "fail_closed" ||
    input.definition.maxOutputTokens >
      capabilityPolicy.limits.maxOutputTokens ||
    input.definition.maxCostMinor > capabilityPolicy.limits.maxCostMinor
  ) {
    return {
      allowed: false,
      run: null,
      code: "capability_policy_invalid",
      event: "none",
    };
  }
  const riskDecision = assessAiHumanReviewRisk({
    ...input.riskContext,
    actionClass: capabilityPolicy.actionClass,
    modelGenerated: true,
  });
  if (
    !riskDecision.executionAllowed ||
    riskDecision.reviewMode === "prohibited"
  ) {
    return {
      allowed: false,
      run: null,
      code: "risk_prohibited",
      event: "none",
    };
  }
  const requiredApprovals: 1 | 2 =
    capabilityPolicy.approval.twoPersonApprovalRequired ||
    riskDecision.reviewMode === "two_humans"
      ? 2
      : 1;
  const deadlineAt = new Date(
    Date.parse(input.createdAt) + input.definition.maxElapsedMs,
  ).toISOString();
  return {
    allowed: true,
    event: "enqueued",
    run: {
      runId: input.runId,
      idempotencyKeySha256: input.idempotencyKeySha256,
      tenantId: input.tenantId,
      projectId: input.projectId,
      requesterId: input.requesterId,
      capability: input.capability,
      definitionId: input.definition.definitionId,
      definitionVersion: input.definition.version,
      definitionSha256: aiWorkflowDefinitionSha256(input.definition),
      status: "queued",
      version: 0,
      attempts: 0,
      stepCount: 0,
      progressPercent: 0,
      outputTokens: 0,
      costMinor: 0,
      workingArtifactSha256: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      deadlineAt,
      nextEligibleAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      review: {
        required: true,
        requiredPermission: capabilityPolicy.approval.approvalAuthority,
        requiredApprovals,
        policyVersion: AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION,
        riskBand: riskDecision.band,
        state: "not_requested",
        artifactSha256: null,
        approvals: [],
      },
      lastSafeErrorCode: null,
    },
  };
}

const terminalStatuses = new Set<AiDurableRunStatus>([
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled",
]);
const runStatuses = new Set<AiDurableRunStatus>([
  "queued",
  "running",
  "waiting_for_review",
  "retry_wait",
  ...terminalStatuses,
]);
const reviewStates = new Set<AiDurableRun["review"]["state"]>([
  "not_required",
  "not_requested",
  "pending",
  "approved",
  "rejected",
]);
const actorKinds = new Set<AiRunActor["kind"]>(["human", "worker", "system"]);
const traceStages = new Set<AiTraceStage>([
  "policy",
  "retrieval",
  "routing",
  "provider",
  "grounding",
  "human_review",
  "settlement",
  "completed",
]);
const traceOutcomes = new Set<AiTraceEventInput["outcome"]>([
  "started",
  "succeeded",
  "blocked",
  "failed",
  "abstained",
]);
const durableSafeErrorCodes = new Set<string>([
  ...AI_SAFE_ERROR_CODES,
  "AI_BOUNDED_DEADLINE_EXCEEDED",
  "AI_WORKER_LEASE_EXPIRED",
  "AI_HUMAN_REVIEW_REJECTED",
]);

function validDurableRun(
  run: AiDurableRun,
  definition: AiWorkflowDefinition,
): boolean {
  if (!run || !run.review || !Array.isArray(run.review.approvals)) {
    return false;
  }
  const createdAtMs = validIsoTimestamp(run.createdAt)
    ? Date.parse(run.createdAt)
    : Number.NaN;
  const updatedAtMs = validIsoTimestamp(run.updatedAt)
    ? Date.parse(run.updatedAt)
    : Number.NaN;
  const deadlineAtMs = validIsoTimestamp(run.deadlineAt)
    ? Date.parse(run.deadlineAt)
    : Number.NaN;
  const approvalsValid =
    Array.isArray(run.review.approvals) &&
    run.review.approvals.every(
      (approval) =>
        validIdentifier(approval.reviewerId) &&
        approval.reviewerId !== run.requesterId &&
        validIdentifier(approval.approvalReference) &&
        SHA256.test(approval.artifactSha256) &&
        approval.artifactSha256 === run.review.artifactSha256 &&
        validIsoTimestamp(approval.reviewedAt) &&
        Date.parse(approval.reviewedAt) >= createdAtMs &&
        Date.parse(approval.reviewedAt) <= updatedAtMs,
    ) &&
    new Set(run.review.approvals.map((approval) => approval.reviewerId))
      .size === run.review.approvals.length &&
    new Set(run.review.approvals.map((approval) => approval.approvalReference))
      .size === run.review.approvals.length;

  if (
    !validIdentifier(run.runId) ||
    !SHA256.test(run.idempotencyKeySha256) ||
    !validIdentifier(run.tenantId) ||
    !validIdentifier(run.projectId) ||
    !validIdentifier(run.requesterId) ||
    !AI_CAPABILITIES.has(run.capability) ||
    !validIdentifier(run.definitionId) ||
    !validIdentifier(run.definitionVersion) ||
    !SHA256.test(run.definitionSha256) ||
    run.definitionSha256 !== aiWorkflowDefinitionSha256(definition) ||
    !runStatuses.has(run.status) ||
    !validNonNegativeInteger(run.version) ||
    !validNonNegativeInteger(run.attempts) ||
    run.attempts > definition.maxAttempts ||
    !validNonNegativeInteger(run.stepCount) ||
    run.stepCount > definition.maxSteps ||
    !validUnitScore(run.progressPercent / 100) ||
    !validNonNegativeInteger(run.outputTokens) ||
    run.outputTokens > definition.maxOutputTokens ||
    !validNonNegativeInteger(run.costMinor) ||
    run.costMinor > definition.maxCostMinor ||
    (run.workingArtifactSha256 != null &&
      !SHA256.test(run.workingArtifactSha256)) ||
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(deadlineAtMs) ||
    updatedAtMs < createdAtMs ||
    deadlineAtMs !== createdAtMs + definition.maxElapsedMs ||
    (run.nextEligibleAt != null && !validIsoTimestamp(run.nextEligibleAt)) ||
    (run.leaseOwner != null && !validIdentifier(run.leaseOwner)) ||
    (run.leaseExpiresAt != null && !validIsoTimestamp(run.leaseExpiresAt)) ||
    run.review.required !== true ||
    !validIdentifier(run.review.requiredPermission) ||
    !new Set([1, 2]).has(run.review.requiredApprovals) ||
    run.review.policyVersion !== AI_CONTROL_PLANE_CAPABILITY_POLICY_VERSION ||
    !RISK_BANDS.has(run.review.riskBand) ||
    !reviewStates.has(run.review.state) ||
    (run.review.artifactSha256 != null &&
      !SHA256.test(run.review.artifactSha256)) ||
    !approvalsValid ||
    run.review.approvals.length > run.review.requiredApprovals ||
    (run.lastSafeErrorCode != null &&
      !durableSafeErrorCodes.has(run.lastSafeErrorCode))
  ) {
    return false;
  }

  const capabilityPolicy = CAPABILITY_POLICY_SNAPSHOT[run.capability];
  const policyRequiresTwo =
    capabilityPolicy.approval.twoPersonApprovalRequired ||
    run.review.riskBand === "high" ||
    run.review.riskBand === "critical";
  if (
    run.review.requiredPermission !==
      capabilityPolicy.approval.approvalAuthority ||
    (policyRequiresTwo && run.review.requiredApprovals !== 2)
  ) {
    return false;
  }

  const hasLease = run.leaseOwner != null && run.leaseExpiresAt != null;
  if ((run.status === "running") !== hasLease) return false;
  if ((run.status === "retry_wait") !== (run.nextEligibleAt != null))
    return false;
  if (run.status === "waiting_for_review" && run.review.state !== "pending") {
    return false;
  }
  if (!run.review.required && run.review.state !== "not_required") return false;
  if (run.review.required && run.review.state === "not_required") return false;
  if (
    run.review.state === "not_required" ||
    run.review.state === "not_requested"
  ) {
    if (run.review.artifactSha256 != null || run.review.approvals.length > 0) {
      return false;
    }
  } else {
    if (
      run.review.artifactSha256 == null ||
      run.review.artifactSha256 !== run.workingArtifactSha256
    ) {
      return false;
    }
  }
  if (
    run.review.state === "approved" &&
    run.review.approvals.length !== run.review.requiredApprovals
  ) {
    return false;
  }
  if (
    run.review.state === "pending" &&
    run.review.approvals.length >= run.review.requiredApprovals
  ) {
    return false;
  }
  if (run.review.state === "rejected" && run.status !== "failed") return false;
  if (run.status === "succeeded" && run.progressPercent !== 100) return false;
  return true;
}

function deny(
  run: AiDurableRun,
  code: AiRunTransitionCode,
): AiRunTransitionDecision {
  return { allowed: false, next: run, code, event: "none" };
}

function withCommonUpdate(
  run: AiDurableRun,
  now: string,
  patch: Partial<AiDurableRun>,
): AiDurableRun {
  return { ...run, ...patch, version: run.version + 1, updatedAt: now };
}

function ownsLiveLease(run: AiDurableRun, command: AiRunCommand): boolean {
  return (
    command.actor.kind === "worker" &&
    run.leaseOwner === command.actor.actorId &&
    run.leaseExpiresAt != null &&
    Date.parse(run.leaseExpiresAt) > Date.parse(command.now)
  );
}

export function transitionAiDurableRun(input: {
  run: AiDurableRun;
  definition: AiWorkflowDefinition;
  command: AiRunCommand;
}): AiRunTransitionDecision {
  const { run, definition, command } = input;
  if (!validDefinition(definition)) {
    return deny(run, "definition_invalid");
  }
  if (
    run.definitionId !== definition.definitionId ||
    run.definitionVersion !== definition.version ||
    run.definitionSha256 !== aiWorkflowDefinitionSha256(definition)
  ) {
    return deny(run, "definition_invalid");
  }
  if (!validDurableRun(run, definition)) return deny(run, "run_invalid");
  if (
    !validIsoTimestamp(command.now) ||
    !validIdentifier(command.actor.actorId) ||
    !actorKinds.has(command.actor.kind) ||
    !Array.isArray(command.actor.permissions) ||
    command.actor.permissions.length > 64 ||
    !command.actor.permissions.every(validIdentifier) ||
    new Set(command.actor.permissions).size !==
      command.actor.permissions.length ||
    !validNonNegativeInteger(command.expectedVersion) ||
    Date.parse(command.now) < Date.parse(run.updatedAt)
  ) {
    return deny(run, "run_invalid");
  }
  if (
    command.actor.tenantId !== run.tenantId ||
    command.actor.projectId !== run.projectId
  ) {
    return deny(run, "scope_mismatch");
  }
  if (command.expectedVersion !== run.version)
    return deny(run, "stale_version");
  if (terminalStatuses.has(run.status)) return deny(run, "invalid_transition");

  const nowMs = Date.parse(command.now);
  if (nowMs > Date.parse(run.deadlineAt) && command.kind !== "cancel") {
    return {
      allowed: true,
      event: "deadline_exceeded",
      code: "deadline_exceeded",
      next: withCommonUpdate(run, command.now, {
        status: "failed",
        nextEligibleAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: "AI_BOUNDED_DEADLINE_EXCEEDED",
      }),
    };
  }

  if (command.kind === "cancel") {
    const authorised =
      command.actor.kind === "system" ||
      (command.actor.kind === "human" &&
        (command.actor.actorId === run.requesterId ||
          command.actor.permissions.includes("ai:run:cancel")));
    if (!authorised) return deny(run, "cancellation_authority_denied");
    return {
      allowed: true,
      event: "cancelled",
      next: withCommonUpdate(run, command.now, {
        status: "cancelled",
        nextEligibleAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: "AI_CANCELLED",
      }),
    };
  }

  if (command.kind === "claim") {
    if (
      !new Set<AiDurableRunStatus>(["queued", "retry_wait"]).has(run.status)
    ) {
      return deny(run, "invalid_transition");
    }
    if (
      run.status === "retry_wait" &&
      run.nextEligibleAt != null &&
      nowMs < Date.parse(run.nextEligibleAt)
    ) {
      return deny(run, "invalid_transition");
    }
    if (run.attempts >= definition.maxAttempts)
      return deny(run, "attempts_exhausted");
    const leaseMs = Date.parse(command.leaseExpiresAt) - nowMs;
    if (
      command.actor.kind !== "worker" ||
      !validIsoTimestamp(command.leaseExpiresAt) ||
      leaseMs <= 0 ||
      leaseMs > definition.maxLeaseMs ||
      Date.parse(command.leaseExpiresAt) > Date.parse(run.deadlineAt)
    ) {
      return deny(run, "lease_invalid");
    }
    return {
      allowed: true,
      event: "claimed",
      next: withCommonUpdate(run, command.now, {
        status: "running",
        attempts: run.attempts + 1,
        nextEligibleAt: null,
        leaseOwner: command.actor.actorId,
        leaseExpiresAt: command.leaseExpiresAt,
      }),
    };
  }

  if (command.kind === "expire_lease") {
    if (
      command.actor.kind !== "system" ||
      run.status !== "running" ||
      run.leaseExpiresAt == null ||
      nowMs <= Date.parse(run.leaseExpiresAt) ||
      !validIsoTimestamp(command.retryAt) ||
      Date.parse(command.retryAt) < nowMs ||
      Date.parse(command.retryAt) > Date.parse(run.deadlineAt)
    ) {
      return deny(run, "lease_invalid");
    }
    const exhausted = run.attempts >= definition.maxAttempts;
    return {
      allowed: true,
      event: exhausted ? "dead_lettered" : "retry_scheduled",
      next: withCommonUpdate(run, command.now, {
        status: exhausted ? "dead_letter" : "retry_wait",
        nextEligibleAt: exhausted ? null : command.retryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: "AI_WORKER_LEASE_EXPIRED",
      }),
    };
  }

  if (command.kind === "review") {
    if (run.status !== "waiting_for_review" || run.review.state !== "pending") {
      return deny(run, "invalid_transition");
    }
    if (
      command.actor.kind !== "human" ||
      !command.actor.permissions.includes(run.review.requiredPermission) ||
      !validIdentifier(command.approvalReference) ||
      !new Set(["approve", "reject"]).has(command.decision)
    ) {
      return deny(run, "review_authority_denied");
    }
    if (
      !SHA256.test(command.artifactSha256) ||
      command.artifactSha256 !== run.review.artifactSha256 ||
      command.artifactSha256 !== run.workingArtifactSha256
    ) {
      return deny(run, "artifact_mismatch");
    }
    if (
      command.actor.actorId === run.requesterId ||
      run.review.approvals.some(
        (approval) => approval.reviewerId === command.actor.actorId,
      )
    ) {
      return deny(run, "reviewer_not_independent");
    }
    if (command.decision === "reject") {
      return {
        allowed: true,
        event: "review_rejected",
        next: withCommonUpdate(run, command.now, {
          status: "failed",
          review: { ...run.review, state: "rejected" },
          lastSafeErrorCode: "AI_HUMAN_REVIEW_REJECTED",
        }),
      };
    }
    const approvals = [
      ...run.review.approvals,
      {
        reviewerId: command.actor.actorId,
        approvalReference: command.approvalReference,
        artifactSha256: command.artifactSha256,
        reviewedAt: command.now,
      },
    ];
    const approved = approvals.length >= run.review.requiredApprovals;
    return {
      allowed: true,
      event: "review_approved",
      next: withCommonUpdate(run, command.now, {
        status: approved ? "queued" : "waiting_for_review",
        review: {
          ...run.review,
          state: approved ? "approved" : "pending",
          approvals,
        },
      }),
    };
  }

  if (run.status !== "running") return deny(run, "invalid_transition");
  if (!ownsLiveLease(run, command)) return deny(run, "lease_mismatch");

  if (command.kind === "heartbeat") {
    const leaseMs = Date.parse(command.leaseExpiresAt) - nowMs;
    if (
      !validIsoTimestamp(command.leaseExpiresAt) ||
      leaseMs <= 0 ||
      leaseMs > definition.maxLeaseMs ||
      Date.parse(command.leaseExpiresAt) > Date.parse(run.deadlineAt)
    ) {
      return deny(run, "lease_invalid");
    }
    if (
      !validUnitScore(command.progressPercent / 100) ||
      command.progressPercent < run.progressPercent
    ) {
      return deny(run, "progress_regressed");
    }
    return {
      allowed: true,
      event: "heartbeat",
      next: withCommonUpdate(run, command.now, {
        progressPercent: command.progressPercent,
        leaseExpiresAt: command.leaseExpiresAt,
      }),
    };
  }

  if (command.kind === "record_step") {
    if (run.review.state === "approved") return deny(run, "invalid_transition");
    if (!definition.allowedStages.includes(command.stage)) {
      return deny(run, "stage_not_allowed");
    }
    if (run.stepCount >= definition.maxSteps)
      return deny(run, "step_limit_exceeded");
    if (
      !validUnitScore(command.progressPercent / 100) ||
      command.progressPercent < run.progressPercent
    ) {
      return deny(run, "progress_regressed");
    }
    if (
      !validNonNegativeInteger(command.additionalOutputTokens) ||
      run.outputTokens + command.additionalOutputTokens >
        definition.maxOutputTokens
    ) {
      return deny(run, "token_limit_exceeded");
    }
    if (
      !validNonNegativeInteger(command.additionalCostMinor) ||
      run.costMinor + command.additionalCostMinor > definition.maxCostMinor
    ) {
      return deny(run, "cost_limit_exceeded");
    }
    if (!SHA256.test(command.artifactSha256)) {
      return deny(run, "artifact_mismatch");
    }
    return {
      allowed: true,
      event: "step_recorded",
      next: withCommonUpdate(run, command.now, {
        stepCount: run.stepCount + 1,
        progressPercent: command.progressPercent,
        outputTokens: run.outputTokens + command.additionalOutputTokens,
        costMinor: run.costMinor + command.additionalCostMinor,
        workingArtifactSha256: command.artifactSha256,
      }),
    };
  }

  if (command.kind === "request_review") {
    if (!run.review.required || run.review.state !== "not_requested") {
      return deny(run, "invalid_transition");
    }
    if (
      !SHA256.test(command.artifactSha256) ||
      command.artifactSha256 !== run.workingArtifactSha256
    ) {
      return deny(run, "artifact_mismatch");
    }
    return {
      allowed: true,
      event: "review_requested",
      next: withCommonUpdate(run, command.now, {
        status: "waiting_for_review",
        leaseOwner: null,
        leaseExpiresAt: null,
        review: {
          ...run.review,
          state: "pending",
          artifactSha256: command.artifactSha256,
          approvals: [],
        },
      }),
    };
  }

  if (command.kind === "complete") {
    if (run.review.required && run.review.state !== "approved") {
      return deny(run, "review_required");
    }
    if (
      !SHA256.test(command.artifactSha256) ||
      command.artifactSha256 !== run.workingArtifactSha256 ||
      (run.review.required &&
        command.artifactSha256 !== run.review.artifactSha256)
    ) {
      return deny(run, "artifact_mismatch");
    }
    return {
      allowed: true,
      event: "succeeded",
      next: withCommonUpdate(run, command.now, {
        status: "succeeded",
        progressPercent: 100,
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
    };
  }

  if (command.kind === "fail") {
    if (
      !(AI_SAFE_ERROR_CODES as readonly string[]).includes(
        command.safeErrorCode,
      )
    ) {
      return deny(run, "run_invalid");
    }
    const exhausted = run.attempts >= definition.maxAttempts;
    if (command.retryable && !exhausted) {
      if (
        !command.retryAt ||
        !validIsoTimestamp(command.retryAt) ||
        Date.parse(command.retryAt) < nowMs ||
        Date.parse(command.retryAt) > Date.parse(run.deadlineAt)
      ) {
        return deny(run, "run_invalid");
      }
      return {
        allowed: true,
        event: "retry_scheduled",
        next: withCommonUpdate(run, command.now, {
          status: "retry_wait",
          nextEligibleAt: command.retryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastSafeErrorCode: command.safeErrorCode,
        }),
      };
    }
    return {
      allowed: true,
      event: exhausted && command.retryable ? "dead_lettered" : "failed",
      next: withCommonUpdate(run, command.now, {
        status: exhausted && command.retryable ? "dead_letter" : "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: command.safeErrorCode,
      }),
    };
  }

  return deny(run, "invalid_transition");
}

/**
 * A future adapter must provide atomic idempotent enqueue and compare-and-swap;
 * an in-memory implementation is not sufficient for production execution.
 */
export interface AiDurableExecutionStore {
  enqueueIfAbsent(input: AiDurableRun): Promise<{
    inserted: boolean;
    run: AiDurableRun;
  }>;
  loadForTenant(input: {
    tenantId: string;
    runId: string;
  }): Promise<AiDurableRun | null>;
  compareAndSwap(input: {
    tenantId: string;
    runId: string;
    expectedVersion: number;
    next: AiDurableRun;
    event: AiRunTransitionDecision["event"];
  }): Promise<boolean>;
  claimDue(input: {
    workerId: string;
    now: string;
    limit: number;
  }): Promise<AiDurableRun[]>;
}

export type AiTraceStage =
  | "policy"
  | "retrieval"
  | "routing"
  | "provider"
  | "grounding"
  | "human_review"
  | "settlement"
  | "completed";

export interface AiTraceEventInput {
  eventId: string;
  traceId: string;
  runId: string;
  tenantId: string;
  projectId: string;
  occurredAt: string;
  stage: AiTraceStage;
  outcome: "started" | "succeeded" | "blocked" | "failed" | "abstained";
  attempt: number;
  step: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costMinor: number;
  modelConfigurationVersion: string | null;
  promptVersion: string | null;
  retrievalManifestSha256: string | null;
  providerRequestIdSha256: string | null;
  safeErrorCode: AiSafeErrorCode | null;
}

export interface AiPrivacySafeTraceEvent extends AiTraceEventInput {
  payloadPolicy: "metadata_only_no_raw_content";
}

export type AiTraceEventDecision =
  | { accepted: true; event: AiPrivacySafeTraceEvent }
  | {
      accepted: false;
      code:
        | "trace_invalid"
        | "scope_invalid"
        | "metric_invalid"
        | "hash_invalid";
    };

export function createPrivacySafeAiTraceEvent(
  input: AiTraceEventInput,
): AiTraceEventDecision {
  if (
    !validIdentifier(input.eventId) ||
    !validIdentifier(input.traceId) ||
    !validIdentifier(input.runId) ||
    !validIsoTimestamp(input.occurredAt) ||
    !traceStages.has(input.stage) ||
    !traceOutcomes.has(input.outcome)
  ) {
    return { accepted: false, code: "trace_invalid" };
  }
  if (!validIdentifier(input.tenantId) || !validIdentifier(input.projectId)) {
    return { accepted: false, code: "scope_invalid" };
  }
  if (
    !validNonNegativeInteger(input.attempt) ||
    !validNonNegativeInteger(input.step) ||
    !validNonNegativeInteger(input.latencyMs) ||
    !validNonNegativeInteger(input.promptTokens) ||
    !validNonNegativeInteger(input.completionTokens) ||
    !validNonNegativeInteger(input.costMinor) ||
    (input.safeErrorCode != null &&
      !(AI_SAFE_ERROR_CODES as readonly string[]).includes(input.safeErrorCode))
  ) {
    return { accepted: false, code: "metric_invalid" };
  }
  if (
    (input.retrievalManifestSha256 != null &&
      !SHA256.test(input.retrievalManifestSha256)) ||
    (input.providerRequestIdSha256 != null &&
      !SHA256.test(input.providerRequestIdSha256))
  ) {
    return { accepted: false, code: "hash_invalid" };
  }
  if (
    (input.modelConfigurationVersion != null &&
      !validIdentifier(input.modelConfigurationVersion)) ||
    (input.promptVersion != null && !validIdentifier(input.promptVersion))
  ) {
    return { accepted: false, code: "trace_invalid" };
  }
  return {
    accepted: true,
    event: {
      eventId: input.eventId,
      traceId: input.traceId,
      runId: input.runId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      occurredAt: input.occurredAt,
      stage: input.stage,
      outcome: input.outcome,
      attempt: input.attempt,
      step: input.step,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      costMinor: input.costMinor,
      modelConfigurationVersion: input.modelConfigurationVersion,
      promptVersion: input.promptVersion,
      retrievalManifestSha256: input.retrievalManifestSha256,
      providerRequestIdSha256: input.providerRequestIdSha256,
      safeErrorCode: input.safeErrorCode,
      payloadPolicy: "metadata_only_no_raw_content",
    },
  };
}
