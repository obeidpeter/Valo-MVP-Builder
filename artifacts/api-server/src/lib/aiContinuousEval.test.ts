import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONTINUOUS_EVAL_FOUNDATION_STATUS,
  PRODUCTION_CONTINUOUS_EVAL_PROFILE,
  compareContinuousEvalRegression,
  computeConfidenceCalibration,
  evaluateContinuousAiCandidate,
  selectActiveLearningCases,
  validateContinuousEvalCorpus,
  type AiContinuousEvalCase,
  type AiContinuousEvalCorpus,
  type AiContinuousEvalObservation,
  type AiContinuousEvalReport,
  type AiEvalCohort,
  type AiPlatformEvalVersions,
} from "./aiContinuousEval";

const versions: AiPlatformEvalVersions = {
  model: "model-v1",
  modelConfiguration: "model-config-v1",
  prompt: "prompt-v1",
  schema: "schema-v1",
  retrieval: "retrieval-v1",
  index: "index-v1",
  policy: "policy-v1",
  corpus: "corpus-v1",
};

const cohorts: AiEvalCohort[] = [
  "representative",
  "fatal_requirement",
  "abstention",
  "ocr_table",
  "injection",
  "tenant_isolation",
  "cost_latency",
];

function evalCase(cohort: AiEvalCohort, index: number): AiContinuousEvalCase {
  const expectedDisposition =
    cohort === "abstention" ? "abstained" : "completed";
  const relevant = new Set<AiEvalCohort>([
    "representative",
    "fatal_requirement",
    "ocr_table",
    "cost_latency",
  ]).has(cohort);
  return {
    caseId: `case-${index}`,
    title: `${cohort} adjudicated fixture`,
    cohorts: [cohort],
    risk:
      cohort === "tenant_isolation" || cohort === "injection"
        ? "critical"
        : "medium",
    dataScope: "synthetic",
    dataApprovalReference: null,
    productionEligible: true,
    expectedDisposition,
    relevanceByChunkId: relevant ? { [`chunk-${index}`]: 3 } : {},
    annotation: {
      status: "adjudicated",
      annotatorIds: ["annotator-a", "annotator-b"],
      adjudicatorId: "adjudicator-c",
    },
  };
}

function corpus(): AiContinuousEvalCorpus {
  return {
    corpusId: "continuous-corpus",
    version: "corpus-v1",
    createdAt: "2026-08-10T12:00:00Z",
    cases: Array.from({ length: 28 }, (_, index) =>
      evalCase(cohorts[index % cohorts.length]!, index),
    ),
  };
}

function observation(
  seededCase: AiContinuousEvalCase,
  overrides: Partial<AiContinuousEvalObservation> = {},
): AiContinuousEvalObservation {
  const relevantIds = Object.keys(seededCase.relevanceByChunkId);
  const hasMaterialClaim = relevantIds.length > 0;
  return {
    caseId: seededCase.caseId,
    versions: { ...versions },
    disposition: seededCase.expectedDisposition,
    retrievedChunkIds: relevantIds,
    materialClaimCount: hasMaterialClaim ? 1 : 0,
    citedMaterialClaimCount: hasMaterialClaim ? 1 : 0,
    citationEvaluatedCount: hasMaterialClaim ? 1 : 0,
    citationCorrectCount: hasMaterialClaim ? 1 : 0,
    unsupportedMaterialClaimCount: 0,
    injectionContained: true,
    tenantLeakDetected: false,
    humanCorrect: true,
    calibratedConfidence: 0.98,
    latencyMs: 1_000,
    costMinor: 100,
    ...overrides,
  };
}

function passingReport(): AiContinuousEvalReport {
  const seededCorpus = corpus();
  return evaluateContinuousAiCandidate({
    corpus: seededCorpus,
    observations: seededCorpus.cases.map((seededCase) =>
      observation(seededCase),
    ),
    expectedVersions: versions,
  });
}

test("continuous evaluation is evidence only and cannot activate production", () => {
  assert.deepEqual(AI_CONTINUOUS_EVAL_FOUNDATION_STATUS, {
    runtimeConnected: false,
    evaluationWriterConnected: false,
    productionApproved: false,
    activation: "blocked",
  });
  const report = passingReport();
  assert.equal(report.evaluationPassed, true);
  assert.equal(report.productionActivationGranted, false);
  assert.equal(report.metrics.retrievalRecallAtK, 1);
  assert.equal(report.metrics.retrievalNdcgAtK, 1);
  assert.equal(report.metrics.citationPrecision, 1);
  assert.equal(report.metrics.citationCoverage, 1);
  assert.equal(report.metrics.injectionContainment, 1);
  assert.equal(report.metrics.tenantLeaks, 0);
  assert.deepEqual(report.blockers, []);
});

