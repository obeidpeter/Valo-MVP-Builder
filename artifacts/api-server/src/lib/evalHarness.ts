/**
 * Pure, provider-free AI evaluation primitives.
 *
 * Gate 0 remains available as an explicitly non-production compatibility
 * profile. Production promotion uses the stricter profile and a separately
 * validated, authorised corpus manifest.
 */

export const EVAL_RECALL_TARGET_V0 = 0.85;
export const EVAL_MIN_CORPUS = 10;
export const EVAL_PRODUCTION_MIN_CORPUS = 25;

export type RequirementSeverity =
  | "fatal"
  | "likely_fatal"
  | "material"
  | "non_material";

export interface GroundTruthRequirement {
  id: string;
  label: string;
  mandatory: boolean;
  severity?: RequirementSeverity;
  /** AND-of-ORs phrase groups used by the deterministic matcher. */
  match: string[][];
}

export type ExpectedEvalBehaviour = "extract" | "abstain" | "safe_failure";

export interface EvalTender {
  id: string;
  title: string;
  documentText: string;
  groundTruth: GroundTruthRequirement[];
  expectedBehaviour?: ExpectedEvalBehaviour;
}

export type CitationVerdict =
  | "correct"
  | "incorrect"
  | "missing"
  | "unverified"
  | "not_applicable";

export interface ExtractedRequirementCandidate {
  text: string;
  /** Must come from an independent citation resolver, never model confidence. */
  citationVerdict?: CitationVerdict;
  /** Must come from a human label or deterministic claim resolver. */
  unsupportedClaim?: boolean;
}

export interface EvalModelOutput {
  requirements: ExtractedRequirementCandidate[];
  disposition: "completed" | "abstained" | "safe_failure";
}

export interface TenderRecall {
  tenderId: string;
  title: string;
  total: number;
  matched: number;
  recall: number;
  mandatoryTotal: number;
  mandatoryMatched: number;
  mandatoryRecall: number;
  fatalTotal: number;
  fatalMatched: number;
  fatalRecall: number;
  fatalMisses: GroundTruthRequirement[];
  candidateTotal: number;
  candidateMatched: number;
  precision: number | null;
  citationExpected: number;
  citationEvaluated: number;
  citationCorrect: number;
  unsupportedClaimsEvaluated: number;
  unsupportedClaims: number;
  abstentionCase: boolean;
  correctAbstention: boolean;
  safeFailureCase: boolean;
  correctSafeFailure: boolean;
  missed: GroundTruthRequirement[];
}

export interface EvalReport {
  perTender: TenderRecall[];
  totalGroundTruth: number;
  totalMatched: number;
  overallRecall: number;
  mandatoryGroundTruth: number;
  mandatoryMatched: number;
  mandatoryRecall: number;
  fatalGroundTruth: number;
  fatalMatched: number;
  fatalRecall: number;
  fatalMisses: number;
  totalCandidates: number;
  matchedCandidates: number;
  precision: number | null;
  citationExpected: number;
  citationEvaluated: number;
  citationCorrect: number;
  citationCoverage: number | null;
  citationCorrectness: number | null;
  unsupportedClaimsEvaluated: number;
  unsupportedClaims: number;
  supportEvaluationCoverage: number | null;
  unsupportedClaimRate: number | null;
  abstentionCases: number;
  correctAbstentions: number;
  abstentionAccuracy: number | null;
  safeFailureCases: number;
  correctSafeFailures: number;
  safeFailureRate: number | null;
  /** Legacy fields retained for existing Gate-0 consumers. */
  target: number;
  passed: boolean;
  mandatoryPassed: boolean;
}

export type EvalProfileName = "gate0_non_production" | "production";

export interface EvalGateProfile {
  name: EvalProfileName;
  production: boolean;
  minimumOverallRecall: number;
  minimumMandatoryRecall: number;
  minimumPrecision: number;
  minimumCitationCorrectness: number | null;
  minimumCitationCoverage: number | null;
  maximumFatalMisses: number | null;
  maximumUnsupportedClaimRate: number | null;
  minimumSupportEvaluationCoverage: number | null;
  minimumAbstentionAccuracy: number | null;
  minimumSafeFailureRate: number | null;
}

