import {
  EVAL_PRODUCTION_MIN_CORPUS,
  PRODUCTION_EVAL_PROFILE,
  aggregateReport,
  evaluateReportAgainstProfile,
  type CorpusValidationResult,
  type EvalReport,
} from "./evalHarness";

export interface AiReleaseVersions {
  model: string;
  modelConfiguration: string;
  prompt: string;
  promptRegistry: string;
  schema: string;
  retrieval: string;
  index: string;
}

export interface LiveEvaluationEvidence {
  runId: string;
  live: boolean;
  status: "passed" | "failed" | "incomplete";
  profile: "production" | "gate0_non_production";
  completedAt: string | null;
  versions: AiReleaseVersions;
  report: EvalReport;
  corpus: CorpusValidationResult;
}

export interface ProviderDecision {
  approved: boolean;
  provider: string;
  region: string;
  modelAllowlist: string[];
  trainingUseDisabled: boolean;
  retentionDays: number | null;
  approvalReference: string;
}

export interface PrivacyDecision {
  approved: boolean;
  residencyDecision: string;
  dpaReference: string;
  dpiaReference: string;
  retentionPolicyReference: string;
  redactionPolicyReference: string;
  approvalReference: string;
}

export interface BudgetDecision {
  approved: boolean;
  currency: string;
  maxCostPerRunMinor: number;
  maxMonthlyCostMinor: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxLatencyMs: number;
  rateCardVersion: string;
  inputCostMinorPerThousandTokens: number;
  outputCostMinorPerThousandTokens: number;
  approvalReference: string;
}

export interface RolloutDecision {
  globalKillSwitchReady: boolean;
  capabilityKillSwitchesReady: boolean;
  stagedRolloutConfigured: boolean;
  rollbackTested: boolean;
  owner: string;
  approvalReference: string;
}

export interface AiReleaseGateInput {
  expectedVersions: AiReleaseVersions;
  evaluation?: LiveEvaluationEvidence | null;
  provider?: ProviderDecision | null;
  privacy?: PrivacyDecision | null;
  budget?: BudgetDecision | null;
  rollout?: RolloutDecision | null;
}

export type AiReleaseBlockerCode =
  | "live_evaluation_missing"
  | "live_evaluation_incomplete"
  | "non_production_profile"
  | "corpus_ineligible"
  | "version_missing"
  | "version_mismatch"
  | "metric_gate_failed"
  | "provider_decision_missing"
  | "provider_decision_incomplete"
  | "privacy_decision_missing"
  | "privacy_decision_incomplete"
  | "budget_decision_missing"
  | "budget_decision_incomplete"
  | "rollout_control_missing"
  | "rollout_control_incomplete";

export interface AiReleaseBlocker {
  code: AiReleaseBlockerCode;
  message: string;
}

export interface AiReleaseGateResult {
  allowed: boolean;
  blockers: AiReleaseBlocker[];
}

const VERSION_KEYS: ReadonlyArray<keyof AiReleaseVersions> = [
  "model",
  "modelConfiguration",
  "prompt",
  "promptRegistry",
  "schema",
  "retrieval",
  "index",
];

const hasText = (value: string | null | undefined): boolean =>
  Boolean(value?.trim());

const PLACEHOLDER_VERSIONS = new Set([
  "latest",
  "none",
  "not_implemented",
  "n/a",
  "unknown",
  "unversioned",
]);

const hasPinnedVersion = (value: string | null | undefined): boolean =>
  hasText(value) && !PLACEHOLDER_VERSIONS.has(value!.trim().toLowerCase());

const positiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