test("production corpus requires independent adjudication and approved redacted data", () => {
  const seeded = corpus();
  seeded.cases[0] = {
    ...seeded.cases[0]!,
    dataScope: "approved_redacted",
    dataApprovalReference: null,
    annotation: {
      status: "single_review",
      annotatorIds: ["annotator-a"],
      adjudicatorId: null,
    },
  };
  const result = validateContinuousEvalCorpus({
    corpus: seeded,
    profile: PRODUCTION_CONTINUOUS_EVAL_PROFILE,
  });
  assert.equal(result.valid, false);
  const codes = new Set(result.problems.map((problem) => problem.code));
  assert.equal(codes.has("production_case_not_adjudicated"), true);
  assert.equal(codes.has("data_approval_missing"), true);

  const nonIndependent = corpus();
  nonIndependent.cases[0]!.annotation.adjudicatorId = "annotator-a";
  assert.equal(
    validateContinuousEvalCorpus({
      corpus: nonIndependent,
      profile: PRODUCTION_CONTINUOUS_EVAL_PROFILE,
    }).problems.some(
      (problem) => problem.code === "reviewer_independence_missing",
    ),
    true,
  );
});

test("critical tenant, injection, and unsupported-claim failures are zero tolerance", () => {
  const seededCorpus = corpus();
  const observations = seededCorpus.cases.map((seededCase) =>
    observation(seededCase),
  );
  const injectionIndex = seededCorpus.cases.findIndex((seededCase) =>
    seededCase.cohorts.includes("injection"),
  );
  const tenantIndex = seededCorpus.cases.findIndex((seededCase) =>
    seededCase.cohorts.includes("tenant_isolation"),
  );
  observations[injectionIndex] = {
    ...observations[injectionIndex]!,
    injectionContained: false,
  };
  observations[tenantIndex] = {
    ...observations[tenantIndex]!,
    tenantLeakDetected: true,
  };
  observations[0] = {
    ...observations[0]!,
    unsupportedMaterialClaimCount: 1,
  };

  const report = evaluateContinuousAiCandidate({
    corpus: seededCorpus,
    observations,
    expectedVersions: versions,
  });
  assert.equal(report.evaluationPassed, false);
  const codes = new Set(report.blockers.map((blocker) => blocker.code));
  assert.equal(codes.has("tenant_leak_detected"), true);
  assert.equal(codes.has("injection_containment_below_floor"), true);
  assert.equal(codes.has("unsupported_claims_present"), true);
  assert.equal(report.productionActivationGranted, false);
});

test("calibration reports ECE and Brier score from human-labelled correctness", () => {
  const report = computeConfidenceCalibration({
    samples: [
      { confidence: 0.9, correct: true },
      { confidence: 0.1, correct: false },
    ],
    bucketCount: 10,
  });
  assert.equal(report.valid, true);
  assert.ok(Math.abs((report.expectedCalibrationError ?? 0) - 0.1) < 1e-12);
  assert.ok(Math.abs((report.brierScore ?? 0) - 0.01) < 1e-12);
  assert.equal(report.sampleCount, 2);

  assert.equal(
    computeConfidenceCalibration({
      samples: [{ confidence: Number.NaN, correct: true }],
    }).valid,
    false,
  );
});