export const GATE0_NON_PRODUCTION_PROFILE: EvalGateProfile = {
  name: "gate0_non_production",
  production: false,
  minimumOverallRecall: EVAL_RECALL_TARGET_V0,
  minimumMandatoryRecall: EVAL_RECALL_TARGET_V0,
  minimumPrecision: 0,
  minimumCitationCorrectness: null,
  minimumCitationCoverage: null,
  maximumFatalMisses: null,
  maximumUnsupportedClaimRate: null,
  minimumSupportEvaluationCoverage: null,
  minimumAbstentionAccuracy: null,
  minimumSafeFailureRate: null,
};

export const PRODUCTION_EVAL_PROFILE: EvalGateProfile = {
  name: "production",
  production: true,
  minimumOverallRecall: 0.95,
  minimumMandatoryRecall: 0.95,
  minimumPrecision: 0.95,
  minimumCitationCorrectness: 0.98,
  minimumCitationCoverage: 1,
  maximumFatalMisses: 0,
  maximumUnsupportedClaimRate: 0,
  minimumSupportEvaluationCoverage: 1,
  minimumAbstentionAccuracy: 1,
  minimumSafeFailureRate: 1,
};

export interface EvalGateFailure {
  metric: string;
  actual: number | null;
  expected: string;
}

export interface EvalGateResult {
  profile: EvalProfileName;
  production: boolean;
  passed: boolean;
  failures: EvalGateFailure[];
}

export type EvalCorpusCohort =
  | "native_digital"
  | "poor_scan"
  | "long_document"
  | "table_heavy"
  | "multiple_lots"
  | "bpp_style"
  | "nipex_ncdmb"
  | "donor_funded"
  | "addendum"
  | "difficult_negative";

export const REQUIRED_PRODUCTION_COHORTS: readonly EvalCorpusCohort[] = [
  "native_digital",
  "poor_scan",
  "long_document",
  "table_heavy",
  "multiple_lots",
  "bpp_style",
  "nipex_ncdmb",
  "donor_funded",
  "addendum",
  "difficult_negative",
];

export interface EvalCorpusCaseManifest {
  tenderId: string;
  sourceCategory: string;
  sourceReferenceHash: string | null;
  authorizationBasis: string;
  synthetic: boolean;
  productionEligible: boolean;
  split: "development" | "validation" | "holdout";
  cohorts: EvalCorpusCohort[];
  annotationStatus: "unverified" | "single_review" | "adjudicated";
  annotatorIds: string[];
  independentReviewerIds: string[];
  agreementMethod: string | null;
  containsRawSensitiveData: boolean;
}

export interface EvalCorpusManifest {
  schemaVersion: 1;
  corpusVersion: string;
  purpose: "non_production_self_check" | "production_holdout";
  cases: EvalCorpusCaseManifest[];
  limitations: string[];
}

