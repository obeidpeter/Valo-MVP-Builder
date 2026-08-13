import { createHash } from "node:crypto";
import {
  evaluationCases,
  evaluationResults,
  evaluationRuns,
  reviews,
} from "@workspace/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  PRODUCTION_CONTINUOUS_EVAL_PROFILE,
  PRODUCTION_CONTINUOUS_EVAL_PROFILE_VERSION,
  REQUIRED_CONTINUOUS_EVAL_COHORTS,
  type AiEvalCohort,
  type AiPlatformEvalVersions,
} from "../aiContinuousEval";
import {
  AI_CAPABILITY_IDS,
  AI_SAFE_ERROR_CODES,
  type AiCapabilityId,
  type AiSafeErrorCode,
} from "../aiPolicy";

/** Evaluation persistence is evidence only and cannot activate production AI. */
export const CONTINUOUS_EVALUATION_STORE_STATUS = Object.freeze({
  persistenceImplemented: true,
  runtimeConnected: false,
  releaseApprovalWriterConnected: false,
  productionActivationGranted: false,
  productionApproved: false,
  activation: "blocked" as const,
});

export type ContinuousEvaluationCase = typeof evaluationCases.$inferSelect;
export type ContinuousEvaluationRun = typeof evaluationRuns.$inferSelect;
export type ContinuousEvaluationResult = typeof evaluationResults.$inferSelect;
export type ContinuousEvaluationReview = typeof reviews.$inferSelect;

export type ContinuousEvaluationStoreErrorCode =
  | "invalid_scope"
  | "invalid_evaluation_input"
  | "not_found_or_not_authorized"
  | "version_mismatch"
  | "invalid_transition"
  | "result_conflict"
  | "completed_run_immutable"
  | "persistence_conflict";

const CONTINUOUS_EVALUATION_ERROR_MESSAGES: Record<
  ContinuousEvaluationStoreErrorCode,
  string
> = {
  invalid_scope: "The evaluation scope is invalid.",
  invalid_evaluation_input: "The evaluation control input is invalid.",
  not_found_or_not_authorized: "The evaluation record is unavailable.",
  version_mismatch: "The evaluation version binding does not match.",
  invalid_transition: "The evaluation transition is not allowed.",
  result_conflict: "A different result already exists for this case.",
  completed_run_immutable: "Completed evaluation runs are immutable.",
  persistence_conflict: "The evaluation transition could not be persisted.",
};

export class ContinuousEvaluationStoreError extends Error {
  readonly code: ContinuousEvaluationStoreErrorCode;

  constructor(code: ContinuousEvaluationStoreErrorCode) {
    super(CONTINUOUS_EVALUATION_ERROR_MESSAGES[code]);
    this.name = "ContinuousEvaluationStoreError";
    this.code = code;
  }
}

import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_V1_5_PATTERN as UUID,
} from "../identifierPatterns";
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLACEHOLDER_VERSION =
  /^(?:none|unknown|unset|draft|not[_-]implemented)$/i;
const CAPABILITIES = new Set<string>(AI_CAPABILITY_IDS);
const COHORTS = new Set<string>(REQUIRED_CONTINUOUS_EVAL_COHORTS);
const SAFE_ERROR_CODES = new Set<string>(AI_SAFE_ERROR_CODES);
const MAX_RESULTS_PER_EVALUATION_RUN = 100_000;
const EVALUATION_VERSION_KEYS = Object.freeze([
  "model",
  "modelConfiguration",
  "prompt",
  "schema",
  "retrieval",
  "index",
  "policy",
  "corpus",
] as const satisfies readonly (keyof AiPlatformEvalVersions)[]);

export interface ContinuousEvaluationScope {
  organisationId: string;
  projectId: string;
}

export type ContinuousEvaluationSplit =
  | "development"
  | "validation"
  | "holdout"
  | "red_team";
export type ContinuousEvaluationRisk = "low" | "medium" | "high" | "critical";
export type ContinuousEvaluationDisposition =
  | "completed"
  | "abstained"
  | "safe_failure";
export type ContinuousEvaluationDataScope = "synthetic" | "approved_redacted";

export interface ContinuousEvaluationCaseContract {
  cohorts: readonly AiEvalCohort[];
  risk: ContinuousEvaluationRisk;
  dataScope: ContinuousEvaluationDataScope;
  productionEligible: boolean;
  expectedDisposition: ContinuousEvaluationDisposition;
  labelDigest: string;
  fatalLabelCount: number;
  likelyFatalLabelCount: number;
  annotationStatus: "unverified" | "single_review" | "adjudicated";
  annotatorCount: number;
  independentlyAdjudicated: boolean;
}

export interface ContinuousEvaluationCreateCaseInput extends ContinuousEvaluationScope {
  corpusVersion: string;
  split: ContinuousEvaluationSplit;
  task: AiCapabilityId;
  /** Digest of an approved fixture; raw corpus content is never persisted here. */
  fixtureDigest: string;
  contract: ContinuousEvaluationCaseContract;
}

export interface ContinuousEvaluationCreateRunInput extends ContinuousEvaluationScope {
  task: AiCapabilityId;
  corpusVersion: string;
  modelConfigurationId: string;
  promptConfigurationId: string;
  expectedVersions: AiPlatformEvalVersions;
  profileVersion: string;
  cohorts: readonly AiEvalCohort[];
}

export interface ContinuousEvaluationStartRunInput extends ContinuousEvaluationScope {
  runId: string;
}

export type ContinuousEvaluationReviewerOutcome =
  | "confirmed"
  | "corrected"
  | "rejected"
  | "not_reviewable";

export type ContinuousEvaluationReviewerReason =
  | "grounding_correct"
  | "citation_incorrect"
  | "citation_missing"
  | "unsupported_claim"
  | "expected_abstention"
  | "unexpected_abstention"
  | "schema_failure"
  | "injection_failure"
  | "tenant_isolation_failure"
  | "insufficient_source_quality";

export interface ContinuousEvaluationReviewerObservation {
  reviewerUserId: string;
  outcome: ContinuousEvaluationReviewerOutcome;
  humanCorrect: boolean | null;
  reasonCodes: readonly ContinuousEvaluationReviewerReason[];
}

export interface ContinuousEvaluationCaseMetrics {
  disposition: ContinuousEvaluationDisposition;
  relevantChunkCount: number;
  retrievedRelevantChunkCount: number;
  retrievalNdcgAtK: number | null;
  materialClaimCount: number;
  citedMaterialClaimCount: number;
  citationEvaluatedCount: number;
  citationCorrectCount: number;
  unsupportedMaterialClaimCount: number;
  injectionContained: boolean;
  tenantLeakDetected: boolean;
  calibratedConfidence: number | null;
  latencyMs: number;
  costMinor: number;
}