test("regression comparison blocks quality loss even when a candidate is marked passing", () => {
  const baseline = passingReport();
  const candidate: AiContinuousEvalReport = {
    ...baseline,
    metrics: {
      ...baseline.metrics,
      retrievalRecallAtK: 0.8,
      retrievalNdcgAtK: 0.82,
      p95LatencyMs: 2_000,
      meanCostMinor: 140,
    },
  };
  const decision = compareContinuousEvalRegression({
    baseline,
    candidate,
    tolerance: {
      maxRecallDrop: 0.01,
      maxNdcgDrop: 0.01,
      maxCitationPrecisionDrop: 0,
      maxHumanAccuracyDrop: 0,
      maxCalibrationErrorIncrease: 0.01,
      maxLatencyIncreaseRatio: 0.2,
      maxCostIncreaseRatio: 0.2,
    },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons.includes("retrieval_recall_regression"), true);
  assert.equal(decision.reasons.includes("retrieval_ndcg_regression"), true);
  assert.equal(decision.reasons.includes("latency_regression"), true);
  assert.equal(decision.reasons.includes("cost_regression"), true);
});

test("active learning deterministically returns privacy-safe case IDs and reasons", () => {
  const seededCorpus = corpus();
  const observations = seededCorpus.cases.map((seededCase) =>
    observation(seededCase),
  );
  observations[0] = {
    ...observations[0]!,
    humanCorrect: false,
    calibratedConfidence: 0.95,
    unsupportedMaterialClaimCount: 1,
  };
  observations[1] = {
    ...observations[1]!,
    tenantLeakDetected: true,
  };
  const selected = selectActiveLearningCases({
    corpus: seededCorpus,
    observations,
    limit: 2,
  });
  assert.deepEqual(
    selected.map((selection) => selection.caseId),
    ["case-0", "case-1"],
  );
  assert.equal(selected[0]?.reasons.includes("unsupported_claim"), true);
  assert.equal(selected[0]?.reasons.includes("high_confidence_error"), true);
  assert.equal(selected[1]?.reasons.includes("tenant_leak"), true);
  assert.equal("content" in (selected[0] ?? {}), false);
  assert.equal("title" in (selected[0] ?? {}), false);
});

test("placeholder platform versions fail closed", () => {
  const seededCorpus = corpus();
  const invalidVersions = { ...versions, retrieval: "not_implemented" };
  const report = evaluateContinuousAiCandidate({
    corpus: seededCorpus,
    observations: seededCorpus.cases.map((seededCase) => ({
      ...observation(seededCase),
      versions: invalidVersions,
    })),
    expectedVersions: invalidVersions,
  });
  assert.equal(report.evaluationPassed, false);
  assert.equal(
    report.blockers.some((blocker) => blocker.code === "version_mismatch"),
    true,
  );
  assert.equal(report.productionActivationGranted, false);
});

test("production evaluation cannot pass without retrieval and citation evidence", () => {
  const seededCorpus = corpus();
  seededCorpus.cases = seededCorpus.cases.map((seededCase) => ({
    ...seededCase,
    relevanceByChunkId: {},
  }));
  const report = evaluateContinuousAiCandidate({
    corpus: seededCorpus,
    observations: seededCorpus.cases.map((seededCase) =>
      observation(seededCase),
    ),
    expectedVersions: versions,
  });
  assert.equal(report.evaluationPassed, false);
  const codes = new Set(report.blockers.map((blocker) => blocker.code));
  assert.equal(codes.has("retrieval_recall_below_floor"), true);
  assert.equal(codes.has("retrieval_ndcg_below_floor"), true);
  assert.equal(codes.has("citation_precision_below_floor"), true);
  assert.equal(codes.has("citation_coverage_below_floor"), true);
});

test("corpus versions, runtime booleans, and profile thresholds fail closed", () => {
  const mismatchedCorpus = corpus();
  mismatchedCorpus.version = "corpus-v2";
  const versionMismatch = evaluateContinuousAiCandidate({
    corpus: mismatchedCorpus,
    observations: mismatchedCorpus.cases.map((seededCase) =>
      observation(seededCase),
    ),
    expectedVersions: versions,
  });
  assert.equal(versionMismatch.evaluationPassed, false);
  assert.equal(
    versionMismatch.blockers.some(
      (blocker) => blocker.code === "version_mismatch",
    ),
    true,
  );

  const seededCorpus = corpus();
  const malformed = seededCorpus.cases.map((seededCase) =>
    observation(seededCase),
  );
  malformed[0] = {
    ...malformed[0]!,
    injectionContained: "true" as never,
  };
  const malformedReport = evaluateContinuousAiCandidate({
    corpus: seededCorpus,
    observations: malformed,
    expectedVersions: versions,
  });
  assert.equal(malformedReport.evaluationPassed, false);
  assert.equal(
    malformedReport.blockers.some(
      (blocker) => blocker.code === "observation_invalid",
    ),
    true,
  );

  assert.equal(
    Object.isFrozen(PRODUCTION_CONTINUOUS_EVAL_PROFILE.requiredCohorts),
    true,
  );
  const loweredProductionProfile = {
    ...PRODUCTION_CONTINUOUS_EVAL_PROFILE,
    minCitationPrecision: 0.5,
    minCitationCoverage: 0.5,
  };
  assert.equal(
    validateContinuousEvalCorpus({
      corpus: seededCorpus,
      profile: loweredProductionProfile,
    }).valid,
    false,
  );
  const loweredThresholdReport = evaluateContinuousAiCandidate({
    corpus: seededCorpus,
    observations: seededCorpus.cases.map((seededCase) =>
      observation(seededCase),
    ),
    expectedVersions: versions,
    profile: loweredProductionProfile,
  });
  assert.equal(loweredThresholdReport.evaluationPassed, false);
  assert.equal(
    loweredThresholdReport.blockers.some(
      (blocker) => blocker.code === "corpus_invalid",
    ),
    true,
  );
});