export interface CorpusValidationResult {
  passed: boolean;
  productionEligible: boolean;
  caseCount: number;
  caseIds: string[];
  problems: string[];
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function specSatisfiedBy(normalized: string, spec: string[][]): boolean {
  return spec.every((group) =>
    group.some((alternative) =>
      normalized.includes(normalizeText(alternative)),
    ),
  );
}

export function requirementMatched(
  groundTruth: GroundTruthRequirement,
  normalizedExtracted: string[],
): boolean {
  if (groundTruth.match.length === 0) return false;
  return normalizedExtracted.some((text) =>
    specSatisfiedBy(text, groundTruth.match),
  );
}

function normalizeOutput(output: string[] | EvalModelOutput): EvalModelOutput {
  return Array.isArray(output)
    ? {
        requirements: output.map((text) => ({ text })),
        disposition: "completed",
      }
    : output;
}

/** Maximum one-to-one matching prevents duplicate candidates inflating scores. */
function maximumMatching(
  groundTruth: GroundTruthRequirement[],
  candidates: ExtractedRequirementCandidate[],
): { matchedGroundTruth: Set<number>; matchedCandidates: Set<number> } {
  const normalized = candidates.map((candidate) =>
    normalizeText(candidate.text),
  );
  const candidateToGroundTruth = new Map<number, number>();

  const assign = (groundTruthIndex: number, visited: Set<number>): boolean => {
    const requirement = groundTruth[groundTruthIndex];
    if (!requirement || requirement.match.length === 0) return false;
    for (
      let candidateIndex = 0;
      candidateIndex < normalized.length;
      candidateIndex += 1
    ) {
      if (visited.has(candidateIndex)) continue;
      if (!specSatisfiedBy(normalized[candidateIndex] ?? "", requirement.match))
        continue;
      visited.add(candidateIndex);
      const previous = candidateToGroundTruth.get(candidateIndex);
      if (previous === undefined || assign(previous, visited)) {
        candidateToGroundTruth.set(candidateIndex, groundTruthIndex);
        return true;
      }
    }
    return false;
  };

  for (let index = 0; index < groundTruth.length; index += 1) {
    assign(index, new Set());
  }
  return {
    matchedGroundTruth: new Set(candidateToGroundTruth.values()),
    matchedCandidates: new Set(candidateToGroundTruth.keys()),
  };
}

export function computeTenderRecall(
  tender: EvalTender,
  output: string[] | EvalModelOutput,
): TenderRecall {
  const normalizedOutput = normalizeOutput(output);
  const matching = maximumMatching(
    tender.groundTruth,
    normalizedOutput.requirements,
  );
  const missed = tender.groundTruth.filter(
    (_requirement, index) => !matching.matchedGroundTruth.has(index),
  );
  const mandatory = tender.groundTruth.filter(
    (requirement) => requirement.mandatory,
  );
  const mandatoryMissed = missed.filter((requirement) => requirement.mandatory);
  const fatal = tender.groundTruth.filter(
    (requirement) => requirement.severity === "fatal",
  );
  const fatalMisses = missed.filter(
    (requirement) => requirement.severity === "fatal",
  );
  const citationExpected = normalizedOutput.requirements.filter(
    (candidate) => candidate.citationVerdict !== "not_applicable",
  ).length;
  const citationEvaluated = normalizedOutput.requirements.filter((candidate) =>
    ["correct", "incorrect", "missing"].includes(
      candidate.citationVerdict ?? "",
    ),
  ).length;
  const citationCorrect = normalizedOutput.requirements.filter(
    (candidate) => candidate.citationVerdict === "correct",
  ).length;
  const supportEvaluated = normalizedOutput.requirements.filter(
    (candidate) => typeof candidate.unsupportedClaim === "boolean",
  );
  const expectedBehaviour = tender.expectedBehaviour ?? "extract";
  const noRequirements = normalizedOutput.requirements.length === 0;

  return {
    tenderId: tender.id,
    title: tender.title,
    total: tender.groundTruth.length,
    matched: matching.matchedGroundTruth.size,
    recall:
      tender.groundTruth.length === 0
        ? 1
        : matching.matchedGroundTruth.size / tender.groundTruth.length,
    mandatoryTotal: mandatory.length,
    mandatoryMatched: mandatory.length - mandatoryMissed.length,
    mandatoryRecall:
      mandatory.length === 0
        ? 1
        : (mandatory.length - mandatoryMissed.length) / mandatory.length,
    fatalTotal: fatal.length,
    fatalMatched: fatal.length - fatalMisses.length,
    fatalRecall:
      fatal.length === 0
        ? 1
        : (fatal.length - fatalMisses.length) / fatal.length,
    fatalMisses,
    candidateTotal: normalizedOutput.requirements.length,
    candidateMatched: matching.matchedCandidates.size,
    precision:
      normalizedOutput.requirements.length === 0
        ? null
        : matching.matchedCandidates.size /
          normalizedOutput.requirements.length,
    citationExpected,
    citationEvaluated,
    citationCorrect,
    unsupportedClaimsEvaluated: supportEvaluated.length,
    unsupportedClaims: supportEvaluated.filter(
      (candidate) => candidate.unsupportedClaim === true,
    ).length,
    abstentionCase: expectedBehaviour === "abstain",
    correctAbstention:
      expectedBehaviour === "abstain" &&
      noRequirements &&
      normalizedOutput.disposition === "abstained",
    safeFailureCase: expectedBehaviour === "safe_failure",
    correctSafeFailure:
      expectedBehaviour === "safe_failure" &&
      noRequirements &&
      normalizedOutput.disposition === "safe_failure",
    missed,
  };
}

export function aggregateReport(
  perTender: TenderRecall[],
  target: number = EVAL_RECALL_TARGET_V0,
): EvalReport {
  const sum = (selector: (tender: TenderRecall) => number): number =>
    perTender.reduce((total, tender) => total + selector(tender), 0);
  const totalGroundTruth = sum((tender) => tender.total);
  const totalMatched = sum((tender) => tender.matched);
  const mandatoryGroundTruth = sum((tender) => tender.mandatoryTotal);
  const mandatoryMatched = sum((tender) => tender.mandatoryMatched);
  const fatalGroundTruth = sum((tender) => tender.fatalTotal);
  const fatalMatched = sum((tender) => tender.fatalMatched);
  const totalCandidates = sum((tender) => tender.candidateTotal);
  const matchedCandidates = sum((tender) => tender.candidateMatched);
  const citationExpected = sum((tender) => tender.citationExpected);
  const citationEvaluated = sum((tender) => tender.citationEvaluated);
  const citationCorrect = sum((tender) => tender.citationCorrect);
  const unsupportedClaimsEvaluated = sum(
    (tender) => tender.unsupportedClaimsEvaluated,
  );
  const unsupportedClaims = sum((tender) => tender.unsupportedClaims);
  const abstentionCases = perTender.filter(
    (tender) => tender.abstentionCase,
  ).length;
  const correctAbstentions = perTender.filter(
    (tender) => tender.correctAbstention,
  ).length;
  const safeFailureCases = perTender.filter(
    (tender) => tender.safeFailureCase,
  ).length;
  const correctSafeFailures = perTender.filter(
    (tender) => tender.correctSafeFailure,
  ).length;
  const overallRecall =
    totalGroundTruth === 0 ? 1 : totalMatched / totalGroundTruth;
  const mandatoryRecall =
    mandatoryGroundTruth === 0 ? 1 : mandatoryMatched / mandatoryGroundTruth;

  return {
    perTender,
    totalGroundTruth,
    totalMatched,
    overallRecall,
    mandatoryGroundTruth,
    mandatoryMatched,
    mandatoryRecall,
    fatalGroundTruth,
    fatalMatched,
    fatalRecall: fatalGroundTruth === 0 ? 1 : fatalMatched / fatalGroundTruth,
    fatalMisses: fatalGroundTruth - fatalMatched,
    totalCandidates,
    matchedCandidates,
    precision:
      totalCandidates === 0 ? null : matchedCandidates / totalCandidates,
    citationExpected,
    citationEvaluated,
    citationCorrect,
    citationCoverage:
      citationExpected === 0 ? null : citationEvaluated / citationExpected,
    citationCorrectness:
      citationEvaluated === 0 ? null : citationCorrect / citationEvaluated,
    unsupportedClaimsEvaluated,
    unsupportedClaims,
    supportEvaluationCoverage:
      totalCandidates === 0
        ? null
        : unsupportedClaimsEvaluated / totalCandidates,
    unsupportedClaimRate:
      unsupportedClaimsEvaluated === 0
        ? null
        : unsupportedClaims / unsupportedClaimsEvaluated,
    abstentionCases,
    correctAbstentions,
    abstentionAccuracy:
      abstentionCases === 0 ? null : correctAbstentions / abstentionCases,
    safeFailureCases,
    correctSafeFailures,
    safeFailureRate:
      safeFailureCases === 0 ? null : correctSafeFailures / safeFailureCases,
    target,
    passed: overallRecall + 1e-9 >= target,
    mandatoryPassed: mandatoryRecall + 1e-9 >= target,
  };
}

function requireMinimum(
  failures: EvalGateFailure[],
  metric: string,
  actual: number | null,
  minimum: number | null,
): void {
  if (minimum === null) return;
  if (
    actual === null ||
    !Number.isFinite(actual) ||
    actual < 0 ||
    actual > 1 ||
    actual + 1e-9 < minimum
  ) {
    failures.push({ metric, actual, expected: `>= ${minimum}` });
  }
}

export function evaluateReportAgainstProfile(
  report: EvalReport,
  profile: EvalGateProfile,
): EvalGateResult {
  const failures: EvalGateFailure[] = [];
  requireMinimum(
    failures,
    "overall_recall",
    report.overallRecall,
    profile.minimumOverallRecall,
  );
  requireMinimum(
    failures,
    "mandatory_recall",
    report.mandatoryRecall,
    profile.minimumMandatoryRecall,
  );
  requireMinimum(
    failures,
    "precision",
    report.precision,
    profile.minimumPrecision,
  );
  requireMinimum(
    failures,
    "citation_correctness",
    report.citationCorrectness,
    profile.minimumCitationCorrectness,
  );
  requireMinimum(
    failures,
    "citation_coverage",
    report.citationCoverage,
    profile.minimumCitationCoverage,
  );
  requireMinimum(
    failures,
    "support_evaluation_coverage",
    report.supportEvaluationCoverage,
    profile.minimumSupportEvaluationCoverage,
  );
  requireMinimum(
    failures,
    "abstention_accuracy",
    report.abstentionAccuracy,
    profile.minimumAbstentionAccuracy,
  );
  requireMinimum(
    failures,
    "safe_failure_rate",
    report.safeFailureRate,
    profile.minimumSafeFailureRate,
  );
  if (
    profile.maximumFatalMisses !== null &&
    (!Number.isSafeInteger(report.fatalMisses) ||
      report.fatalMisses < 0 ||
      report.fatalMisses > profile.maximumFatalMisses)
  ) {
    failures.push({
      metric: "fatal_misses",
      actual: report.fatalMisses,
      expected: `<= ${profile.maximumFatalMisses}`,
    });
  }
  if (
    profile.maximumUnsupportedClaimRate !== null &&
    (report.unsupportedClaimRate === null ||
      !Number.isFinite(report.unsupportedClaimRate) ||
      report.unsupportedClaimRate < 0 ||
      report.unsupportedClaimRate > 1 ||
      report.unsupportedClaimRate - 1e-9 > profile.maximumUnsupportedClaimRate)
  ) {
    failures.push({
      metric: "unsupported_claim_rate",
      actual: report.unsupportedClaimRate,
      expected: `<= ${profile.maximumUnsupportedClaimRate}`,
    });
  }
  if (profile.production && report.fatalGroundTruth === 0) {
    failures.push({
      metric: "fatal_case_coverage",
      actual: 0,
      expected: ">= 1 seeded fatal requirement",
    });
  }
  return {
    profile: profile.name,
    production: profile.production,
    passed: failures.length === 0,
    failures,
  };
}

export function validateCorpus(tenders: EvalTender[]): string[] {
  const problems: string[] = [];
  if (tenders.length < EVAL_MIN_CORPUS) {
    problems.push(
      `corpus has ${tenders.length} tenders, need >= ${EVAL_MIN_CORPUS}`,
    );
  }
  const seenTenderIds = new Set<string>();
  for (const tender of tenders) {
    if (seenTenderIds.has(tender.id))
      problems.push(`duplicate tender id: ${tender.id}`);
    seenTenderIds.add(tender.id);
    if (!tender.documentText.trim())
      problems.push(`${tender.id}: empty documentText`);
    const expected = tender.expectedBehaviour ?? "extract";
    if (expected === "extract" && tender.groundTruth.length === 0) {
      problems.push(`${tender.id}: no ground-truth requirements`);
    }
    if (
      expected === "extract" &&
      !tender.groundTruth.some((requirement) => requirement.mandatory)
    ) {
      problems.push(`${tender.id}: no mandatory ground-truth requirement`);
    }
    const seenRequirementIds = new Set<string>();
    for (const requirement of tender.groundTruth) {
      if (seenRequirementIds.has(requirement.id)) {
        problems.push(
          `${tender.id}: duplicate requirement id ${requirement.id}`,
        );
      }
      seenRequirementIds.add(requirement.id);
      if (!requirement.label.trim())
        problems.push(`${tender.id}/${requirement.id}: empty label`);
      if (requirement.match.length === 0) {
        problems.push(`${tender.id}/${requirement.id}: empty match spec`);
      }
      if (
        requirement.match.some(
          (group) =>
            group.length === 0 ||
            group.some((alternative) => !alternative.trim()),
        )
      ) {
        problems.push(
          `${tender.id}/${requirement.id}: match spec has an empty group or alternative`,
        );
      }
    }
  }
  return problems;
}

export function validateCorpusManifest(
  tenders: EvalTender[],
  manifest: EvalCorpusManifest,
  profile: EvalGateProfile,
): CorpusValidationResult {
  const problems = validateCorpus(tenders);
  if (manifest.schemaVersion !== 1) {
    problems.push(
      `unsupported manifest schema version: ${manifest.schemaVersion}`,
    );
  }
  if (!manifest.corpusVersion.trim()) {
    problems.push("manifest corpus version missing");
  }
  if (
    manifest.limitations.length === 0 ||
    manifest.limitations.some((limitation) => !limitation.trim())
  ) {
    problems.push("manifest limitations must be explicit");
  }
  const manifestIds = new Set<string>();
  for (const entry of manifest.cases) {
    if (manifestIds.has(entry.tenderId)) {
      problems.push(`manifest duplicate tender id: ${entry.tenderId}`);
    }
    manifestIds.add(entry.tenderId);
    if (!entry.sourceCategory.trim()) {
      problems.push(`${entry.tenderId}: source category missing`);
    }
    if (!entry.authorizationBasis.trim()) {
      problems.push(`${entry.tenderId}: authorization basis missing`);
    }
    if (entry.containsRawSensitiveData) {
      problems.push(
        `${entry.tenderId}: raw sensitive data is prohibited in the manifest`,
      );
    }
  }
  for (const tender of tenders) {
    if (!manifestIds.has(tender.id))
      problems.push(`${tender.id}: manifest entry missing`);
  }
  for (const id of manifestIds) {
    if (!tenders.some((tender) => tender.id === id)) {
      problems.push(`${id}: manifest entry has no corpus case`);
    }
  }

  if (profile.production) {
    if (manifest.purpose !== "production_holdout") {
      problems.push(
        "production evaluation requires a production_holdout manifest",
      );
    }
    if (tenders.length < EVAL_PRODUCTION_MIN_CORPUS) {
      problems.push(
        `production corpus has ${tenders.length} cases, need >= ${EVAL_PRODUCTION_MIN_CORPUS}`,
      );
    }
    const cohorts = new Set(manifest.cases.flatMap((entry) => entry.cohorts));
    for (const cohort of REQUIRED_PRODUCTION_COHORTS) {
      if (!cohorts.has(cohort))
        problems.push(`production cohort missing: ${cohort}`);
    }
    for (const entry of manifest.cases) {
      if (!entry.productionEligible) {
        problems.push(
          `${entry.tenderId}: not approved for production evaluation`,
        );
      }
      if (entry.synthetic) {
        problems.push(`${entry.tenderId}: synthetic case is self-check only`);
      }
      if (entry.split !== "holdout") {
        problems.push(
          `${entry.tenderId}: production case is not in the holdout split`,
        );
      }
      if (
        entry.annotationStatus !== "adjudicated" ||
        entry.annotatorIds.length === 0 ||
        entry.independentReviewerIds.length === 0 ||
        !entry.agreementMethod?.trim()
      ) {
        problems.push(
          `${entry.tenderId}: annotation/adjudication evidence incomplete`,
        );
      }
      if (!/^sha256:[a-f0-9]{64}$/i.test(entry.sourceReferenceHash ?? "")) {
        problems.push(`${entry.tenderId}: source reference hash missing`);
      }
      if (
        entry.annotatorIds.some((annotator) =>
          entry.independentReviewerIds.includes(annotator),
        )
      ) {
        problems.push(
          `${entry.tenderId}: annotator and independent reviewer identities overlap`,
        );
      }
    }
  }

  return {
    passed: problems.length === 0,
    productionEligible: profile.production && problems.length === 0,
    caseCount: tenders.length,
    caseIds: manifest.cases.map((entry) => entry.tenderId),
    problems,
  };
}