export interface ContinuousEvaluationAppendResultInput extends ContinuousEvaluationScope {
  runId: string;
  caseId: string;
  fixtureDigest: string;
  caseContract: ContinuousEvaluationCaseContract;
  passed: boolean;
  metrics: ContinuousEvaluationCaseMetrics;
  outputHash?: string | null;
  errorCode?: AiSafeErrorCode | null;
  reviewer: ContinuousEvaluationReviewerObservation;
}

export interface ContinuousEvaluationAggregateMetrics {
  caseCount: number;
  passRate: number;
  expectedDispositionAccuracy: number | null;
  retrievalRecallAtK: number | null;
  retrievalNdcgAtK: number | null;
  citationPrecision: number | null;
  citationCoverage: number | null;
  unsupportedClaimRate: number | null;
  injectionContainment: number | null;
  tenantLeaks: number;
  humanAccuracy: number | null;
  expectedCalibrationError: number | null;
  brierScore: number | null;
  p95LatencyMs: number | null;
  meanCostMinor: number | null;
}

export type ContinuousEvaluationLimitationCode =
  | "small_sample"
  | "missing_human_labels"
  | "synthetic_only"
  | "ocr_coverage_limited"
  | "cohort_imbalance"
  | "cost_estimate_only"
  | "baseline_unavailable";

export interface ContinuousEvaluationCompleteRunInput extends ContinuousEvaluationScope {
  runId: string;
  limitations: readonly ContinuousEvaluationLimitationCode[];
}

export interface ContinuousEvaluationAbortRunInput extends ContinuousEvaluationScope {
  runId: string;
  errorCode: AiSafeErrorCode;
}

interface ContinuousEvaluationRunEnvelope {
  schemaVersion: "valo.continuous-evaluation.run.v1";
  projectId: string;
  expectedVersions: AiPlatformEvalVersions;
  profileVersion: string;
  cohorts: readonly AiEvalCohort[];
}

interface PersistedRunMetrics extends ContinuousEvaluationRunEnvelope {
  summary?: ContinuousEvaluationAggregateMetrics;
  cohortMetrics?: Partial<
    Readonly<Record<AiEvalCohort, ContinuousEvaluationAggregateMetrics>>
  >;
}

interface PersistedResultMetrics {
  schemaVersion: "valo.continuous-evaluation.result.v1";
  cohorts: readonly AiEvalCohort[];
  productionEligible: boolean;
  expectedDisposition: ContinuousEvaluationDisposition;
  disposition: ContinuousEvaluationDisposition;
  relevantChunkCount: number;
  retrievedRelevantChunkCount: number;
  retrievalNdcgAtK: number | null;
  materialClaimCount: number;
  citedMaterialClaimCount: number;
  citationEvaluatedCount: number;
  citationCorrectCount: number;
  unsupportedMaterialClaimCount: number;
  injectionContained: boolean;
  tenantLeakDetected: boolean;
  calibratedConfidence: number | null;
  latencyMs: number;
  costMinor: number;
  reviewerObservation: {
    reviewerUserId: string;
    outcome: ContinuousEvaluationReviewerOutcome;
    humanCorrect: boolean | null;
    reasonCodes: readonly ContinuousEvaluationReviewerReason[];
  };
}

interface EvaluationCasePersistenceInput extends ContinuousEvaluationCreateCaseInput {
  fixtureReference: string;
  labelHash: string;
  now: Date;
}

interface EvaluationRunPersistenceInput extends ContinuousEvaluationCreateRunInput {
  metricsJson: string;
  now: Date;
}

interface EvaluationResultPersistenceInput extends ContinuousEvaluationAppendResultInput {
  expectedSampleSize: number;
  passed: boolean;
  resultMetricsJson: string;
  now: Date;
}

interface EvaluationCompletePersistenceInput extends ContinuousEvaluationCompleteRunInput {
  expectedSampleSize: number;
  metricsJson: string;
  limitationsJson: string;
  now: Date;
}

interface EvaluationAbortPersistenceInput extends ContinuousEvaluationAbortRunInput {
  limitationsJson: string;
  now: Date;
}

export interface ContinuousEvaluationAppendResult {
  result: ContinuousEvaluationResult;
  review?: ContinuousEvaluationReview;
  inserted: boolean;
}

export interface ContinuousEvaluationCompletedRun {
  run: ContinuousEvaluationRun;
  evaluationPassed: boolean;
  releaseDecision: "pending";
  productionActivationGranted: false;
}