const REPORT_SUMMARY_FIELDS: ReadonlyArray<keyof EvalReport> = [
  "totalGroundTruth",
  "totalMatched",
  "overallRecall",
  "mandatoryGroundTruth",
  "mandatoryMatched",
  "mandatoryRecall",
  "fatalGroundTruth",
  "fatalMatched",
  "fatalRecall",
  "fatalMisses",
  "totalCandidates",
  "matchedCandidates",
  "precision",
  "citationExpected",
  "citationEvaluated",
  "citationCorrect",
  "citationCoverage",
  "citationCorrectness",
  "unsupportedClaimsEvaluated",
  "unsupportedClaims",
  "supportEvaluationCoverage",
  "unsupportedClaimRate",
  "abstentionCases",
  "correctAbstentions",
  "abstentionAccuracy",
  "safeFailureCases",
  "correctSafeFailures",
  "safeFailureRate",
];

function sameReportSummary(left: EvalReport, right: EvalReport): boolean {
  return REPORT_SUMMARY_FIELDS.every((field) =>
    Object.is(left[field], right[field]),
  );
}

/**
 * Recomputes every release decision from supplied evidence. Stored "passed"
 * booleans are never trusted by themselves.
 */
export function evaluateAiRelease(
  input: AiReleaseGateInput,
): AiReleaseGateResult {
  const blockers: AiReleaseBlocker[] = [];
  const add = (code: AiReleaseBlockerCode, message: string): void => {
    blockers.push({ code, message });
  };

  for (const key of VERSION_KEYS) {
    if (!hasPinnedVersion(input.expectedVersions[key])) {
      add(
        "version_missing",
        `Expected ${key} version is missing or is an unpinned placeholder.`,
      );
    }
  }

  const evaluation = input.evaluation;
  if (!evaluation || !evaluation.live) {
    add(
      "live_evaluation_missing",
      "A retained live evaluation run is required.",
    );
  } else {
    if (
      evaluation.status !== "passed" ||
      !hasText(evaluation.runId) ||
      !hasText(evaluation.completedAt) ||
      !Number.isFinite(Date.parse(evaluation.completedAt ?? ""))
    ) {
      add(
        "live_evaluation_incomplete",
        "The live evaluation is failed, incomplete, or lacks retained identity/time evidence.",
      );
    }
    if (evaluation.profile !== "production") {
      add(
        "non_production_profile",
        "Gate-0 compatibility results cannot promote production AI.",
      );
    }
    if (
      !evaluation.corpus.passed ||
      !evaluation.corpus.productionEligible ||
      evaluation.corpus.caseCount < EVAL_PRODUCTION_MIN_CORPUS ||
      evaluation.corpus.problems.length > 0
    ) {
      add(
        "corpus_ineligible",
        "The evaluation corpus is not an authorised representative production holdout.",
      );
    }
    const evaluatedTenderIds = evaluation.report.perTender.map(
      (tender) => tender.tenderId,
    );
    const manifestTenderIds = evaluation.corpus.caseIds;
    const manifestTenderIdSet = new Set(manifestTenderIds);
    if (
      manifestTenderIds.length !== evaluation.corpus.caseCount ||
      manifestTenderIdSet.size !== manifestTenderIds.length ||
      evaluatedTenderIds.length !== evaluation.corpus.caseCount ||
      new Set(evaluatedTenderIds).size !== evaluatedTenderIds.length ||
      evaluatedTenderIds.some((tenderId) => !manifestTenderIdSet.has(tenderId))
    ) {
      add(
        "live_evaluation_incomplete",
        "The live report must contain one unique result for every manifest case.",
      );
    }
    for (const key of VERSION_KEYS) {
      if (!hasPinnedVersion(evaluation.versions[key])) {
        add(
          "version_missing",
          `Evaluation ${key} version is missing or is an unpinned placeholder.`,
        );
      } else if (evaluation.versions[key] !== input.expectedVersions[key]) {
        add(
          "version_mismatch",
          `Evaluation ${key} version does not match the release candidate.`,
        );
      }
    }
    const recomputedReport = aggregateReport(
      evaluation.report.perTender,
      PRODUCTION_EVAL_PROFILE.minimumOverallRecall,
    );
    if (!sameReportSummary(evaluation.report, recomputedReport)) {
      add(
        "live_evaluation_incomplete",
        "The stored report summary cannot be reproduced from its per-case results.",
      );
    }
    const suppliedMetricGate = evaluateReportAgainstProfile(
      evaluation.report,
      PRODUCTION_EVAL_PROFILE,
    );
    const recomputedMetricGate = evaluateReportAgainstProfile(
      recomputedReport,
      PRODUCTION_EVAL_PROFILE,
    );
    const metricFailures = new Map(
      [...suppliedMetricGate.failures, ...recomputedMetricGate.failures].map(
        (failure) => [failure.metric, failure],
      ),
    );
    for (const failure of metricFailures.values()) {
      add(
        "metric_gate_failed",
        `${failure.metric} was ${failure.actual ?? "not measured"}; required ${failure.expected}.`,
      );
    }
  }

  const provider = input.provider;
  if (!provider) {
    add(
      "provider_decision_missing",
      "An approved provider/model decision is required.",
    );
  } else if (
    !provider.approved ||
    !hasText(provider.provider) ||
    !hasText(provider.region) ||
    provider.modelAllowlist.length === 0 ||
    provider.modelAllowlist.some((model) => !hasPinnedVersion(model)) ||
    !provider.modelAllowlist.includes(input.expectedVersions.model) ||
    !provider.trainingUseDisabled ||
    provider.retentionDays === null ||
    !Number.isSafeInteger(provider.retentionDays) ||
    provider.retentionDays < 0 ||
    !hasText(provider.approvalReference)
  ) {
    add(
      "provider_decision_incomplete",
      "Provider, region, model allowlist, no-training, retention and approval evidence must all be decided.",
    );
  }

  const privacy = input.privacy;
  if (!privacy) {
    add(
      "privacy_decision_missing",
      "An approved privacy/residency decision is required.",
    );
  } else if (
    !privacy.approved ||
    !hasText(privacy.residencyDecision) ||
    !hasText(privacy.dpaReference) ||
    !hasText(privacy.dpiaReference) ||
    !hasText(privacy.retentionPolicyReference) ||
    !hasText(privacy.redactionPolicyReference) ||
    !hasText(privacy.approvalReference)
  ) {
    add(
      "privacy_decision_incomplete",
      "Residency, DPA/DPIA, retention, redaction and privacy approval evidence are incomplete.",
    );
  }

  const budget = input.budget;
  if (!budget) {
    add(
      "budget_decision_missing",
      "An approved AI budget and latency envelope is required.",
    );
  } else if (
    !budget.approved ||
    !hasText(budget.currency) ||
    !positiveInteger(budget.maxCostPerRunMinor) ||
    !positiveInteger(budget.maxMonthlyCostMinor) ||
    !positiveInteger(budget.maxInputTokens) ||
    !positiveInteger(budget.maxOutputTokens) ||
    !positiveInteger(budget.maxLatencyMs) ||
    !hasText(budget.rateCardVersion) ||
    !positiveInteger(budget.inputCostMinorPerThousandTokens) ||
    !positiveInteger(budget.outputCostMinorPerThousandTokens) ||
    budget.maxMonthlyCostMinor < budget.maxCostPerRunMinor ||
    !hasText(budget.approvalReference)
  ) {
    add(
      "budget_decision_incomplete",
      "Cost, token, latency and approval limits must be positive and explicit.",
    );
  }

  const rollout = input.rollout;
  if (!rollout) {
    add(
      "rollout_control_missing",
      "Kill-switch and rollback ownership evidence is required.",
    );
  } else if (
    !rollout.globalKillSwitchReady ||
    !rollout.capabilityKillSwitchesReady ||
    !rollout.stagedRolloutConfigured ||
    !rollout.rollbackTested ||
    !hasText(rollout.owner) ||
    !hasText(rollout.approvalReference)
  ) {
    add(
      "rollout_control_incomplete",
      "Global/capability kill switches, staged rollout, tested rollback, owner and approval evidence are incomplete.",
    );
  }

  return { allowed: blockers.length === 0, blockers };
}