/** Atomic persistence boundary, injectable for deterministic unit tests. */
export interface ContinuousEvaluationRepository {
  createCase(
    input: EvaluationCasePersistenceInput,
  ): Promise<ContinuousEvaluationCase>;
  findCase(
    scope: ContinuousEvaluationScope,
    caseId: string,
  ): Promise<ContinuousEvaluationCase | null>;
  createRun(
    input: EvaluationRunPersistenceInput,
  ): Promise<ContinuousEvaluationRun>;
  findRun(
    scope: ContinuousEvaluationScope,
    runId: string,
  ): Promise<ContinuousEvaluationRun | null>;
  startRun(
    scope: ContinuousEvaluationScope,
    runId: string,
    now: Date,
  ): Promise<ContinuousEvaluationRun | null>;
  appendResult(
    input: EvaluationResultPersistenceInput,
  ): Promise<ContinuousEvaluationAppendResult | null>;
  /** Returns bounded, content-free result envelopes for authoritative aggregation. */
  listResults(
    scope: ContinuousEvaluationScope,
    runId: string,
    limit: number,
  ): Promise<ContinuousEvaluationResult[]>;
  completeRun(
    input: EvaluationCompletePersistenceInput,
  ): Promise<ContinuousEvaluationRun | null>;
  abortRun(
    input: EvaluationAbortPersistenceInput,
  ): Promise<ContinuousEvaluationRun | null>;
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, CanonicalValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(",")}}`;
}

function evaluationHash(value: CanonicalValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    VERSION.test(value) &&
    !PLACEHOLDER_VERSION.test(value)
  );
}

function validInteger(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

function validUnit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function validNullableUnit(value: unknown): value is number | null {
  return value === null || validUnit(value);
}

function assertScope(scope: ContinuousEvaluationScope): void {
  if (!validUuid(scope.organisationId) || !validUuid(scope.projectId)) {
    throw new ContinuousEvaluationStoreError("invalid_scope");
  }
}

function validVersions(versions: AiPlatformEvalVersions): boolean {
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
    return false;
  }
  const keys = Object.keys(versions).sort();
  const expectedKeys = [...EVALUATION_VERSION_KEYS].sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    EVALUATION_VERSION_KEYS.every((key) => validVersion(versions[key]))
  );
}

function validCohorts(cohorts: readonly AiEvalCohort[]): boolean {
  return (
    cohorts.length > 0 &&
    cohorts.length <= REQUIRED_CONTINUOUS_EVAL_COHORTS.length &&
    new Set(cohorts).size === cohorts.length &&
    cohorts.every((cohort) => COHORTS.has(cohort))
  );
}

function validCaseContract(
  contract: ContinuousEvaluationCaseContract,
): boolean {
  return (
    validCohorts(contract.cohorts) &&
    new Set(["low", "medium", "high", "critical"]).has(contract.risk) &&
    new Set(["synthetic", "approved_redacted"]).has(contract.dataScope) &&
    typeof contract.productionEligible === "boolean" &&
    new Set(["completed", "abstained", "safe_failure"]).has(
      contract.expectedDisposition,
    ) &&
    validHash(contract.labelDigest) &&
    validInteger(contract.fatalLabelCount, 100_000) &&
    validInteger(contract.likelyFatalLabelCount, 100_000) &&
    new Set(["unverified", "single_review", "adjudicated"]).has(
      contract.annotationStatus,
    ) &&
    validInteger(contract.annotatorCount, 100) &&
    typeof contract.independentlyAdjudicated === "boolean" &&
    (!contract.productionEligible ||
      (contract.annotationStatus === "adjudicated" &&
        contract.annotatorCount >= 2 &&
        contract.independentlyAdjudicated)) &&
    (contract.dataScope !== "approved_redacted" || contract.productionEligible)
  );
}

function caseHashMaterial(
  input: ContinuousEvaluationCreateCaseInput,
): CanonicalValue {
  return {
    schemaVersion: "valo.continuous-evaluation.case.v1",
    organisationId: input.organisationId,
    projectId: input.projectId,
    corpusVersion: input.corpusVersion,
    split: input.split,
    task: input.task,
    fixtureDigest: input.fixtureDigest,
    contract: {
      cohorts: [...input.contract.cohorts].sort(),
      risk: input.contract.risk,
      dataScope: input.contract.dataScope,
      productionEligible: input.contract.productionEligible,
      expectedDisposition: input.contract.expectedDisposition,
      labelDigest: input.contract.labelDigest,
      fatalLabelCount: input.contract.fatalLabelCount,
      likelyFatalLabelCount: input.contract.likelyFatalLabelCount,
      annotationStatus: input.contract.annotationStatus,
      annotatorCount: input.contract.annotatorCount,
      independentlyAdjudicated: input.contract.independentlyAdjudicated,
    },
  };
}

export function continuousEvaluationCaseLabelHash(
  input: ContinuousEvaluationCreateCaseInput,
): string {
  return evaluationHash(caseHashMaterial(input));
}

function fixtureReference(input: ContinuousEvaluationCreateCaseInput): string {
  return evaluationHash({
    schemaVersion: "valo.continuous-evaluation.fixture-reference.v1",
    organisationId: input.organisationId,
    projectId: input.projectId,
    corpusVersion: input.corpusVersion,
    task: input.task,
    fixtureDigest: input.fixtureDigest,
  });
}

function runEnvelope(
  input: ContinuousEvaluationCreateRunInput,
): ContinuousEvaluationRunEnvelope {
  return {
    schemaVersion: "valo.continuous-evaluation.run.v1",
    projectId: input.projectId,
    expectedVersions: { ...input.expectedVersions },
    profileVersion: input.profileVersion,
    cohorts: [...input.cohorts].sort(),
  };
}

function parseRunMetrics(
  run: ContinuousEvaluationRun,
): PersistedRunMetrics | null {
  if (!run.metrics) return null;
  try {
    const value = JSON.parse(run.metrics) as PersistedRunMetrics;
    if (
      value.schemaVersion !== "valo.continuous-evaluation.run.v1" ||
      !validUuid(value.projectId) ||
      !validVersions(value.expectedVersions) ||
      !validVersion(value.profileVersion) ||
      !validCohorts(value.cohorts)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function requireRun(
  run: ContinuousEvaluationRun | null,
  scope: ContinuousEvaluationScope,
): { run: ContinuousEvaluationRun; envelope: PersistedRunMetrics } {
  if (!run) {
    throw new ContinuousEvaluationStoreError("not_found_or_not_authorized");
  }
  const envelope = parseRunMetrics(run);
  if (!envelope || envelope.projectId !== scope.projectId) {
    throw new ContinuousEvaluationStoreError("not_found_or_not_authorized");
  }
  return { run, envelope };
}

function requireCase(
  evalCase: ContinuousEvaluationCase | null,
): ContinuousEvaluationCase {
  if (!evalCase) {
    throw new ContinuousEvaluationStoreError("not_found_or_not_authorized");
  }
  return evalCase;
}

function validCaseMetrics(metrics: ContinuousEvaluationCaseMetrics): boolean {
  const counts = [
    metrics.relevantChunkCount,
    metrics.retrievedRelevantChunkCount,
    metrics.materialClaimCount,
    metrics.citedMaterialClaimCount,
    metrics.citationEvaluatedCount,
    metrics.citationCorrectCount,
    metrics.unsupportedMaterialClaimCount,
    metrics.latencyMs,
    metrics.costMinor,
  ];
  return (
    new Set(["completed", "abstained", "safe_failure"]).has(
      metrics.disposition,
    ) &&
    counts.every((value) => validInteger(value, 1_000_000_000)) &&
    metrics.retrievedRelevantChunkCount <= metrics.relevantChunkCount &&
    metrics.citedMaterialClaimCount <= metrics.materialClaimCount &&
    metrics.citationCorrectCount <= metrics.citationEvaluatedCount &&
    metrics.unsupportedMaterialClaimCount <= metrics.materialClaimCount &&
    validNullableUnit(metrics.retrievalNdcgAtK) &&
    (metrics.relevantChunkCount === 0
      ? metrics.retrievalNdcgAtK === null
      : metrics.retrievalNdcgAtK !== null) &&
    metrics.citationEvaluatedCount === metrics.citedMaterialClaimCount &&
    typeof metrics.injectionContained === "boolean" &&
    typeof metrics.tenantLeakDetected === "boolean" &&
    validNullableUnit(metrics.calibratedConfidence)
  );
}

function validReviewer(
  reviewer: ContinuousEvaluationReviewerObservation,
): boolean {
  const reasons = new Set<ContinuousEvaluationReviewerReason>([
    "grounding_correct",
    "citation_incorrect",
    "citation_missing",
    "unsupported_claim",
    "expected_abstention",
    "unexpected_abstention",
    "schema_failure",
    "injection_failure",
    "tenant_isolation_failure",
    "insufficient_source_quality",
  ]);
  return (
    validUuid(reviewer.reviewerUserId) &&
    new Set(["confirmed", "corrected", "rejected", "not_reviewable"]).has(
      reviewer.outcome,
    ) &&
    (reviewer.humanCorrect === null ||
      typeof reviewer.humanCorrect === "boolean") &&
    reviewer.reasonCodes.length > 0 &&
    reviewer.reasonCodes.length <= reasons.size &&
    new Set(reviewer.reasonCodes).size === reviewer.reasonCodes.length &&
    reviewer.reasonCodes.every((reason) => reasons.has(reason)) &&
    (reviewer.outcome === "confirmed"
      ? reviewer.humanCorrect === true
      : reviewer.outcome === "not_reviewable"
        ? reviewer.humanCorrect === null
        : reviewer.humanCorrect === false)
  );
}

function derivedCasePassed(input: {
  expectedDisposition: ContinuousEvaluationDisposition;
  metrics: ContinuousEvaluationCaseMetrics;
  reviewer: ContinuousEvaluationReviewerObservation;
}): boolean {
  return (
    input.metrics.disposition === input.expectedDisposition &&
    input.metrics.unsupportedMaterialClaimCount === 0 &&
    input.metrics.injectionContained &&
    !input.metrics.tenantLeakDetected &&
    input.reviewer.outcome === "confirmed" &&
    input.reviewer.humanCorrect === true
  );
}

function resultMetricsJson(
  input: ContinuousEvaluationAppendResultInput,
): string {
  return canonicalJson({
    schemaVersion: "valo.continuous-evaluation.result.v1",
    cohorts: [...input.caseContract.cohorts].sort(),
    productionEligible: input.caseContract.productionEligible,
    expectedDisposition: input.caseContract.expectedDisposition,
    disposition: input.metrics.disposition,
    relevantChunkCount: input.metrics.relevantChunkCount,
    retrievedRelevantChunkCount: input.metrics.retrievedRelevantChunkCount,
    retrievalNdcgAtK: input.metrics.retrievalNdcgAtK,
    materialClaimCount: input.metrics.materialClaimCount,
    citedMaterialClaimCount: input.metrics.citedMaterialClaimCount,
    citationEvaluatedCount: input.metrics.citationEvaluatedCount,
    citationCorrectCount: input.metrics.citationCorrectCount,
    unsupportedMaterialClaimCount: input.metrics.unsupportedMaterialClaimCount,
    injectionContained: input.metrics.injectionContained,
    tenantLeakDetected: input.metrics.tenantLeakDetected,
    calibratedConfidence: input.metrics.calibratedConfidence,
    latencyMs: input.metrics.latencyMs,
    costMinor: input.metrics.costMinor,
    reviewerObservation: {
      reviewerUserId: input.reviewer.reviewerUserId,
      outcome: input.reviewer.outcome,
      humanCorrect: input.reviewer.humanCorrect,
      reasonCodes: [...input.reviewer.reasonCodes].sort(),
    },
  });
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseResultMetrics(value: string): PersistedResultMetrics | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    if (
      !exactKeys(record, [
        "schemaVersion",
        "cohorts",
        "productionEligible",
        "expectedDisposition",
        "disposition",
        "relevantChunkCount",
        "retrievedRelevantChunkCount",
        "retrievalNdcgAtK",
        "materialClaimCount",
        "citedMaterialClaimCount",
        "citationEvaluatedCount",
        "citationCorrectCount",
        "unsupportedMaterialClaimCount",
        "injectionContained",
        "tenantLeakDetected",
        "calibratedConfidence",
        "latencyMs",
        "costMinor",
        "reviewerObservation",
      ]) ||
      record.schemaVersion !== "valo.continuous-evaluation.result.v1" ||
      !Array.isArray(record.cohorts) ||
      typeof record.productionEligible !== "boolean" ||
      !new Set(["completed", "abstained", "safe_failure"]).has(
        record.expectedDisposition as string,
      ) ||
      !record.reviewerObservation ||
      typeof record.reviewerObservation !== "object" ||
      Array.isArray(record.reviewerObservation)
    ) {
      return null;
    }
    const reviewerRecord = record.reviewerObservation as Readonly<
      Record<string, unknown>
    >;
    if (
      !exactKeys(reviewerRecord, [
        "reviewerUserId",
        "outcome",
        "humanCorrect",
        "reasonCodes",
      ]) ||
      !Array.isArray(reviewerRecord.reasonCodes)
    ) {
      return null;
    }
    const metrics = {
      disposition: record.disposition,
      relevantChunkCount: record.relevantChunkCount,
      retrievedRelevantChunkCount: record.retrievedRelevantChunkCount,
      retrievalNdcgAtK: record.retrievalNdcgAtK,
      materialClaimCount: record.materialClaimCount,
      citedMaterialClaimCount: record.citedMaterialClaimCount,
      citationEvaluatedCount: record.citationEvaluatedCount,
      citationCorrectCount: record.citationCorrectCount,
      unsupportedMaterialClaimCount: record.unsupportedMaterialClaimCount,
      injectionContained: record.injectionContained,
      tenantLeakDetected: record.tenantLeakDetected,
      calibratedConfidence: record.calibratedConfidence,
      latencyMs: record.latencyMs,
      costMinor: record.costMinor,
    } as ContinuousEvaluationCaseMetrics;
    const reviewer = {
      reviewerUserId: reviewerRecord.reviewerUserId,
      outcome: reviewerRecord.outcome,
      humanCorrect: reviewerRecord.humanCorrect,
      reasonCodes: reviewerRecord.reasonCodes,
    } as ContinuousEvaluationReviewerObservation;
    const cohorts = record.cohorts as AiEvalCohort[];
    if (
      !validCohorts(cohorts) ||
      !validCaseMetrics(metrics) ||
      !validReviewer(reviewer)
    ) {
      return null;
    }
    return {
      schemaVersion: "valo.continuous-evaluation.result.v1",
      cohorts,
      productionEligible: record.productionEligible,
      expectedDisposition:
        record.expectedDisposition as ContinuousEvaluationDisposition,
      ...metrics,
      reviewerObservation: reviewer,
    };
  } catch {
    return null;
  }
}

interface ValidatedPersistedResult {
  result: ContinuousEvaluationResult;
  metrics: PersistedResultMetrics;
}

function validatePersistedResult(
  result: ContinuousEvaluationResult,
  runId: string,
): ValidatedPersistedResult | null {
  const metrics = parseResultMetrics(result.resultMetrics);
  if (
    !metrics ||
    result.evaluationRunId !== runId ||
    !validUuid(result.evaluationCaseId) ||
    typeof result.passed !== "boolean" ||
    (result.outputHash != null && !validHash(result.outputHash)) ||
    (result.errorCode != null && !SAFE_ERROR_CODES.has(result.errorCode)) ||
    (metrics.disposition === "completed" &&
      (result.outputHash == null || result.errorCode != null)) ||
    (metrics.disposition === "safe_failure" &&
      (result.errorCode == null || result.outputHash != null)) ||
    result.passed !==
      derivedCasePassed({
        expectedDisposition: metrics.expectedDisposition,
        metrics,
        reviewer: metrics.reviewerObservation,
      })
  ) {
    return null;
  }
  return { result, metrics };
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

function calibrationMetrics(values: readonly PersistedResultMetrics[]): {
  expectedCalibrationError: number | null;
  brierScore: number | null;
} {
  const samples = values.flatMap((value) =>
    value.calibratedConfidence == null ||
    value.reviewerObservation.humanCorrect == null
      ? []
      : [
          {
            confidence: value.calibratedConfidence,
            correct: value.reviewerObservation.humanCorrect,
          },
        ],
  );
  if (samples.length === 0) {
    return { expectedCalibrationError: null, brierScore: null };
  }
  let expectedCalibrationError = 0;
  for (let index = 0; index < 10; index += 1) {
    const lower = index / 10;
    const upper = (index + 1) / 10;
    const bucket = samples.filter(
      (sample) =>
        sample.confidence >= lower &&
        (index === 9 ? sample.confidence <= upper : sample.confidence < upper),
    );
    if (bucket.length === 0) continue;
    const confidence = mean(bucket.map((sample) => sample.confidence))!;
    const accuracy =
      bucket.filter((sample) => sample.correct).length / bucket.length;
    expectedCalibrationError +=
      (bucket.length / samples.length) * Math.abs(confidence - accuracy);
  }
  return {
    expectedCalibrationError,
    brierScore:
      samples.reduce(
        (sum, sample) =>
          sum + (sample.confidence - (sample.correct ? 1 : 0)) ** 2,
        0,
      ) / samples.length,
  };
}

function aggregateResults(
  values: readonly ValidatedPersistedResult[],
): ContinuousEvaluationAggregateMetrics {
  const metrics = values.map((value) => value.metrics);
  const materialClaimCount = metrics.reduce(
    (sum, value) => sum + value.materialClaimCount,
    0,
  );
  const citedMaterialClaimCount = metrics.reduce(
    (sum, value) => sum + value.citedMaterialClaimCount,
    0,
  );
  const citationEvaluatedCount = metrics.reduce(
    (sum, value) => sum + value.citationEvaluatedCount,
    0,
  );
  const citationCorrectCount = metrics.reduce(
    (sum, value) => sum + value.citationCorrectCount,
    0,
  );
  const unsupportedMaterialClaimCount = metrics.reduce(
    (sum, value) => sum + value.unsupportedMaterialClaimCount,
    0,
  );
  const injection = metrics.filter((value) =>
    value.cohorts.includes("injection"),
  );
  const calibration = calibrationMetrics(metrics);
  return {
    caseCount: values.length,
    passRate:
      values.length === 0
        ? 0
        : values.filter((value) => value.result.passed).length / values.length,
    expectedDispositionAccuracy: mean(
      metrics.map((value) =>
        value.disposition === value.expectedDisposition ? 1 : 0,
      ),
    ),
    retrievalRecallAtK: mean(
      metrics.flatMap((value) =>
        value.relevantChunkCount === 0
          ? []
          : [value.retrievedRelevantChunkCount / value.relevantChunkCount],
      ),
    ),
    retrievalNdcgAtK: mean(
      metrics.flatMap((value) =>
        value.retrievalNdcgAtK == null ? [] : [value.retrievalNdcgAtK],
      ),
    ),
    citationPrecision:
      citationEvaluatedCount === 0
        ? null
        : citationCorrectCount / citationEvaluatedCount,
    citationCoverage:
      materialClaimCount === 0
        ? null
        : citedMaterialClaimCount / materialClaimCount,
    unsupportedClaimRate:
      materialClaimCount === 0
        ? 0
        : unsupportedMaterialClaimCount / materialClaimCount,
    injectionContainment:
      injection.length === 0
        ? null
        : injection.filter((value) => value.injectionContained).length /
          injection.length,
    tenantLeaks: metrics.filter((value) => value.tenantLeakDetected).length,
    humanAccuracy: mean(
      metrics.flatMap((value) =>
        value.reviewerObservation.humanCorrect == null
          ? []
          : [value.reviewerObservation.humanCorrect ? 1 : 0],
      ),
    ),
    ...calibration,
    p95LatencyMs: p95(metrics.map((value) => value.latencyMs)),
    meanCostMinor: mean(metrics.map((value) => value.costMinor)),
  };
}

function safelyPassesProductionProfile(
  summary: ContinuousEvaluationAggregateMetrics,
): boolean {
  const profile = PRODUCTION_CONTINUOUS_EVAL_PROFILE;
  return (
    summary.caseCount >= profile.minCaseCount &&
    summary.passRate === 1 &&
    summary.expectedDispositionAccuracy != null &&
    summary.expectedDispositionAccuracy >=
      profile.minExpectedDispositionAccuracy &&
    summary.retrievalRecallAtK != null &&
    summary.retrievalRecallAtK >= profile.minRetrievalRecallAtK &&
    summary.retrievalNdcgAtK != null &&
    summary.retrievalNdcgAtK >= profile.minRetrievalNdcgAtK &&
    summary.citationPrecision != null &&
    summary.citationPrecision >= profile.minCitationPrecision &&
    summary.citationCoverage != null &&
    summary.citationCoverage >= profile.minCitationCoverage &&
    summary.unsupportedClaimRate != null &&
    summary.unsupportedClaimRate <= profile.maxUnsupportedClaimRate &&
    summary.injectionContainment != null &&
    summary.injectionContainment >= profile.minInjectionContainment &&
    summary.tenantLeaks <= profile.maxTenantLeaks &&
    summary.humanAccuracy != null &&
    summary.humanAccuracy >= profile.minHumanAccuracy &&
    summary.expectedCalibrationError != null &&
    summary.expectedCalibrationError <= profile.maxExpectedCalibrationError &&
    summary.brierScore != null &&
    summary.brierScore <= profile.maxBrierScore &&
    summary.p95LatencyMs != null &&
    summary.p95LatencyMs <= profile.maxP95LatencyMs &&
    summary.meanCostMinor != null &&
    summary.meanCostMinor <= profile.maxMeanCostMinor
  );
}

export class ContinuousEvaluationStore {
  constructor(
    private readonly repository: ContinuousEvaluationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCase(
    input: ContinuousEvaluationCreateCaseInput,
  ): Promise<ContinuousEvaluationCase> {
    assertScope(input);
    if (
      !CAPABILITIES.has(input.task) ||
      !validVersion(input.corpusVersion) ||
      !new Set(["development", "validation", "holdout", "red_team"]).has(
        input.split,
      ) ||
      !validHash(input.fixtureDigest) ||
      !validCaseContract(input.contract)
    ) {
      throw new ContinuousEvaluationStoreError("invalid_evaluation_input");
    }
    return this.repository.createCase({
      ...input,
      fixtureReference: fixtureReference(input),
      labelHash: continuousEvaluationCaseLabelHash(input),
      now: this.now(),
    });
  }

  async createRun(
    input: ContinuousEvaluationCreateRunInput,
  ): Promise<ContinuousEvaluationRun> {
    assertScope(input);
    if (
      !CAPABILITIES.has(input.task) ||
      !validVersion(input.corpusVersion) ||
      !validUuid(input.modelConfigurationId) ||
      !validUuid(input.promptConfigurationId) ||
      !validVersions(input.expectedVersions) ||
      input.expectedVersions.corpus !== input.corpusVersion ||
      !validVersion(input.profileVersion) ||
      !validCohorts(input.cohorts)
    ) {
      throw new ContinuousEvaluationStoreError("invalid_evaluation_input");
    }
    const envelope = runEnvelope(input);
    return this.repository.createRun({
      ...input,
      metricsJson: canonicalJson(
        envelope as unknown as Readonly<Record<string, CanonicalValue>>,
      ),
      now: this.now(),
    });
  }

  async startRun(
    input: ContinuousEvaluationStartRunInput,
  ): Promise<ContinuousEvaluationRun> {
    assertScope(input);
    if (!validUuid(input.runId)) {
      throw new ContinuousEvaluationStoreError("invalid_evaluation_input");
    }
    const { run } = requireRun(
      await this.repository.findRun(input, input.runId),
      input,
    );
    if (run.status === "completed") {
      throw new ContinuousEvaluationStoreError("completed_run_immutable");
    }
    if (run.status !== "draft") {
      throw new ContinuousEvaluationStoreError("invalid_transition");
    }
    const started = await this.repository.startRun(
      input,
      input.runId,
      this.now(),
    );
    if (!started)
      throw new ContinuousEvaluationStoreError("persistence_conflict");
    return started;
  }

  async appendResult(
    input: ContinuousEvaluationAppendResultInput,
  ): Promise<ContinuousEvaluationAppendResult> {
    assertScope(input);
    const derivedPassed =
      validCaseContract(input.caseContract) &&
      validCaseMetrics(input.metrics) &&
      validReviewer(input.reviewer)
        ? derivedCasePassed({
            expectedDisposition: input.caseContract.expectedDisposition,
            metrics: input.metrics,
            reviewer: input.reviewer,
          })
        : null;
    if (
      !validUuid(input.runId) ||
      !validUuid(input.caseId) ||
      !validHash(input.fixtureDigest) ||
      typeof input.passed !== "boolean" ||
      !validCaseContract(input.caseContract) ||
      !validCaseMetrics(input.metrics) ||
      !validReviewer(input.reviewer) ||
      derivedPassed == null ||
      input.passed !== derivedPassed ||
      (input.outputHash != null && !validHash(input.outputHash)) ||
      (input.errorCode != null && !SAFE_ERROR_CODES.has(input.errorCode)) ||
      (input.metrics.disposition === "completed" &&
        (input.outputHash == null || input.errorCode != null)) ||
      (input.metrics.disposition === "safe_failure" &&
        (input.errorCode == null || input.outputHash != null))
    ) {
      throw new ContinuousEvaluationStoreError("invalid_evaluation_input");
    }
    const { run, envelope } = requireRun(
      await this.repository.findRun(input, input.runId),
      input,
    );
    if (run.status === "completed") {
      throw new ContinuousEvaluationStoreError("completed_run_immutable");
    }
    if (run.status !== "running") {
      throw new ContinuousEvaluationStoreError("invalid_transition");
    }
    if (run.sampleSize >= MAX_RESULTS_PER_EVALUATION_RUN) {
      throw new ContinuousEvaluationStoreError("invalid_transition");
    }
    const evalCase = requireCase(
      await this.repository.findCase(input, input.caseId),
    );
    const expectedLabelHash = continuousEvaluationCaseLabelHash({
      organisationId: input.organisationId,
      projectId: input.projectId,
      corpusVersion: evalCase.corpusVersion,
      split: evalCase.split as ContinuousEvaluationSplit,
      task: evalCase.task as AiCapabilityId,
      fixtureDigest: input.fixtureDigest,
      contract: input.caseContract,
    });
    if (
      evalCase.organisationId !== input.organisationId ||
      evalCase.task !== run.task ||
      evalCase.corpusVersion !== run.corpusVersion ||
      envelope.expectedVersions.corpus !== run.corpusVersion ||
      !input.caseContract.cohorts.every((cohort) =>
        envelope.cohorts.includes(cohort),
      )
    ) {
      throw new ContinuousEvaluationStoreError("version_mismatch");
    }
    if (
      evalCase.labelHash !== expectedLabelHash ||
      evalCase.fixtureReference !==
        fixtureReference({
          organisationId: input.organisationId,
          projectId: input.projectId,
          corpusVersion: evalCase.corpusVersion,
          split: evalCase.split as ContinuousEvaluationSplit,
          task: evalCase.task as AiCapabilityId,
          fixtureDigest: input.fixtureDigest,
          contract: input.caseContract,
        })
    ) {
      throw new ContinuousEvaluationStoreError("version_mismatch");
    }
    const metricsJson = resultMetricsJson(input);
    const persisted = await this.repository.appendResult({
      ...input,
      passed: derivedPassed,
      expectedSampleSize: run.sampleSize,
      resultMetricsJson: metricsJson,
      now: this.now(),
    });
    if (!persisted) {
      throw new ContinuousEvaluationStoreError("persistence_conflict");
    }
    if (
      !persisted.inserted &&
      (persisted.result.evaluationRunId !== input.runId ||
        persisted.result.evaluationCaseId !== input.caseId ||
        persisted.result.passed !== derivedPassed ||
        persisted.result.resultMetrics !== metricsJson ||
        persisted.result.outputHash !== (input.outputHash ?? null) ||
        persisted.result.errorCode !== (input.errorCode ?? null))
    ) {
      throw new ContinuousEvaluationStoreError("result_conflict");
    }
    return persisted;
  }

  async completeRun(
    input: ContinuousEvaluationCompleteRunInput,
  ): Promise<ContinuousEvaluationCompletedRun> {
    assertScope(input);
    const limitationCodes = new Set<ContinuousEvaluationLimitationCode>([
      "small_sample",
      "missing_human_labels",
      "synthetic_only",
      "ocr_coverage_limited",
      "cohort_imbalance",
      "cost_estimate_only",
      "baseline_unavailable",
    ]);
    if (
      !validUuid(input.runId) ||
      input.limitations.length > limitationCodes.size ||
      new Set(input.limitations).size !== input.limitations.length ||
      !input.limitations.every((code) => limitationCodes.has(code))
    ) {
      throw new ContinuousEvaluationStoreError("invalid_evaluation_input");
    }
    const { run, envelope } = requireRun(
      await this.repository.findRun(input, input.runId),
      input,
    );
    if (run.status === "completed") {
      throw new ContinuousEvaluationStoreError("completed_run_immutable");
    }
    if (run.status !== "running" || run.sampleSize === 0) {
      throw new ContinuousEvaluationStoreError("invalid_transition");
    }
    if (run.sampleSize > MAX_RESULTS_PER_EVALUATION_RUN) {
      throw new ContinuousEvaluationStoreError("persistence_conflict");
    }
    const persistedResults = await this.repository.listResults(
      input,
      input.runId,
      Math.min(run.sampleSize + 1, MAX_RESULTS_PER_EVALUATION_RUN + 1),
    );
    const uniqueCaseIds = new Set(
      persistedResults.map((result) => result.evaluationCaseId),
    );
    const validatedResults = persistedResults.map((result) =>
      validatePersistedResult(result, input.runId),
    );
    if (
      persistedResults.length !== run.sampleSize ||
      uniqueCaseIds.size !== persistedResults.length ||
      validatedResults.some((result) => result == null)
    ) {
      throw new ContinuousEvaluationStoreError("persistence_conflict");
    }
    const results = validatedResults as ValidatedPersistedResult[];
    const summary = aggregateResults(results);
    const cohortMetrics = Object.fromEntries(
      envelope.cohorts.map((cohort) => [
        cohort,
        aggregateResults(
          results.filter((result) => result.metrics.cohorts.includes(cohort)),
        ),
      ]),
    ) as Readonly<Record<AiEvalCohort, ContinuousEvaluationAggregateMetrics>>;
    const canonicalCohorts = Object.fromEntries(
      Object.entries(cohortMetrics)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([cohort, metrics]) => [cohort, { ...metrics } as CanonicalValue]),
    ) as Readonly<Record<string, CanonicalValue>>;
    const metricsJson = canonicalJson({
      ...envelope,
      summary: { ...summary } as CanonicalValue,
      cohortMetrics: canonicalCohorts,
    } as unknown as Readonly<Record<string, CanonicalValue>>);
    const completed = await this.repository.completeRun({
      ...input,
      expectedSampleSize: run.sampleSize,
      metricsJson,
      limitationsJson: canonicalJson({
        schemaVersion: "valo.continuous-evaluation.limitations.v1",
        codes: [...input.limitations].sort(),
      }),
      now: this.now(),
    });
    if (!completed) {
      throw new ContinuousEvaluationStoreError("persistence_conflict");
    }
    return {
      run: completed,
      evaluationPassed:
        envelope.profileVersion ===
          PRODUCTION_CONTINUOUS_EVAL_PROFILE_VERSION &&
        REQUIRED_CONTINUOUS_EVAL_COHORTS.every(
          (cohort) => cohortMetrics[cohort]?.caseCount > 0,
        ) &&
        results.every((result) => result.metrics.productionEligible) &&
        safelyPassesProductionProfile(summary),
      releaseDecision: "pending",
      productionActivationGranted: false,
    };
  }

  async abortRun(
    input: ContinuousEvaluationAbortRunInput,
  ): Promise<ContinuousEvaluationRun> {
    assertScope(input);
    if (!validUuid(input.runId) || !SAFE_ERROR_CODES.has(input.errorCode)) {
      throw new ContinuousEvaluationStoreError("invalid_evaluation_input");
    }
    const { run } = requireRun(
      await this.repository.findRun(input, input.runId),
      input,
    );
    if (run.status === "completed") {
      throw new ContinuousEvaluationStoreError("completed_run_immutable");
    }
    if (run.status !== "draft" && run.status !== "running") {
      throw new ContinuousEvaluationStoreError("invalid_transition");
    }
    const failed = await this.repository.abortRun({
      ...input,
      limitationsJson: canonicalJson({
        schemaVersion: "valo.continuous-evaluation.abort.v1",
        errorCode: input.errorCode,
      }),
      now: this.now(),
    });
    if (!failed)
      throw new ContinuousEvaluationStoreError("persistence_conflict");
    return failed;
  }
}

export class DrizzleContinuousEvaluationRepository implements ContinuousEvaluationRepository {
  private async database(): Promise<(typeof import("@workspace/db"))["db"]> {
    return (await import("@workspace/db")).db;
  }

  async createCase(
    input: EvaluationCasePersistenceInput,
  ): Promise<ContinuousEvaluationCase> {
    const database = await this.database();
    const [inserted] = await database
      .insert(evaluationCases)
      .values({
        organisationId: input.organisationId,
        corpusVersion: input.corpusVersion,
        split: input.split,
        task: input.task,
        fixtureReference: input.fixtureReference,
        labelHash: input.labelHash,
        fatalLabelCount: input.contract.fatalLabelCount,
        likelyFatalLabelCount: input.contract.likelyFatalLabelCount,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const [existing] = await database
      .select()
      .from(evaluationCases)
      .where(
        and(
          eq(evaluationCases.organisationId, input.organisationId),
          eq(evaluationCases.corpusVersion, input.corpusVersion),
          eq(evaluationCases.fixtureReference, input.fixtureReference),
        ),
      );
    if (!existing || existing.labelHash !== input.labelHash) {
      throw new ContinuousEvaluationStoreError("result_conflict");
    }
    return existing;
  }

  async findCase(
    scope: ContinuousEvaluationScope,
    caseId: string,
  ): Promise<ContinuousEvaluationCase | null> {
    const database = await this.database();
    const [evalCase] = await database
      .select()
      .from(evaluationCases)
      .where(
        and(
          eq(evaluationCases.id, caseId),
          eq(evaluationCases.organisationId, scope.organisationId),
        ),
      );
    return evalCase ?? null;
  }

  async createRun(
    input: EvaluationRunPersistenceInput,
  ): Promise<ContinuousEvaluationRun> {
    const database = await this.database();
    const [run] = await database
      .insert(evaluationRuns)
      .values({
        organisationId: input.organisationId,
        task: input.task,
        corpusVersion: input.corpusVersion,
        modelConfigurationId: input.modelConfigurationId,
        promptConfigurationId: input.promptConfigurationId,
        status: "draft",
        sampleSize: 0,
        metrics: input.metricsJson,
        limitations: null,
        releaseDecision: "pending",
        startedAt: input.now,
      })
      .returning();
    if (!run) throw new ContinuousEvaluationStoreError("persistence_conflict");
    return run;
  }

  async findRun(
    scope: ContinuousEvaluationScope,
    runId: string,
  ): Promise<ContinuousEvaluationRun | null> {
    const database = await this.database();
    const [run] = await database
      .select()
      .from(evaluationRuns)
      .where(
        and(
          eq(evaluationRuns.id, runId),
          eq(evaluationRuns.organisationId, scope.organisationId),
        ),
      );
    return run ?? null;
  }

  async startRun(
    scope: ContinuousEvaluationScope,
    runId: string,
    now: Date,
  ): Promise<ContinuousEvaluationRun | null> {
    const database = await this.database();
    const [run] = await database
      .update(evaluationRuns)
      .set({ status: "running", startedAt: now })
      .where(
        and(
          eq(evaluationRuns.id, runId),
          eq(evaluationRuns.organisationId, scope.organisationId),
          eq(evaluationRuns.status, "draft"),
          eq(evaluationRuns.releaseDecision, "pending"),
        ),
      )
      .returning();
    return run ?? null;
  }

  async appendResult(
    input: EvaluationResultPersistenceInput,
  ): Promise<ContinuousEvaluationAppendResult | null> {
    const database = await this.database();
    return database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(evaluationResults)
        .where(
          and(
            eq(evaluationResults.evaluationRunId, input.runId),
            eq(evaluationResults.evaluationCaseId, input.caseId),
          ),
        );
      if (existing) return { result: existing, inserted: false };
      const [active] = await transaction
        .select({
          id: evaluationRuns.id,
          sampleSize: evaluationRuns.sampleSize,
        })
        .from(evaluationRuns)
        .where(
          and(
            eq(evaluationRuns.id, input.runId),
            eq(evaluationRuns.organisationId, input.organisationId),
            eq(evaluationRuns.status, "running"),
            eq(evaluationRuns.releaseDecision, "pending"),
            eq(evaluationRuns.sampleSize, input.expectedSampleSize),
            lt(evaluationRuns.sampleSize, MAX_RESULTS_PER_EVALUATION_RUN),
          ),
        );
      if (!active) return null;
      const [inserted] = await transaction
        .insert(evaluationResults)
        .values({
          evaluationRunId: input.runId,
          evaluationCaseId: input.caseId,
          passed: input.passed,
          resultMetrics: input.resultMetricsJson,
          outputHash: input.outputHash ?? null,
          errorCode: input.errorCode ?? null,
          createdAt: input.now,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [concurrent] = await transaction
          .select()
          .from(evaluationResults)
          .where(
            and(
              eq(evaluationResults.evaluationRunId, input.runId),
              eq(evaluationResults.evaluationCaseId, input.caseId),
            ),
          );
        if (!concurrent) {
          throw new ContinuousEvaluationStoreError("persistence_conflict");
        }
        return { result: concurrent, inserted: false };
      }
      const [updated] = await transaction
        .update(evaluationRuns)
        .set({ sampleSize: sql`${evaluationRuns.sampleSize} + 1` })
        .where(
          and(
            eq(evaluationRuns.id, input.runId),
            eq(evaluationRuns.organisationId, input.organisationId),
            eq(evaluationRuns.status, "running"),
            eq(evaluationRuns.releaseDecision, "pending"),
            eq(evaluationRuns.sampleSize, input.expectedSampleSize),
            lt(evaluationRuns.sampleSize, MAX_RESULTS_PER_EVALUATION_RUN),
          ),
        )
        .returning({ id: evaluationRuns.id });
      if (!updated) {
        throw new ContinuousEvaluationStoreError("persistence_conflict");
      }
      const [review] = await transaction
        .insert(reviews)
        .values({
          organisationId: input.organisationId,
          projectId: input.projectId,
          reviewType: "ai_evaluation_observation",
          objectType: "evaluation_result",
          objectId: inserted.id,
          reviewerUserId: input.reviewer.reviewerUserId,
          status: "completed",
          findings: canonicalJson({
            schemaVersion: "valo.continuous-evaluation.review.v1",
            outcome: input.reviewer.outcome,
            humanCorrect: input.reviewer.humanCorrect,
            reasonCodes: [...input.reviewer.reasonCodes].sort(),
          }),
          sourceVersion: 1,
          completedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!review) {
        throw new ContinuousEvaluationStoreError("persistence_conflict");
      }
      return { result: inserted, review, inserted: true };
    });
  }

  async listResults(
    scope: ContinuousEvaluationScope,
    runId: string,
    limit: number,
  ): Promise<ContinuousEvaluationResult[]> {
    const database = await this.database();
    const [scopedRun] = await database
      .select({ id: evaluationRuns.id })
      .from(evaluationRuns)
      .where(
        and(
          eq(evaluationRuns.id, runId),
          eq(evaluationRuns.organisationId, scope.organisationId),
        ),
      );
    if (!scopedRun) return [];
    return database
      .select()
      .from(evaluationResults)
      .where(eq(evaluationResults.evaluationRunId, runId))
      .orderBy(evaluationResults.id)
      .limit(limit);
  }

  async completeRun(
    input: EvaluationCompletePersistenceInput,
  ): Promise<ContinuousEvaluationRun | null> {
    const database = await this.database();
    const [run] = await database
      .update(evaluationRuns)
      .set({
        status: "completed",
        metrics: input.metricsJson,
        limitations: input.limitationsJson,
        releaseDecision: "pending",
        completedAt: input.now,
      })
      .where(
        and(
          eq(evaluationRuns.id, input.runId),
          eq(evaluationRuns.organisationId, input.organisationId),
          eq(evaluationRuns.status, "running"),
          eq(evaluationRuns.releaseDecision, "pending"),
          eq(evaluationRuns.sampleSize, input.expectedSampleSize),
        ),
      )
      .returning();
    return run ?? null;
  }

  async abortRun(
    input: EvaluationAbortPersistenceInput,
  ): Promise<ContinuousEvaluationRun | null> {
    const database = await this.database();
    const [run] = await database
      .update(evaluationRuns)
      .set({
        status: "failed",
        limitations: input.limitationsJson,
        releaseDecision: "pending",
        completedAt: input.now,
      })
      .where(
        and(
          eq(evaluationRuns.id, input.runId),
          eq(evaluationRuns.organisationId, input.organisationId),
          sql`${evaluationRuns.status} IN ('draft', 'running')`,
          eq(evaluationRuns.releaseDecision, "pending"),
        ),
      )
      .returning();
    return run ?? null;
  }
}

export function createContinuousEvaluationStore(input?: {
  repository?: ContinuousEvaluationRepository;
  now?: () => Date;
}): ContinuousEvaluationStore {
  return new ContinuousEvaluationStore(
    input?.repository ?? new DrizzleContinuousEvaluationRepository(),
    input?.now,
  );
}
